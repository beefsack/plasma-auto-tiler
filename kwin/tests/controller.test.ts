import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEQUENTIAL_LENGTH } from "../src/boundary";
import { TileController, type ControllerEnvironment, type CurrentScope } from "../src/controller";
import { DIRECTIONS, type Direction } from "../src/logic";

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
    readonly rootsByDesktop = new Map<string, unknown>();
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
            rootTile: (_output, desktop) => this.rootsByDesktop.get(desktop.id) ?? this.root,
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

    // Mirrors a QTimer timeout already queued before stop(): the cancel flag
    // is ignored so the callback is genuinely invoked after cancellation.
    fireScheduledForced(index: number): void {
        const entry = this.scheduled[index];
        if (entry === undefined) {
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

function configureThreeOccupantPreset(
    state: ReturnType<typeof presetSetup>,
    target: TestTile = state.source,
): {
    readonly directions: number[];
    readonly managed: unknown[];
    readonly left: TestTile;
    readonly middle: TestTile;
    readonly right: TestTile;
    readonly branch: TestTile;
} {
    const directions: number[] = [];
    const managed: unknown[] = [];
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        managed.push(value);
        const subject = value as TestWindow;
        if (subject.tile !== target && subject.tile !== null) {
            (subject.tile as TestTile).windows = [];
        }
        subject.tile = leaf;
        leaf.windows = [subject];
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
    target.split = (direction) => {
        directions.push(direction);
        target.isLayout = true;
        target.windows = [];
        target.tiles = [left, branch];
        return [left, branch];
    };
    return { directions, managed, left, middle, right, branch };
}

// Floating active window with an occupied leaf, a layout branch, and an
// empty leaf beneath the exact scope root. `root.tiles` ordering is chosen so
// the decoded traversal reaches the layout branch and occupied leaf before the
// empty leaf, proving deterministic skipping.
function attachSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly empty: TestTile;
    readonly occupied: TestTile;
    readonly layout: TestTile;
    readonly active: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const layout = tile(RECT, true);
    const occupied = tile();
    const occupiedWindow = window({ tile: occupied });
    occupied.windows = [occupiedWindow];
    const empty = tile();
    const active = window();
    // LIFO traversal reaches layout (skipped), then occupied (skipped), then
    // empty (selected), proving deterministic first-empty selection.
    root.tiles = [empty, occupied, layout];
    harness.root = root;
    harness.active = active;
    harness.windows = [occupiedWindow, active];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, empty, occupied, layout, active };
}

// Floating active and other in-scope unassigned windows plus three empty
// leaves, an occupied leaf, a layout leaf, and a generic (non-Custom) leaf
// beneath the exact scope root. `root.tiles` ordering is chosen so the decoded
// LIFO traversal reaches leaves in a deterministic order with the generic,
// layout, and occupied leaves interleaved for skipping: first, generic, layout,
// second, occupied, third.
function fillSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly first: TestTile;
    readonly second: TestTile;
    readonly third: TestTile;
    readonly occupied: TestTile;
    readonly layout: TestTile;
    readonly generic: object;
    readonly active: TestWindow;
    readonly otherA: TestWindow;
    readonly otherB: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const first = tile();
    const second = tile();
    const third = tile();
    const occupied = tile();
    const occupiedWindow = window({ tile: occupied });
    occupied.windows = [occupiedWindow];
    const layout = tile(RECT, true);
    const generic = tile();
    const { layoutDirection: ignoredDirection, split: ignoredSplit, ...nonCustom } = generic;
    void ignoredDirection;
    void ignoredSplit;
    const active = window();
    const otherA = window();
    const otherB = window();
    root.tiles = [third, occupied, second, layout, nonCustom, first];
    harness.root = root;
    harness.active = active;
    harness.windows = [otherA, active, otherB];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, first, second, third, occupied, layout, generic: nonCustom, active, otherA, otherB };
}

function currentScopeFor(active: TestWindow): CurrentScope {
    const output = active.output;
    if (output === null) {
        throw new Error("test window has no output");
    }
    return {
        output,
        desktop: DESKTOP,
        scope: { output, desktopId: DESKTOP.id },
    };
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
        const { controller, harness, target, focused } = setup();
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        controller.armKeyboardInsertion("right");
        if (harness.screensChanged !== undefined) {
            harness.screensChanged();
        }
        harness.emitAdded(window());
        controller.armKeyboardInsertion("right");
        if (harness.desktopChanged !== undefined) {
            harness.desktopChanged();
        }
        harness.emitAdded(window());
        controller.armKeyboardInsertion("right");
        focused.outputChanged.emit();
        harness.emitAdded(window());
        assert.equal(controller.hasPendingKeyboard, false);
        assert.equal(splits, 0);
    });

    it("clears an armed insertion when the source active window is removed even when the target occupant is a distinct wrapper", () => {
        const { harness, controller, target } = setup();
        const occupant = window({ tile: target });
        target.windows = [occupant];
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
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
        ...insertActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...focusActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...moveActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ["plasma-auto-tiler-detach", "Detach window from tile", "Meta+Shift+Space"],
        ["plasma-auto-tiler-attach", "Attach window to available tile", "Meta+Alt+Shift+Space"],
        ["plasma-auto-tiler-fill-scope", "Fill available tiles with windows", "Meta+Alt+Return"],
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
            for (const [, name] of insertActions) {
                invokeShortcut(harness, name);
            }
            for (const [, name] of [...focusActions, ...moveActions]) {
                invokeShortcut(harness, name);
            }
            invokeShortcut(harness, "plasma-auto-tiler-detach");
            invokeShortcut(harness, "plasma-auto-tiler-attach");
            invokeShortcut(harness, "plasma-auto-tiler-fill-scope");
            for (const [name] of presetActions) {
                invokeShortcut(harness, name);
            }
            harness.emitAdded(window());
            harness.emitRemoved(window());
            harness.screensChanged?.();
            harness.desktopChanged?.();
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

describe("TileController tile attach", () => {
    it("invokes the registered callback and attaches the active window with one guarded write", () => {
        const state = attachSetup();
        const registered = state.harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-attach");
        assert.notEqual(registered, undefined);
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        const baseline = state.harness.logs.length;
        registered?.handler();
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
    it("registers fill-scope metadata and fills through the registered callback with anchor-first guarded writes", () => {
        const state = fillSetup();
        const registered = state.harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-fill-scope");
        assert.notEqual(registered, undefined);
        assert.equal(registered?.text, "Fill available tiles with windows");
        assert.equal(registered?.sequence, "Meta+Alt+Return");
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        attachTileWriter(state.otherA, writes);
        attachTileWriter(state.otherB, writes);
        const baseline = state.harness.logs.length;
        registered?.handler();
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

        const disabled = new Harness();
        disabled.shortcutResult = false;
        const disabledController = new TileController(disabled.environment());
        disabledController.start();
        assert.equal(disabledController.isEnabled, false);
        const disabledBaseline = disabled.logs.length;
        invokeShortcut(disabled, "plasma-auto-tiler-fill-scope");
        assert.equal(disabled.logs.length, disabledBaseline);
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

describe("TileController selected overlay state", () => {
    it("records the selected overlay only after every occupant assignment succeeds", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const overlay = state.controller.readSelectedOverlay(currentScopeFor(state.active));
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "columns");
        assert.equal(overlay.root, state.source);
        assert.deepEqual(overlay.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(overlay.scope.scope.output, OUTPUT);
        assert.equal(overlay.scope.scope.desktopId, "desktop-1");
        assert.equal(countEvent(state.harness.logs, "preset-applied:columns"), 1);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("records a singleton preset without splitting and without geometry", () => {
        const state = presetSetup();
        state.root.tiles = [state.source];
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const overlay = state.controller.readSelectedOverlay(currentScopeFor(state.active));
        assert.ok(overlay !== null);
        assert.equal(overlay.root, state.source);
        assert.deepEqual(overlay.leaves, [state.source]);
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("creates no overlay state on precondition, split, or assignment failure", () => {
        const cases: ReadonlyArray<{
            readonly configure: (state: ReturnType<typeof presetSetup>) => void;
            readonly expected: string;
        }> = [
            {
                configure: (state) => {
                    state.harness.active = null;
                },
                expected: "preset-rejected:no-active-window",
            },
            {
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
                expected: "preset-rejected:desktop-output-scope",
            },
            {
                configure: (state) => {
                    state.active.resizeable = false;
                },
                expected: "preset-rejected:active-window-eligibility",
            },
            {
                configure: (state) => {
                    state.late.windows = [state.active];
                },
                expected: "preset-rejected:occupancy-validity",
            },
            {
                configure: (state) => {
                    state.source.split = () => {
                        state.source.isLayout = true;
                        return [null, null];
                    };
                },
                expected: "preset-failed:split-mutation-possible",
            },
            {
                configure: (state) => {
                    const realized = configureThreeOccupantPreset(state);
                    realized.middle.manage = () => {
                        throw new Error("private-window-title");
                    };
                },
                expected: "preset-failed:assignment-failed:later",
            },
        ];
        for (const testCase of cases) {
            const state = presetSetup();
            const scope = currentScopeFor(state.active);
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
            assert.equal(state.controller.readSelectedOverlay(scope), null);
            assert.equal(countEvent(state.harness.logs, testCase.expected), 1);
            assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
            for (const entry of state.harness.logs) {
                assert.equal(entry.includes("private-window-title"), false);
                assert.equal(entry.includes("screen-1"), false);
                assert.equal(entry.includes("desktop-1"), false);
            }
        }
    });

    it("preserves an existing same-scope overlay when a later application fails before mutating", () => {
        const cases: ReadonlyArray<{
            readonly name: string;
            readonly configure: (state: ReturnType<typeof presetSetup>) => void;
            readonly expected: string;
        }> = [
            {
                name: "precondition",
                configure: (state) => {
                    state.harness.active = null;
                },
                expected: "preset-rejected:no-active-window",
            },
            {
                name: "scope drift",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
                expected: "preset-rejected:desktop-output-scope",
            },
            {
                name: "occupancy drift",
                configure: (state) => {
                    state.late.windows = [state.active];
                },
                expected: "preset-rejected:occupancy-validity",
            },
        ];
        for (const testCase of cases) {
            const state = presetSetup();
            configureThreeOccupantPreset(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
            const scope = currentScopeFor(state.active);
            const before = state.controller.readSelectedOverlay(scope);
            assert.ok(before !== null);
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
            assert.equal(countEvent(state.harness.logs, testCase.expected), 1);
            const after = state.controller.readSelectedOverlay(scope);
            assert.ok(after !== null);
            assert.equal(after.root, before.root);
            assert.deepEqual(after.leaves, before.leaves);
            assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        }
    });

    it("discards an existing overlay only when a mutating failure breaks its structure, never replacing it", () => {
        const split = presetSetup();
        const first = configureThreeOccupantPreset(split);
        invokeShortcut(split.harness, "plasma-auto-tiler-apply-columns");
        const splitScope = currentScopeFor(split.active);
        assert.ok(split.controller.readSelectedOverlay(splitScope) !== null);
        first.left.split = () => {
            first.left.isLayout = true;
            return [null, null];
        };
        invokeShortcut(split.harness, "plasma-auto-tiler-apply-columns");
        assert.equal(countEvent(split.harness.logs, "preset-failed:split-mutation-possible"), 1);
        assert.equal(split.controller.readSelectedOverlay(splitScope), null);
        assert.equal(countEvent(split.harness.logs, "selected-overlay-invalidated"), 1);

        const assign = presetSetup();
        const firstAssign = configureThreeOccupantPreset(assign);
        invokeShortcut(assign.harness, "plasma-auto-tiler-apply-columns");
        const assignScope = currentScopeFor(assign.active);
        assert.ok(assign.controller.readSelectedOverlay(assignScope) !== null);
        const failLeft = tile({ x: 0, y: 0, width: 33, height: 100 });
        const failBranch = tile({ x: 33, y: 0, width: 67, height: 100 });
        const failLeaf = tile({ x: 33, y: 0, width: 33, height: 100 });
        const failFarLeaf = tile({ x: 66, y: 0, width: 34, height: 100 });
        failLeft.manage = () => true;
        failBranch.split = () => {
            failBranch.isLayout = true;
            failBranch.tiles = [failLeaf, failFarLeaf];
            return [failLeaf, failFarLeaf];
        };
        failLeaf.manage = () => false;
        firstAssign.left.split = () => {
            firstAssign.left.isLayout = true;
            firstAssign.left.windows = [];
            firstAssign.left.tiles = [failLeft, failBranch];
            return [failLeft, failBranch];
        };
        invokeShortcut(assign.harness, "plasma-auto-tiler-apply-rows");
        assert.equal(countEvent(assign.harness.logs, "preset-failed:assignment-failed:later"), 1);
        assert.equal(assign.controller.readSelectedOverlay(assignScope), null);
        assert.equal(countEvent(assign.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("atomically replaces the same-scope overlay when a later preset succeeds", () => {
        const state = presetSetup();
        const first = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const firstOverlay = state.controller.readSelectedOverlay(scope);
        assert.ok(firstOverlay !== null);
        assert.equal(firstOverlay.root, state.source);

        const second = configureThreeOccupantPreset(state, first.left);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-balanced-grid");

        const replaced = state.controller.readSelectedOverlay(scope);
        assert.ok(replaced !== null);
        assert.notEqual(replaced.root, firstOverlay.root);
        assert.equal(replaced.root, first.left);
        assert.equal(replaced.preset, "balanced-grid");
        assert.deepEqual(replaced.leaves, [second.left, second.middle, second.right]);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("keeps overlays independent across exact desktop scopes", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope1 = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope1) !== null);

        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        const source2 = tile();
        const active2 = window({ tile: source2, desktops: [desktop2] });
        source2.windows = [active2];
        root2.tiles = [source2];
        state.harness.rootsByDesktop.set("desktop-2", root2);
        state.harness.currentDesktop = desktop2;
        state.harness.active = active2;
        state.harness.windows = [active2];

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-rows");

        const firstOverlay = state.controller.readSelectedOverlay(scope1);
        const secondOverlay = state.controller.readSelectedOverlay({
            output: OUTPUT,
            desktop: desktop2,
            scope: { output: OUTPUT, desktopId: desktop2.id },
        });
        assert.ok(firstOverlay !== null);
        assert.ok(secondOverlay !== null);
        assert.equal(firstOverlay.preset, "columns");
        assert.equal(firstOverlay.root, state.source);
        assert.equal(secondOverlay.preset, "rows");
        assert.equal(secondOverlay.root, source2);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("does not return or discard the overlay for a different exact scope", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);

        const otherOutput = { ...OUTPUT, name: "screen-2" };
        const otherScope: CurrentScope = {
            output: otherOutput,
            desktop: DESKTOP,
            scope: { output: otherOutput, desktopId: DESKTOP.id },
        };
        assert.equal(state.controller.readSelectedOverlay(otherScope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);
    });

    it("returns the recorded overlay through the read seam on a healthy topology", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);

        const first = state.controller.readSelectedOverlay(scope);
        const second = state.controller.readSelectedOverlay(scope);
        assert.ok(first !== null);
        assert.ok(second !== null);
        assert.equal(first.preset, "columns");
        assert.equal(first.root, state.source);
        assert.deepEqual(first.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(second, first);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("discards inertly with one fixed diagnostic when the workspace root no longer yields the overlay", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        state.harness.root = null;
        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);

        // The stale entry is gone; a further read stays inert without another diagnostic.
        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("discards when the current workspace root is not a Custom Tile", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const { layoutDirection: _layoutDirection, split: _split, ...nonCustomRoot } = tile(RECT, true);
        state.harness.root = nonCustomRoot;

        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("discards when the overlay root leaves, its topology drifts, or leaf order changes", () => {
        const removed = presetSetup();
        const first = configureThreeOccupantPreset(removed);
        invokeShortcut(removed.harness, "plasma-auto-tiler-apply-columns");
        const removedScope = currentScopeFor(removed.active);
        removed.source.tiles = [first.left];
        assert.equal(removed.controller.readSelectedOverlay(removedScope), null);
        assert.equal(countEvent(removed.harness.logs, "selected-overlay-invalidated"), 1);

        const unreachable = presetSetup();
        const second = configureThreeOccupantPreset(unreachable);
        invokeShortcut(unreachable.harness, "plasma-auto-tiler-apply-columns");
        const unreachableScope = currentScopeFor(unreachable.active);
        unreachable.root.tiles = [second.left];
        assert.equal(unreachable.controller.readSelectedOverlay(unreachableScope), null);
        assert.equal(countEvent(unreachable.harness.logs, "selected-overlay-invalidated"), 1);

        const reordered = presetSetup();
        const third = configureThreeOccupantPreset(reordered);
        invokeShortcut(reordered.harness, "plasma-auto-tiler-apply-columns");
        const reorderedScope = currentScopeFor(reordered.active);
        reordered.source.tiles = [third.branch, third.left];
        assert.equal(reordered.controller.readSelectedOverlay(reorderedScope), null);
        assert.equal(countEvent(reordered.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("preserves structurally valid overlay state when windows are removed or vacate leaves", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        state.harness.emitRemoved(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        realized.middle.windows = [];
        realized.right.windows = [];
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);
        assert.equal(state.controller.isEnabled, true);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("never assigns occupants while reading or validating overlay state", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const managedBefore = realized.managed.length;
        assert.ok(managedBefore > 0);

        assert.ok(state.controller.readSelectedOverlay(scope) !== null);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        // An invalidating read must also stay assignment-free.
        state.harness.root = null;
        assert.equal(state.controller.readSelectedOverlay(scope), null);

        assert.equal(realized.managed.length, managedBefore);
    });
});

// Simulates KWin's tile window-list maintenance on a guarded `window.tile`
// write (the attach half of setTileCompatibility): the window leaves the
// previous tile's window list and joins the target's. Each write is recorded
// so tests can assert deterministic order and count.
function attachTileWriter(subject: TestWindow, writes: Array<{ window: TestWindow; target: object | null }> = []): void {
    let current: object | null = subject.tile;
    Object.defineProperty(subject, "tile", {
        configurable: true,
        get: () => current,
        set: (next: object | null) => {
            writes.push({ window: subject, target: next });
            const previous = current;
            current = next;
            if (previous !== null && previous !== next) {
                (previous as TestTile).windows = ((previous as TestTile).windows as TestWindow[]).filter(
                    (value) => value !== subject,
                );
            }
            if (next !== null) {
                (next as TestTile).windows = [
                    ...((next as TestTile).windows as TestWindow[]).filter((value) => value !== subject),
                    subject,
                ];
            }
        },
    });
}

describe("TileController selected overlay reflow", () => {
    it("compacts occupants into ordinal leaves after a removal leaves a hole", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        // After the preset, ordinal leaves hold [active, lateWindow, earlyWindow].
        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.active.tile, realized.left);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("never reassigns a window that still lingers in its leaf when removal is processed", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // Worst-case removal timing: the removed window is still listed in its
        // leaf's window array, so only the identity guard prevents reassignment.
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.active.tile, realized.left);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
    });

    it("compacts the overlay after a successful detach without retiling the detached window", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        invokeShortcut(state.harness, "plasma-auto-tiler-detach");

        assert.equal(state.active.tile, null);
        assert.equal(state.lateWindow.tile, realized.left);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(countEvent(state.harness.logs, "detach-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
        assert.ok(
            state.harness.logs.indexOf("plasma-auto-tiler:detach-completed") <
                state.harness.logs.indexOf("plasma-auto-tiler:reflow-completed"),
        );
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("does not reflow a selected overlay when detaching a same-scope external window", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const external = window({ tile: state.early });
        state.early.windows = [external];
        state.harness.active = external;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");

        assert.equal(external.tile, null);
        assert.equal(countEvent(state.harness.logs, "detach-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("adds an eligible new window into the first trailing leaf only when capacity exists", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        attachTileWriter(state.active);
        attachTileWriter(state.lateWindow);
        attachTileWriter(state.earlyWindow);

        // Removal + compaction leaves the trailing leaf empty.
        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);
        assert.equal(state.earlyWindow.tile, realized.middle);

        const incoming = window();
        state.harness.emitAdded(incoming);

        assert.equal(incoming.tile, realized.right);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 2);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 0);
    });

    it("falls through to generic automatic placement when the selected overlay is full", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const managed: unknown[] = [];
        state.early.manage = (value) => {
            managed.push(value);
            return true;
        };
        const incoming = window();
        state.harness.emitAdded(incoming);

        assert.equal(countEvent(state.harness.logs, "reflow-no-capacity"), 1);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 1);
        assert.deepEqual(managed, [incoming]);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("rejects ineligible and out-of-scope additions without touching the overlay", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const before = state.controller.readSelectedOverlay(scope);
        assert.ok(before !== null);

        state.harness.emitAdded(window({ resizeable: false }));
        state.harness.emitAdded(window({ output: null }));

        assert.equal(countEvent(state.harness.logs, "window-added-rejected:not-resizeable"), 1);
        assert.equal(countEvent(state.harness.logs, "window-added-rejected:scope-unavailable"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(state.harness.logs, "reflow-rejected:candidate-eligibility"), 0);
        const after = state.controller.readSelectedOverlay(scope);
        assert.ok(after !== null);
        assert.equal(after.root, before.root);
        assert.deepEqual(after.leaves, [realized.left, realized.middle, realized.right]);
    });

    it("does not pull a window already tiled outside the overlay into the overlay", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const external = tile({ x: 400, y: 0, width: 100, height: 100 });
        state.root.tiles = [...(state.root.tiles as TestTile[]), external];
        const tiledElsewhere = window({ tile: external });
        external.windows = [tiledElsewhere];
        state.harness.emitAdded(tiledElsewhere);

        assert.equal(countEvent(state.harness.logs, "reflow-rejected:candidate-eligibility"), 1);
        assert.equal(tiledElsewhere.tile, external);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 0);
    });

    it("discards a structurally drifted overlay without writing when a removal triggers reflow", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);

        state.harness.root = tile(RECT, true);
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-rejected:assignment-stale"), 0);
        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("is a no-op when the overlay is already compact and correct", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // A removal outside the overlay on the same scope reflows the overlay
        // but finds nothing to write.
        state.harness.emitRemoved(window());

        assert.equal(countEvent(state.harness.logs, "reflow-noop"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("aborts before any write when preflight validation fails", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // The same window occupying two leaves is an inconsistent overlay.
        realized.middle.windows = [state.active];
        state.harness.emitRemoved(state.earlyWindow);

        assert.equal(countEvent(state.harness.logs, "reflow-rejected:occupancy-validity"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("stops fail-fast after a partial write without claiming rollback", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // Removing the first occupant needs two writes (late -> left, early -> middle).
        // The second write must fail.
        Object.defineProperty(state.earlyWindow, "tile", {
            configurable: true,
            value: realized.right,
            writable: false,
        });
        realized.left.windows = [];
        state.harness.emitRemoved(state.active);

        assert.equal(countEvent(state.harness.logs, "reflow-partial:assignment-failed"), 1);
        assert.equal(state.lateWindow.tile, realized.left);
        assert.equal(state.earlyWindow.tile, realized.right);
        assert.equal(state.controller.isEnabled, true);
    });

    it("rejects when topology changes between planning and the first write", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        let reads = 0;
        const decoy = tile(RECT, true);
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                reads += 1;
                return reads === 1 ? state.root : decoy;
            },
        });

        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-rejected:assignment-stale"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.earlyWindow.tile, realized.right);
        assert.equal(state.controller.isEnabled, true);
    });

    it("writes in deterministic ordinal order", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.lateWindow, writes);
        attachTileWriter(state.earlyWindow, writes);

        realized.left.windows = [];
        state.harness.emitRemoved(state.active);

        assert.deepEqual(writes, [
            { window: state.lateWindow, target: realized.left },
            { window: state.earlyWindow, target: realized.middle },
        ]);
    });

    it("retains the current ordinal traversal after a manual move on the next reflow", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // Manual directional moves swap the order without an immediate reflow.
        state.lateWindow.tile = realized.left;
        realized.left.windows = [state.lateWindow];
        state.active.tile = realized.right;
        realized.right.windows = [state.active];

        // The next lifecycle reflow compacts the moved traversal (late first),
        // not the preset's original active-first order.
        realized.middle.windows = [];
        state.harness.emitRemoved(state.earlyWindow);

        assert.equal(state.active.tile, realized.middle);
        assert.equal(state.lateWindow.tile, realized.left);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
    });

    it("reflows only the affected scope when multiple scopes have selected overlays", () => {
        const first = presetSetup();
        const realized = configureThreeOccupantPreset(first);
        invokeShortcut(first.harness, "plasma-auto-tiler-apply-columns");
        const firstScope = currentScopeFor(first.active);

        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        const source2 = tile();
        const active2 = window({ tile: source2, desktops: [desktop2] });
        source2.windows = [active2];
        root2.tiles = [source2];
        first.harness.rootsByDesktop.set("desktop-2", root2);
        first.harness.currentDesktop = desktop2;
        first.harness.active = active2;
        first.harness.windows = [active2];
        invokeShortcut(first.harness, "plasma-auto-tiler-apply-columns");
        const secondScope: CurrentScope = {
            output: OUTPUT,
            desktop: desktop2,
            scope: { output: OUTPUT, desktopId: desktop2.id },
        };
        assert.ok(first.controller.readSelectedOverlay(secondScope) !== null);

        first.harness.emitRemoved(active2);

        // Only the removed window's scope reflows (no-op); scope 1 is untouched.
        assert.equal(countEvent(first.harness.logs, "reflow-noop"), 1);
        assert.equal(countEvent(first.harness.logs, "reflow-completed"), 0);
        const overlay1 = first.controller.readSelectedOverlay(firstScope);
        assert.ok(overlay1 !== null);
        assert.equal(overlay1.root, first.source);
        assert.deepEqual(overlay1.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(first.active.tile, realized.left);
        assert.equal(first.lateWindow.tile, realized.middle);
        assert.equal(first.earlyWindow.tile, realized.right);
    });

    it("does not reflow an unrelated scope when a removed wrapper loses its scope", () => {
        const first = presetSetup();
        const realized = configureThreeOccupantPreset(first);
        invokeShortcut(first.harness, "plasma-auto-tiler-apply-columns");

        const detachedScopeWindow = window({ output: null });
        first.harness.emitRemoved(detachedScopeWindow);

        assert.equal(countEvent(first.harness.logs, "reflow-noop"), 0);
        assert.equal(countEvent(first.harness.logs, "reflow-completed"), 0);
        assert.equal(first.active.tile, realized.left);
        assert.equal(first.lateWindow.tile, realized.middle);
        assert.equal(first.earlyWindow.tile, realized.right);
    });

    it("never calls structural tile operations during reflow", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        let structuralCalls = 0;
        for (const leaf of [realized.left, realized.middle, realized.right]) {
            leaf.split = () => {
                structuralCalls += 1;
                throw new Error("private-window-title");
            };
            leaf.unmanage = () => {
                structuralCalls += 1;
                return false;
            };
        }
        realized.left.manage = () => {
            structuralCalls += 1;
            return false;
        };

        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(structuralCalls, 0);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.controller.isEnabled, true);
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
            state.controller.armKeyboardInsertion("right");
            const diagnostics = state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:keyboard-"));
            assert.deepEqual(diagnostics, ["plasma-auto-tiler:keyboard-invoked", `plasma-auto-tiler:${testCase.reason}`]);
        }
    });

    it("reports pending replacement without changing the existing successful arm", () => {
        const { harness, controller } = setup();
        const baseline = harness.logs.length;
        controller.armKeyboardInsertion("right");
        controller.armKeyboardInsertion("right");
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

    it("is inert when an already-cancelled deferred callback is forced to fire after removal, even once desktops settle", () => {
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

        harness.emitRemoved(incoming);
        assert.equal(harness.scheduled[0]?.cancelled, true);

        // Simulate a timeout already queued before removal: it fires even
        // though the entry was cancelled, with desktops settled into scope.
        // The callback must be inert rather than placing the removed window.
        incoming.desktops = [DESKTOP];
        harness.fireScheduledForced(0);
        assert.equal(managed.length, 0);
        assert.equal(countEvent(harness.logs, "window-added-eligible-deferred"), 0);
        assert.equal(countEvent(harness.logs, "window-added-reevaluated:match"), 0);
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
        controller.armKeyboardInsertion("right");
        controller.armKeyboardInsertion("right");
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
        controller.armKeyboardInsertion("right");
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
        controller.armKeyboardInsertion("right");
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

    it("registers the exact 18-action all-or-nothing catalog", () => {
        const { harness } = setup();
        const names = harness.shortcuts.map((entry) => entry.name).sort();
        assert.deepEqual(names, [
            "plasma-auto-tiler-apply-balanced-grid",
            "plasma-auto-tiler-apply-columns",
            "plasma-auto-tiler-apply-rows",
            "plasma-auto-tiler-attach",
            "plasma-auto-tiler-detach",
            "plasma-auto-tiler-fill-scope",
            "plasma-auto-tiler-focus-down",
            "plasma-auto-tiler-focus-left",
            "plasma-auto-tiler-focus-right",
            "plasma-auto-tiler-focus-up",
            "plasma-auto-tiler-insert-down",
            "plasma-auto-tiler-insert-left",
            "plasma-auto-tiler-insert-right",
            "plasma-auto-tiler-insert-up",
            "plasma-auto-tiler-move-down",
            "plasma-auto-tiler-move-left",
            "plasma-auto-tiler-move-right",
            "plasma-auto-tiler-move-up",
        ]);
    });

    it("disables atomically when any single new directional insertion registration fails", () => {
        // 1-based registration positions of the three added insert actions.
        for (const failIndex of [2, 3, 4]) {
            const harness = new Harness();
            for (let index = 1; index < failIndex; index += 1) {
                harness.shortcutResults.push(true);
            }
            harness.shortcutResults.push(false);
            const controller = new TileController(harness.environment());
            controller.start();
            assert.equal(controller.isEnabled, false);
            assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
            assert.equal(countEvent(harness.logs, "startup-handlers-ready"), 0);
            assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
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
