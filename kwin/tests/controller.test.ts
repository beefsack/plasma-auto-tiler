import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEQUENTIAL_LENGTH } from "../src/boundary";
import { TileController, type ControllerEnvironment } from "../src/controller";

const RECT = { x: 0, y: 0, width: 100, height: 100 };
const OUTPUT = {
    geometry: RECT,
    name: "screen-1",
    manufacturer: "KDE",
    model: "test",
    serialNumber: "1",
};
const DESKTOP = { id: "desktop-1" };

interface TestWindow {
    normalWindow: boolean;
    managed: boolean;
    resizeable: boolean;
    appletPopup: boolean;
    desktops: unknown;
    output: typeof OUTPUT | null;
    tile: object | null;
    frameGeometry: typeof RECT;
    move: boolean;
    resize: boolean;
    outputChanged: TestSignal;
    desktopsChanged: TestSignal;
    tileChanged: TestSignal;
    interactiveMoveResizeStarted: TestSignal;
    interactiveMoveResizeFinished: TestSignal;
}

interface TestSignal {
    connect(callback: () => void): void;
    disconnect(callback: () => void): void;
    emit(): void;
    readonly subscriberCount: number;
}

interface TestTile {
    relativeGeometry: typeof RECT;
    absoluteGeometry: typeof RECT;
    parent: object | null;
    tiles: unknown;
    windows: unknown;
    isLayout: boolean;
    canBeRemoved: boolean;
    layoutDirection: number;
    manage: (window: unknown) => boolean;
    unmanage: (window: unknown) => boolean;
    split: (direction: number) => unknown;
}

interface RegisteredShortcut {
    readonly name: string;
    readonly text: string;
    readonly sequence: string;
    readonly handler: () => void;
}

function tile(
    geometry = RECT,
    isLayout = false,
    manage: (window: unknown) => boolean = () => true,
): TestTile {
    return {
        relativeGeometry: geometry,
        absoluteGeometry: geometry,
        parent: null,
        tiles: [],
        windows: [],
        isLayout,
        canBeRemoved: true,
        layoutDirection: 1,
        manage,
        unmanage: () => true,
        split: () => [],
    };
}

function window(overrides: Partial<TestWindow> = {}): TestWindow {
    return {
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        desktops: [DESKTOP],
        output: OUTPUT,
        tile: null,
        frameGeometry: RECT,
        move: false,
        resize: false,
        outputChanged: signal(),
        desktopsChanged: signal(),
        tileChanged: signal(),
        interactiveMoveResizeStarted: signal(),
        interactiveMoveResizeFinished: signal(),
        ...overrides,
    };
}

function signal(): TestSignal {
    const callbacks = new Set<() => void>();
    return {
        connect: (next) => {
            callbacks.add(next);
        },
        disconnect: (next) => {
            callbacks.delete(next);
        },
        emit: () => {
            for (const callback of callbacks) {
                callback();
            }
        },
        get subscriberCount(): number {
            return callbacks.size;
        },
    };
}

class Harness {
    active: unknown = null;
    writtenActive: unknown;
    currentDesktop: unknown = DESKTOP;
    root: unknown = null;
    windows: unknown = [];
    cursor: unknown = { x: 250, y: 50 };
    shortcutResult = true;
    readonly shortcutResults: boolean[] = [];
    readonly shortcuts: RegisteredShortcut[] = [];
    readonly scheduled: { delayMs: number; callback: () => void; cancelled: boolean }[] = [];
    readonly activeWrites: unknown[] = [];
    added: ((value: unknown) => void) | undefined;
    removed: ((value: unknown) => void) | undefined;
    screensChanged: (() => void) | undefined;
    desktopChanged: (() => void) | undefined;
    throwOnLog = false;
    readonly logs: string[] = [];

    environment(): ControllerEnvironment {
        return {
            activeWindow: () => this.active,
            setActiveWindow: (window) => {
                this.writtenActive = window;
                this.activeWrites.push(window);
            },
            currentDesktopForOutput: () => this.currentDesktop,
            rootTile: () => this.root,
            windowList: () => this.windows,
            cursorPos: () => this.cursor,
            onWindowAdded: (handler) => {
                this.added = handler;
            },
            onWindowRemoved: (handler) => {
                this.removed = handler;
            },
            onScreensChanged: (handler) => {
                this.screensChanged = handler;
            },
            onCurrentDesktopChanged: (handler) => {
                this.desktopChanged = handler;
            },
            watchInteractiveWindow: (target, started, finished, invalidated) => {
                target.interactiveMoveResizeStarted.connect(started);
                target.interactiveMoveResizeFinished.connect(finished);
                target.outputChanged.connect(invalidated);
                target.desktopsChanged.connect(invalidated);
                return () => {
                    target.interactiveMoveResizeStarted.disconnect(started);
                    target.interactiveMoveResizeFinished.disconnect(finished);
                    target.outputChanged.disconnect(invalidated);
                    target.desktopsChanged.disconnect(invalidated);
                };
            },
            onPendingTargetChanged: (target, handler) => {
                target.outputChanged.connect(handler);
                target.desktopsChanged.connect(handler);
                target.tileChanged.connect(handler);
                return () => {
                    target.outputChanged.disconnect(handler);
                    target.desktopsChanged.disconnect(handler);
                    target.tileChanged.disconnect(handler);
                };
            },
            scheduleOnce: (delayMs, callback) => {
                const entry = { delayMs, callback, cancelled: false };
                this.scheduled.push(entry);
                return () => {
                    entry.cancelled = true;
                };
            },
            registerShortcut: (name, text, sequence, handler) => {
                this.shortcuts.push({ name, text, sequence, handler });
                return this.shortcutResults.shift() ?? this.shortcutResult;
            },
            log: (message) => {
                if (this.throwOnLog) {
                    throw new Error("log sink failed");
                }
                this.logs.push(message);
            },
        };
    }

    emitAdded(value: unknown): void {
        if (this.added !== undefined) {
            this.added(value);
        }
    }

    emitRemoved(value: unknown): void {
        if (this.removed !== undefined) {
            this.removed(value);
        }
    }

    fireScheduled(index: number): void {
        const entry = this.scheduled[index];
        if (entry === undefined || entry.cancelled) {
            return;
        }
        entry.callback();
    }
}

function setup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly target: TestTile;
    readonly focused: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const target = tile();
    const focused = window({ tile: target });
    target.windows = [focused];
    root.tiles = [target];
    harness.root = root;
    harness.active = focused;
    harness.windows = [focused];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, target, focused };
}

function focusSetup(direction: "left" | "down" | "up" | "right"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly focused: TestWindow;
    readonly focusedTile: TestTile;
    readonly neighbor: TestTile;
    readonly neighborWindow: TestWindow;
} {
    const state = setup();
    const geometry =
        direction === "left"
            ? { x: -200, y: 0, width: 100, height: 100 }
            : direction === "right"
              ? { x: 200, y: 0, width: 100, height: 100 }
              : direction === "up"
                ? { x: 0, y: -200, width: 100, height: 100 }
                : { x: 0, y: 200, width: 100, height: 100 };
    const neighbor = tile(geometry);
    const neighborWindow = window({ tile: neighbor });
    neighbor.windows = [neighborWindow];
    state.root.tiles = [state.target, neighbor];
    return {
        harness: state.harness,
        controller: state.controller,
        root: state.root,
        focused: state.focused,
        focusedTile: state.target,
        neighbor,
        neighborWindow,
    };
}

function moveSetup(direction: "left" | "down" | "up" | "right"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly focused: TestWindow;
    readonly focusedTile: TestTile;
    readonly target: TestTile;
} {
    const state = setup();
    const geometry =
        direction === "left"
            ? { x: -200, y: 0, width: 100, height: 100 }
            : direction === "right"
              ? { x: 200, y: 0, width: 100, height: 100 }
              : direction === "up"
                ? { x: 0, y: -200, width: 100, height: 100 }
                : { x: 0, y: 200, width: 100, height: 100 };
    const target = tile(geometry);
    state.root.tiles = [state.target, target];
    return {
        harness: state.harness,
        controller: state.controller,
        root: state.root,
        focused: state.focused,
        focusedTile: state.target,
        target,
    };
}

function presetSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly source: TestTile;
    readonly active: TestWindow;
    readonly early: TestTile;
    readonly late: TestTile;
    readonly earlyWindow: TestWindow;
    readonly lateWindow: TestWindow;
} {
    const harness = new Harness();
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
    return { harness, controller, root, source, active, early, late, earlyWindow, lateWindow };
}

function configureThreeOccupantPreset(state: ReturnType<typeof presetSetup>): {
    readonly directions: number[];
    readonly managed: unknown[];
    readonly left: TestTile;
    readonly middle: TestTile;
    readonly right: TestTile;
} {
    const directions: number[] = [];
    const managed: unknown[] = [];
    const manage = (target: TestTile) => (value: unknown): boolean => {
        managed.push(value);
        const subject = value as TestWindow;
        if (subject.tile !== state.source && subject.tile !== null) {
            (subject.tile as TestTile).windows = [];
        }
        subject.tile = target;
        target.windows = [subject];
        return true;
    };
    const left = tile({ x: 0, y: 0, width: 33, height: 100 });
    const middle = tile({ x: 33, y: 0, width: 33, height: 100 });
    const right = tile({ x: 66, y: 0, width: 34, height: 100 });
    left.manage = manage(left);
    middle.manage = manage(middle);
    right.manage = manage(right);
    const branch = tile({ x: 33, y: 0, width: 67, height: 100 }, true);
    branch.split = (direction) => {
        directions.push(direction);
        branch.tiles = [middle, right];
        return [middle, right];
    };
    state.source.split = (direction) => {
        directions.push(direction);
        state.source.isLayout = true;
        state.source.windows = [];
        state.source.tiles = [left, branch];
        return [left, branch];
    };
    return { directions, managed, left, middle, right };
}

function invokeShortcut(harness: Harness, name: string): void {
    const shortcut = harness.shortcuts.find((entry) => entry.name === name);
    if (shortcut === undefined) {
        throw new Error(`missing registered shortcut: ${name}`);
    }
    shortcut.handler();
}

describe("TileController keyboard insertion", () => {
    it("arms only a strict eligible occupied focused leaf without mutating topology", () => {
        const { controller, target } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        controller.armKeyboardInsertion();
        assert.equal(controller.hasPendingKeyboard, true);
        assert.equal(splits, 0);

        const rejected = setup();
        rejected.harness.active = window({ resizeable: false, tile: rejected.target });
        rejected.target.windows = [rejected.harness.active];
        rejected.controller.armKeyboardInsertion();
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
        controller.armKeyboardInsertion();
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
        controller.armKeyboardInsertion();
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
        controller.armKeyboardInsertion();
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
        controller.armKeyboardInsertion();
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
        controller.armKeyboardInsertion();
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
        controller.armKeyboardInsertion();
        harness.emitAdded(window());
        assert.equal(incomingManages, 0);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(controller.isEnabled, true);
    });

    it("clears armed state on output and desktop scope changes", () => {
        const { controller, harness, target, focused } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        controller.armKeyboardInsertion();
        if (harness.screensChanged !== undefined) {
            harness.screensChanged();
        }
        harness.emitAdded(window());
        controller.armKeyboardInsertion();
        if (harness.desktopChanged !== undefined) {
            harness.desktopChanged();
        }
        harness.emitAdded(window());
        controller.armKeyboardInsertion();
        focused.outputChanged.emit();
        harness.emitAdded(window());
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(splits, 0);
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
        controller.armKeyboardInsertion();
        harness.emitAdded(window());
        harness.emitAdded(window());
        assert.equal(controller.isEnabled, false);
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(countEvent(harness.logs, "disabled:exception"), 1);
    });
});

describe("TileController keyboard focus", () => {
    const focusActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-focus-left", "Focus window left", "Meta+H"],
        ["down", "plasma-auto-tiler-focus-down", "Focus window down", "Meta+J"],
        ["up", "plasma-auto-tiler-focus-up", "Focus window up", "Meta+K"],
        ["right", "plasma-auto-tiler-focus-right", "Focus window right", "Meta+Alt+Ctrl+L"],
    ];
    const moveActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-move-left", "Move window left", "Meta+Shift+H"],
        ["down", "plasma-auto-tiler-move-down", "Move window down", "Meta+Shift+J"],
        ["up", "plasma-auto-tiler-move-up", "Move window up", "Meta+Shift+K"],
        ["right", "plasma-auto-tiler-move-right", "Move window right", "Meta+Shift+L"],
    ];
    const presetActions: ReadonlyArray<readonly [string, string, string]> = [
        ["plasma-auto-tiler-apply-columns", "Apply columns in focused leaf", "Meta+Alt+1"],
        ["plasma-auto-tiler-apply-rows", "Apply rows in focused leaf", "Meta+Alt+2"],
        ["plasma-auto-tiler-apply-balanced-grid", "Apply balanced grid in focused leaf", "Meta+Alt+3"],
    ];

    const actionCatalog: ReadonlyArray<readonly [string, string, string]> = [
        ["plasma-auto-tiler-insert-right", "Insert next window right of focused leaf", "Meta+Alt+Right"],
        ...focusActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...moveActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ["plasma-auto-tiler-detach", "Detach window from tile", "Meta+Shift+Space"],
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
            invokeShortcut(harness, "plasma-auto-tiler-insert-right");
            for (const [, name] of [...focusActions, ...moveActions]) {
                invokeShortcut(harness, name);
            }
            invokeShortcut(harness, "plasma-auto-tiler-detach");
            for (const [name] of presetActions) {
                invokeShortcut(harness, name);
            }
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
        for (const [direction, name] of focusActions) {
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
});

describe("TileController keyboard move", () => {
    const moveActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-move-left", "Move window left", "Meta+Shift+H"],
        ["down", "plasma-auto-tiler-move-down", "Move window down", "Meta+Shift+J"],
        ["up", "plasma-auto-tiler-move-up", "Move window up", "Meta+Shift+K"],
        ["right", "plasma-auto-tiler-move-right", "Move window right", "Meta+Shift+L"],
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
            {
                reason: "move-rejected:no-target",
                configure: (state) => {
                    const occupied = tile({ x: 200, y: 0, width: 100, height: 100 });
                    occupied.windows = [window({ tile: occupied })];
                    state.root.tiles = [state.focusedTile, occupied];
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
        for (const [direction, name] of moveActions) {
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

describe("TileController focused-leaf presets", () => {
    const presetActions: ReadonlyArray<readonly [string, readonly number[]]> = [
        ["plasma-auto-tiler-apply-columns", [1, 1]],
        ["plasma-auto-tiler-apply-rows", [2, 2]],
        ["plasma-auto-tiler-apply-balanced-grid", [1, 2]],
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

            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

            assert.equal(splits, 0);
            assert.equal(countEvent(state.harness.logs, "preset-applied:columns"), 0);
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

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

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

function dragSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly origin: TestTile;
    readonly target: TestTile;
    readonly dragged: TestWindow;
    readonly targetWindow: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const origin = tile();
    const target = tile({ x: 200, y: 0, width: 100, height: 100 });
    const dragged = window({ tile: origin });
    const targetWindow = window({ tile: target });
    origin.windows = [dragged];
    target.windows = [targetWindow];
    root.tiles = [origin, target];
    harness.root = root;
    harness.active = dragged;
    harness.windows = [dragged, targetWindow];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, origin, target, dragged, targetWindow };
}

function startDrag(dragged: TestWindow): void {
    dragged.move = true;
    dragged.resize = false;
    dragged.interactiveMoveResizeStarted.emit();
    dragged.move = false;
}

function movedGeometry(): typeof RECT {
    return { x: 10, y: 10, width: 100, height: 100 };
}

function countEvent(logs: readonly string[], event: string): number {
    return logs.filter((entry) => entry === `plasma-auto-tiler:${event}`).length;
}

describe("TileController interactive drag", () => {
    it("captures only interactive moves and permits one active drag", () => {
        const { controller, dragged, targetWindow } = dragSetup();
        dragged.resize = true;
        dragged.interactiveMoveResizeStarted.emit();
        assert.equal(controller.hasActiveDrag, false);

        startDrag(dragged);
        assert.equal(controller.hasActiveDrag, true);
        targetWindow.move = true;
        targetWindow.interactiveMoveResizeStarted.emit();
        assert.equal(controller.hasActiveDrag, true);
    });

    it("does not claim a cancellation when origin association and geometry are unchanged", () => {
        const { controller, origin, dragged, target } = dragSetup();
        let splits = 0;
        let restores = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        origin.manage = () => {
            restores += 1;
            return true;
        };
        startDrag(dragged);
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(splits, 0);
        assert.equal(restores, 0);
    });

    it("restores association through origin manage for center and outside no-op finishes", () => {
        for (const cursor of [{ x: 250, y: 50 }, { x: 1000, y: 1000 }]) {
            const { harness, controller, origin, target, dragged } = dragSetup();
            let restores = 0;
            let splits = 0;
            origin.manage = (value) => {
                restores += 1;
                assert.equal(value, dragged);
                return true;
            };
            target.split = () => {
                splits += 1;
                return [];
            };
            harness.cursor = cursor;
            startDrag(dragged);
            dragged.tile = null;
            dragged.frameGeometry = movedGeometry();
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(controller.hasActiveDrag, false);
            assert.equal(restores, 1);
            assert.equal(splits, 0);
        }
    });

    it("rejects stale, same, empty, multiple, ineligible, invalid, and cross-scope targets before split", () => {
        const cases: ReadonlyArray<(state: ReturnType<typeof dragSetup>) => void> = [
            (state) => {
                state.harness.cursor = { x: 50, y: 50 };
            },
            (state) => {
                state.target.windows = [];
            },
            (state) => {
                state.target.windows = [state.targetWindow, window({ tile: state.target })];
            },
            (state) => {
                state.targetWindow.normalWindow = false;
            },
            (state) => {
                state.target.absoluteGeometry = { x: 200, y: 0, width: 0, height: 100 };
            },
            (state) => {
                state.dragged.output = { ...OUTPUT };
            },
        ];
        for (const configure of cases) {
            const state = dragSetup();
            let splits = 0;
            let restores = 0;
            state.origin.manage = () => {
                restores += 1;
                return true;
            };
            state.target.split = () => {
                splits += 1;
                return [];
            };
            state.harness.cursor = { x: 290, y: 50 };
            startDrag(state.dragged);
            state.dragged.tile = null;
            state.dragged.frameGeometry = movedGeometry();
            configure(state);
            state.dragged.interactiveMoveResizeFinished.emit();
            assert.equal(splits, 0);
            assert.equal(state.controller.hasActiveDrag, false);
            assert.equal(state.controller.isEnabled, true);
            assert.ok(restores <= 1);
        }
    });

    it("maps all directions to geometric children, retaining the origin leaf", () => {
        const cases: ReadonlyArray<[typeof RECT, number, unknown[]]> = [
            [{ x: 210, y: 50, width: 1, height: 1 }, 1, []],
            [{ x: 290, y: 50, width: 1, height: 1 }, 1, []],
            [{ x: 250, y: 10, width: 1, height: 1 }, 2, []],
            [{ x: 250, y: 90, width: 1, height: 1 }, 2, []],
        ];
        for (const [cursorRect, expectedDirection] of cases) {
            const { harness, origin, target, dragged, targetWindow } = dragSetup();
            const managed: unknown[] = [];
            const first = tile(
                expectedDirection === 1
                    ? { x: 200, y: 0, width: 50, height: 100 }
                    : { x: 200, y: 0, width: 100, height: 50 },
                false,
                (value) => {
                    managed.push(value);
                    return true;
                },
            );
            const second = tile(
                expectedDirection === 1
                    ? { x: 250, y: 0, width: 50, height: 100 }
                    : { x: 200, y: 50, width: 100, height: 50 },
                false,
                (value) => {
                    managed.push(value);
                    return true;
                },
            );
            let direction = 0;
            target.split = (value) => {
                direction = value;
                target.isLayout = true;
                target.tiles = [first, second];
                return [second, first];
            };
            harness.cursor = { x: cursorRect.x, y: cursorRect.y };
            startDrag(dragged);
            dragged.frameGeometry = movedGeometry();
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(direction, expectedDirection);
            assert.equal(managed[0], targetWindow);
            assert.equal(managed[1], dragged);
            assert.deepEqual(origin.windows, [dragged]);
        }
    });

    it("disables structural drag once for malformed split output or post-split manage failure", () => {
        const malformed = dragSetup();
        malformed.target.split = () => [];
        malformed.harness.cursor = { x: 290, y: 50 };
        startDrag(malformed.dragged);
        malformed.dragged.frameGeometry = movedGeometry();
        malformed.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(malformed.controller.isEnabled, false);
        assert.equal(countEvent(malformed.harness.logs, "disabled:drag-split-result-invalid"), 1);

        const failedManage = dragSetup();
        const first = tile({ x: 200, y: 0, width: 50, height: 100 }, false, () => false);
        const second = tile({ x: 250, y: 0, width: 50, height: 100 });
        failedManage.target.split = () => [first, second];
        failedManage.harness.cursor = { x: 290, y: 50 };
        startDrag(failedManage.dragged);
        failedManage.dragged.frameGeometry = movedGeometry();
        failedManage.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(failedManage.controller.isEnabled, false);
        assert.equal(countEvent(failedManage.harness.logs, "disabled:drag-manage-failed"), 1);
    });

    it("deduplicates and disconnects existing and newly added interactive handlers", () => {
        const { harness, dragged } = dragSetup();
        harness.emitAdded(dragged);
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        dragged.desktopsChanged.emit();
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 0);
        if (harness.desktopChanged !== undefined) {
            harness.desktopChanged();
        }
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        const added = window();
        harness.emitAdded(added);
        harness.emitAdded(added);
        assert.equal(added.interactiveMoveResizeStarted.subscriberCount, 1);
        harness.emitRemoved(added);
        assert.equal(added.interactiveMoveResizeStarted.subscriberCount, 0);
    });

    it("contains drag exceptions and clears active state", () => {
        const { controller, harness, target, dragged } = dragSetup();
        target.split = () => {
            throw "split";
        };
        harness.cursor = { x: 290, y: 50 };
        startDrag(dragged);
        dragged.frameGeometry = movedGeometry();
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "disabled:exception"), 1);
    });
});

describe("TileController production diagnostics", () => {
    it("maps each keyboard guard to one fixed reason after callback entry", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof setup>) => void;
        }> = [
            {
                reason: "keyboard-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "keyboard-rejected:active-window-eligibility",
                configure: (state) => {
                    state.harness.active = window({ resizeable: false, tile: state.target });
                    state.target.windows = [state.harness.active];
                },
            },
            {
                reason: "keyboard-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "keyboard-rejected:root-lookup",
                configure: (state) => {
                    state.harness.root = null;
                },
            },
            {
                reason: "keyboard-rejected:topology-decode",
                configure: (state) => {
                    state.root.tiles = { length: 1 };
                },
            },
            {
                reason: "keyboard-rejected:active-tile-association",
                configure: (state) => {
                    state.focused.tile = null;
                },
            },
            {
                reason: "keyboard-rejected:target-occupancy-validity",
                configure: (state) => {
                    state.target.windows = [];
                },
            },
        ];
        for (const testCase of cases) {
            const state = setup();
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            state.controller.armKeyboardInsertion();
            const diagnostics = state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:keyboard-"));
            assert.deepEqual(diagnostics, ["plasma-auto-tiler:keyboard-invoked", `plasma-auto-tiler:${testCase.reason}`]);
        }
    });

    it("reports pending replacement without changing the existing successful arm", () => {
        const { harness, controller } = setup();
        const baseline = harness.logs.length;
        controller.armKeyboardInsertion();
        controller.armKeyboardInsertion();
        assert.equal(controller.hasPendingKeyboard, true);
        const diagnostics = harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:keyboard-"));
        assert.deepEqual(diagnostics, [
            "plasma-auto-tiler:keyboard-invoked",
            "plasma-auto-tiler:keyboard-armed",
            "plasma-auto-tiler:keyboard-invoked",
            "plasma-auto-tiler:keyboard-pending-replaced",
            "plasma-auto-tiler:keyboard-armed",
        ]);
    });

    it("records window-added entry, eligibility, rejection, and privacy-safe once-only codes", () => {
        const accepted = setup();
        accepted.harness.emitAdded(window());
        accepted.harness.emitAdded(window());
        assert.equal(countEvent(accepted.harness.logs, "window-added-observed"), 1);
        assert.equal(countEvent(accepted.harness.logs, "window-added-eligible"), 1);
        assert.ok(
            accepted.harness.logs.indexOf("plasma-auto-tiler:window-added-observed") <
                accepted.harness.logs.indexOf("plasma-auto-tiler:window-added-eligible"),
        );

        const rejected = setup();
        rejected.harness.emitAdded(window({ appletPopup: true }));
        rejected.harness.emitAdded(window({ appletPopup: true }));
        assert.equal(countEvent(rejected.harness.logs, "window-added-observed"), 1);
        assert.equal(countEvent(rejected.harness.logs, "window-added-rejected:applet-popup"), 1);
        assert.equal(countEvent(rejected.harness.logs, "window-added-eligible"), 0);

        for (const entry of [...accepted.harness.logs, ...rejected.harness.logs]) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("maps each immediate window-added rejection to exactly one privacy-safe sub-code (desktop-scope-mismatch defers instead; covered separately)", () => {
        const cases: ReadonlyArray<{
            readonly code: string;
            readonly configure: (state: ReturnType<typeof setup>) => void;
        }> = [
            {
                code: "scope-unavailable",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                    state.harness.emitAdded(window());
                },
            },
            {
                code: "not-normal-window",
                configure: (state) => {
                    state.harness.emitAdded(window({ normalWindow: false }));
                },
            },
            {
                code: "not-managed",
                configure: (state) => {
                    state.harness.emitAdded(window({ managed: false }));
                },
            },
            {
                code: "not-resizeable",
                configure: (state) => {
                    state.harness.emitAdded(window({ resizeable: false }));
                },
            },
            {
                code: "applet-popup",
                configure: (state) => {
                    state.harness.emitAdded(window({ appletPopup: true }));
                },
            },
        ];
        for (const testCase of cases) {
            const state = setup();
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            const rejections = state.harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:window-added-rejected:"));
            assert.deepEqual(rejections, [`plasma-auto-tiler:window-added-rejected:${testCase.code}`]);
            assert.equal(countEvent(state.harness.logs, "window-added-eligible"), 0);
            for (const entry of state.harness.logs) {
                assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
                assert.equal(entry.includes("screen-1"), false);
                assert.equal(entry.includes("desktop-1"), false);
            }
        }
    });

    it("defers a desktop-scope-mismatch window-added instead of rejecting immediately, and terminally rejects it if the mismatch persists after one bounded re-evaluation", () => {
        const { harness, root, target } = setup();
        let manages = 0;
        target.manage = () => {
            manages += 1;
            return true;
        };
        root.tiles = [target];
        const incoming = window({ desktops: [] });
        harness.emitAdded(incoming);

        assert.equal(
            countEvent(harness.logs, "window-added-rejected:desktop-scope-mismatch"),
            0,
            "must not reject immediately; desktop-scope-mismatch is deferred",
        );
        assert.equal(countEvent(harness.logs, "window-added-deferred:no-desktops"), 1);
        assert.equal(harness.scheduled.length, 1);
        assert.equal(manages, 0);

        harness.fireScheduled(0);

        assert.equal(countEvent(harness.logs, "window-added-reevaluated:no-desktops"), 1);
        assert.equal(countEvent(harness.logs, "window-added-rejected-deferred:desktop-scope-mismatch"), 1);
        assert.equal(countEvent(harness.logs, "window-added-eligible-deferred"), 0);
        assert.equal(manages, 0);
        for (const entry of harness.logs) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("places a window whose desktops settle into scope before the deferred re-evaluation fires", () => {
        const { harness, root } = setup();
        const managed: unknown[] = [];
        const empty = tile(RECT, false, (value) => {
            managed.push(value);
            return true;
        });
        root.tiles = [empty];
        const incoming = window({ desktops: [] });
        harness.emitAdded(incoming);
        assert.equal(managed.length, 0);

        // Simulate the window's desktops settling to the live current desktop
        // between windowAdded and the deferred re-evaluation.
        incoming.desktops = [DESKTOP];
        harness.fireScheduled(0);

        assert.deepEqual(managed, [incoming]);
        assert.equal(countEvent(harness.logs, "window-added-reevaluated:match"), 1);
        assert.equal(countEvent(harness.logs, "window-added-eligible-deferred"), 1);
        assert.equal(countEvent(harness.logs, "window-added-rejected-deferred:desktop-scope-mismatch"), 0);
    });

    it("cancels the deferred re-evaluation and does not place the window if it closes first", () => {
        const { harness, controller, root } = setup();
        const managed: unknown[] = [];
        const empty = tile(RECT, false, (value) => {
            managed.push(value);
            return true;
        });
        root.tiles = [empty];
        const incoming = window({ desktops: [] });
        harness.emitAdded(incoming);
        assert.equal(harness.scheduled.length, 1);
        assert.equal(harness.scheduled[0]?.cancelled, false);

        harness.emitRemoved(incoming);
        assert.equal(harness.scheduled[0]?.cancelled, true);

        // Firing after cancellation must be inert (mirrors real QTimer.stop()
        // semantics honoured by the fake); confirm no placement and no crash.
        harness.fireScheduled(0);
        assert.equal(managed.length, 0);
        assert.equal(countEvent(harness.logs, "window-added-eligible-deferred"), 0);
        assert.equal(countEvent(harness.logs, "window-added-rejected-deferred:desktop-scope-mismatch"), 0);
        assert.equal(controller.isEnabled, true);
    });

    it("logs each runtime boundary once and confirms keyboard success after both manages", () => {
        const { harness, controller, target, focused } = setup();
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, false, () => true);
        const right = tile({ x: 50, y: 0, width: 50, height: 100 }, false, () => {
            assert.equal(countEvent(harness.logs, "keyboard-completed"), 0);
            return true;
        });
        target.split = () => {
            target.isLayout = true;
            target.tiles = [left, right];
            return [left, right];
        };
        controller.armKeyboardInsertion();
        controller.armKeyboardInsertion();
        harness.emitAdded(window());

        assert.equal(countEvent(harness.logs, "startup-handlers-ready"), 1);
        assert.equal(countEvent(harness.logs, "boundary-decoded:workspace-window-list"), 1);
        assert.equal(countEvent(harness.logs, "boundary-decoded:tile-children"), 1);
        assert.equal(countEvent(harness.logs, "boundary-decoded:tile-occupancy"), 1);
        assert.equal(countEvent(harness.logs, "boundary-decoded:split-result"), 1);
        assert.equal(countEvent(harness.logs, "keyboard-armed"), 2);
        assert.equal(countEvent(harness.logs, "keyboard-completed"), 1);
        assert.equal(focused.tile, target);
    });

    it("does not log ordinary placement before a successful manage", () => {
        const { harness, root, target } = setup();
        const empty = tile(RECT, false, () => {
            assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
            return false;
        });
        root.tiles = [target, empty];
        harness.emitAdded(window());
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);

        const accepted = setup();
        const leaf = tile(RECT, false, () => true);
        accepted.root.tiles = [accepted.target, leaf];
        accepted.harness.emitAdded(window());
        assert.equal(countEvent(accepted.harness.logs, "automatic-placement-managed"), 1);
    });

    it("logs drag capture, unchanged completion, restoration, and split completion after success", () => {
        const unchanged = dragSetup();
        startDrag(unchanged.dragged);
        unchanged.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(unchanged.harness.logs, "drag-origin-captured"), 1);
        assert.equal(countEvent(unchanged.harness.logs, "drag-unchanged"), 1);

        const restored = dragSetup();
        restored.harness.cursor = { x: 250, y: 50 };
        restored.origin.manage = () => {
            assert.equal(countEvent(restored.harness.logs, "drag-origin-restored"), 0);
            return true;
        };
        startDrag(restored.dragged);
        restored.dragged.tile = null;
        restored.dragged.frameGeometry = movedGeometry();
        restored.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(restored.harness.logs, "drag-origin-restored"), 1);

        const completed = dragSetup();
        const first = tile({ x: 200, y: 0, width: 50, height: 100 }, false, () => true);
        const second = tile({ x: 250, y: 0, width: 50, height: 100 }, false, () => {
            assert.equal(countEvent(completed.harness.logs, "drag-split-completed"), 0);
            return true;
        });
        completed.target.split = () => [first, second];
        completed.harness.cursor = { x: 290, y: 50 };
        startDrag(completed.dragged);
        completed.dragged.frameGeometry = movedGeometry();
        completed.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(completed.harness.logs, "drag-split-completed"), 1);
    });

    it("emits fixed private-safe ignored-window and disable diagnostics", () => {
        const { harness, controller, target } = setup();
        harness.emitAdded(window({ appletPopup: true }));
        assert.equal(countEvent(harness.logs, "window-added-observed"), 1);
        assert.equal(countEvent(harness.logs, "window-added-rejected:applet-popup"), 1);

        target.split = () => {
            throw new Error("private-window-title");
        };
        controller.armKeyboardInsertion();
        harness.emitAdded(window());
        harness.emitAdded(window());
        assert.equal(countEvent(harness.logs, "disabled:exception"), 1);
        for (const entry of harness.logs) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("contains sink failures without changing an eligible operation", () => {
        const { harness, controller } = setup();
        harness.throwOnLog = true;
        controller.armKeyboardInsertion();
        assert.equal(controller.isEnabled, true);
        assert.equal(controller.hasPendingKeyboard, true);
    });
});

describe("TileController shortcut registration", () => {
    it("captures the result and emits one fixed success diagnostic before readiness", () => {
        const { harness } = setup();
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
        assert.ok(
            harness.logs.indexOf("plasma-auto-tiler:shortcut-registered") <
                harness.logs.indexOf("plasma-auto-tiler:startup-handlers-ready"),
        );
        for (const entry of harness.logs) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("disables once with a fixed reason and no readiness when registration fails", () => {
        const harness = new Harness();
        harness.shortcutResult = false;
        const controller = new TileController(harness.environment());
        controller.start();
        controller.start();
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
        assert.equal(countEvent(harness.logs, "startup-handlers-ready"), 0);
        assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
        for (const entry of harness.logs) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("keeps the controller enabled when the diagnostic sink throws on success", () => {
        const harness = new Harness();
        harness.throwOnLog = true;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
    });

    it("disables inertly when the diagnostic sink throws on failure", () => {
        const harness = new Harness();
        harness.throwOnLog = true;
        harness.shortcutResult = false;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, false);
    });
});

describe("TileController focus-writer seam", () => {
    it("forwards the strict guarded target through the fixture writer", () => {
        const harness = new Harness();
        const target = window();
        harness.environment().setActiveWindow(target);
        assert.equal(harness.writtenActive, target);
    });
});
