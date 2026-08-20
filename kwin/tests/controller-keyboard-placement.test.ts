import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    countEvent,
    currentScopeFor,
    focusSetup,
    Harness,
    invokeShortcut,
    OUTPUT,
    qv4MethodSignal,
    RECT,
    setFullscreen,
    setMaximized,
    setSticky,
    setup,
    tile,
    type TestSignal,
    type TestTile,
    window,
} from "./controller-fixtures";
import { MAX_SEQUENTIAL_LENGTH } from "../src/boundary";
import { PROFILE_CATALOGS, REGISTERED_PROFILE_ACTION_IDS, TileController } from "../src/controller";
import { DIRECTIONS, type Direction } from "../src/logic";
describe("TileController keyboard insertion", () => {
    it("arms only a strict eligible occupied focused leaf without mutating topology", () => {
        const { controller, target } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        controller.armKeyboardInsertion("right");
        assert.equal(controller.hasPendingKeyboard, true);
        assert.equal(splits, 0);

        const rejected = setup();
        rejected.harness.active = window({ resizeable: false, tile: rejected.target });
        rejected.target.windows = [rejected.harness.active];
        rejected.controller.armKeyboardInsertion("right");
        assert.equal(rejected.controller.hasPendingKeyboard, false);
        assert.equal(splits, 0);
    });

    it("keeps the focused window left and places the incoming window right", () => {
        const { harness, controller, target, focused } = setup();
        const managed: unknown[] = [];
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        let splits = 0;
        target.split = () => {
            splits += 1;
            target.isLayout = true;
            target.tiles = [left, right];
            return [right, left];
        };
        const incoming = window();
        controller.armKeyboardInsertion("right");
        harness.emitAdded(incoming);
        assert.equal(splits, 1);
        assert.deepEqual(managed, [focused, incoming]);
        assert.equal(controller.hasPendingKeyboard, false);
    });

    it("uses the singleton tile occupant when KWin returns a distinct active-window wrapper", () => {
        const { harness, controller, target } = setup();
        const occupant = window({ tile: target });
        target.windows = [occupant];
        const managed: unknown[] = [];
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        target.split = () => {
            target.isLayout = true;
            target.tiles = [left, right];
            return [left, right];
        };

        const incoming = window();
        controller.armKeyboardInsertion("right");
        harness.emitAdded(incoming);

        assert.deepEqual(managed, [occupant, incoming]);
        assert.equal(countEvent(harness.logs, "keyboard-armed:target-occupant-wrapper"), 1);
        assert.equal(countEvent(harness.logs, "keyboard-completed"), 1);
    });

    it("revalidates the active window immediately before a pending split", () => {
        const { harness, controller, target } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        controller.armKeyboardInsertion("right");
        harness.active = null;
        harness.emitAdded(window());

        assert.equal(splits, 0);
        assert.equal(controller.hasPendingKeyboard, false);
    });

    it("clears pending state and disables once when a mutated split returns malformed children", () => {
        const { harness, controller, target } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            target.isLayout = true;
            return [];
        };
        controller.armKeyboardInsertion("right");
        harness.emitAdded(window());
        harness.emitAdded(window());
        assert.equal(splits, 1);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "disabled:keyboard-split-child-selection-failed"), 1);
    });

    it("disables once when the split result fails the runtime decode boundary", () => {
        const { harness, controller, target } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            target.isLayout = true;
            return [null, null];
        };
        controller.armKeyboardInsertion("right");
        harness.emitAdded(window());
        harness.emitAdded(window());
        assert.equal(splits, 1);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "disabled:keyboard-split-result-invalid"), 1);
    });

    it("clears pending state when manage fails and does not manage the incoming window", () => {
        const { harness, controller, target } = setup();
        let incomingManages = 0;
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, false, () => false);
        const right = tile({ x: 50, y: 0, width: 50, height: 100 }, false, () => {
            incomingManages += 1;
            return true;
        });
        target.split = () => [left, right];
        controller.armKeyboardInsertion("right");
        harness.emitAdded(window());
        assert.equal(incomingManages, 0);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(controller.isEnabled, true);
    });

    it("clears armed state on output and desktop scope changes", () => {
        const { controller, harness, root, target, focused } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        // A retained empty leaf lets the owned scope's automatic placement
        // absorb each post-clear eligible add without a structural split, so
        // the assertion below isolates arm-clearing from dwindle insertion.
        const empty = tile();
        root.tiles = [target, empty];
        controller.armKeyboardInsertion("right");
        if (harness.screensChanged !== undefined) {
            harness.screensChanged();
        }
        harness.emitAdded(window());
        controller.armKeyboardInsertion("right");
        if (harness.desktopChanged !== undefined) {
            harness.emitCurrentDesktopChanged(null, null, null);
        }
        harness.emitAdded(window());
        controller.armKeyboardInsertion("right");
        focused.outputChanged.emit();
        harness.emitAdded(window());
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(splits, 0);
    });

    it("clears an armed insertion when the source active window is removed even when the target occupant is a distinct wrapper", () => {
        const { harness, controller, root, target } = setup();
        const occupant = window({ tile: target });
        target.windows = [occupant];
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        // A retained empty leaf lets the owned scope's automatic placement
        // absorb the post-clear eligible add without a structural split, so
        // the assertion below isolates arm-clearing from dwindle insertion.
        const empty = tile();
        root.tiles = [target, empty];
        controller.armKeyboardInsertion("right");
        assert.equal(controller.hasPendingKeyboard, true);
        assert.equal(countEvent(harness.logs, "keyboard-armed:target-occupant-wrapper"), 1);

        harness.emitRemoved(harness.active);
        harness.emitAdded(window());

        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(occupant.outputChanged.subscriberCount, 0);
        assert.equal(splits, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("tolerates duplicate removal notifications without lingering pending state", () => {
        const { harness, controller, target } = setup();
        const occupant = window({ tile: target });
        target.windows = [occupant];
        controller.armKeyboardInsertion("right");
        harness.emitRemoved(harness.active);
        harness.emitRemoved(harness.active);
        harness.emitRemoved(occupant);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(occupant.outputChanged.subscriberCount, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("registers the four directional insertion actions with exact metadata and per-direction arm callbacks", () => {
        const { harness } = setup();
        const expected: readonly [string, string, string][] = [
            ["plasma-auto-tiler-insert-right", "Insert next window right of focused leaf", "Meta+Alt+Right"],
            ["plasma-auto-tiler-insert-left", "Insert next window left of focused leaf", "Meta+Alt+Left"],
            ["plasma-auto-tiler-insert-up", "Insert next window up of focused leaf", "Meta+Alt+Up"],
            ["plasma-auto-tiler-insert-down", "Insert next window down of focused leaf", "Meta+Alt+Down"],
        ];
        for (const [name, text, sequence] of expected) {
            const registered = harness.shortcuts.find((entry) => entry.name === name);
            assert.ok(registered !== undefined, `missing registration ${name}`);
            assert.equal(registered.text, text);
            assert.equal(registered.sequence, sequence);
            assert.equal(typeof registered.handler, "function");
        }
    });

    it("maps every direction to the correct split orientation and child assignment", () => {
        const cases: readonly { direction: Direction; splitDirection: number }[] = [
            { direction: "right", splitDirection: 1 },
            { direction: "left", splitDirection: 1 },
            { direction: "up", splitDirection: 2 },
            { direction: "down", splitDirection: 2 },
        ];
        for (const { direction, splitDirection } of cases) {
            const { harness, controller, target, focused } = setup();
            const splits: number[] = [];
            const managed: Array<[TestTile, unknown]> = [];
            const axis = direction === "left" || direction === "right" ? "x" : "y";
            const first = tile({ x: 0, y: 0, width: 50, height: 50 });
            const second = tile({
                x: axis === "x" ? 50 : 0,
                y: axis === "x" ? 0 : 50,
                width: 50,
                height: 50,
            });
            const manage = (leaf: TestTile) => (value: unknown): boolean => {
                managed.push([leaf, value]);
                return true;
            };
            first.manage = manage(first);
            second.manage = manage(second);
            target.split = (directionArg) => {
                splits.push(directionArg);
                target.isLayout = true;
                target.tiles = [first, second];
                return [second, first];
            };
            invokeShortcut(harness, `plasma-auto-tiler-insert-${direction}`);
            const incoming = window();
            harness.emitAdded(incoming);
            assert.equal(controller.hasPendingKeyboard, false);
            assert.deepEqual(splits, [splitDirection]);
            // The revalidated source occupant is assigned first to the child
            // opposite the requested side; the incoming window lands on the
            // requested side second.
            const expected: Array<[TestTile, unknown]> =
                direction === "right" || direction === "down"
                    ? [[first, focused], [second, incoming]]
                    : [[second, focused], [first, incoming]];
            assert.deepEqual(managed, expected);
            assert.equal(countEvent(harness.logs, "keyboard-completed"), 1);
            assert.equal(countEvent(harness.logs, "keyboard-failed:first-assignment"), 0);
            assert.equal(countEvent(harness.logs, "keyboard-failed:second-assignment"), 0);
        }
    });

    it("arms keyboard insertion when target scope signals are function-valued QV4 signals (approximating QJSEngine shape, not live proof)", () => {
        const { harness, controller, focused } = setup();
        const outputChanged = qv4MethodSignal();
        const desktopsChanged = qv4MethodSignal();
        const tileChanged = qv4MethodSignal();
        const qv4Signals: Record<string, TestSignal & (() => void)> = {
            outputChanged,
            desktopsChanged,
            tileChanged,
        };
        for (const name of Object.keys(qv4Signals)) {
            Object.defineProperty(focused, name, {
                get: () => qv4Signals[name],
                enumerable: false,
                configurable: true,
            });
        }
        controller.armKeyboardInsertion("right");
        assert.equal(controller.hasPendingKeyboard, true);
        assert.equal(countEvent(harness.logs, "keyboard-rejected:target-occupancy-validity"), 0);
        assert.equal(countEvent(harness.logs, "pending-attach-ok:outputChanged"), 1);
        assert.equal(countEvent(harness.logs, "pending-attach-ok:desktopsChanged"), 1);
        assert.equal(countEvent(harness.logs, "pending-attach-ok:tileChanged"), 1);
        outputChanged.emit();
        assert.equal(controller.hasPendingKeyboard, false);
    });

    it("re-arming atomically replaces the recorded source and direction", () => {
        const { harness, controller, target } = setup();
        const other = window({ tile: target });
        target.windows = [harness.active, other];
        const splits: number[] = [];
        const managed: Array<[TestTile, unknown]> = [];
        const first = tile({ x: 0, y: 0, width: 50, height: 100 });
        const second = tile({ x: 0, y: 50, width: 100, height: 50 });
        const manage = (leaf: TestTile) => (value: unknown): boolean => {
            managed.push([leaf, value]);
            return true;
        };
        first.manage = manage(first);
        second.manage = manage(second);
        target.split = (directionArg) => {
            splits.push(directionArg);
            target.isLayout = true;
            target.tiles = [first, second];
            return [first, second];
        };
        controller.armKeyboardInsertion("left");
        harness.active = other;
        controller.armKeyboardInsertion("up");
        assert.equal(countEvent(harness.logs, "keyboard-pending-replaced"), 1);
        assert.equal(controller.hasPendingKeyboard, true);
        const incoming = window();
        harness.emitAdded(incoming);
        // The latest arm (up) wins: vertical split, re-armed source occupant
        // kept in the bottom child, incoming placed on top.
        assert.deepEqual(splits, [2]);
        assert.deepEqual(managed, [[second, other], [first, incoming]]);
        assert.equal(countEvent(harness.logs, "keyboard-completed"), 1);
    });

    it("clears an armed insertion when the source or target window is removed in every direction", () => {
        for (const direction of DIRECTIONS) {
            const { harness, controller } = setup();
            controller.armKeyboardInsertion(direction);
            assert.equal(controller.hasPendingKeyboard, true);
            harness.emitRemoved(harness.active);
            assert.equal(controller.hasPendingKeyboard, false);
            assert.equal(controller.isEnabled, true);

            const targetSetup = setup();
            const occupant = window({ tile: targetSetup.target });
            targetSetup.target.windows = [occupant];
            targetSetup.controller.armKeyboardInsertion(direction);
            assert.equal(targetSetup.controller.hasPendingKeyboard, true);
            targetSetup.harness.emitRemoved(occupant);
            assert.equal(targetSetup.controller.hasPendingKeyboard, false);
            assert.equal(occupant.outputChanged.subscriberCount, 0);
            assert.equal(targetSetup.controller.isEnabled, true);
        }
    });

    it("revalidates target occupancy and scope immediately before a pending split", () => {
        const { harness, controller, target } = setup();
        const occupant = window({ tile: target });
        target.windows = [occupant];
        const splits: number[] = [];
        target.split = (directionArg) => {
            splits.push(directionArg);
            return [];
        };
        controller.armKeyboardInsertion("right");
        occupant.output = { ...OUTPUT, name: "screen-2" };
        harness.emitAdded(window());
        assert.equal(splits.length, 0);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(controller.isEnabled, true);
    });

    it("reports a fixed first-assignment diagnostic and stops without claiming rollback", () => {
        for (const direction of DIRECTIONS) {
            const { harness, controller, target } = setup();
            const axis = direction === "left" || direction === "right" ? "x" : "y";
            const first = tile({ x: 0, y: 0, width: 50, height: 50 });
            const second = tile({
                x: axis === "x" ? 50 : 0,
                y: axis === "x" ? 0 : 50,
                width: 50,
                height: 50,
            });
            const occupantChild = direction === "left" || direction === "up" ? second : first;
            const incomingChild = occupantChild === first ? second : first;
            let incomingManages = 0;
            occupantChild.manage = () => false;
            incomingChild.manage = () => {
                incomingManages += 1;
                return true;
            };
            target.split = () => {
                target.isLayout = true;
                target.tiles = [first, second];
                return [first, second];
            };
            controller.armKeyboardInsertion(direction);
            harness.emitAdded(window());
            assert.equal(countEvent(harness.logs, "keyboard-failed:first-assignment"), 1);
            assert.equal(incomingManages, 0);
            assert.equal(controller.hasPendingKeyboard, false);
            assert.equal(controller.isEnabled, true);
            assert.equal(harness.logs.some((entry) => entry.includes("rollback")), false);
        }
    });

    it("reports a fixed second-assignment diagnostic after the source succeeds", () => {
        const { harness, controller, target, focused } = setup();
        const managed: unknown[] = [];
        const first = tile({ x: 0, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        const second = tile({ x: 50, y: 0, width: 50, height: 100 }, false, () => false);
        target.split = () => {
            target.isLayout = true;
            target.tiles = [first, second];
            return [first, second];
        };
        controller.armKeyboardInsertion("right");
        harness.emitAdded(window());
        assert.deepEqual(managed, [focused]);
        assert.equal(countEvent(harness.logs, "keyboard-failed:second-assignment"), 1);
        assert.equal(countEvent(harness.logs, "keyboard-completed"), 0);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(controller.isEnabled, true);
        assert.equal(harness.logs.some((entry) => entry.includes("rollback")), false);
    });

    it("keeps armed insertion independent of selected-overlay state", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const source = tile();
        const insertTarget = tile({ x: 200, y: 0, width: 100, height: 100 });
        const active = window({ tile: source });
        source.windows = [active];
        root.tiles = [source, insertTarget];
        harness.root = root;
        harness.active = active;
        harness.windows = [active];
        const controller = new TileController(harness.environment());
        controller.start();

        invokeShortcut(harness, "plasma-auto-tiler-apply-columns");
        assert.equal(countEvent(harness.logs, "preset-applied:columns"), 1);
        const scope = currentScopeFor(active);
        assert.ok(controller.readSelectedOverlay(scope) !== null);

        const insertWindow = window({ tile: insertTarget });
        insertTarget.windows = [insertWindow];
        harness.active = insertWindow;
        const first = tile({ x: 0, y: 0, width: 50, height: 100 });
        const second = tile({ x: 50, y: 0, width: 50, height: 100 });
        insertTarget.split = () => {
            insertTarget.isLayout = true;
            insertTarget.tiles = [first, second];
            return [first, second];
        };
        controller.armKeyboardInsertion("right");
        harness.emitAdded(window());
        assert.equal(countEvent(harness.logs, "keyboard-completed"), 1);
        assert.equal(countEvent(harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(harness.logs, "selected-overlay-invalidated"), 0);
        const overlay = controller.readSelectedOverlay(scope);
        assert.ok(overlay !== null);
        assert.equal(overlay.root, source);
        assert.deepEqual(overlay.leaves, [source]);
    });
});
describe("TileController ordinary placement and boundaries", () => {
    it("selects the deterministic retained empty leaf and only manages it", () => {
        const { harness, root } = setup();
        const managed: unknown[] = [];
        const below = tile({ x: 0, y: 50, width: 100, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        const above = tile({ x: 0, y: 0, width: 100, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        let splits = 0;
        below.split = () => {
            splits += 1;
            return [];
        };
        above.split = () => {
            splits += 1;
            return [];
        };
        root.tiles = [below, above];
        const incoming = window();
        harness.emitAdded(incoming);
        assert.deepEqual(managed, [incoming]);
        assert.equal(splits, 0);
    });

    it("does not mutate when no retained empty leaf or strict scope eligibility exists", () => {
        const { harness, root, target } = setup();
        let manages = 0;
        target.manage = () => {
            manages += 1;
            return true;
        };
        root.tiles = [target];
        harness.emitAdded(window());
        harness.emitAdded(window({ appletPopup: true }));
        harness.emitAdded(window({ output: { ...OUTPUT } }));
        assert.equal(manages, 0);
    });

    it("fails inert for malformed, cyclic, and over-bounded tile lists", () => {
        const malformed = setup();
        malformed.root.tiles = { 0: malformed.target, length: 2 };
        malformed.harness.emitAdded(window());

        const cyclic = setup();
        cyclic.root.tiles = [cyclic.root];
        cyclic.harness.emitAdded(window());

        const bounded = setup();
        const tooMany: TestTile[] = [];
        for (let index = 0; index <= MAX_SEQUENTIAL_LENGTH; index += 1) {
            tooMany.push(tile());
        }
        bounded.root.tiles = tooMany;
        bounded.harness.emitAdded(window());

        assert.equal(malformed.controller.isEnabled, true);
        assert.equal(cyclic.controller.isEnabled, true);
        assert.equal(bounded.controller.isEnabled, true);
    });

    it("contains handler exceptions, logs once, and clears pending state", () => {
        const { harness, controller, target } = setup();
        target.split = () => {
            throw "split";
        };
        controller.armKeyboardInsertion("right");
        harness.emitAdded(window());
        harness.emitAdded(window());
        assert.equal(controller.isEnabled, false);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(countEvent(harness.logs, "disabled:exception"), 1);
    });
});

describe("TileController keyboard focus", () => {
    const insertActions: ReadonlyArray<readonly ["right" | "left" | "up" | "down", string, string, string]> = [
        ["right", "plasma-auto-tiler-insert-right", "Insert next window right of focused leaf", "Meta+Alt+Right"],
        ["left", "plasma-auto-tiler-insert-left", "Insert next window left of focused leaf", "Meta+Alt+Left"],
        ["up", "plasma-auto-tiler-insert-up", "Insert next window up of focused leaf", "Meta+Alt+Up"],
        ["down", "plasma-auto-tiler-insert-down", "Insert next window down of focused leaf", "Meta+Alt+Down"],
    ];
    const focusActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-focus-left", "Focus window left", "Meta+H"],
        ["down", "plasma-auto-tiler-focus-down", "Focus window down", "Meta+J"],
        ["up", "plasma-auto-tiler-focus-up", "Focus window up", "Meta+K"],
        ["right", "plasma-auto-tiler-focus-right", "Focus window right", "Meta+L"],
    ];
    const focusArrowActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-focus-left-arrow", "Focus window left (arrow)", "Meta+Left"],
        ["down", "plasma-auto-tiler-focus-down-arrow", "Focus window down (arrow)", "Meta+Down"],
        ["up", "plasma-auto-tiler-focus-up-arrow", "Focus window up (arrow)", "Meta+Up"],
        ["right", "plasma-auto-tiler-focus-right-arrow", "Focus window right (arrow)", "Meta+Right"],
    ];
    const presetActions: ReadonlyArray<readonly [string, string, string]> = [
        ["plasma-auto-tiler-apply-columns", "Apply columns in focused leaf", "Meta+Alt+1"],
        ["plasma-auto-tiler-apply-rows", "Apply rows in focused leaf", "Meta+Alt+2"],
        ["plasma-auto-tiler-apply-balanced-grid", "Apply balanced grid in focused leaf", "Meta+Alt+3"],
        ["plasma-auto-tiler-apply-dwindle", "Apply dwindle in focused leaf", "Meta+Alt+4"],
    ];
    // The keyboard-focus suite uses only the focus families for its guard loop;
    // move/workspace registrations are catalog-derived and asserted through the
    // binding-profile-catalog suite and the actionCatalog set.
    const projectActionCatalog: ReadonlyArray<readonly [string, string, string]> = [
        ["plasma-auto-tiler-detach", "Detach window from tile", "Meta+Shift+Space"],
        ["plasma-auto-tiler-attach", "Attach window to available tile", "Meta+Alt+Shift+Space"],
        ["plasma-auto-tiler-sticky-toggle", "Toggle sticky floating on all desktops", "Meta+Shift+G"],
        ["plasma-auto-tiler-fill-scope", "Fill available tiles with windows", "Meta+Alt+Return"],
    ];
    // Expected registration is catalog-driven: the selected profile's own
    // non-deferred rows whose actionId has an implemented callback, in catalog
    // order, plus the fixed project-only rows. Meta+0 (workspace-0) and
    // Meta+Shift+0 (move-workspace-0) are both registered catalog rows.
    const catalogActionCatalog: ReadonlyArray<readonly [string, string, string]> = PROFILE_CATALOGS.cosmic.rows
        .filter((row) => row.classification !== "deferred" && REGISTERED_PROFILE_ACTION_IDS.has(row.actionId))
        .map((row) => [row.shortcutId, row.text, row.sequence] as const);

    const actionCatalog: ReadonlyArray<readonly [string, string, string]> = [
        ...insertActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...catalogActionCatalog,
        ...projectActionCatalog,
        ...presetActions,
    ];

    it("registers the exact current action catalog in order", () => {
        const { harness } = setup();
        assert.deepEqual(
            harness.shortcuts.map(({ name, text, sequence }) => [name, text, sequence]),
            actionCatalog,
        );
    });

    it("disables for every aggregate registration failure and keeps every catalog callback inert", () => {
        for (let failedIndex = 0; failedIndex < actionCatalog.length; failedIndex += 1) {
            const harness = new Harness();
            for (let index = 0; index < actionCatalog.length; index += 1) {
                harness.shortcutResults.push(index !== failedIndex);
            }
            const controller = new TileController(harness.environment());
            controller.start();
            assert.equal(harness.shortcuts.length, actionCatalog.length);
            assert.equal(controller.isEnabled, false);
            assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
            assert.equal(countEvent(harness.logs, "startup-handlers-ready"), 0);
            assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
            const baseline = harness.logs.length;
            for (const [name] of actionCatalog) {
                invokeShortcut(harness, name);
            }
            harness.emitAdded(window());
            harness.emitRemoved(window());
            harness.screensChanged?.();
            harness.emitCurrentDesktopChanged(null, null, null);
            assert.equal(harness.logs.length, baseline);
            assert.deepEqual(harness.activeWrites, []);
            assert.equal(controller.hasPendingKeyboard, false);
        }
    });

    it("maps every focus guard to its first fixed private reason", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof focusSetup>) => void;
        }> = [
            {
                reason: "focus-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "focus-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "focus-rejected:active-window-eligibility",
                configure: (state) => {
                    state.focused.resizeable = false;
                },
            },
            {
                reason: "focus-rejected:root-lookup",
                configure: (state) => {
                    state.harness.root = null;
                },
            },
            {
                reason: "focus-rejected:topology-decode",
                configure: (state) => {
                    state.root.tiles = { length: 1 };
                },
            },
            {
                reason: "focus-rejected:active-tile-association",
                configure: (state) => {
                    state.focused.tile = null;
                },
            },
            {
                reason: "focus-rejected:focused-occupancy-validity",
                configure: (state) => {
                    state.focusedTile.windows = [];
                },
            },
            {
                reason: "focus-rejected:no-neighbor",
                configure: (state) => {
                    state.root.tiles = [state.focusedTile];
                },
            },
            {
                reason: "focus-rejected:no-neighbor",
                configure: (state) => {
                    state.neighbor.windows = [];
                },
            },
            {
                reason: "focus-rejected:no-neighbor",
                configure: (state) => {
                    state.neighborWindow.normalWindow = false;
                },
            },
        ];
        for (const testCase of cases) {
            const state = focusSetup("right");
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
                ["plasma-auto-tiler:focus-invoked", `plasma-auto-tiler:${testCase.reason}`],
            );
            assert.deepEqual(state.harness.activeWrites, []);
        }
    });

    it("focuses the exact eligible directional target without mutating topology or associations", () => {
        for (const [direction, name] of [...focusActions, ...focusArrowActions]) {
            const state = focusSetup(direction);
            const rootTiles = state.root.tiles;
            const focusedWindows = state.focusedTile.windows;
            const targetWindows = state.neighbor.windows;
            invokeShortcut(state.harness, name);
            assert.deepEqual(state.harness.activeWrites, [state.neighborWindow]);
            assert.equal(state.harness.writtenActive, state.neighborWindow);
            assert.equal(state.root.tiles, rootTiles);
            assert.equal(state.focusedTile.windows, focusedWindows);
            assert.equal(state.neighbor.windows, targetWindows);
            assert.equal(state.focused.tile, state.focusedTile);
            assert.equal(state.neighborWindow.tile, state.neighbor);
            assert.deepEqual(
                state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
                ["plasma-auto-tiler:focus-invoked"],
            );
        }
    });

    it("focuses an occupied neighbor whose leaf touches the focused leaf edge", () => {
        const state = focusSetup("right");
        state.neighbor.relativeGeometry = { x: 100, y: 0, width: 100, height: 100 };
        state.neighbor.absoluteGeometry = state.neighbor.relativeGeometry;
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.deepEqual(state.harness.activeWrites, [state.neighborWindow]);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
            ["plasma-auto-tiler:focus-invoked"],
        );
    });

    it("uses the nearest selector target and remains deterministic on repeats", () => {
        const state = focusSetup("right");
        const farther = tile({ x: 400, y: 0, width: 100, height: 100 });
        const fartherWindow = window({ tile: farther });
        farther.windows = [fartherWindow];
        state.root.tiles = [state.focusedTile, farther, state.neighbor];
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.deepEqual(state.harness.activeWrites, [state.neighborWindow, state.neighborWindow]);
        assert.notEqual(state.harness.writtenActive, fartherWindow);
    });

    it("skips a nearer empty leaf and focuses the farther eligible occupied neighbor", () => {
        const state = focusSetup("right");
        const empty = tile({ x: 150, y: 0, width: 100, height: 100 });
        state.root.tiles = [state.focusedTile, empty, state.neighbor];
        const rootTiles = state.root.tiles;
        const focusedWindows = state.focusedTile.windows;
        const emptyWindows = empty.windows;
        const neighborWindows = state.neighbor.windows;
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.deepEqual(state.harness.activeWrites, [state.neighborWindow]);
        assert.equal(state.harness.writtenActive, state.neighborWindow);
        assert.equal(state.root.tiles, rootTiles);
        assert.equal(state.focusedTile.windows, focusedWindows);
        assert.equal(empty.windows, emptyWindows);
        assert.equal(state.neighbor.windows, neighborWindows);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
            ["plasma-auto-tiler:focus-invoked"],
        );
    });

    it("skips a nearer ineligible leaf and focuses the farther eligible occupied neighbor", () => {
        const state = focusSetup("right");
        const nearer = tile({ x: 150, y: 0, width: 100, height: 100 });
        nearer.windows = [window({ tile: nearer, normalWindow: false })];
        state.root.tiles = [state.focusedTile, nearer, state.neighbor];
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.deepEqual(state.harness.activeWrites, [state.neighborWindow]);
        assert.equal(state.harness.writtenActive, state.neighborWindow);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
            ["plasma-auto-tiler:focus-invoked"],
        );
    });

    it("rejects with no-neighbor when only empty or ineligible leaves remain", () => {
        const state = focusSetup("right");
        state.root.tiles = [state.focusedTile, tile({ x: 150, y: 0, width: 100, height: 100 })];
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
            ["plasma-auto-tiler:focus-invoked", "plasma-auto-tiler:focus-rejected:no-neighbor"],
        );
        assert.deepEqual(state.harness.activeWrites, []);
    });

    it("deterministically focuses the same farther eligible target on repeats", () => {
        const state = focusSetup("right");
        const empty = tile({ x: 150, y: 0, width: 100, height: 100 });
        state.root.tiles = [state.focusedTile, empty, state.neighbor];
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.deepEqual(state.harness.activeWrites, [state.neighborWindow, state.neighborWindow]);
        assert.equal(state.harness.writtenActive, state.neighborWindow);
    });

    it("contains focus diagnostic sink failures without changing the focus result", () => {
        const state = focusSetup("right");
        state.harness.throwOnLog = true;
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.equal(state.controller.isEnabled, true);
        assert.deepEqual(state.harness.activeWrites, [state.neighborWindow]);
    });

    it("bails focus with the specific reason for fullscreen, sticky, and maximized active windows", () => {
        const gates: ReadonlyArray<{ readonly label: string; readonly configure: (state: ReturnType<typeof focusSetup>) => void }> = [
            { label: "focus-rejected:fullscreen", configure: (state) => setFullscreen(state.focused, true) },
            { label: "focus-rejected:sticky", configure: (state) => setSticky(state.focused, true) },
            { label: "focus-rejected:maximized", configure: (state) => setMaximized(state.focused, 3) },
        ];
        for (const gate of gates) {
            const state = focusSetup("right");
            const baseline = state.harness.logs.length;
            gate.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
            assert.deepEqual(state.harness.activeWrites, []);
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:focus-")),
                ["plasma-auto-tiler:focus-invoked", `plasma-auto-tiler:${gate.label}`],
            );
        }
    });
});
