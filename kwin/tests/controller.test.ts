import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEQUENTIAL_LENGTH } from "../src/boundary";
import { TileController, type ControllerEnvironment, type CurrentScope } from "../src/controller";
import { buildDwindleBlueprint, type Blueprint } from "../src/layout-blueprint";
import { DIRECTIONS, type Direction, type Point } from "../src/logic";

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
    caption: string;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    move: boolean;
    resize: boolean;
    outputChanged: TestSignal;
    desktopsChanged: TestSignal;
    tileChanged: TestSignal;
    interactiveMoveResizeStarted: TestSignal;
    interactiveMoveResizeStepped: TestSignal;
    interactiveMoveResizeFinished: TestSignal;
    moveResizedChanged: TestSignal;
    fullScreenChanged: TestSignal;
    maximizedChanged: TestSignal;
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
    remove?: () => boolean;
}

interface RegisteredShortcut {
    readonly name: string;
    readonly text: string;
    readonly sequence: string;
    readonly handler: () => void;
}

// A queued one-shot event-loop yield, mirroring the callDBus async callback
// seam: arming enqueues exactly one dispatch that runs once on a later
// "event-loop turn" (the harness flush).
interface YieldEntry {
    readonly callback: () => void;
    fired: boolean;
    cancelled: boolean;
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
        caption: "test-window",
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        move: false,
        resize: false,
        outputChanged: signal(),
        desktopsChanged: signal(),
        tileChanged: signal(),
        interactiveMoveResizeStarted: signal(),
        interactiveMoveResizeStepped: signal(),
        interactiveMoveResizeFinished: signal(),
        moveResizedChanged: signal(),
        fullScreenChanged: signal(),
        maximizedChanged: signal(),
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

// Approximates QV4's QObjectMethod shape: a QObject signal property reads as
// a callable QObjectMethod function whose connect/disconnect live on the
// function prototype (QV4 installs them on Function.prototype,
// qv4qobjectwrapper.cpp:322-323), not as an object with an own connect member.
// This is a Node stand-in for the QJSEngine shape and is NOT live proof that
// KWin delivers these signals; it only proves the attach path no longer
// requires an object-valued signal with an own connect member.
function qv4MethodSignal(): TestSignal & (() => void) {
    const callbacks = new Set<() => void>();
    const method = function (): void {} as TestSignal & (() => void);
    const proto = Object.create(Function.prototype);
    Object.defineProperties(proto, {
        connect: { value: (next: () => void) => callbacks.add(next) },
        disconnect: { value: (next: () => void) => callbacks.delete(next) },
        emit: { value: () => { for (const callback of callbacks) callback(); } },
        subscriberCount: { get: () => callbacks.size },
    });
    Object.setPrototypeOf(method, proto);
    return method;
}

class Harness {
    active: unknown = null;
    writtenActive: unknown;
    currentDesktop: unknown = DESKTOP;
    root: unknown = null;
    rootReads = 0;
    readonly rootsByDesktop = new Map<string, unknown>();
    windows: unknown = [];
    cursor: unknown = null;
    cursorThrows = false;
    clientArea: unknown = { x: 0, y: 0, width: 100, height: 100 };
    shortcutResult = true;
    readonly shortcutResults: boolean[] = [];
    readonly shortcuts: RegisteredShortcut[] = [];
    readonly scheduled: { delayMs: number; callback: () => void; cancelled: boolean }[] = [];
    readonly activeWrites: unknown[] = [];
    yieldResult = true;
    readonly yields: YieldEntry[] = [];
    added: ((value: unknown) => void) | undefined;
    removed: ((value: unknown) => void) | undefined;
    screensChanged: (() => void) | undefined;
    desktopChanged: (() => void) | undefined;
    desktopsChanged: (() => void) | undefined;
    desktopsList: unknown = [DESKTOP];
    screensList: unknown = [OUTPUT];
    currentDesktopValue: unknown = DESKTOP;
    createDesktopThrows: Error | undefined;
    removeDesktopThrows: Error | undefined;
    setCurrentDesktopThrows: Error | undefined;
    desktopsThrows: Error | undefined;
    readonly createDesktopCalls: Array<{ position: number; name: string }> = [];
    readonly removedDesktops: unknown[] = [];
    readonly currentDesktopWrites: unknown[] = [];
    nextDesktopNumber = 1;
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
            rootTile: (_output, desktop) => {
                this.rootReads += 1;
                return this.rootsByDesktop.get(desktop.id) ?? this.root;
            },
            windowList: () => this.windows,
            cursorPos: () => {
                if (this.cursorThrows) {
                    throw new Error("cursor-read-failed");
                }
                return this.cursor;
            },
            clientArea: () => this.clientArea,
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
            desktops: () => {
                if (this.desktopsThrows !== undefined) {
                    throw this.desktopsThrows;
                }
                return this.desktopsList;
            },
            screens: () => this.screensList,
            currentDesktop: () => this.currentDesktopValue,
            createDesktop: (position, name) => {
                if (this.createDesktopThrows !== undefined) {
                    throw this.createDesktopThrows;
                }
                this.createDesktopCalls.push({ position, name });
                // Monotonic desktop id/number: a trailing empty desktop removed
                // by cleanup must never cause a later create to reuse its id.
                this.nextDesktopNumber += 1;
                const created = { id: `desktop-${this.nextDesktopNumber}`, x11DesktopNumber: this.nextDesktopNumber };
                this.desktopsList = [
                    ...((Array.isArray(this.desktopsList) ? this.desktopsList : []) as unknown[]),
                    created,
                ];
                return created;
            },
            removeDesktop: (desktop) => {
                if (this.removeDesktopThrows !== undefined) {
                    throw this.removeDesktopThrows;
                }
                this.removedDesktops.push(desktop);
                if (Array.isArray(this.desktopsList)) {
                    this.desktopsList = (this.desktopsList as unknown[]).filter(
                        (entry) => (entry as { id: string }).id !== (desktop as { id: string }).id,
                    );
                }
            },
            setCurrentDesktop: (desktop) => {
                if (this.setCurrentDesktopThrows !== undefined) {
                    throw this.setCurrentDesktopThrows;
                }
                this.currentDesktopWrites.push(desktop);
                this.currentDesktopValue = desktop;
            },
            onDesktopsChanged: (handler) => {
                this.desktopsChanged = handler;
            },
            watchInteractiveWindow: (target, started, finished, stepped, moveResizedChanged, invalidated) => {
                const connected: Array<[string, () => void]> = [];
                const attach = (name: string, handler: () => void): boolean => {
                    let value: unknown;
                    try {
                        value = (target as unknown as Record<string, unknown>)[name];
                        (value as { connect: (next: () => void) => void }).connect(handler);
                        connected.push([name, handler]);
                        this.logs.push(`plasma-auto-tiler:drag-attach-ok:${name}`);
                        return true;
                    } catch (error) {
                        this.logs.push(
                            `plasma-auto-tiler:drag-attach-failed:${name}:${String(error)} (observed typeof ${typeof value})`,
                        );
                        return false;
                    }
                };
                const attempts: ReadonlyArray<readonly [string, () => void]> = [
                    ["interactiveMoveResizeStarted", started],
                    ["interactiveMoveResizeStepped", stepped],
                    ["interactiveMoveResizeFinished", finished],
                    ["moveResizedChanged", moveResizedChanged],
                    ["outputChanged", invalidated],
                    ["desktopsChanged", invalidated],
                ];
                let ok = 0;
                let failed = 0;
                for (const [name, handler] of attempts) {
                    if (attach(name, handler)) {
                        ok += 1;
                    } else {
                        failed += 1;
                    }
                }
                return {
                    disconnect: () => {
                        for (const [name, handler] of connected) {
                            try {
                                (target as unknown as Record<string, { disconnect: (next: () => void) => void }>)[
                                    name
                                ]!.disconnect(handler);
                            } catch (error) {
                                void error;
                            }
                        }
                    },
                    ok,
                    failed,
                };
            },
            watchFullscreen: (target, changed) => {
                let value: unknown;
                try {
                    value = (target as unknown as Record<string, unknown>)["fullScreenChanged"];
                    (value as { connect: (next: () => void) => void }).connect(changed);
                    this.logs.push("plasma-auto-tiler:fullscreen-attach-ok:fullScreenChanged");
                    return {
                        disconnect: () => {
                            try {
                                (
                                    target as unknown as Record<
                                        string,
                                        { disconnect: (next: () => void) => void }
                                    >
                                )["fullScreenChanged"]!.disconnect(changed);
                            } catch (error) {
                                void error;
                            }
                        },
                        ok: 1,
                        failed: 0,
                    };
                } catch (error) {
                    this.logs.push(
                        `plasma-auto-tiler:fullscreen-attach-failed:fullScreenChanged:${String(error)} (observed typeof ${typeof value})`,
                    );
                    return { disconnect: () => {}, ok: 0, failed: 1 };
                }
            },
            watchMaximize: (target, changed) => {
                let value: unknown;
                try {
                    value = (target as unknown as Record<string, unknown>)["maximizedChanged"];
                    (value as { connect: (next: () => void) => void }).connect(changed);
                    this.logs.push("plasma-auto-tiler:maximize-attach-ok:maximizedChanged");
                    return {
                        disconnect: () => {
                            try {
                                (
                                    target as unknown as Record<
                                        string,
                                        { disconnect: (next: () => void) => void }
                                    >
                                )["maximizedChanged"]!.disconnect(changed);
                            } catch (error) {
                                void error;
                            }
                        },
                        ok: 1,
                        failed: 0,
                    };
                } catch (error) {
                    this.logs.push(
                        `plasma-auto-tiler:maximize-attach-failed:maximizedChanged:${String(error)} (observed typeof ${typeof value})`,
                    );
                    return { disconnect: () => {}, ok: 0, failed: 1 };
                }
            },
            onPendingTargetChanged: (target, handler) => {
                const surface = target as unknown as Record<string, unknown>;
                const connected: Array<[string, () => void]> = [];
                const attach = (name: string): boolean => {
                    let value: unknown;
                    try {
                        value = surface[name];
                        (value as { connect: (next: () => void) => void }).connect(handler);
                        connected.push([name, handler]);
                        this.logs.push(`plasma-auto-tiler:pending-attach-ok:${name}`);
                        return true;
                    } catch (error) {
                        this.logs.push(
                            `plasma-auto-tiler:pending-attach-failed:${name}:${String(error)} (observed typeof ${typeof value})`,
                        );
                        return false;
                    }
                };
                attach("outputChanged");
                attach("desktopsChanged");
                attach("tileChanged");
                return () => {
                    for (const [name, connectedHandler] of connected) {
                        try {
                            (surface[name] as { disconnect: (next: () => void) => void }).disconnect(connectedHandler);
                        } catch (error) {
                            void error;
                        }
                    }
                };
            },
            yieldOnce: (callback) => {
                if (!this.yieldResult) {
                    return false;
                }
                this.yields.push({ callback, fired: false, cancelled: false });
                return true;
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

    emitDesktopsChanged(): void {
        if (this.desktopsChanged !== undefined) {
            this.desktopsChanged();
        }
    }

    // Fire the next queued one-shot event-loop yield in FIFO order, modeling a
    // callDBus callback dispatch. Returns whether an entry was queued.
    flushNextYield(): boolean {
        const entry = this.yields.shift();
        if (entry === undefined) {
            return false;
        }
        if (!entry.cancelled) {
            entry.fired = true;
            entry.callback();
        }
        return true;
    }

    // Model a lost callDBus reply: the armed one-shot yield is removed without
    // ever invoking its callback. KWin's callDBus wrapper never dispatches the
    // callback for an error reply (scripting.cpp:361-364), so the armed yield
    // is silently absent exactly as if the D-Bus call had failed.
    dropNextYield(): boolean {
        const entry = this.yields.shift();
        if (entry === undefined) {
            return false;
        }
        return true;
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

// Occupied directional target for a swap: the active window in `source` and a
// second in-scope window in `target`, both with the attach tile writer installed
// so guarded `window.tile` writes maintain the tile window lists exactly as
// setTileCompatibility does on KWin. The shared `writes` array records every
// guarded write in deterministic order.
function swapSetup(direction: "left" | "down" | "up" | "right"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly source: TestTile;
    readonly target: TestTile;
    readonly active: TestWindow;
    readonly occupant: TestWindow;
    readonly writes: Array<{ window: TestWindow; target: object | null }>;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const geometry =
        direction === "left"
            ? { x: -200, y: 0, width: 100, height: 100 }
            : direction === "right"
              ? { x: 200, y: 0, width: 100, height: 100 }
              : direction === "up"
                ? { x: 0, y: -200, width: 100, height: 100 }
                : { x: 0, y: 200, width: 100, height: 100 };
    const source = tile();
    const target = tile(geometry);
    const active = window({ tile: source });
    const occupant = window({ tile: target });
    source.windows = [active];
    target.windows = [occupant];
    root.tiles = [source, target];
    harness.root = root;
    harness.active = active;
    harness.windows = [active, occupant];
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(active, writes);
    attachTileWriter(occupant, writes);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, source, target, active, occupant, writes };
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
        ["right", "plasma-auto-tiler-focus-right", "Focus window right", "Meta+Alt+Ctrl+L"],
    ];
    const focusArrowActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-focus-left-arrow", "Focus window left (arrow)", "Meta+Left"],
        ["down", "plasma-auto-tiler-focus-down-arrow", "Focus window down (arrow)", "Meta+Down"],
        ["up", "plasma-auto-tiler-focus-up-arrow", "Focus window up (arrow)", "Meta+Up"],
        ["right", "plasma-auto-tiler-focus-right-arrow", "Focus window right (arrow)", "Meta+Right"],
    ];
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
    const presetActions: ReadonlyArray<readonly [string, string, string]> = [
        ["plasma-auto-tiler-apply-columns", "Apply columns in focused leaf", "Meta+Alt+1"],
        ["plasma-auto-tiler-apply-rows", "Apply rows in focused leaf", "Meta+Alt+2"],
        ["plasma-auto-tiler-apply-balanced-grid", "Apply balanced grid in focused leaf", "Meta+Alt+3"],
        ["plasma-auto-tiler-apply-dwindle", "Apply dwindle in focused leaf", "Meta+Alt+4"],
    ];
    const workspaceActions: ReadonlyArray<readonly [string, string, string]> = [
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
            (index) => [`plasma-auto-tiler-workspace-${index}`, `Focus workspace ${index}`, `Meta+${index}`] as const,
        ),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
            (index) =>
                [`plasma-auto-tiler-move-workspace-${index}`, `Move window to workspace ${index}`, `Meta+Shift+${index}`] as const,
        ),
        ["plasma-auto-tiler-workspace-append", "Append and focus a new workspace", "Meta+0"],
        ["plasma-auto-tiler-move-workspace-append", "Move window to a newly appended workspace", "Meta+Shift+0"],
    ];

    const actionCatalog: ReadonlyArray<readonly [string, string, string]> = [
        ...insertActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...focusActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...focusArrowActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...moveActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ...moveArrowActions.map(([, name, text, sequence]) => [name, text, sequence] as const),
        ["plasma-auto-tiler-detach", "Detach window from tile", "Meta+Shift+Space"],
        ["plasma-auto-tiler-attach", "Attach window to available tile", "Meta+Alt+Shift+Space"],
        ["plasma-auto-tiler-float-toggle", "Float or tile active window", "Meta+G"],
        ["plasma-auto-tiler-sticky-toggle", "Toggle sticky floating on all desktops", "Meta+Shift+G"],
        ["plasma-auto-tiler-maximize", "Maximize active window in its workspace", "Meta+M"],
        ["plasma-auto-tiler-fill-scope", "Fill available tiles with windows", "Meta+Alt+Return"],
        ...presetActions,
        ...workspaceActions,
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
            for (const [, name] of [...focusActions, ...focusArrowActions, ...moveActions, ...moveArrowActions]) {
                invokeShortcut(harness, name);
            }
            invokeShortcut(harness, "plasma-auto-tiler-detach");
            invokeShortcut(harness, "plasma-auto-tiler-attach");
            invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
            invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
            invokeShortcut(harness, "plasma-auto-tiler-maximize");
            invokeShortcut(harness, "plasma-auto-tiler-fill-scope");
            for (const [name] of presetActions) {
                invokeShortcut(harness, name);
            }
            for (const [name] of workspaceActions) {
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
});

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

describe("TileController selected overlay state", () => {
    it("records the selected overlay only after every occupant assignment succeeds", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");

        const overlay = state.controller.readSelectedOverlay(currentScopeFor(state.active));
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "dwindle");
        assert.equal(overlay.root, state.source);
        assert.deepEqual(overlay.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(overlay.scope.scope.output, OUTPUT);
        assert.equal(overlay.scope.scope.desktopId, "desktop-1");
        assert.equal(countEvent(state.harness.logs, "preset-applied:dwindle"), 1);
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
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");
        const scope = currentScopeFor(state.active);
        const overlay = state.controller.readSelectedOverlay(scope);
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "dwindle");

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
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");
        const scope = currentScopeFor(state.active);
        const overlay = state.controller.readSelectedOverlay(scope);
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "dwindle");

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
                // The reflow planning revalidates the overlay once (read one),
                // then the per-write revalidation re-reads it (read two) and
                // sees the decoy, so the first write rejects.
                return reads <= 1 ? state.root : decoy;
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

// Owned dwindle(3) scope realizing H[term1, V[term2, term3]], with the drop
// target term1 split-ready and the vacated origin term2 removable. The scope is
// adopted unchanged on start (ownership-taken, no yields), so a later native
// Shift drop models the accepted three-window example.
function nativeDropSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly term1: TestTile;
    readonly right: TestTile;
    readonly term2: TestTile;
    readonly term3: TestTile;
    readonly top: TestTile;
    readonly bottom: TestTile;
    readonly term1Win: TestWindow;
    readonly term2Win: TestWindow;
    readonly term3Win: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const term1 = tile({ x: 0, y: 0, width: 100, height: 100 });
    const right = tile({ x: 100, y: 0, width: 100, height: 100 }, true);
    right.layoutDirection = 2;
    const term2 = tile({ x: 100, y: 0, width: 100, height: 50 });
    const term3 = tile({ x: 100, y: 50, width: 100, height: 50 });
    const term1Win = window({ tile: term1, caption: "term1" });
    const term2Win = window({ tile: term2, caption: "term2" });
    const term3Win = window({ tile: term3, caption: "term3" });
    term1.windows = [term1Win];
    term2.windows = [term2Win];
    term3.windows = [term3Win];
    root.tiles = [term1, right];
    right.tiles = [term2, term3];
    harness.root = root;
    harness.active = term1Win;
    harness.windows = [term1Win, term2Win, term3Win];
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(term1Win, writes);
    attachTileWriter(term2Win, writes);
    attachTileWriter(term3Win, writes);
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    const top = tile({ x: 0, y: 0, width: 100, height: 50 });
    const bottom = tile({ x: 0, y: 50, width: 100, height: 50 });
    top.manage = manage(top);
    bottom.manage = manage(bottom);
    term1.split = (direction) => {
        term1.isLayout = true;
        term1.layoutDirection = direction;
        term1.windows = [];
        term1.tiles = [top, bottom];
        return [top, bottom];
    };
    term2.manage = manage(term2);
    term2.remove = () => {
        right.tiles = (right.tiles as TestTile[]).filter((entry) => entry !== term2);
        // KWin promotes a single-child layout after a tile removal: the vacated
        // V-wrapper disappears and term3 becomes the root's direct right child,
        // realizing the whole accepted tree H[V[term1, term2], term3].
        if ((right.tiles as TestTile[]).length === 1) {
            const sole = (right.tiles as TestTile[])[0];
            if (sole !== undefined) {
                root.tiles = (root.tiles as TestTile[]).map((entry) => (entry === right ? sole : entry));
            }
        }
        return true;
    };
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, term1, right, term2, term3, top, bottom, term1Win, term2Win, term3Win };
}

// The live minimum-split floor failure: four full-width rows 245px tall inside
// a 980px working height (y 44..289, 289..534, 534..779, 779..1024). A 50/50
// vertical split of a 245px row yields 122.5px halves, below KWin's 15%
// working-height floor (147px), so the split must be refused before mutating.
function rowsDropSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly rows: readonly [TestTile, TestTile, TestTile, TestTile];
    readonly row0Win: TestWindow;
    readonly row1Win: TestWindow;
    readonly row2Win: TestWindow;
    readonly row3Win: TestWindow;
    readonly splits: number[];
} {
    const harness = new Harness();
    harness.clientArea = { x: 0, y: 44, width: 1536, height: 980 };
    const row0 = tile({ x: 0, y: 44, width: 1536, height: 245 });
    const row1 = tile({ x: 0, y: 289, width: 1536, height: 245 });
    const row2 = tile({ x: 0, y: 534, width: 1536, height: 245 });
    const row3 = tile({ x: 0, y: 779, width: 1536, height: 245 });
    const root = tile({ x: 0, y: 44, width: 1536, height: 980 }, true);
    root.layoutDirection = 2;
    const row0Win = window({ tile: row0, caption: "row0" });
    const row1Win = window({ tile: row1, caption: "row1" });
    const row2Win = window({ tile: row2, caption: "row2" });
    const row3Win = window({ tile: row3, caption: "row3" });
    row0.windows = [row0Win];
    row1.windows = [row1Win];
    row2.windows = [row2Win];
    row3.windows = [row3Win];
    root.tiles = [row0, row1, row2, row3];
    harness.root = root;
    harness.active = row0Win;
    harness.windows = [row0Win, row1Win, row2Win, row3Win];
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(row0Win, writes);
    attachTileWriter(row1Win, writes);
    attachTileWriter(row2Win, writes);
    attachTileWriter(row3Win, writes);
    const splits: number[] = [];
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    const halve = (source: TestTile, direction: number): unknown => {
        splits.push(direction);
        source.isLayout = true;
        source.windows = [];
        const geometry = source.absoluteGeometry;
        const first = tile({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });
        const second = tile({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });
        if (direction === 1) {
            first.absoluteGeometry = { x: geometry.x, y: geometry.y, width: geometry.width / 2, height: geometry.height };
            second.absoluteGeometry = { x: geometry.x + geometry.width / 2, y: geometry.y, width: geometry.width / 2, height: geometry.height };
        } else {
            first.absoluteGeometry = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height / 2 };
            second.absoluteGeometry = { x: geometry.x, y: geometry.y + geometry.height / 2, width: geometry.width, height: geometry.height / 2 };
        }
        first.relativeGeometry = first.absoluteGeometry;
        second.relativeGeometry = second.absoluteGeometry;
        first.manage = manage(first);
        second.manage = manage(second);
        source.tiles = [first, second];
        return [first, second];
    };
    row0.split = (direction) => halve(row0, direction);
    row1.split = (direction) => halve(row1, direction);
    row2.split = (direction) => halve(row2, direction);
    row3.split = (direction) => halve(row3, direction);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, rows: [row0, row1, row2, row3], row0Win, row1Win, row2Win, row3Win, splits };
}

function collectLeaves(tile: TestTile): TestTile[] {
    if (!tile.isLayout) {
        return [tile];
    }
    const result: TestTile[] = [];
    for (const child of tile.tiles as TestTile[]) {
        result.push(...collectLeaves(child));
    }
    return result;
}

function assertLeafPartition(leaves: readonly TestTile[], area: typeof RECT): void {
    let total = 0;
    for (const leaf of leaves) {
        const g = leaf.absoluteGeometry;
        assert.ok(g.x >= area.x - 1e-9 && g.y >= area.y - 1e-9, "leaf must start within the working area");
        assert.ok(g.x + g.width <= area.x + area.width + 1e-9, "leaf must not exceed the working area width");
        assert.ok(g.y + g.height <= area.y + area.height + 1e-9, "leaf must not exceed the working area height");
        total += g.width * g.height;
    }
    for (let i = 0; i < leaves.length; i += 1) {
        for (let j = i + 1; j < leaves.length; j += 1) {
            const a = leaves[i]!.absoluteGeometry;
            const b = leaves[j]!.absoluteGeometry;
            const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            assert.equal(overlaps, false, `leaves ${i} and ${j} must not overlap`);
        }
    }
    assert.equal(total, area.width * area.height, "leaves must sum the full working extent");
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

// A dwindle(2) scope H[a, b] where dragging `a` onto `b` with a left-horizontal
// split leaves `a` floating (the drop manage reports success but never
// assigns), so the occupancy bijection fails on the origin collapse and queues
// a full reconstruction instead of the steady-state acceptance path.
function reconstructDropSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly a: TestTile;
    readonly b: TestTile;
    readonly bLeft: TestTile;
    readonly bRight: TestTile;
    readonly aWin: TestWindow;
    readonly bWin: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const a = tile({ x: 0, y: 0, width: 100, height: 100 });
    const b = tile({ x: 100, y: 0, width: 100, height: 100 });
    const aWin = window({ tile: a, caption: "a" });
    const bWin = window({ tile: b, caption: "b" });
    a.windows = [aWin];
    b.windows = [bWin];
    root.tiles = [a, b];
    harness.root = root;
    harness.active = aWin;
    harness.windows = [aWin, bWin];
    attachTileWriter(aWin);
    attachTileWriter(bWin);
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    // The dragged window's split child reports manage success without actually
    // assigning, so the drop completes with `aWin` still floating and its
    // reflow leaf empty. The occupancy bijection then fails on settle and the
    // invariant queues the full reconstruction this fixture exists to exercise.
    const bLeft = tile({ x: 100, y: 0, width: 50, height: 100 });
    const bRight = tile({ x: 150, y: 0, width: 50, height: 100 });
    bLeft.manage = () => true;
    bRight.manage = manage(bRight);
    b.split = (direction) => {
        b.isLayout = true;
        b.layoutDirection = direction;
        b.windows = [];
        b.tiles = [bLeft, bRight];
        return [bLeft, bRight];
    };
    a.remove = () => {
        root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
        return true;
    };
    bLeft.remove = () => {
        b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bLeft);
        return true;
    };
    bRight.remove = () => {
        b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bRight);
        return true;
    };
    b.remove = () => {
        root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== b);
        return true;
    };
    installDwindleSplitter(root);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, a, b, bLeft, bRight, aWin, bWin };
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

    it("does not overwrite a captured origin on a repeated start of the same window", () => {
        const { controller, harness, origin, target, dragged, targetWindow } = dragSetup();
        startDrag(dragged);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);

        // A repeated started signal for the same window (e.g. a move/resize
        // retransition) must not re-capture the origin or corrupt the drag.
        dragged.move = true;
        dragged.interactiveMoveResizeStarted.emit();
        dragged.move = false;
        assert.equal(countEvent(harness.logs, "drag-started"), 2);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);
        assert.equal(controller.hasActiveDrag, true);

        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.equal(controller.hasActiveDrag, false);
        assert.deepEqual(origin.windows, [dragged]);
        assert.deepEqual(target.windows, [targetWindow]);
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

    it("restores association through origin manage when the cursor resolves to the origin or no occupied leaf", () => {
        for (const cursor of [{ x: 60, y: 60 }, { x: 1000, y: 1000 }]) {
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

    it("rejects stale, same, multiple, ineligible, invalid, and cross-scope targets before split", () => {
        const cases: ReadonlyArray<(state: ReturnType<typeof dragSetup>) => void> = [
            (state) => {
                // The final frame center sits over the origin, so no occupied
                // leaf resolves and the drop restores.
                state.dragged.frameGeometry = { x: 10, y: 10, width: 100, height: 100 };
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
            startDrag(state.dragged);
            state.dragged.tile = null;
            // Final frame center over the target so the geometry-derived target
            // resolves and the planner's own validation decides the bail.
            state.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
            configure(state);
            state.dragged.interactiveMoveResizeFinished.emit();
            assert.equal(splits, 0);
            assert.equal(state.controller.hasActiveDrag, false);
            assert.equal(state.controller.isEnabled, true);
            assert.ok(restores <= 1);
        }
    });

    it("maps all directions to geometric children, retaining the origin leaf", () => {
        // With no cursor available the final frame center is the fallback
        // resolver point, so its position inside the four target-leaf regions
        // decides the split axis and side.
        const cases: ReadonlyArray<[typeof RECT, number]> = [
            [{ x: 160, y: 0, width: 100, height: 100 }, 1],
            [{ x: 240, y: 0, width: 100, height: 100 }, 1],
            [{ x: 200, y: 0, width: 100, height: 20 }, 2],
            [{ x: 200, y: 80, width: 100, height: 20 }, 2],
        ];
        for (const [finalGeometry, expectedDirection] of cases) {
            const { origin, target, dragged, targetWindow } = dragSetup();
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
            startDrag(dragged);
            dragged.frameGeometry = finalGeometry;
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(direction, expectedDirection);
            assert.equal(managed[0], targetWindow);
            assert.equal(managed[1], dragged);
            assert.deepEqual(origin.windows, [dragged]);
        }
    });

    it("selects the split direction from the cursor across all regions with a central dead-zone default", () => {
        const cases: ReadonlyArray<[Point, number]> = [
            [{ x: 210, y: 50 }, 1],
            [{ x: 290, y: 50 }, 1],
            [{ x: 250, y: 10 }, 2],
            [{ x: 250, y: 90 }, 2],
            [{ x: 250, y: 50 }, 2],
        ];
        for (const [cursor, expectedDirection] of cases) {
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
            startDrag(dragged);
            dragged.tile = null;
            dragged.frameGeometry = movedGeometry();
            harness.cursor = cursor;
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(direction, expectedDirection);
            assert.equal(managed[0], targetWindow);
            assert.equal(managed[1], dragged);
            assert.deepEqual(origin.windows, [dragged]);
        }
    });

    it("places the dragged window directly into an empty leaf without splitting or occupied-leaf reflow", () => {
        const { harness, controller, root, origin, target, dragged } = dragSetup();
        const empty = tile({ x: 400, y: 0, width: 100, height: 100 });
        root.tiles = [origin, target, empty];
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        empty.manage = (value) => {
            (value as TestWindow).tile = empty;
            empty.windows = [value as TestWindow];
            return true;
        };
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = movedGeometry();
        harness.cursor = { x: 450, y: 50 };
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(splits, 0);
        assert.equal(countEvent(harness.logs, "drag-empty-target"), 1);
        assert.equal(countEvent(harness.logs, "drag-empty-placement"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(dragged.tile, empty);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs the decisive plan rejection reason when an occupied target cannot be reflowed", () => {
        const { harness, controller, target, targetWindow, dragged } = dragSetup();
        target.windows = [targetWindow, window({ tile: target }), window({ tile: target })];
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-bail:geometry-plan-rejected:invalid-leaf-count"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("disables structural drag once for malformed split output or post-split manage failure", () => {
        const malformed = dragSetup();
        malformed.target.split = () => [];
        startDrag(malformed.dragged);
        malformed.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        malformed.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(malformed.controller.isEnabled, false);
        assert.equal(countEvent(malformed.harness.logs, "disabled:drag-split-result-invalid"), 1);

        const failedManage = dragSetup();
        const first = tile({ x: 200, y: 0, width: 50, height: 100 }, false, () => false);
        const second = tile({ x: 250, y: 0, width: 50, height: 100 });
        failedManage.target.split = () => [first, second];
        startDrag(failedManage.dragged);
        failedManage.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
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

    it("emits exactly one startup drag-attach summary aggregating per-signal results", () => {
        const { harness } = dragSetup();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:12:12:0"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:6:0"), 0);

        harness.desktopChanged?.();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:12:12:0"), 1);
    });

    it("reports a per-signal attach failure with a useful detail without skipping the window", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const origin = tile();
        const dragged = window({ tile: origin });
        delete (dragged as Partial<TestWindow>).moveResizedChanged;
        origin.windows = [dragged];
        root.tiles = [origin];
        harness.root = root;
        harness.windows = [dragged];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:5:1"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-interaction-signals"), 0);
        const failed = harness.logs.find((entry) =>
            entry.startsWith("plasma-auto-tiler:drag-attach-failed:moveResizedChanged:"),
        );
        assert.notEqual(failed, undefined);
        assert.ok(
            failed?.includes("typeof undefined"),
            `failed line must name the observed typeof, got: ${failed}`,
        );
    });

    it("attaches function-valued, prototype-provided signals approximating the QJSEngine shape (not live proof)", () => {
        // QV4 exposes QObject signal properties as callable QObjectMethod
        // functions whose connect/disconnect live on the function prototype
        // (qv4qobjectwrapper.cpp:322-323), so the whole-window isSignal-style
        // guard that required an object-valued signal with an own connect
        // member was live-proven false. A window whose interaction signals are
        // function-valued through a custom prototype and a getter approximates
        // that QJSEngine shape here. This is a static approximation, NOT live
        // proof that KWin delivers these signals.
        const harness = new Harness();
        const root = tile(RECT, true);
        const origin = tile();
        const dragged = window({ tile: origin });
        const qv4Signals: Record<string, TestSignal & (() => void)> = {
            interactiveMoveResizeStarted: qv4MethodSignal(),
            interactiveMoveResizeStepped: qv4MethodSignal(),
            interactiveMoveResizeFinished: qv4MethodSignal(),
            outputChanged: qv4MethodSignal(),
            desktopsChanged: qv4MethodSignal(),
            moveResizedChanged: qv4MethodSignal(),
        };
        for (const name of Object.keys(qv4Signals)) {
            Object.defineProperty(dragged, name, {
                get: () => qv4Signals[name],
                enumerable: false,
                configurable: true,
            });
        }
        origin.windows = [dragged];
        root.tiles = [origin];
        harness.root = root;
        harness.windows = [dragged];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:6:0"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-interaction-signals"), 0);
        assert.equal(
            harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-attach-failed:")),
            false,
        );
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        dragged.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-started"), 1);
    });

    it("logs a distinct skip reason for every remaining attach guard", () => {
        const harness = new Harness();
        harness.root = tile(RECT, true);
        const plain = window({ tile: null });
        const wrongDesktop = window({ tile: null, desktops: [{ id: "other-desktop" }] });
        const nullOutput = window({ tile: null, output: null });
        harness.windows = [plain, wrongDesktop, nullOutput];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:out-of-scope"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-scope"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-interaction-signals"), 0);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:not-window"), 0);
        harness.emitAdded({ normalWindow: true });
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:not-window"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:duplicate"), 0);
        harness.emitAdded(plain);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:duplicate"), 1);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("logs a window-list decode failure as the attach guard skip", () => {
        const harness = new Harness();
        harness.windows = "not-a-window-list";
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:window-list-decode-failed"), 1);
        assert.equal(
            harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-attach-summary:")),
            false,
            "a failed window-list decode must not emit a startup summary",
        );
    });

    it("skips interactive attachment once the window map is at capacity", () => {
        const harness = new Harness();
        harness.root = tile(RECT, true);
        const windows: TestWindow[] = [];
        for (let i = 0; i < MAX_SEQUENTIAL_LENGTH; i += 1) {
            windows.push(window({ tile: null }));
        }
        harness.windows = windows;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6144:6144:0"), 1);
        const overflow = window({ tile: null });
        harness.emitAdded(overflow);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:max-windows"), 1);
    });

    it("logs diagnostic-only drag event signals without mutating tiles", () => {
        const { controller, harness, origin, target, targetWindow, dragged } = dragSetup();
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit();
        dragged.moveResizedChanged.emit();
        assert.equal(countEvent(harness.logs, "drag-started"), 1);
        assert.equal(countEvent(harness.logs, "drag-stepped"), 0);
        assert.equal(countEvent(harness.logs, "drag-move-resized-changed"), 1);
        assert.equal(controller.hasActiveDrag, true);
        dragged.interactiveMoveResizeStepped.emit();
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-stepped"), 0);
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.deepEqual(origin.windows, [dragged]);
        assert.deepEqual(target.windows, [targetWindow]);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("contains drag exceptions and clears active state", () => {
        const { controller, harness, target, dragged } = dragSetup();
        target.split = () => {
            throw "split";
        };
        startDrag(dragged);
        dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "disabled:exception"), 1);
    });

    it("resolves a native Shift-drop overlap into a position-directed split and defers the origin collapse", () => {
        const { harness, controller, root, term1, right, term2, term3, top, bottom, term1Win, term2Win, term3Win } =
            nativeDropSetup();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        startDrag(term2Win);
        // Model the native finish: KWin manages term2 into term1 and vacates
        // term2 before interactiveMoveResizeFinished fires.
        term2Win.frameGeometry = movedGeometry();
        term2Win.tile = term1;
        harness.cursor = { x: 50, y: 75 };
        term2Win.interactiveMoveResizeFinished.emit();

        // Finish-only: the position-directed split happens in this dispatch and
        // no removal runs yet.
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 0);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.deepEqual(top.windows, [term1Win]);
        assert.deepEqual(bottom.windows, [term2Win]);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.deepEqual(right.tiles, [term2, term3]);
        assert.equal(harness.yields.length, 1);
        assert.equal(controller.hasActiveDrag, false);

        // After the one-shot yield the empty origin collapses and KWin
        // promotes the single-child V-wrapper, leaving the whole accepted tree
        // H[V[term1, term2], term3] with term3 as the root's direct right
        // child. The mirrored chain is a valid dwindle(3) ordering, so no
        // unwanted reconstruction is queued.
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.deepEqual(root.tiles, [term1, term3]);
        assert.equal(term1.isLayout, true);
        assert.equal(term1.layoutDirection, 2);
        assert.deepEqual(term1.tiles, [top, bottom]);
        assert.deepEqual(top.windows, [term1Win]);
        assert.deepEqual(bottom.windows, [term2Win]);
        assert.deepEqual(term3.windows, [term3Win]);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.equal(term3Win.tile, term3);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("defaults a central-zone native Shift drop to a vertical split with the occupant above", () => {
        const { harness, controller, term1, top, bottom, term1Win, term2Win } = nativeDropSetup();

        startDrag(term2Win);
        term2Win.frameGeometry = movedGeometry();
        term2Win.tile = term1;
        harness.cursor = { x: 50, y: 50 };
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(term1.layoutDirection, 2);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(controller.isEnabled, true);
    });

    it("restores the origin when the native drop target is not exactly dragged plus one occupant", () => {
        const { harness, controller, term1, term2, term1Win, term2Win } = nativeDropSetup();
        const extra = window({ tile: term1 });

        startDrag(term2Win);
        term2Win.frameGeometry = movedGeometry();
        term2Win.tile = term1;
        term1.windows = [term1Win, term2Win, extra];
        harness.cursor = { x: 50, y: 75 };
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal((term1.windows as TestWindow[]).includes(term2Win), false);
        assert.equal(controller.isEnabled, true);
    });

    it("refuses an undersized drop split while the dragged window still holds its origin leaf, leaving the tree untouched", () => {
        const { harness, controller, root, rows, row0Win, row2Win, splits } = rowsDropSetup();
        const [row0, row1, row2, row3] = rows;
        assert.equal(row2.absoluteGeometry.height, 245);
        assert.equal((harness.clientArea as typeof RECT).height, 980);

        startDrag(row0Win);
        // Model the no-op condition: the dragged window never left its origin
        // leaf, and the finish resolver point lands on the center of row2
        // (534..779). The center dead zone classifies a vertical split, whose
        // 122.5px halves fall below the 147px floor, so the drop is refused
        // before any mutation and no rollback is required.
        row0Win.frameGeometry = { x: 768, y: 656, width: 100, height: 100 };
        harness.cursor = { x: 768, y: 656 };
        row0Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-refused:undersized-split"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 0);
        assert.equal(splits.length, 0);
        // Tree structure is completely untouched: the four rows remain the four
        // leaves, row2 was never split, and no new tile exists.
        assert.deepEqual(root.tiles, [row0, row1, row2, row3]);
        assert.equal(row2.isLayout, false);
        assert.deepEqual(row2.tiles, []);
        assert.equal(collectLeaves(root).length, 4);
        // The dragged window still holds its origin leaf and row2 keeps its
        // single occupant: refusal needs no rollback because nothing mutated.
        assert.equal(row0Win.tile, row0);
        assert.deepEqual(row0.windows, [row0Win]);
        assert.deepEqual(row2.windows, [row2Win]);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps a passing drop split contiguous, non-overlapping, and summing the full working extent", () => {
        const { harness, controller, root, rows, row0Win, splits } = rowsDropSetup();
        const row2 = rows[2];
        assert.ok(row2 !== undefined);

        startDrag(row0Win);
        // Native Shift drop into the left half of row2 (534..779): a horizontal
        // 50/50 split of the 1536px-wide row yields 768px halves, above the 15%
        // working-width floor (230.4px), so the split is allowed.
        row0Win.tile = row2;
        row0Win.frameGeometry = { x: 300, y: 656, width: 100, height: 100 };
        harness.cursor = { x: 300, y: 656 };
        row0Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-refused:undersized-split"), 0);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(splits.length, 1);
        assert.equal(row2.isLayout, true);
        assert.equal(collectLeaves(root).length, 5);
        // The geometry invariant still holds after the split: the leaves are
        // contiguous, non-overlapping, and sum the full working extent.
        assertLeafPartition(collectLeaves(root), harness.clientArea as typeof RECT);
        assert.equal(controller.isEnabled, true);
    });

    it("reflows a plain drop from the final frame geometry into the accepted three-window example", () => {
        const { harness, controller, root, term1, right, term2, term3, top, bottom, term1Win, term2Win, term3Win } =
            nativeDropSetup();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        startDrag(term2Win);
        // Model a plain drop: KWin floats the dragged window (no custom tile
        // is applied without Shift) at the final drop geometry, and the origin
        // leaf no longer lists it.
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        // The drag-hook entry log fires before any decision, then the geometry
        // target resolves and the shared reflow split runs with the origin
        // collapse deferred, exactly like the native Shift path.
        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-geometry-target"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 0);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.deepEqual(top.windows, [term1Win]);
        assert.deepEqual(bottom.windows, [term2Win]);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.deepEqual(right.tiles, [term2, term3]);
        assert.equal(harness.yields.length, 1);
        assert.equal(controller.hasActiveDrag, false);

        // After the one-shot yield the empty origin collapses and KWin
        // promotes the single-child V-wrapper, leaving the whole accepted tree
        // H[V[term1, term2], term3].
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.deepEqual(root.tiles, [term1, term3]);
        assert.equal(term1.isLayout, true);
        assert.equal(term1.layoutDirection, 2);
        assert.deepEqual(term1.tiles, [top, bottom]);
        assert.deepEqual(top.windows, [term1Win]);
        assert.deepEqual(bottom.windows, [term2Win]);
        assert.deepEqual(term3.windows, [term3Win]);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.equal(term3Win.tile, term3);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("converges a plain drop and a native Shift drop on the same reflow", () => {
        const plain = nativeDropSetup();
        startDrag(plain.term2Win);
        plain.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        plain.term2Win.tile = null;
        plain.term2Win.interactiveMoveResizeFinished.emit();
        plain.harness.flushNextYield();

        const shift = nativeDropSetup();
        startDrag(shift.term2Win);
        shift.term2Win.frameGeometry = movedGeometry();
        shift.term2Win.tile = shift.term1;
        shift.harness.cursor = { x: 50, y: 75 };
        shift.term2Win.interactiveMoveResizeFinished.emit();
        shift.harness.flushNextYield();

        // Identical final tree shape and occupant mapping for both modifiers.
        assert.deepEqual(plain.root.tiles, [plain.term1, plain.term3]);
        assert.deepEqual(shift.root.tiles, [shift.term1, shift.term3]);
        assert.equal(plain.term1.isLayout, true);
        assert.equal(shift.term1.isLayout, true);
        assert.equal(plain.term1.layoutDirection, shift.term1.layoutDirection);
        assert.deepEqual(plain.term1.tiles, [plain.top, plain.bottom]);
        assert.deepEqual(shift.term1.tiles, [shift.top, shift.bottom]);
        assert.equal(plain.term1Win.tile, plain.top);
        assert.equal(shift.term1Win.tile, shift.top);
        assert.equal(plain.term2Win.tile, plain.bottom);
        assert.equal(shift.term2Win.tile, shift.bottom);
        assert.deepEqual(plain.term3.windows, [plain.term3Win]);
        assert.deepEqual(shift.term3.windows, [shift.term3Win]);
    });

    it("converges a vacated plain drop and a lagged origin-associated plain drop on the same reflow", () => {
        const vacated = nativeDropSetup();
        startDrag(vacated.term2Win);
        vacated.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        vacated.term2Win.tile = null;
        vacated.term2Win.interactiveMoveResizeFinished.emit();
        vacated.harness.flushNextYield();

        const lagged = nativeDropSetup();
        startDrag(lagged.term2Win);
        // KWin unmanage lags the finish hook: the window is floated (tile null)
        // but the origin leaf still lists it. The cursor sits over term1, so
        // the reflow must match the vacated drop exactly.
        lagged.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        lagged.term2Win.tile = null;
        lagged.term2.windows = [lagged.term2Win];
        lagged.harness.cursor = { x: 50, y: 75 };
        lagged.term2Win.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(lagged.harness.logs, "drag-geometry-target"), 1);
        assert.equal(countEvent(lagged.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(lagged.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(lagged.term1Win.tile, lagged.top);
        assert.equal(lagged.term2Win.tile, lagged.bottom);
        // KWin evacuates the lagged origin list, then the deferred one-shot
        // yield collapses the origin to the same accepted tree.
        lagged.term2.windows = [];
        lagged.harness.flushNextYield();
        assert.equal(countEvent(lagged.harness.logs, "ownership-remove-collapsed"), 1);

        assert.deepEqual(vacated.root.tiles, [vacated.term1, vacated.term3]);
        assert.deepEqual(lagged.root.tiles, [lagged.term1, lagged.term3]);
        assert.equal(vacated.term1.isLayout, true);
        assert.equal(lagged.term1.isLayout, true);
        assert.equal(vacated.term1.layoutDirection, lagged.term1.layoutDirection);
        assert.deepEqual(vacated.term1.tiles, [vacated.top, vacated.bottom]);
        assert.deepEqual(lagged.term1.tiles, [lagged.top, lagged.bottom]);
        assert.equal(vacated.term1Win.tile, vacated.top);
        assert.equal(lagged.term1Win.tile, lagged.top);
        assert.equal(vacated.term2Win.tile, vacated.bottom);
        assert.equal(lagged.term2Win.tile, lagged.bottom);
        assert.deepEqual(vacated.term3.windows, [vacated.term3Win]);
        assert.deepEqual(lagged.term3.windows, [lagged.term3Win]);
    });

    it("derives the split direction from the cursor point used for target resolution, for plain and Shift alike", () => {
        for (const mode of ["plain", "shift"] as const) {
            const state = nativeDropSetup();
            startDrag(state.term2Win);
            // The cursor sits in the upper half of term1, so the split is
            // vertical with the dragged window above; the final frame center
            // (lower half) is not the intent input and is ignored for direction.
            state.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
            state.harness.cursor = { x: 50, y: 25 };
            state.term2Win.tile = mode === "shift" ? state.term1 : null;
            state.term2Win.interactiveMoveResizeFinished.emit();
            state.harness.flushNextYield();

            assert.equal(countEvent(state.harness.logs, "drag-geometry-target"), 1);
            assert.equal(state.term1.layoutDirection, 2);
            assert.equal(state.term1Win.tile, state.bottom);
            assert.equal(state.term2Win.tile, state.top);
            assert.deepEqual(state.root.tiles, [state.term1, state.term3]);
            assert.equal(state.controller.isEnabled, true);
        }
    });

    it("derives the drop target from the cursor, bailing to the origin over the frame-center leaf", () => {
        const state = nativeDropSetup();
        startDrag(state.term2Win);
        // The cursor sits over the origin while the final frame center sits over
        // term1: the cursor is authoritative, so the drop bails back to the
        // origin instead of splitting term1.
        state.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        state.term2Win.tile = null;
        state.term2.windows = [state.term2Win];
        state.harness.cursor = { x: 150, y: 25 };
        state.term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-origin-restored"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(state.term2Win.tile, state.term2);
        assert.deepEqual(state.term1.windows, [state.term1Win]);
        assert.equal(state.controller.hasActiveDrag, false);
        assert.equal(state.controller.isEnabled, true);
    });

    it("bails when native overlap state contradicts the cursor-derived target", () => {
        const { harness, controller, term1, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        // KWin managed the dragged window into term1, but the cursor sits over
        // term3: inconsistent state, never reflow.
        term2Win.tile = term1;
        term2Win.frameGeometry = { x: 100, y: 50, width: 100, height: 50 };
        harness.cursor = { x: 150, y: 75 };
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:geometry-native-mismatch"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs a distinct target-is-origin bail and restores the origin when the final frame center sits over the origin leaf", () => {
        const { harness, controller, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        // The frame center sits back over the origin leaf, and KWin's unmanage
        // lags the finish hook so the origin still lists the dragged window:
        // the center resolves to the origin, so the drop bails and restores.
        term2Win.frameGeometry = { x: 100, y: 0, width: 100, height: 50 };
        term2Win.tile = null;
        term2.windows = [term2Win];
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs a distinct no-target-leaf bail with the center point when the final frame center sits on no leaf", () => {
        const { harness, controller, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        // Final frame center sits outside every leaf (occupied or empty): the
        // vacated origin no longer lists the dragged window and no leaf contains
        // the center, so the drop bails with the decisive point.
        term2.windows = [];
        term2Win.frameGeometry = { x: 300, y: 0, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:no-target-leaf:350,25"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs distinct scope and topology bail reasons when the finish scope or tree is unavailable", () => {
        const changed = nativeDropSetup();
        startDrag(changed.term2Win);
        changed.term2Win.output = { ...OUTPUT };
        changed.term2Win.tile = null;
        changed.term2Win.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(changed.harness.logs, "drag-bail:scope-changed"), 1);
        assert.equal(changed.controller.hasActiveDrag, false);

        const missingRoot = nativeDropSetup();
        startDrag(missingRoot.term2Win);
        missingRoot.harness.root = null;
        missingRoot.term2Win.tile = null;
        missingRoot.term2Win.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(missingRoot.harness.logs, "drag-bail:topology-unavailable:root-lookup"), 1);
        assert.equal(missingRoot.controller.hasActiveDrag, false);
    });

    it("emits the drag-finished hook entry log before every finish decision and bail", () => {
        const cases: ReadonlyArray<{
            readonly outcome: string;
            readonly prepare: (state: ReturnType<typeof nativeDropSetup>) => void;
        }> = [
            {
                outcome: "drag-geometry-target",
                prepare: (state) => {
                    state.term2Win.tile = null;
                    state.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
                },
            },
            {
                outcome: "drag-bail:no-target-leaf:350,25",
                prepare: (state) => {
                    state.term2Win.tile = null;
                    state.term2Win.frameGeometry = { x: 300, y: 0, width: 100, height: 50 };
                },
            },
            {
                outcome: "drag-geometry-target",
                prepare: (state) => {
                    state.term2Win.tile = state.term1;
                    state.harness.cursor = { x: 50, y: 75 };
                },
            },
        ];
        for (const testCase of cases) {
            const state = nativeDropSetup();
            startDrag(state.term2Win);
            testCase.prepare(state);
            state.term2Win.interactiveMoveResizeFinished.emit();
            const entry = "plasma-auto-tiler:drag-finished";
            const outcome = `plasma-auto-tiler:${testCase.outcome}`;
            assert.ok(state.harness.logs.includes(entry));
            assert.ok(state.harness.logs.indexOf(entry) < state.harness.logs.indexOf(outcome));
        }
    });
});

describe("TileController drag snapshot diagnostics", () => {
    function snapshotPayloads(logs: readonly string[], prefix: string): unknown[] {
        const marker = `plasma-auto-tiler:${prefix}`;
        return logs.filter((entry) => entry.startsWith(marker)).map((entry) => JSON.parse(entry.slice(marker.length)));
    }

    it("emits a compact before snapshot with final geometry, resolver center, and topology leaves", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const before = snapshotPayloads(harness.logs, "drag-snapshot-before:");
        assert.equal(before.length, 1);
        const payload = before[0] as {
            geometry: { x: number; y: number; width: number; height: number };
            center: { x: number; y: number };
            pointSource: string;
            leaves: unknown[];
        };
        assert.deepEqual(payload.geometry, { x: 0, y: 50, width: 100, height: 50 });
        assert.deepEqual(payload.center, { x: 50, y: 75 });
        assert.equal(payload.pointSource, "frame-center");
        assert.deepEqual(payload.leaves, [
            {
                id: "tile-0",
                geometry: { x: 100, y: 50, width: 100, height: 50 },
                occupants: [{ id: "window-0", caption: "term3" }],
            },
            { id: "tile-1", geometry: { x: 100, y: 0, width: 100, height: 50 }, occupants: [] },
            {
                id: "tile-2",
                geometry: { x: 0, y: 0, width: 100, height: 100 },
                occupants: [{ id: "window-1", caption: "term1" }],
            },
        ]);
    });

    it("reports the target resolution outcome as a compact JSON log", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
    });

    it("reports empty-leaf target resolution with occupancy empty in the target outcome", () => {
        const { harness, root, origin, target, dragged } = dragSetup();
        const empty = tile({ x: 400, y: 0, width: 100, height: 100 });
        root.tiles = [origin, target, empty];
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = movedGeometry();
        harness.cursor = { x: 450, y: 50 };
        dragged.interactiveMoveResizeFinished.emit();

        const targetPayloads = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(targetPayloads.length, 1);
        assert.deepEqual(targetPayloads[0], {
            kind: "resolved",
            leaf: "tile-0",
            center: { x: 450, y: 50 },
            pointSource: "cursor",
            occupancy: "empty",
        });
    });

    it("uses a finite cursor as the resolver point and records pointSource cursor", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursor = { x: 50, y: 25 };
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 25 },
            pointSource: "cursor",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 0);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-read-threw"), 0);
    });

    it("falls back to the frame center and emits a one-time diagnostic when the cursor is unavailable", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursor = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 1);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-read-threw"), 0);
    });

    it("falls back to the frame center and emits a one-time diagnostic when the cursor is not a finite point", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursor = { x: Infinity, y: 25 };
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 1);
    });

    it("falls back to the frame center and emits a one-time diagnostic when the cursor read throws", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursorThrows = true;
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-read-threw"), 1);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 0);
    });

    it("shares the chosen cursor point between the bail suffix and the target payload", () => {
        const { harness, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2.windows = [term2Win];
        harness.cursor = { x: 150, y: 25 };
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "target-is-origin",
            center: { x: 150, y: 25 },
            pointSource: "cursor",
        });
        assert.equal(countEvent(harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 0);
    });

    it("reports a bail target outcome with the existing bail diagnostic and no after snapshot", () => {
        const { harness, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 100, y: 0, width: 100, height: 50 };
        term2Win.tile = null;
        term2.windows = [term2Win];
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "target-is-origin",
            center: { x: 150, y: 25 },
            pointSource: "frame-center",
        });
        assert.equal(countEvent(harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-after:").length, 0);
    });

    it("emits a before snapshot with null leaves and a topology status on a topology bail", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.root = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const before = snapshotPayloads(harness.logs, "drag-snapshot-before:");
        assert.equal(before.length, 1);
        assert.deepEqual(before[0], {
            geometry: { x: 0, y: 50, width: 100, height: 50 },
            center: null,
            leaves: null,
            topology: "root-lookup",
        });
        assert.equal(countEvent(harness.logs, "drag-bail:topology-unavailable:root-lookup"), 1);
    });

    it("emits a before snapshot with null center and decoded leaves on a geometry bail", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 0, width: 0, height: 0 };
        term2Win.interactiveMoveResizeFinished.emit();

        const before = snapshotPayloads(harness.logs, "drag-snapshot-before:");
        assert.equal(before.length, 1);
        const payload = before[0] as {
            geometry: unknown;
            center: unknown;
            leaves: unknown[];
            topology?: unknown;
        };
        assert.deepEqual(payload.geometry, { x: 0, y: 0, width: 0, height: 0 });
        assert.equal(payload.center, null);
        assert.equal(payload.topology, undefined);
        assert.equal(payload.leaves.length, 3);
        assert.equal(countEvent(harness.logs, "drag-bail:geometry-invalid"), 1);
    });

    it("emits an after snapshot once the deferred reflow completion has settled", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-after:").length, 0);

        harness.flushNextYield();

        const after = snapshotPayloads(harness.logs, "drag-snapshot-after:");
        assert.equal(after.length, 1);
        const payload = after[0] as { leaves: unknown[] };
        assert.deepEqual(payload.leaves, [
            {
                id: "tile-0",
                geometry: { x: 100, y: 50, width: 100, height: 50 },
                occupants: [{ id: "window-0", caption: "term3" }],
            },
            {
                id: "tile-1",
                geometry: { x: 0, y: 50, width: 100, height: 50 },
                occupants: [{ id: "window-1", caption: "term2" }],
            },
            {
                id: "tile-2",
                geometry: { x: 0, y: 0, width: 100, height: 50 },
                occupants: [{ id: "window-2", caption: "term1" }],
            },
        ]);
    });

    it("reuses the resolution and collapse decodes so a successful drop adds no whole-root decode", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        harness.rootReads = 0;
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();
        // One pre/resolution decode: the before and target snapshots reuse it.
        assert.equal(harness.rootReads, 1);
        harness.flushNextYield();
        // Settle + collapse postcondition + invariant; the after snapshot
        // reuses the collapse postcondition decode.
        assert.equal(harness.rootReads, 4);
    });

    it("swallows snapshot serialization errors into fixed failed diagnostics without affecting the drop", () => {
        const { harness, controller, term2Win } = nativeDropSetup();
        const original = JSON.stringify;
        JSON.stringify = () => {
            throw new Error("snapshot sink failure");
        };
        try {
            startDrag(term2Win);
            term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
            term2Win.tile = null;
            term2Win.interactiveMoveResizeFinished.emit();
            harness.flushNextYield();
        } finally {
            JSON.stringify = original;
        }
        assert.equal(countEvent(harness.logs, "drag-snapshot-failed:before:serialize"), 1);
        assert.equal(countEvent(harness.logs, "drag-snapshot-failed:target:serialize"), 1);
        assert.equal(countEvent(harness.logs, "drag-snapshot-failed:after:serialize"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(controller.isEnabled, true);
    });
});

describe("TileController drag reconstruction final snapshot", () => {
    function snapshotPayloads(logs: readonly string[], prefix: string): unknown[] {
        const marker = `plasma-auto-tiler:${prefix}`;
        return logs.filter((entry) => entry.startsWith(marker)).map((entry) => JSON.parse(entry.slice(marker.length)));
    }

    it("emits one drag-snapshot-final only after the queued reconstruction settles", () => {
        const state = reconstructDropSetup();
        startDrag(state.aWin);
        state.aWin.frameGeometry = { x: 100, y: 0, width: 50, height: 100 };
        state.aWin.tile = null;
        state.aWin.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(snapshotPayloads(state.harness.logs, "drag-snapshot-final:").length, 0);

        // The origin collapse leaves the root with a single layout child, so a
        // full reconstruction is queued; the final snapshot must not appear
        // while that reconstruction is still pending.
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(snapshotPayloads(state.harness.logs, "drag-snapshot-final:").length, 0);

        // The reconstruction settles over two more yields (collapse then
        // rebuild); the final snapshot appears only once it is done.
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(snapshotPayloads(state.harness.logs, "drag-snapshot-final:").length, 0);
        assert.equal(state.harness.flushNextYield(), true);

        const final = snapshotPayloads(state.harness.logs, "drag-snapshot-final:");
        assert.equal(final.length, 1);
        const payload = final[0] as {
            leaves: Array<{
                id: string;
                geometry: { width: number; height: number };
                occupants: Array<{ id: string; caption: string }>;
            }>;
        };
        assert.equal(payload.leaves.length, 2);
        assert.deepEqual(
            payload.leaves.map((leaf) => leaf.occupants[0]?.caption).sort(),
            ["a", "b"],
        );
        for (const leaf of payload.leaves) {
            assert.equal(typeof leaf.id, "string");
            assert.equal(leaf.occupants.length, 1);
            assert.equal(typeof leaf.occupants[0]?.id, "string");
            assert.ok(leaf.geometry.width > 0 && leaf.geometry.height > 0);
        }
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 2);
        assert.equal(state.harness.yields.length, 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("emits no drag-snapshot-final on a non-reconstructing drop", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();
        harness.flushNextYield();

        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-after:").length, 1);
        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-final:").length, 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
    });
});

// Owned dwindle(2) scope H[target, origin] with a horizontal (side-by-side)
// split target. A drag of the origin window onto the target splits the target
// into 50/50 left/right children; the fixture's origin removal models KWin's
// "last child fills the area" donation, expanding the right child so the two
// reflow leaves become 25/75. The controller's normalize step then writes the
// equal 50/50 halves. The fixture models the controller's intent, not real
// KWin setter behavior: the neighbor-adjusting relativeGeometry write is a
// static stand-in, not live proof.
function normalizeSetup(
    setterMode: "adjust" | "throw" | "no-adjust" = "adjust",
): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly target: TestTile;
    readonly origin: TestTile;
    readonly left: TestTile;
    readonly right: TestTile;
    readonly dragged: TestWindow;
    readonly occupant: TestWindow;
} {
    const harness = new Harness();
    const root = tile({ x: 0, y: 0, width: 200, height: 100 }, true);
    const target = tile({ x: 0, y: 0, width: 100, height: 100 });
    const origin = tile({ x: 100, y: 0, width: 100, height: 100 });
    const occupant = window({ tile: target, caption: "occupant" });
    const dragged = window({ tile: origin, caption: "dragged" });
    target.windows = [occupant];
    origin.windows = [dragged];
    root.tiles = [target, origin];
    harness.root = root;
    harness.active = occupant;
    harness.windows = [occupant, dragged];
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(occupant, writes);
    attachTileWriter(dragged, writes);
    const left = tile({ x: 0, y: 0, width: 50, height: 100 });
    const right = tile({ x: 50, y: 0, width: 50, height: 100 });
    left.parent = target;
    right.parent = target;
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    left.manage = manage(left);
    right.manage = manage(right);
    target.split = (direction) => {
        target.isLayout = true;
        target.layoutDirection = direction;
        target.windows = [];
        target.tiles = [left, right];
        return [left, right];
    };
    origin.remove = () => {
        root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== origin);
        // Donation: target spans the full width and the last (right) child
        // absorbs the extra area, so the two reflow leaves become 25/75.
        target.relativeGeometry = { x: 0, y: 0, width: 200, height: 100 };
        target.absoluteGeometry = target.relativeGeometry;
        right.relativeGeometry = { x: 50, y: 0, width: 150, height: 100 };
        right.absoluteGeometry = right.relativeGeometry;
        // Setter model: "adjust" pushes right's near edge on a left write,
        // "throw" models a failing write, "no-adjust" models a write that does
        // not reach the sibling (so the post-decode stays unequal).
        let leftState = left.relativeGeometry;
        Object.defineProperty(left, "relativeGeometry", {
            configurable: true,
            get: () => leftState,
            set:
                setterMode === "throw"
                    ? () => {
                          throw new Error("relativeGeometry write failed");
                      }
                    : (next: typeof RECT) => {
                          leftState = next;
                          left.absoluteGeometry = next;
                          if (setterMode === "adjust") {
                              const near = next.x + next.width;
                              const far = right.relativeGeometry.x + right.relativeGeometry.width;
                              right.relativeGeometry = {
                                  x: near,
                                  y: right.relativeGeometry.y,
                                  width: far - near,
                                  height: right.relativeGeometry.height,
                              };
                              right.absoluteGeometry = right.relativeGeometry;
                          }
                      },
        });
        return true;
    };
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, target, origin, left, right, dragged, occupant };
}

function runNormalizeDrag(state: ReturnType<typeof normalizeSetup>): void {
    startDrag(state.dragged);
    state.dragged.tile = null;
    state.dragged.frameGeometry = { x: 40, y: 40, width: 20, height: 20 };
    state.harness.cursor = { x: 75, y: 50 };
    state.dragged.interactiveMoveResizeFinished.emit();
}

describe("TileController drag reflow normalization", () => {
    it("equalizes the two reflow leaves to 50/50 relative geometry after origin collapse", () => {
        const state = normalizeSetup();
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 1);
        runNormalizeDrag(state);
        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);

        state.harness.flushNextYield();

        assert.equal(countEvent(state.harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 1);
        assert.equal(
            state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-reflow-normalize-skipped:")),
            false,
        );
        assert.equal(
            state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-reflow-normalize-failed:")),
            false,
        );
        assert.equal(state.left.relativeGeometry.width, 100);
        assert.equal(state.right.relativeGeometry.width, 100);
        assert.equal(state.controller.isEnabled, true);
    });

    it("emits the after snapshot with equal ratios after normalization", () => {
        const state = normalizeSetup();
        runNormalizeDrag(state);
        state.harness.flushNextYield();
        const markers = state.harness.logs
            .filter((entry) => entry.startsWith("plasma-auto-tiler:drag-snapshot-after:"))
            .map((entry) => JSON.parse(entry.slice("plasma-auto-tiler:drag-snapshot-after:".length)));
        assert.equal(markers.length, 1);
        const payload = markers[0] as { leaves: Array<{ geometry: { width: number } }> };
        const widths = payload.leaves.map((leaf) => leaf.geometry.width);
        assert.equal(widths.length, 2);
        assert.equal(widths[0], widths[1]);
        assert.ok(
            state.harness.logs.indexOf("plasma-auto-tiler:drag-reflow-normalized") <
                state.harness.logs.findIndex((entry) => entry.startsWith("plasma-auto-tiler:drag-snapshot-after:")),
        );
    });

    it("skips normalization when the two leaves are not siblings", () => {
        const state = normalizeSetup();
        runNormalizeDrag(state);
        state.left.parent = {};
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-skipped:not-siblings"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(state.left.relativeGeometry.width, 50);
        assert.equal(state.right.relativeGeometry.width, 150);
        assert.equal(state.controller.isEnabled, true);
    });

    it("skips normalization when the parent has no known split axis", () => {
        const state = normalizeSetup();
        runNormalizeDrag(state);
        state.target.layoutDirection = 0;
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-skipped:floating-parent"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("contains a failed relativeGeometry write without disabling the controller", () => {
        const state = normalizeSetup("throw");
        runNormalizeDrag(state);
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-failed:write"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(state.controller.isEnabled, true);
    });

    it("reports a post-decode mismatch when the write does not reach the sibling", () => {
        const state = normalizeSetup("no-adjust");
        runNormalizeDrag(state);
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-failed:mismatch"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(state.controller.isEnabled, true);
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
            assert.equal(countEvent(completed.harness.logs, "drag-overlap-split-completed"), 0);
            return true;
        });
        completed.target.split = () => [first, second];
        startDrag(completed.dragged);
        completed.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        completed.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(completed.harness.logs, "drag-overlap-split-completed"), 1);
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

    it("registers the exact 50-action all-or-nothing catalog", () => {
        const { harness } = setup();
        const names = harness.shortcuts.map((entry) => entry.name).sort();
        assert.deepEqual(names, [
            "plasma-auto-tiler-apply-balanced-grid",
            "plasma-auto-tiler-apply-columns",
            "plasma-auto-tiler-apply-dwindle",
            "plasma-auto-tiler-apply-rows",
            "plasma-auto-tiler-attach",
            "plasma-auto-tiler-detach",
            "plasma-auto-tiler-fill-scope",
            "plasma-auto-tiler-float-toggle",
            "plasma-auto-tiler-focus-down",
            "plasma-auto-tiler-focus-down-arrow",
            "plasma-auto-tiler-focus-left",
            "plasma-auto-tiler-focus-left-arrow",
            "plasma-auto-tiler-focus-right",
            "plasma-auto-tiler-focus-right-arrow",
            "plasma-auto-tiler-focus-up",
            "plasma-auto-tiler-focus-up-arrow",
            "plasma-auto-tiler-insert-down",
            "plasma-auto-tiler-insert-left",
            "plasma-auto-tiler-insert-right",
            "plasma-auto-tiler-insert-up",
            "plasma-auto-tiler-maximize",
            "plasma-auto-tiler-move-down",
            "plasma-auto-tiler-move-down-arrow",
            "plasma-auto-tiler-move-left",
            "plasma-auto-tiler-move-left-arrow",
            "plasma-auto-tiler-move-right",
            "plasma-auto-tiler-move-right-arrow",
            "plasma-auto-tiler-move-up",
            "plasma-auto-tiler-move-up-arrow",
            "plasma-auto-tiler-move-workspace-1",
            "plasma-auto-tiler-move-workspace-2",
            "plasma-auto-tiler-move-workspace-3",
            "plasma-auto-tiler-move-workspace-4",
            "plasma-auto-tiler-move-workspace-5",
            "plasma-auto-tiler-move-workspace-6",
            "plasma-auto-tiler-move-workspace-7",
            "plasma-auto-tiler-move-workspace-8",
            "plasma-auto-tiler-move-workspace-9",
            "plasma-auto-tiler-move-workspace-append",
            "plasma-auto-tiler-sticky-toggle",
            "plasma-auto-tiler-workspace-1",
            "plasma-auto-tiler-workspace-2",
            "plasma-auto-tiler-workspace-3",
            "plasma-auto-tiler-workspace-4",
            "plasma-auto-tiler-workspace-5",
            "plasma-auto-tiler-workspace-6",
            "plasma-auto-tiler-workspace-7",
            "plasma-auto-tiler-workspace-8",
            "plasma-auto-tiler-workspace-9",
            "plasma-auto-tiler-workspace-append",
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

// Install a splitter that mirrors KWin's dwindle chain construction: each
// split turns the tile into a layout with two children whose geometry follows
// the requested orientation (1 = horizontal, 2 = vertical), and installs the
// same splitter on both children so the chain can keep growing.
function installDwindleSplitter(tile: TestTile): void {
    tile.split = (direction) => {
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        const horizontal = direction === 1;
        const childA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const childB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        installDwindleSplitter(childA);
        installDwindleSplitter(childB);
        tile.tiles = [childA, childB];
        return [childA, childB];
    };
}

// Install a configurable splitter that models the KWin minimum-geometry
// boundary. While `state.rejecting` is true it yields a split result whose
// children carry invalid geometry (the strict `orderedChildren` check rejects
// the pair) and does not realize the split in the live tree, so a capacity
// rejection leaves the scope structurally unchanged and retryable. When
// `state.rejecting` is false it behaves exactly like `installDwindleSplitter`,
// realizing a valid dwindle chain.
function installCapacityRejectingSplitter(tile: TestTile, state: { rejecting: boolean }): void {
    tile.split = (direction) => {
        const horizontal = direction === 1;
        const validA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const validB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        if (state.rejecting) {
            // KWin minimum geometry can yield an empty child: the first child
            // has zero width, so `orderedChildren` must reject the pair.
            return [makeTile({ x: 0, y: 0, width: 0, height: 100 }), validB];
        }
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        installDwindleSplitter(validA);
        installDwindleSplitter(validB);
        tile.tiles = [validA, validB];
        return [validA, validB];
    };
}

function makeTile(geometry = RECT, isLayout = false): TestTile {
    return tile(geometry, isLayout);
}

// Install a splitter that returns placeholder children whose own split()
// throws, while realizing the live tree with distinct children under
// `tile.tiles`. A rebuild that retains a returned child handle and splits it
// on a later structural call fails here; the guarded rebuild re-resolves the
// root and fresh-decodes `tile.tiles` after every split, so it succeeds.
function installStaleReturnSplitter(tile: TestTile): void {
    tile.split = (direction) => {
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        const horizontal = direction === 1;
        const liveA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const liveB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        installStaleReturnSplitter(liveA);
        installStaleReturnSplitter(liveB);
        tile.tiles = [liveA, liveB];
        const staleA = makeTile();
        const staleB = makeTile();
        staleA.split = () => {
            throw new Error("stale returned child handle split");
        };
        staleB.split = () => {
            throw new Error("stale returned child handle split");
        };
        return [staleA, staleB];
    };
}

// Structural shape check: the live tree must realize the dwindle blueprint
// exactly, with the first decoded child as the blueprint's left subtree and
// the second as its right subtree, and orientation alternating from a
// horizontal root at depth zero.
function assertDwindleShape(tile: TestTile, blueprint: Blueprint, depth: number): void {
    if (blueprint.kind === "leaf") {
        assert.equal(tile.isLayout, false);
        return;
    }
    assert.equal(tile.isLayout, true);
    assert.equal(tile.layoutDirection, depth % 2 === 0 ? 1 : 2);
    const children = tile.tiles as TestTile[];
    assert.equal(children.length, 2);
    const left = children[0];
    const right = children[1];
    assert.ok(left !== undefined && right !== undefined);
    assertDwindleShape(left, blueprint.left, depth + 1);
    assertDwindleShape(right, blueprint.right, depth + 1);
}

describe("TileController automatic dwindle ownership", () => {
    it("adopts a stable scope on controller start without any structural call", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let splits = 0;
        let removes = 0;
        for (const value of [root, left, right]) {
            value.split = () => {
                splits += 1;
                return [];
            };
            value.remove = () => {
                removes += 1;
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();

        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-split"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(first.tile, left);
        assert.equal(second.tile, right);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("reconstructs a persisted same-shape tree with empty leaves instead of adopting it", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window();
        const second = window();
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        let splits = 0;
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        const installedSplit = root.split;
        root.split = (direction) => {
            splits += 1;
            return installedSplit(direction);
        };
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();

        // The shape is a valid dwindle(2) but both leaves are empty and both
        // windows are floating: the occupancy bijection fails, so ownership is
        // not taken directly and the reconstruction is armed with no direct
        // structural call and no timer.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        // Phase one (first yield): removals-only collapse, no split.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 2);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Phase two (second yield): splits-only rebuild assigning the
        // population to the freshly realized dwindle leaves.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 2);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.notEqual(first.tile, second.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("reconstructs a persisted same-shape tree with one empty leaf and a floating window", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window();
        left.windows = [first];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();

        // One leaf is correctly occupied but the other is empty and the second
        // owned window is floating: the occupancy bijection fails even though
        // the shape is a valid dwindle(2), so the reconstruction is armed with
        // no direct structural call.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 2);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 2);
        assert.equal(harness.yields.length, 0);
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.notEqual(first.tile, second.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("adopts a zero-child layout root as the sole usable leaf of a one-window scope", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = window({ tile: root });
        root.windows = [first];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let splits = 0;
        let removes = 0;
        root.split = () => {
            splits += 1;
            return [];
        };
        root.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();

        // The zero-child layout root is the sole usable leaf, so the tree is
        // already dwindle(1) with the owned window in that leaf: ownership is
        // taken with no structural call and no reconstruction yield. This MUST
        // fail if dwindleMatches counts only non-layout tiles, which would
        // reject the root and arm a needless collapse/split reconstruction.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(first.tile, root);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("splits the zero-child layout root on insertion instead of marking the scope inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = window({ tile: root });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);

        // The zero-child root is the sole usable leaf and the insertion point
        // at depth zero: splitting it grows dwindle(1) into dwindle(2). This
        // MUST fail with the prior behavior, which could not resolve a
        // non-layout insertion leaf and marked the scope inert.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        const rootChildren = root.tiles as TestTile[];
        assert.equal(rootChildren.length, 2);
        assert.equal(first.tile, rootChildren[0]);
        assert.equal(second.tile, rootChildren[1]);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("leaves a zero-child layout root with no owned windows unmanaged and untouched", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        harness.root = root;
        let splits = 0;
        let removes = 0;
        root.split = () => {
            splits += 1;
            return [];
        };
        root.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();

        // An empty scope has no owned population, so it is never managed,
        // never reconstructed, and never marked inert.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 0);
        assert.deepEqual(root.tiles, []);
    });

    it("adopts the current desktop scope when a window is added after a switch to an empty workspace", () => {
        const harness = new Harness();
        const root1 = tile(RECT, true);
        const first = window({ tile: root1 });
        root1.windows = [first];
        harness.rootsByDesktop.set(DESKTOP.id, root1);
        harness.active = first;
        harness.windows = [first];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Switch to an empty desktop with no window: no anchor exists, so the
        // desktop is left unmanaged at the change notification.
        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        harness.rootsByDesktop.set(desktop2.id, root2);
        harness.currentDesktop = desktop2;
        harness.desktopChanged?.();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);

        // An eligible window appears on the now-current empty desktop. It must
        // adopt the scope (not silently drop it) and reconstruct it so the
        // window ends up tiled. Pre-fix this path hit generic placement with no
        // empty leaf and produced no ownership-pending and no insertion.
        const second = window({ desktops: [desktop2] });
        attachTileWriter(second);
        harness.active = second;
        harness.windows = [first, second];
        harness.emitAdded(second);

        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "window-added-noop:no-empty-leaf"), 0);

        while (harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(second.tile, root2);
    });

    it("emits a decisive no-op diagnostic when an in-scope addition reaches placement with no empty leaf on an inert scope", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        root.split = () => [];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // A malformed split damages the scope, marking it inert for the session.
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);

        // A later eligible addition on the inert scope reaches generic placement
        // with no empty leaf and no dwindle fallback: it must emit a decisive
        // no-op reason instead of disappearing silently.
        const later = window();
        harness.emitAdded(later);
        assert.equal(countEvent(harness.logs, "window-added-noop:no-empty-leaf"), 1);
        assert.equal(later.tile, null);
    });

    it("rebuilds a non-dwindle one-window scope onto the collapsed zero-child root's sole leaf", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: a });
        a.windows = [first];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // Phase one collapse: the two-leaf tree collapses to the zero-child
        // layout root and arms the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Phase two: the collapsed zero-child root is not dwindle(1) until the
        // floating population occupies its sole usable leaf, so the rebuild
        // assigns the window to the root. This MUST fail if the count-one
        // match accepted the empty zero-child root: the window would be
        // dropped floating and ownership claimed without occupying it.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        assert.equal(first.tile, root);
        assert.deepEqual(root.windows, [first]);
        assert.equal(harness.scheduled.length, 0);
    });

    it("rebuilds a non-dwindle owned scope as the dwindle blueprint after a deferred remove-to-split yield", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        let removes = 0;
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();

        // The flat three-leaf tree is non-dwindle: ownership is recorded and
        // the reconstruction arms its first one-shot event-loop yield. No
        // structural call happens in the takeover dispatch, no timer is
        // scheduled, and exactly one yield is armed. This MUST fail if the
        // takeover dispatch does not arm the callback.
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        // First yield dispatch: the removals-only collapse runs synchronously
        // with a fresh whole-root decode after every remove, no split, and it
        // arms the second one-shot yield. This MUST fail if the collapse phase
        // does not arm the next callback.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 3);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Second yield dispatch: the splits-only dwindle rebuild runs in one
        // synchronous batch and assigns the owned population, with no removals,
        // and no yield is armed afterwards.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(removes, 3);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.ok(third.tile !== null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("re-resolves the root and fresh-decodes around every rebuild split instead of retaining returned child handles", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installStaleReturnSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // The rebuild never splits a child retained from a prior split: the
        // second split would throw if the controller reused the first split's
        // return values, so the success below proves every structural call is
        // preceded by a fresh root resolution and tree decode.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.ok(third.tile !== null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("inserts each added window on the dwindle right spine with alternating orientation", () => {
        const harness = new Harness();
        const root = tile();
        const first = window({ tile: root });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(first.tile, (root.tiles as TestTile[])[0]);
        assert.equal(second.tile, (root.tiles as TestTile[])[1]);

        const third = window();
        harness.windows = [first, second, third];
        attachTileWriter(third);
        harness.emitAdded(third);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 2);
        const rootChildren = root.tiles as TestTile[];
        const right = rootChildren[1];
        assert.ok(right !== undefined);
        assert.equal(second.tile, (right.tiles as TestTile[])[0]);
        assert.equal(third.tile, (right.tiles as TestTile[])[1]);

        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("rebuilds for the changed managed count when windows leave before the reconstruction completes", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // The third window closes before the reconstruction's first yield
        // fires. Live KWin 6.7.3 still lists the removed window in its leaf
        // at `windowRemoved` (unit-19c), so the removal is deferred to one
        // one-shot event-loop yield instead of collapsing now; the pending
        // rebuild re-resolves the fresh population itself, and the removed
        // window is never reassigned. The old source failed here because its
        // unit-test contract required the leaf to already be freed at
        // `windowRemoved` (this `c.windows = []` before the notification),
        // which live KWin 6.7.3 never does.
        third.tile = c;
        c.windows = [third];
        harness.windows = [first, second];
        harness.emitRemoved(third);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.yields.length, 2);

        // The leaf evacuation settles on the event loop before any callback.
        // KWin's `Tile::unmanage` both removes the window from the leaf's
        // windows list and clears `requestedTile`, so `third.tile` is nulled
        // here too.
        c.windows = [];
        third.tile = null;

        // The pending collapse-phase dispatch collapses the scope and arms
        // the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.yields.length, 2);

        // The deferred removal settle is inert: its captured leaf is already
        // gone from the fresh tree, so it must not remove or arm anything.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 1);

        // The split-phase dispatch realizes dwindle(2) from the changed
        // population and completes the rebuild.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.equal(third.tile, null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("collapses the freed leaf after an owned window is removed, with a fresh whole-root decode", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let splits = 0;
        let removes = 0;
        for (const value of [left, right]) {
            value.split = () => {
                splits += 1;
                return [];
            };
        }
        right.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== right);
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live KWin 6.7.3 arrives at `windowRemoved` with the removed window
        // still listed in its former leaf's windows array and `window.tile`
        // still set (unit-19c), so the collapse cannot run in the removal
        // dispatch: the leaf is not yet provably freed. The removal is
        // deferred to one one-shot event-loop yield. The old source failed
        // this exact ordering: its `windowIndex(leaf.windows, window) >= 0`
        // guard returned early, so the freed leaf was never collapsed and the
        // tree never rebalanced. The previous test contract (leaf freed
        // before `windowRemoved`) does not match live KWin 6.7.3.
        second.tile = right;
        right.windows = [second];
        harness.windows = [first];
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.equal(harness.yields.length, 1);

        // The leaf evacuation settles on a later event-loop turn; only then
        // does the deferred settle collapse the provably-freed leaf, with a
        // fresh whole-root decode before and after the single remove. KWin's
        // `Tile::unmanage` also clears the removed window's `requestedTile`.
        right.windows = [];
        second.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(removes, 1);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, [left]);
        // The survivor stays tiled on the sole usable leaf under the layout
        // root: the scope is already dwindle(1), so no reconstruction is
        // armed and no split ever runs.
        assert.equal(first.tile, left);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("settles removal of the last window onto an empty tree without arming a reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        left.windows = [first];
        root.tiles = [left];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        let splits = 0;
        left.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        root.split = () => {
            splits += 1;
            return [];
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Removing the sole window down to N=0: the removal is deferred while
        // the window still lingers in its leaf, then the settle collapses the
        // last leaf to the empty zero-child root. An empty owned scope never
        // starts a reconstruction, so nothing is armed and no split ever runs.
        first.tile = left;
        left.windows = [first];
        harness.windows = [];
        harness.emitRemoved(first);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 1);

        // The window's tile is nulled with the evacuation, mirroring KWin's
        // `Tile::unmanage` clearing `requestedTile`.
        left.windows = [];
        first.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(removes, 1);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, []);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("occupies an empty zero-child layout root with the first eligible window added after N=0", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        let splits = 0;
        leaf.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        root.split = () => {
            splits += 1;
            return [];
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Remove the last window down to N=0: the freed leaf collapses and the
        // owned scope's tree is the zero-child layout root.
        first.tile = leaf;
        leaf.windows = [first];
        harness.windows = [];
        harness.emitRemoved(first);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        leaf.windows = [];
        first.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // First eligible add on the N=0 scope: the incoming window must become
        // the empty zero-child root's occupant through one guarded
        // compatibility assignment, with no inert marking and no split. This
        // MUST fail with the pre-fix behavior, which required exactly one
        // occupant of the insertion leaf and marked the empty root inert.
        const incoming = window();
        attachTileWriter(incoming);
        harness.windows = [incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-occupied-root"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(splits, 0);
        assert.equal(incoming.tile, root);
        assert.deepEqual(root.windows, [incoming]);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("leaves a zero-child root untouched when its sole occupant is removed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = window({ tile: root });
        root.windows = [first];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        root.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // The sole occupant lives on the zero-child layout root itself, the
        // scope's only usable leaf. The root is excluded from every removal,
        // so the notification returns before arming any settle yield and no
        // structural call or reconstruction follows.
        first.tile = root;
        root.windows = [first];
        harness.windows = [];
        harness.emitRemoved(first);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("makes a duplicate removal settle callback inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        right.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== right);
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Duplicate `windowRemoved` notifications for the same lingering
        // window arm two settle yields; the first collapses the freed leaf and
        // the second is inert because its captured leaf is gone from the fresh
        // tree. Exactly one remove ever runs.
        second.tile = right;
        right.windows = [second];
        harness.windows = [first];
        harness.emitRemoved(second);
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 2);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 2);

        right.windows = [];
        second.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(removes, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(removes, 1, "a duplicate settle callback cannot remove again");
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.deepEqual(root.tiles, [left]);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("never mixes a remove and a split in one dispatch", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let splits = 0;
        let removes = 0;
        right.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== right);
            return true;
        };
        // After the collapse the tree is functionally dwindle(1) under the
        // layout root, so the insertion splits the root horizontally at depth
        // zero, keeping the surviving occupant in the first child.
        const childA = tile({ x: 0, y: 0, width: 50, height: 100 });
        const childB = tile({ x: 50, y: 0, width: 50, height: 100 });
        root.split = (direction) => {
            splits += 1;
            assert.equal(direction, 1);
            root.isLayout = true;
            root.windows = [];
            root.tiles = [childA, childB];
            return [childA, childB];
        };
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();

        // Removal dispatch: the removed window is still listed in its leaf
        // (live KWin 6.7.3 ordering), so the removal is deferred and neither
        // a remove nor a split happens in the notification dispatch.
        second.tile = right;
        right.windows = [second];
        harness.windows = [first];
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 1);

        // Settle dispatch: exactly one collapse, zero splits. KWin's
        // `Tile::unmanage` has evacuated the leaf and cleared the removed
        // window's `requestedTile` by this event-loop turn.
        right.windows = [];
        second.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(splits, 0);
        assert.equal(removes, 1);
        assert.equal(harness.yields.length, 0);

        // Add dispatch: one dwindle insertion split, zero removals.
        const incoming = window();
        harness.windows = [first, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(removes, 1);
        assert.equal(splits, 1);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("excludes explicitly detached windows from the owned population and the dwindle rebuild", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // Detaching the third window before the reconstruction's first yield
        // fires removes it from the owned population, so the deferred rebuild
        // realizes dwindle(2) and never assigns the detached window.
        harness.active = third;
        invokeShortcut(harness, "plasma-auto-tiler-detach");
        assert.equal(countEvent(harness.logs, "detach-completed"), 1);
        assert.equal(third.tile, null);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.equal(third.tile, null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("does not collapse a leaf for a detached window's removal", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        right.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        harness.active = second;
        invokeShortcut(harness, "plasma-auto-tiler-detach");
        assert.equal(second.tile, null);
        assert.equal(countEvent(harness.logs, "detach-completed"), 1);

        second.tile = null;
        right.windows = [];
        harness.emitRemoved(second);

        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, [left, right]);
        assert.equal(harness.yields.length, 0);
    });

    it("lets a valid selected overlay win over dwindle ownership", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");
        const scope = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        // The takeover reconstruction armed before the overlay was recorded is
        // dropped inertly on its first yield dispatch: a valid selected overlay
        // wins, so no collapse or split ever runs.
        assert.equal(state.harness.yields.length, 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-collapsed"), 0);
        assert.equal(state.harness.yields.length, 0);

        // A full valid overlay absorbs an add through the established reflow
        // fallback instead of a dwindle insertion split.
        const incoming = window();
        state.harness.emitAdded(incoming);
        assert.equal(countEvent(state.harness.logs, "ownership-add-split"), 0);

        // A removal reflows the overlay instead of collapsing a dwindle leaf.
        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
    });

    it("marks a damaged scope inert for the session and never retries dwindle there", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let splits = 0;
        // The single-leaf scope's insertion point is the layout root at depth
        // zero, so the malformed split stub lives on the root.
        root.split = () => {
            splits += 1;
            return [];
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);
        assert.equal(splits, 1);

        const later = window();
        harness.emitAdded(later);
        assert.equal(splits, 1, "a damaged scope is never retried");
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);
        assert.equal(controller.isEnabled, true);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("keeps a scope retryable when minimum geometry rejects the split children, then recovers on a later lifecycle dispatch", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        const seam = { rejecting: true };
        installCapacityRejectingSplitter(root, seam);
        let removes = 0;
        leaf.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
            return true;
        };
        root.remove = () => {
            removes += 1;
            return true;
        };
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // A second window is added while KWin minimum geometry rejects the
        // split children. The strict geometry-order validation still rejects,
        // the incoming window is left unmanaged, and the scope is NOT marked
        // inert: the rejection is a capacity failure, not a damaged tree.
        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-add-failed:no-child-geometry"), 1);
        assert.equal(second.tile, null, "the impossible incoming insertion stays unmanaged");

        // The failed insert leaves the scope owned and retryable, so the same
        // add dispatch's invariant check can proceed and arms the deferred
        // reconstruction. This assertion MUST fail when the retry dispatch
        // seam is absent: the old source marked the scope inert and
        // `dwindleEnsureInvariant` was suppressed.
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // A later lifecycle dispatch collapses to the single root leaf.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // KWin geometry now admits a valid split; the deferred rebuild
        // proceeds and realizes dwindle(2) with both windows assigned. The
        // second `ownership-taken` is the rebuild completion.
        seam.rejecting = false;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 1, "the collapse removed exactly one leaf");
        const rootChildren = root.tiles as TestTile[];
        assert.equal(rootChildren.length, 2);
        assert.equal(first.tile, rootChildren[0]);
        assert.equal(second.tile, rootChildren[1]);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("defers a removal during a pending reconstruction and keeps stale duplicate callbacks inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 25, height: 100 });
        const b = tile({ x: 25, y: 0, width: 25, height: 100 });
        const c = tile({ x: 50, y: 0, width: 25, height: 100 });
        const d = tile({ x: 75, y: 0, width: 25, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        const fourth = window({ tile: d });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        d.windows = [fourth];
        root.tiles = [a, b, c, d];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third, fourth];
        let removes = 0;
        for (const leaf of [a, b, c, d]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        attachTileWriter(fourth);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // A removal arrives while a reconstruction is already pending. Live
        // KWin 6.7.3 still lists the removed window in its leaf at
        // `windowRemoved`, so the removal is deferred to one one-shot
        // event-loop yield and never collapses in the notification dispatch.
        // The pending rebuild keeps sole control of the structural work and
        // re-resolves the changed population itself on its next dispatch. The
        // old source could never reach this state against live KWin: its
        // freed-leaf-first unit contract let a synchronous collapse run at
        // `windowRemoved`, but the live ordering leaves the window listed, so
        // the guard returned early and nothing ever settled.
        second.tile = b;
        b.windows = [second];
        harness.windows = [first, third, fourth];
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 2);

        // The leaf evacuation settles on the event loop before any callback.
        // KWin's `Tile::unmanage` also clears the removed window's tile.
        b.windows = [];
        second.tile = null;

        // The pending collapse-phase dispatch collapses the scope to the
        // zero-child root and arms the split-phase yield.
        const collapseCallback = harness.yields[0]?.callback;
        assert.ok(collapseCallback !== undefined);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 2);
        // A duplicate dispatch of the same collapse callback is inert: after
        // the first fire the record advanced to awaiting-split, so a stale
        // repeat of the collapse callback cannot act again.
        collapseCallback();
        assert.equal(removes, 4, "a duplicate callback cannot collapse twice");
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);

        // The deferred removal settle is inert: its captured leaf is already
        // gone from the fresh tree, so it removes nothing and arms nothing.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(removes, 4, "a stale settle callback cannot remove a collapsed leaf");
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The split-phase dispatch realizes dwindle(3) from the surviving
        // population and never reassigns the removed window.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(controller.isEnabled, true);
        assert.equal(harness.scheduled.length, 0);
    });

    it("re-drives completion after a lost split-phase yield reply on the next lifecycle event", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // First yield dispatch: the removals-only collapse completes and arms
        // the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // The split-phase reply is lost (a D-Bus error reply never dispatches
        // the callDBus callback, scripting.cpp:361-364), so the scope stays
        // collapsed and the pending record stays at awaiting-split.
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.deepEqual(root.tiles, []);

        // A later already-wired ordinary lifecycle event re-drives completion
        // instead of leaving the scope collapsed forever: the add is left
        // floating and the pending rebuild re-resolves the fresh population
        // (including the added window) on the re-armed yield. No inertness and
        // no premature split happen in the add dispatch.
        const incoming = window();
        harness.windows = [first, second, third, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 0);
        assert.equal(harness.yields.length, 1);

        // The re-armed yield completes the split rebuild exactly once and
        // realizes dwindle(4) with the added window tiled.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(4);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.ok(third.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("bounds re-drive re-arms so repeated lost split-phase replies mark the scope inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        let removes = 0;
        let splits = 0;
        for (const leaf of [a, b, c]) {
            leaf.split = () => {
                splits += 1;
                return [];
            };
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // First yield dispatch: the removals-only collapse completes and arms
        // the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // The split-phase reply is lost (a D-Bus error reply never dispatches
        // the callDBus callback, scripting.cpp:361-364).
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // A lifecycle event re-arms the split-phase yield (budget 1 of 2) so
        // the scope is not stranded collapsed after one lost reply. No split,
        // rebuild, or inertness happens in the lifecycle callback itself.
        const firstIncoming = window();
        harness.windows = [first, second, third, firstIncoming];
        attachTileWriter(firstIncoming);
        harness.emitAdded(firstIncoming);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(splits, 0);
        assert.equal(harness.yields.length, 1);

        // The re-armed reply is lost too; the scope stays collapsed.
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);
        assert.deepEqual(root.tiles, []);

        // Another ordinary lifecycle event spends the second re-arm of the
        // budget (2 of 2) and still re-arms: repeated loss has not yet marked
        // the scope inert.
        const secondIncoming = window();
        harness.windows = [first, second, third, firstIncoming, secondIncoming];
        attachTileWriter(secondIncoming);
        harness.emitAdded(secondIncoming);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 1);

        // That re-armed reply is lost as well, exhausting the budget.
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);

        // One more ordinary lifecycle event finds the budget exhausted and
        // fails the scope closed: it becomes inert, the pending reconstruction
        // is dropped, and nothing is armed. No split or rebuild ever ran, the
        // scope stays collapsed, and no timer was scheduled.
        const thirdIncoming = window();
        harness.windows = [first, second, third, firstIncoming, secondIncoming, thirdIncoming];
        attachTileWriter(thirdIncoming);
        harness.emitAdded(thirdIncoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:rearm-budget-exhausted"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(splits, 0);
        assert.equal(removes, 3);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);

        // The inert scope is never retried: a further lifecycle event neither
        // re-arms a rebuild nor mutates structure.
        const fourthIncoming = window();
        harness.windows = [first, second, third, firstIncoming, secondIncoming, thirdIncoming, fourthIncoming];
        attachTileWriter(fourthIncoming);
        harness.emitAdded(fourthIncoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:rearm-budget-exhausted"), 1);
        assert.equal(splits, 0);
        assert.equal(removes, 3);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("fails a scope closed when the one-shot yield arm fails", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        let splits = 0;
        let removes = 0;
        for (const leaf of [a, b, c]) {
            leaf.split = () => {
                splits += 1;
                return [];
            };
            leaf.remove = () => {
                removes += 1;
                return true;
            };
        }
        harness.yieldResult = false;
        const controller = new TileController(harness.environment());
        controller.start();

        // The takeover arm fails closed: the scope is inert, nothing is armed,
        // and no structural call ever ran.
        assert.equal(countEvent(harness.logs, "ownership-inert:initial-yield-arm-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(removes, 0);
        assert.equal(splits, 0);

        // The inert scope is never retried: a later add takes the generic
        // automatic-placement path, never a new reconstruction.
        const incoming = window();
        harness.windows = [first, second, third, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:initial-yield-arm-failed"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("accepts a non-canonical but bijection-intact tree at a steady-state removal and arms no reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 100 });
        const v = tile({ x: 100, y: 0, width: 100, height: 100 }, true);
        v.layoutDirection = 2;
        const b = tile({ x: 100, y: 0, width: 100, height: 50 });
        const h = tile({ x: 100, y: 50, width: 100, height: 50 }, true);
        const c = tile({ x: 100, y: 50, width: 100, height: 25 });
        const d = tile({ x: 100, y: 75, width: 100, height: 25 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        const cWin = window({ tile: c, caption: "c" });
        const dWin = window({ tile: d, caption: "d" });
        a.windows = [aWin];
        b.windows = [bWin];
        c.windows = [cWin];
        d.windows = [dWin];
        root.tiles = [a, v];
        v.tiles = [b, h];
        h.tiles = [c, d];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin, cWin, dWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        attachTileWriter(cWin);
        attachTileWriter(dWin);
        let removes = 0;
        let splits = 0;
        for (const value of [root, v, h, a, b, c, d]) {
            value.split = () => {
                splits += 1;
                return [];
            };
        }
        a.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
            // KWin promotes a single-child layout after a tile removal: the
            // vacated H wrapper disappears and the V chain becomes the root.
            if ((root.tiles as TestTile[]).length === 1) {
                const sole = (root.tiles as TestTile[])[0];
                if (sole !== undefined) {
                    harness.root = sole;
                }
            }
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();

        // The persisted canonical dwindle(4) chain H[a, V[b, H[c, d]]] is
        // adopted unchanged with no structural call.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // Removing the first-chain window `a`: live KWin 6.7.3 still lists the
        // window in its leaf at `windowRemoved`, so the collapse is deferred to
        // one one-shot event-loop yield.
        aWin.tile = a;
        a.windows = [aWin];
        harness.windows = [bWin, cWin, dWin];
        harness.emitRemoved(aWin);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(harness.yields.length, 1);

        // The settle removes `a` and the root promotes to its sole child, so
        // the live tree becomes the vertical-root V[b, H[c, d]]. The
        // window-to-leaf occupancy bijection is intact (three leaves, three
        // owned windows), so the steady-state invariant accepts the genuinely
        // non-canonical topology with the accepted diagnostic instead of arming
        // a reconstruction: no collapse beyond the single removal, no split, no
        // pending rebuild, and every survivor stays tiled.
        a.windows = [];
        aWin.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(removes, 1);
        assert.equal(splits, 0);
        assert.equal(harness.root, v);
        assert.equal(v.isLayout, true);
        assert.equal(v.layoutDirection, 2);
        assert.deepEqual(v.tiles, [b, h]);
        assert.deepEqual(h.tiles, [c, d]);
        assert.equal(bWin.tile, b);
        assert.equal(cWin.tile, c);
        assert.equal(dWin.tile, d);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("arms a reconstruction from a steady-state add when the occupancy bijection fails, with the failed diagnostic", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        let removes = 0;
        let splits = 0;
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
            leaf.split = () => {
                splits += 1;
                return [];
            };
        }
        const seam = { rejecting: true };
        installCapacityRejectingSplitter(b, seam);
        installDwindleSplitter(root);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();

        // The persisted canonical dwindle(2) H[a, b] is adopted unchanged, so
        // ownership is established before the bijection is broken.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // A third window arrives while KWin minimum geometry rejects the split
        // children: the insertion leaves the incoming window floating and the
        // live tree untouched, so the occupancy bijection fails (three owned
        // windows against two leaves) and the steady-state invariant arms the
        // deferred reconstruction with the failed diagnostic.
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-failed:no-child-geometry"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(incoming.tile, null);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 1);

        // The queued reconstruction settles: the removals-only collapse runs at
        // the first yield, then the splits-only rebuild realizes dwindle(3)
        // with every window tiled at the second.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(removes, 2);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.notEqual(aWin.tile, bWin.tile);
        assert.notEqual(aWin.tile, incoming.tile);
        assert.notEqual(bWin.tile, incoming.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("reconciles a foreign persisted non-canonical tree to the canonical dwindle shape on adoption", () => {
        const harness = new Harness();
        const v = tile(RECT, true);
        v.layoutDirection = 2;
        const h = tile({ x: 0, y: 0, width: 100, height: 50 }, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 50 });
        const b = tile({ x: 0, y: 50, width: 100, height: 50 });
        const c = tile({ x: 0, y: 0, width: 100, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        const cWin = window({ tile: c, caption: "c" });
        a.windows = [aWin];
        b.windows = [bWin];
        c.windows = [cWin];
        v.tiles = [a, h];
        h.tiles = [b, c];
        harness.root = v;
        harness.active = aWin;
        harness.windows = [aWin, bWin, cWin];
        let removes = 0;
        a.remove = () => {
            removes += 1;
            v.tiles = (v.tiles as TestTile[]).filter((entry) => entry !== a);
            return true;
        };
        b.remove = () => {
            removes += 1;
            h.tiles = (h.tiles as TestTile[]).filter((entry) => entry !== b);
            return true;
        };
        c.remove = () => {
            removes += 1;
            h.tiles = (h.tiles as TestTile[]).filter((entry) => entry !== c);
            return true;
        };
        h.remove = () => {
            removes += 1;
            v.tiles = (v.tiles as TestTile[]).filter((entry) => entry !== h);
            return true;
        };
        installDwindleSplitter(v);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        attachTileWriter(cWin);
        const controller = new TileController(harness.environment());
        controller.start();

        // The foreign persisted vertical-root tree V[a, H[b, c]] has an intact
        // occupancy bijection (three leaves, three owned windows) but is
        // non-canonical (the root is vertical, not horizontal). Adoption must
        // reconcile it, not accept it through the steady-state bijection-only
        // branch: no ownership-taken and no acceptance diagnostic, just the
        // armed reconstruction.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        // Collapse phase: the nested tree collapses removals-only to the single
        // zero-child layout root, then arms the split phase.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 4);
        assert.deepEqual(v.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Split phase: the canonical dwindle(3) shape is realized and every
        // window lands on its own leaf.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(v, compiled.value, 0);
        }
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(cWin.tile !== null);
        assert.notEqual(aWin.tile, bWin.tile);
        assert.notEqual(aWin.tile, cWin.tile);
        assert.notEqual(bWin.tile, cWin.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("inserts a fourth window at the right-spine leaf of an owned non-canonical tree without reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 100 });
        const v = tile({ x: 100, y: 0, width: 100, height: 100 }, true);
        v.layoutDirection = 2;
        const b = tile({ x: 100, y: 0, width: 100, height: 50 });
        const h = tile({ x: 100, y: 50, width: 100, height: 50 }, true);
        const c = tile({ x: 100, y: 50, width: 100, height: 25 });
        const d = tile({ x: 100, y: 75, width: 100, height: 25 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        const cWin = window({ tile: c, caption: "c" });
        const dWin = window({ tile: d, caption: "d" });
        a.windows = [aWin];
        b.windows = [bWin];
        c.windows = [cWin];
        d.windows = [dWin];
        root.tiles = [a, v];
        v.tiles = [b, h];
        h.tiles = [c, d];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin, cWin, dWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        attachTileWriter(cWin);
        attachTileWriter(dWin);
        let removes = 0;
        a.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
            if ((root.tiles as TestTile[]).length === 1) {
                const sole = (root.tiles as TestTile[])[0];
                if (sole !== undefined) {
                    harness.root = sole;
                }
            }
            return true;
        };
        installDwindleSplitter(d);
        const controller = new TileController(harness.environment());
        controller.start();

        // The persisted canonical dwindle(4) chain H[a, V[b, H[c, d]]] is
        // adopted unchanged with no structural call.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // Removing the first-chain window `a` promotes the root to its sole
        // child, leaving the owned non-canonical vertical-root tree V[b, H[c, d]]
        // with an intact bijection (three leaves, three owned windows). The
        // steady-state invariant accepts it instead of reconstructing.
        aWin.tile = a;
        a.windows = [aWin];
        harness.windows = [bWin, cWin, dWin];
        harness.emitRemoved(aWin);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(harness.yields.length, 1);
        a.windows = [];
        aWin.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(removes, 1);
        assert.equal(harness.root, v);
        assert.equal(v.layoutDirection, 2);

        // A fourth window arrives into the owned non-canonical tree. The
        // insertion target is the deepest right-spine leaf `d` at depth two
        // (horizontal orientation), reached without depending on a canonical
        // root: `d` splits horizontally and the incoming window lands on its
        // second child, with the prior occupant on the first.
        const incoming = window();
        harness.windows = [bWin, cWin, dWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.root, v);
        assert.equal(d.isLayout, true);
        assert.equal(d.layoutDirection, 1);
        const dChildren = d.tiles as TestTile[];
        assert.equal(dChildren.length, 2);
        assert.equal(dWin.tile, dChildren[0]);
        assert.equal(incoming.tile, dChildren[1]);
        const occupied = [bWin.tile, cWin.tile, dWin.tile, incoming.tile];
        for (const entry of occupied) {
            assert.notEqual(entry, null);
        }
        assert.equal(new Set(occupied).size, 4);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });
});

describe("TileController deferred invariant recovery", () => {
    it("recovers a leaf-count mismatch from a real drag split deferred origin removal", () => {
        const state = reconstructDropSetup();
        // KWin's CustomTile::remove() returns void: a no-throw call is only
        // mutation-possible, never an acknowledgement. Model the deleteLater
        // lag on the first origin removal: it reports success but the live tree
        // still lists the origin, so the settle postcondition sees a leaf-count
        // mismatch instead of a one-fewer-leaf tree.
        let aRemoves = 0;
        state.a.remove = () => {
            aRemoves += 1;
            if (aRemoves === 1) {
                return true;
            }
            state.root.tiles = (state.root.tiles as TestTile[]).filter((entry) => entry !== state.a);
            return true;
        };
        startDrag(state.aWin);
        state.aWin.frameGeometry = { x: 100, y: 0, width: 50, height: 100 };
        state.aWin.tile = null;
        state.aWin.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(state.harness.yields.length, 1);

        // The deferred origin removal settle hits the leaf-count mismatch:
        // recoverable, not inert. No after snapshot applies because the
        // collapse did not complete.
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "ownership-remove-failed:leaf-count"), 1);
        assert.equal(state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(state.harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(
            state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-snapshot-after:")),
            false,
        );

        // The owed invariant recovery settles to a full reconstruction with both
        // windows tiled and no orphan left behind.
        while (state.harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 2);
        assert.equal(state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(state.aWin.tile !== null);
        assert.ok(state.bWin.tile !== null);
        assert.notEqual(state.aWin.tile, state.bWin.tile);
        assert.equal(state.harness.yields.length, 0);
    });

    it("defers the dwindle invariant during a live drag without structural work", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        installCapacityRejectingSplitter(b, { rejecting: true });
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);

        // Start a live drag on aWin and keep `move` true so the drag is still
        // live-moving when the invariant is reached.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);

        // A third window arrives while the drag is live. Its insertion hits the
        // minimum-geometry capacity rejection and stays floating, so the
        // steady-state invariant would normally arm a reconstruction. During a
        // live drag it must defer instead of doing structural work.
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-failed:no-child-geometry"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, [a, b]);
        assert.deepEqual(a.windows, [aWin]);
        assert.deepEqual(b.windows, [bWin]);
    });

    it("runs the owed invariant check once after a no-finish abnormal termination", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installCapacityRejectingSplitter(b, { rejecting: true });
        installDwindleSplitter(root);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin, then a third window arrives and the invariant is
        // deferred, marking exactly one owed check.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // Abnormal termination: the dragged window is removed with no finish
        // event. The owed check must run exactly once and arm the deferred
        // reconstruction.
        aWin.tile = null;
        harness.windows = [bWin, incoming];
        harness.emitRemoved(aWin);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The owed reconstruction settles: collapse then rebuild dwindle(2)
        // with both surviving windows tiled and no orphan left behind.
        while (harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.notEqual(bWin.tile, incoming.tile);
        assert.equal(harness.yields.length, 0);
    });

    it("runs the owed invariant check via moveResizedChanged when the finish signal is missed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installCapacityRejectingSplitter(b, { rejecting: true });
        installDwindleSplitter(root);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin, then a third window arrives and the invariant is
        // deferred, marking exactly one owed check.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // The interactiveMoveResizeFinished signal is missed entirely: the
        // live move simply turns false, and the resulting moveResizedChanged
        // must run the owed invariant check. No window is removed and no
        // scope change happens.
        aWin.move = false;
        aWin.resize = false;
        aWin.moveResizedChanged.emit();
        assert.equal(countEvent(harness.logs, "drag-move-resized-changed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, [a, b]);
        assert.deepEqual(a.windows, [aWin]);
        assert.deepEqual(b.windows, [bWin]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The owed reconstruction settles: collapse then rebuild dwindle(3)
        // with all three windows tiled and no orphan left behind.
        while (harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(new Set([aWin.tile, bWin.tile, incoming.tile]).size, 3);
        assert.equal(harness.yields.length, 0);
    });

    it("defers adoption reconstruction during a live drag", () => {
        const harness = new Harness();
        const root1 = tile(RECT, true);
        const leaf = tile();
        const aWin = window({ tile: leaf, caption: "a" });
        leaf.windows = [aWin];
        root1.tiles = [leaf];
        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        const c = tile({ x: 0, y: 0, width: 50, height: 100 });
        const d = tile({ x: 50, y: 0, width: 50, height: 100 });
        const w2 = window({ tile: c, caption: "w2", desktops: [desktop2] });
        c.windows = [w2];
        root2.tiles = [c, d];
        harness.rootsByDesktop.set(DESKTOP.id, root1);
        harness.rootsByDesktop.set(desktop2.id, root2);
        harness.active = aWin;
        harness.windows = [aWin];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin on the first desktop.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);

        // A window arrives on a second, not-yet-owned desktop while the drag is
        // live: adoption would normally arm a reconstruction, but must defer.
        harness.currentDesktop = desktop2;
        harness.windows = [aWin, w2];
        harness.emitAdded(w2);

        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
    });

    it("defers a removal during a live drag without structural work", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        let removes = 0;
        for (const entry of [a, b]) {
            entry.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((tile) => tile !== entry);
                return true;
            };
        }
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();

        // bWin is removed (its leaf already provably freed) while the drag is
        // live: the removal must defer instead of structurally removing.
        b.windows = [];
        harness.windows = [aWin];
        harness.emitRemoved(bWin);

        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, [a, b]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The drag ends without a drop: the owed check runs and reconstructs the
        // reduced population with no orphan left behind.
        aWin.move = false;
        aWin.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);

        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.equal(harness.yields.length, 0);
    });

    it("defers a pending removal settle during a live drag", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        let removes = 0;
        for (const entry of [a, b]) {
            entry.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((tile) => tile !== entry);
                return true;
            };
        }
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Remove bWin while it is still listed in its leaf: the removal is
        // deferred to a one-shot yield before any drag starts.
        bWin.tile = b;
        b.windows = [bWin];
        harness.windows = [aWin];
        harness.emitRemoved(bWin);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(harness.yields.length, 1);

        // A live drag starts before the deferred settle fires.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();

        // The deferred settle fires mid-drag: it must defer instead of removing.
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(removes, 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.deepEqual(root.tiles, [a, b]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The drag ends without a drop: the owed check runs and reconstructs.
        aWin.move = false;
        aWin.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);

        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.equal(harness.yields.length, 0);
    });

    it("runs the owed check only after the deferred origin removal settles on a drop", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 100 });
        const b = tile({ x: 100, y: 0, width: 100, height: 100 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const manage = (leaf: TestTile) => (value: unknown): boolean => {
            (value as TestWindow).tile = leaf;
            return true;
        };
        const bLeft = tile({ x: 100, y: 0, width: 50, height: 100 });
        const bRight = tile({ x: 150, y: 0, width: 50, height: 100 });
        bLeft.manage = manage(bLeft);
        bRight.manage = manage(bRight);
        const seam = { rejecting: true };
        b.split = (direction) => {
            if (seam.rejecting) {
                return [tile({ x: 100, y: 0, width: 0, height: 100 }), tile({ x: 150, y: 0, width: 50, height: 100 })];
            }
            b.isLayout = true;
            b.layoutDirection = direction;
            b.windows = [];
            b.tiles = [bLeft, bRight];
            return [bLeft, bRight];
        };
        a.remove = () => {
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
            return true;
        };
        bLeft.remove = () => {
            b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bLeft);
            return true;
        };
        bRight.remove = () => {
            b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bRight);
            return true;
        };
        b.remove = () => {
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== b);
            return true;
        };
        installDwindleSplitter(root);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin, then a third window arrives and the invariant is
        // deferred (marking exactly one owed check).
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // The drag ends as a drop onto bWin, arming the deferred origin removal.
        // The owed check must NOT run yet: the origin is transiently empty.
        seam.rejecting = false;
        aWin.tile = null;
        aWin.frameGeometry = { x: 100, y: 0, width: 50, height: 100 };
        aWin.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 1);

        // After the deferred origin removal settles, the owed check runs and
        // arms the reconstruction for the reduced population.
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(new Set([aWin.tile, bWin.tile, incoming.tile]).size, 3);
        assert.equal(harness.yields.length, 0);
    });

    it("clears a stale drag record before accepting a new drag", () => {
        const { controller, harness, dragged, targetWindow } = dragSetup();
        startDrag(dragged);
        assert.equal(controller.hasActiveDrag, true);
        assert.equal(dragged.move, false);

        // The drag ended without a finish event: the captured record is stale.
        // A new drag on the target window must clear it and capture fresh.
        targetWindow.move = true;
        targetWindow.interactiveMoveResizeStarted.emit();
        targetWindow.move = false;
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 2);
        assert.equal(controller.hasActiveDrag, true);
    });

    it("logs a drag-bail reason when finish has no tracked drag or a mismatched window", () => {
        const { harness, dragged, targetWindow } = dragSetup();
        // Finish with no tracked drag.
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 1);

        // Track a drag on `dragged`, then finish fires for a different window.
        startDrag(dragged);
        targetWindow.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:window-mismatch"), 1);
    });

    it("logs an interactive resize separately from an unknown non-move and attributes its follow-on bail", () => {
        const { harness, controller, dragged, targetWindow } = dragSetup();

        // An interactive resize (resize live, move not live) is not captured
        // and is logged as a resize, distinct from an unknown non-move.
        dragged.resize = true;
        dragged.move = false;
        dragged.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:resize"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:not-move"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        assert.equal(controller.hasActiveDrag, false);

        // The resize finish sees no tracked drag and the bail is attributed to
        // the resize rather than a generic no-tracked-drag.
        dragged.resize = false;
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag:resize"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 0);

        // An unknown non-move (neither move nor resize) keeps the generic
        // not-move capture failure and generic no-tracked-drag finish bail.
        targetWindow.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:not-move"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:resize"), 1);
        targetWindow.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 1);
    });

    it("does not attribute an unpaired finish after a completed resize", () => {
        const { harness, dragged } = dragSetup();

        // Complete a normal interactive resize.
        dragged.resize = true;
        dragged.interactiveMoveResizeStarted.emit();
        dragged.resize = false;
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag:resize"), 1);

        // A later finish with no preceding start must not be attributed to the
        // consumed resize gesture.
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag:resize"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 1);
    });

    it("logs a drag-bail reason when invalidation clears an active tracked drag", () => {
        const { harness, controller, dragged } = dragSetup();
        startDrag(dragged);
        assert.equal(controller.hasActiveDrag, true);
        assert.equal(countEvent(harness.logs, "drag-bail:window-invalidated"), 0);

        dragged.desktopsChanged.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:window-invalidated"), 1);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("logs an explicit reason when a tiled drag is ignored because its scope is inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        root.split = () => [];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // A malformed split marks the scope inert for the session.
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);

        // A move drag on the still-tiled window is ignored with an explicit log.
        first.move = true;
        first.resize = false;
        first.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:scope-inert"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        assert.equal(controller.hasActiveDrag, false);
    });
});

describe("TileController fullscreen passthrough", () => {
    function setFullscreen(subject: TestWindow, value: boolean): void {
        subject.fullScreen = value;
        subject.fullScreenChanged.emit();
    }

    it("leaves a created fullscreen window unmanaged with no tile write", () => {
        const { harness } = setup();
        const created = window({ fullScreen: true });
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(created, writes);
        harness.emitAdded(created);
        assert.equal(created.tile, null);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        assert.equal(countEvent(harness.logs, "window-added-eligible"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("preserves the slot and never mutates the tree when a tiled window enters fullscreen", () => {
        const { harness, root, target, focused } = setup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(focused, writes);
        setFullscreen(focused, true);
        assert.equal(focused.tile, target);
        assert.equal(writes.length, 0);
        assert.deepEqual(root.tiles, [target]);
        assert.deepEqual(target.windows, [focused]);
        assert.equal(countEvent(harness.logs, "fullscreen:enter preserved"), 1);
    });

    it("ignores geometry and lifecycle events while fullscreen without placement, reconstruction, drag, or resize", () => {
        const { harness, controller, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.moveResizedChanged.emit();
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("restores the preserved slot on exit via tile.manage without a guarded window.tile write", () => {
        const { harness, target, focused } = setup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(focused, writes);
        setFullscreen(focused, true);
        focused.tile = null;
        target.windows = [];
        let manages = 0;
        target.manage = (value) => {
            manages += 1;
            return value === focused;
        };
        writes.length = 0;
        setFullscreen(focused, false);
        assert.equal(manages, 1);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restore failed"), 0);
    });

    it("keeps the fullscreen record through removal so the owned tree is not collapsed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leafA = tile();
        const leafB = tile({ x: 200, y: 0, width: 100, height: 100 });
        const fsWin = window({ tile: leafA });
        const otherWin = window({ tile: leafB });
        leafA.windows = [fsWin];
        leafB.windows = [otherWin];
        root.tiles = [leafA, leafB];
        harness.root = root;
        harness.active = fsWin;
        harness.windows = [fsWin, otherWin];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        setFullscreen(fsWin, true);
        leafA.windows = [];
        let removes = 0;
        leafA.remove = () => {
            removes += 1;
            return true;
        };
        harness.emitRemoved(fsWin);
        assert.equal(removes, 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(otherWin.tile, leafB);
        assert.deepEqual(root.tiles, [leafA, leafB]);
        assert.ok(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen") >= 1);
        assert.equal(fsWin.fullScreenChanged.subscriberCount, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("does not reflow a selected overlay when another window is removed while fullscreen", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = tile();
        const second = tile({ x: 200, y: 0, width: 100, height: 100 });
        const fullscreen = window({ tile: first });
        const removed = window({ tile: second });
        first.windows = [fullscreen];
        second.windows = [removed];
        root.tiles = [first, second];
        harness.root = root;
        harness.active = fullscreen;
        harness.windows = [fullscreen, removed];
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-apply-columns");
        setFullscreen(fullscreen, true);
        second.windows = [];
        harness.emitRemoved(removed);
        assert.equal(fullscreen.tile, first);
        assert.equal(countEvent(harness.logs, "reflow-completed"), 0);
        assert.ok(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen") >= 1);
        assert.equal(controller.isEnabled, true);
    });

    it("suppresses the new scope after a fullscreen window changes output", () => {
        const { harness, root, target, focused } = setup();
        const otherOutput = { ...OUTPUT, name: "screen-2" };
        setFullscreen(focused, true);
        focused.output = otherOutput;
        focused.outputChanged.emit();
        const incoming = window({ output: otherOutput });
        harness.emitAdded(incoming);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, [target]);
        assert.ok(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen") >= 1);
    });

    it("newly manages a created fullscreen window on exit into an empty leaf", () => {
        const { harness, root, target } = setup();
        const empty = tile(RECT, false, () => true);
        root.tiles = [target, empty];
        const created = window({ fullScreen: true });
        harness.emitAdded(created);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        setFullscreen(created, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit newly managed"), 1);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
    });

    it("bails non-destructively and logs a reason when the preserved slot is gone", () => {
        const { harness, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.tile = null;
        target.windows = [];
        root.tiles = [];
        setFullscreen(focused, false);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restore failed:tile-missing"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 0);
        assert.equal(harness.yields.length, 0);
    });

    it("feature-detects a missing fullScreenChanged binding without failing startup", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const focused = window({ tile: null });
        delete (focused as unknown as Record<string, unknown>)["fullScreenChanged"];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
        assert.ok(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:fullscreen-attach-failed:fullScreenChanged:")));
        const created = window({ fullScreen: true });
        harness.emitAdded(created);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
    });

    it("guards keyboard window movement while the active window is fullscreen", () => {
        const state = moveSetup("right");
        setFullscreen(state.focused, true);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.focused.tile, state.focusedTile);
        assert.deepEqual(state.target.windows, []);
        assert.deepEqual(
            state.harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:move-") || entry.includes("fullscreen:ignored")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen"],
        );
    });

    it("never swaps the active window onto a fullscreen occupant", () => {
        const state = swapSetup("right");
        setFullscreen(state.occupant, true);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(
            countEvent(state.harness.logs.slice(baseline), "fullscreen:ignored lifecycle while fullscreen"),
            1,
        );
        assert.equal(state.active.tile, state.source);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(state.source.windows, [state.active]);
        assert.deepEqual(state.target.windows, [state.occupant]);
    });

    it("guards preset application while the active window is fullscreen", () => {
        const { harness, focused, target } = setup();
        setFullscreen(focused, true);
        const baseline = harness.logs.length;
        invokeShortcut(harness, "plasma-auto-tiler-apply-columns");
        assert.equal(focused.tile, target);
        assert.deepEqual(
            harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:preset-") || entry.includes("fullscreen:ignored")),
            [
                "plasma-auto-tiler:preset-invoked:columns",
                "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen",
            ],
        );
    });

    it("guards keyboard insertion arming while the active window is fullscreen", () => {
        const { harness, focused, target } = setup();
        setFullscreen(focused, true);
        const baseline = harness.logs.length;
        invokeShortcut(harness, "plasma-auto-tiler-insert-right");
        assert.equal(focused.tile, target);
        assert.deepEqual(
            harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:keyboard-") || entry.includes("fullscreen:ignored")),
            [
                "plasma-auto-tiler:keyboard-invoked",
                "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen",
            ],
        );
    });

    it("guards detach while the active window is fullscreen", () => {
        const { harness, focused, target } = setup();
        setFullscreen(focused, true);
        const baseline = harness.logs.length;
        invokeShortcut(harness, "plasma-auto-tiler-detach");
        assert.equal(focused.tile, target);
        assert.deepEqual(
            harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:detach-") || entry.includes("fullscreen:ignored")),
            [
                "plasma-auto-tiler:detach-invoked",
                "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen",
            ],
        );
    });

    it("guards drag/drop and resize lifecycle while fullscreen without reflow", () => {
        const { harness, controller, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.move = false;
        focused.resize = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.yields.length, 0);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("records an already-fullscreen existing window at startup without tiling, writing, reconstruction, or automatic placement", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const fullscreen = window({ fullScreen: true });
        const target = tile();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(fullscreen, writes);
        target.manage = (value) => {
            fullscreen.tile = target;
            return value === fullscreen;
        };
        root.tiles = [target];
        harness.root = root;
        harness.active = fullscreen;
        harness.windows = [fullscreen];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
        assert.equal(fullscreen.tile, null);
        assert.deepEqual(target.windows, []);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:enter preserved"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        const incoming = window();
        const incomingWrites: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(incoming, incomingWrites);
        harness.emitAdded(incoming);
        assert.equal(incoming.tile, null);
        assert.equal(incomingWrites.length, 0);
        assert.equal(writes.length, 0);
        assert.deepEqual(target.windows, []);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        fullscreen.move = true;
        fullscreen.interactiveMoveResizeStarted.emit();
        fullscreen.interactiveMoveResizeFinished.emit();
        assert.equal(fullscreen.tile, null);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        fullscreen.fullScreen = false;
        fullscreen.fullScreenChanged.emit();
        assert.equal(countEvent(harness.logs, "fullscreen:exit newly managed"), 1);
        assert.equal(fullscreen.tile, target);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
    });

    it("bails non-destructively on exit when the preserved leaf became occupied by another window", () => {
        const { harness, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.tile = null;
        target.windows = [];
        const intruder = window({ tile: target });
        target.windows = [intruder];
        setFullscreen(focused, false);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restore failed:leaf-occupied"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(intruder.tile, target);
        assert.deepEqual(root.tiles, [target]);
    });
});

describe("TileController floating and sticky windows", () => {
    function floatSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly root: TestTile;
        readonly target: TestTile;
        readonly focused: TestWindow;
        readonly manages: Array<{ tile: TestTile; window: TestWindow }>;
        readonly unmanages: Array<{ tile: TestTile; window: TestWindow }>;
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
        const manages: Array<{ tile: TestTile; window: TestWindow }> = [];
        const unmanages: Array<{ tile: TestTile; window: TestWindow }> = [];
        target.manage = (value) => {
            const w = value as TestWindow;
            manages.push({ tile: target, window: w });
            w.tile = target;
            target.windows = [w];
            return true;
        };
        target.unmanage = (value) => {
            const w = value as TestWindow;
            unmanages.push({ tile: target, window: w });
            w.tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller, root, target, focused, manages, unmanages };
    }

    function setFullscreen(subject: TestWindow, value: boolean): void {
        subject.fullScreen = value;
        subject.fullScreenChanged.emit();
    }

    it("floats a tiled window retaining the vacated leaf and recording centered 60% work-area geometry", () => {
        const { harness, controller, root, target, focused, unmanages } = floatSetup();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(unmanages.length, 1);
        assert.equal(focused.tile, null);
        assert.deepEqual(root.tiles, [target], "the vacated leaf is retained");
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
        assert.equal(countEvent(harness.logs, "float-completed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("tiles a floating window back through tile.manage and reuses the remembered geometry on re-float", () => {
        const { harness, root, target, focused, manages } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(manages.length, 1);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
        assert.deepEqual(root.tiles, [target]);

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.tile, null);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
    });

    it("leaves a floating window floating on a capacity failure with the exact reason", () => {
        const { harness, root, target, focused, manages } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        const second = window();
        harness.emitAdded(second);
        assert.equal(second.tile, target, "the new window fills the retained empty leaf");

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(manages.filter((entry) => entry.window === focused).length, 0);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "tile-failed:no-available-leaf"), 1);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.deepEqual(root.tiles, [target]);
    });

    it("retains the all-desktop pin and floating state when a sticky window's tile request fails", () => {
        const { harness, root, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);

        const second = window();
        harness.emitAdded(second);
        assert.equal(second.tile, target, "the new window fills the retained empty leaf");

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "tile-failed:no-available-leaf"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.equal(focused.onAllDesktops, true, "the all-desktop pin survives the failed tile request");
        assert.equal(focused.tile, null, "the window remains floating");
        assert.deepEqual(root.tiles, [target]);
    });

    it("restores the all-desktop pin when a sticky window's tile assignment fails", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        let failManage = false;
        target.manage = (value) => {
            if (failManage) {
                return false;
            }
            (value as TestWindow).tile = target;
            target.windows = [value as TestWindow];
            return true;
        };
        target.unmanage = (value) => {
            (value as TestWindow).tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);

        failManage = true;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "tile-failed:assignment-failed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.equal(focused.onAllDesktops, true, "the all-desktop pin is restored after the failed tile");
        assert.equal(focused.tile, null, "the window remains floating");
        assert.deepEqual(root.tiles, [target]);
    });

    it("logs a distinct reason when a failed tile cannot restore the all-desktop pin", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        target.manage = () => false;
        target.unmanage = (value) => {
            (value as TestWindow).tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);

        let pinned = true;
        Object.defineProperty(focused, "onAllDesktops", {
            configurable: true,
            get: () => pinned,
            set: (value: boolean) => {
                if (value === true) {
                    throw new Error("pin-write-failed");
                }
                pinned = value;
            },
        });

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "tile-failed:assignment-failed"), 1);
        assert.equal(countEvent(harness.logs, "tile-failed:sticky-restore-failed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.equal(focused.tile, null, "the window remains floating");
    });

    it("never tiles a sticky window whose all-desktop pin cannot be cleared", () => {
        const { harness, root, target, focused, manages } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);
        assert.equal(focused.tile, null);

        Object.defineProperty(focused, "onAllDesktops", {
            configurable: true,
            get: () => true,
        });

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(manages.filter((entry) => entry.window === focused).length, 0);
        assert.equal(focused.tile, null, "the window is not tiled when the pin cannot be cleared");
        assert.equal(countEvent(harness.logs, "tile-failed:sticky-clear-failed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.deepEqual(root.tiles, [target]);
    });

    it("leaves a floating window floating on an assignment failure with the exact reason", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        let failManage = false;
        target.manage = (value) => {
            if (failManage) {
                return false;
            }
            (value as TestWindow).tile = target;
            target.windows = [value as TestWindow];
            return true;
        };
        target.unmanage = (value) => {
            (value as TestWindow).tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        failManage = true;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "tile-failed:assignment-failed"), 1);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
    });

    it("excludes a floating window from automatic placement, drag capture, and reconstruction", () => {
        const { harness, controller, root, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");

        // A move drag on the floating window is ignored with the exact reason.
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:floating"), 1);
        assert.equal(controller.hasActiveDrag, false);
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();

        // Adding a window fills the retained leaf and never re-tiles or
        // reconstructs around the floating window.
        const added = window();
        harness.emitAdded(added);
        assert.equal(added.tile, target);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.deepEqual(root.tiles, [target]);
    });

    it("adopts an already all-desktops startup window as sticky floating with no collapse or keepAbove", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const floating = window({ desktops: [], onAllDesktops: true, tile: null });
        const tiled = window({ tile: b });
        a.windows = [];
        b.windows = [tiled];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = tiled;
        harness.windows = [floating, tiled];
        const controller = new TileController(harness.environment());
        controller.start();

        assert.equal(countEvent(harness.logs, "startup-sticky-float"), 1);
        assert.equal(floating.tile, null);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(harness.yields.length, 0);

        // Fullscreen round trip keeps the sticky window floating.
        setFullscreen(floating, true);
        setFullscreen(floating, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored float"), 1);
        assert.equal(floating.tile, null);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);

        assert.equal(harness.logs.some((entry) => entry.includes("keepAbove")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("sticky from tiled floats first, pins all desktops, and sticky off remains floating with geometry retained", () => {
        const { harness, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.tile, null);
        assert.equal(focused.onAllDesktops, true);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
        assert.equal(countEvent(harness.logs, "float-completed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 1);

        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, false);
        assert.equal(focused.tile, null, "sticky off remains floating");
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 1);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
    });

    it("tiling a sticky window clears its all-desktop pin first", () => {
        const { harness, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.onAllDesktops, false);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 1);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
    });

    it("retains float geometry and floating state through a fullscreen round trip", () => {
        const { harness, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        setFullscreen(focused, true);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        setFullscreen(focused, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored float"), 1);
        assert.equal(focused.tile, null);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("restores a user-adjusted float geometry through a fullscreen round trip", () => {
        const { harness, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        const userGeometry = { x: 30, y: 40, width: 70, height: 50 };
        focused.frameGeometry = userGeometry;

        setFullscreen(focused, true);
        setFullscreen(focused, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored float"), 1);
        assert.equal(focused.tile, null);
        assert.deepEqual(focused.frameGeometry, userGeometry);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("drops only session state on floating window close without any structural remove or collapse", () => {
        const { harness, root, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        let removes = 0;
        target.remove = () => {
            removes += 1;
            return true;
        };
        harness.emitRemoved(focused);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
    });

    it("emits the exact ignored-reason logs for no active window and fullscreen and ineligible windows", () => {
        const { harness } = floatSetup();
        harness.active = null;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:no-active-window"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-rejected:no-active-window"), 1);

        const fullscreenActive = window({ fullScreen: true });
        harness.active = fullscreenActive;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 2);

        harness.active = window({ normalWindow: false });
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:not-normal-window"), 1);

        harness.active = window({ appletPopup: true });
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-rejected:applet-popup"), 1);
    });

    it("rejects floating a window associated with a layout tile", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const focused = window({ tile: root });
        root.windows = [focused];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:active-tile-association"), 1);
        assert.equal(countEvent(harness.logs, "float-completed"), 0);
    });

    it("routes attach of a floating window through the float-to-tile transition", () => {
        const { harness, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.tile, null);

        invokeShortcut(harness, "plasma-auto-tiler-attach");
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
        assert.equal(countEvent(harness.logs, "attach-completed"), 0);
    });

    it("routes attach of a sticky floating window through the float-to-tile transition, clearing the pin", () => {
        const { harness, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);
        assert.equal(focused.tile, null);

        invokeShortcut(harness, "plasma-auto-tiler-attach");
        assert.equal(focused.tile, target);
        assert.equal(focused.onAllDesktops, false, "attach clears the pin through the float-to-tile transition");
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 1);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
        assert.equal(countEvent(harness.logs, "attach-completed"), 0);
    });

    it("declines startup adoption of an already tile-managed all-desktops window with no mutation", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const tiledSticky = window({ tile: leaf, onAllDesktops: true });
        leaf.windows = [tiledSticky];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = tiledSticky;
        harness.windows = [tiledSticky];
        const controller = new TileController(harness.environment());
        controller.start();

        assert.equal(countEvent(harness.logs, "startup-sticky-float"), 0);
        assert.equal(countEvent(harness.logs, "startup-sticky-declined:tile-managed"), 1);
        assert.equal(tiledSticky.tile, leaf, "the window keeps its tile");
        assert.equal(tiledSticky.onAllDesktops, true, "the pin is not mutated at startup");
    });
});

describe("TileController dynamic virtual desktops", () => {
    it("navigates to an existing 1-based index and never creates on an absent index", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopWrites.length, 1);
        assert.equal((harness.currentDesktopWrites[0] as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-navigate-completed:2"), 1);

        const writes = harness.currentDesktopWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-9");
        assert.equal(harness.currentDesktopWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-navigate-absent:9"), 1);
    });

    it("Meta+0 focuses an existing script-owned trailing empty without duplicate creation", () => {
        const { harness } = setup();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal(countEvent(harness.logs, "workspace-append-completed"), 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // Repeated Meta+0 on the trailing empty focuses it without appending.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal(countEvent(harness.logs, "workspace-append-focused-existing"), 2);
        assert.equal(countEvent(harness.logs, "workspace-created-owned"), 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
    });

    it("cleanup removes excess owned empty trailing desktops, keeping exactly one trailing empty", () => {
        const { harness, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        // Meta+0 creates the trailing owned empty; moving the floating window
        // into it makes reconciliation append a replacement.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-cleanup-replenished"), 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
        // Moving back re-empties desktop-2: it is now excess next to the kept
        // replacement desktop-3, so cleanup removes only it. Simulate the
        // window returning to desktop-1 and the user following it.
        focused.desktops = [DESKTOP];
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 1);
        assert.equal((harness.removedDesktops[0] as { id: string }).id, "desktop-2");
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
    });

    it("move to an absent index is a specific no-op with no membership write", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-5");
        assert.equal(countEvent(harness.logs, "workspace-move-absent:5"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual(focused.desktops as unknown[], [DESKTOP]);
    });

    it("moves a tiled window to an existing desktop, writing membership and following", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        const members = (focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id);
        assert.deepEqual(members, ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // The destination adoption is deferred one event-loop turn and never
        // loses the window; flush the queued yield without throwing.
        assert.equal(harness.flushNextYield(), true);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
    });

    it("move to the current desktop is a specific no-op", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-1");
        assert.equal(countEvent(harness.logs, "workspace-move-no-op:already-there"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
    });

    it("collapses the tiled source leaf synchronously and adopts only on the yielded turn", () => {
        const { harness, root, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        let unmanages = 0;
        let removes = 0;
        target.unmanage = (_value) => {
            unmanages += 1;
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        // Synchronous turn: the freed source leaf is unmanaged and collapsed,
        // the window is untiled and already a member of the target desktop.
        assert.equal(unmanages, 1);
        assert.equal(removes, 1);
        assert.deepEqual(root.tiles, []);
        assert.equal(focused.tile, null);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // Destination adoption is deferred: nothing has adopted yet and the
        // move's one-shot yield is still queued.
        assert.equal(harness.yields.length, 1);
        assert.equal(countEvent(harness.logs, "workspace-move-adopt"), 0);
        // Adoption runs only on the yielded turn and defers the still-floating
        // window into the destination scope's pending reconstruction.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "workspace-move-adopted-deferred:reconstruction"), 1);
        assert.ok(harness.yields.length >= 1);
    });

    it("leaves a moved window floating on the target when destination placement fails", () => {
        const { harness, root, target, focused, controller } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        // No event-loop yield can be armed: the destination scope cannot even
        // start its reconstruction, so adoption must fail closed into a
        // retained-floating placement instead of stranding the window.
        harness.yieldResult = false;
        let unmanages = 0;
        let removes = 0;
        target.unmanage = (_value) => {
            unmanages += 1;
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(unmanages, 1);
        assert.equal(removes, 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-move-adopt-failed:retained-floating"), 1);
        assert.equal(countEvent(harness.logs, "ownership-inert:initial-yield-arm-failed"), 1);
        assert.equal(focused.tile, null);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("defers cleanup while a cross-workspace move is unsettled and retries after it settles", () => {
        const { harness, root, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(harness.yields.length, 1);
        // Cleanup triggered while the move is still pending defers it.
        harness.emitDesktopsChanged();
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:move-unsettled"), 1);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:reconstruction-pending"), 0);
        assert.equal(harness.removedDesktops.length, 0);
        // After the move settles, cleanup is no longer deferred by it; the only
        // remaining deferral is the destination scope's pending reconstruction.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:move-unsettled"), 1);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:reconstruction-pending"), 1);
    });

    it("moves a floating window across workspaces without mutating the tile tree", () => {
        const { harness, root, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        let unmanages = 0;
        let removes = 0;
        let splits = 0;
        target.unmanage = (_value) => {
            unmanages += 1;
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            removes += 1;
            return true;
        };
        target.split = () => {
            splits += 1;
            return [];
        };
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-completed"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-floated"), 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // The tile tree is untouched: only the float's own single unmanage ran.
        assert.equal(focused.tile, null);
        assert.equal(unmanages, 1);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(harness.yields.length, 0);
    });

    it("refuses to move a sticky window with no membership write or navigation", () => {
        const { harness, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
    });

    it("refuses to move a fullscreen window with no membership write or navigation", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        focused.fullScreen = true;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
    });

    it("reports an append create failure without navigating or owning", () => {
        const { harness } = setup();
        harness.createDesktopThrows = new Error("create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-created-owned"), 0);
    });

    it("reports a failed membership write on a tiled move without navigating or arming", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        Object.defineProperty(focused, "desktops", {
            configurable: true,
            get: () => [DESKTOP],
            set: () => {
                throw new Error("desktops-write-failed");
            },
        });
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-failed:desktops-write"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("keeps navigation nonfatal when the desktops surface is missing", () => {
        const { harness, controller } = setup();
        harness.desktopsThrows = new Error("kwin-workspace-surface-missing:desktops");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(
            countEvent(harness.logs, "workspace-desktops-unavailable:kwin-workspace-surface-missing:desktops"),
            1,
        );
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps cleanup nonfatal when removeDesktop throws mid-cleanup", () => {
        const { harness, controller, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        // Reach [desktop-1(occupied), desktop-2(owned empty)] then occupy the
        // trailing empty so a replacement desktop-3 is appended.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-cleanup-replenished"), 1);
        // The excess desktop-2 is removed by the next reconciliation, but the
        // removal throws.
        harness.removeDesktopThrows = new Error("remove-failed");
        focused.desktops = [DESKTOP];
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        harness.emitDesktopsChanged();
        assert.equal(countEvent(harness.logs, "workspace-cleanup-remove-failed:remove-failed"), 1);
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("defers desktop mutation during a live drag and performs it after drag completion", () => {
        const { harness, root, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);
        // Meta+0 while the drag is live defers the desktop creation: nothing is
        // created and no desktop list mutation occurs.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:navigate"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        // Shift+0 while the drag is live defers the whole move: the window does
        // not move before its required target exists.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:move"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        // Drag completion drains both requests: the trailing empty is created
        // and focused, then the window moves into it.
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        // The move's destination adoption settles on its yield and the
        // replacement is appended.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(countEvent(harness.logs, "workspace-cleanup-replenished"), 1);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("defers desktop mutation while a reconstruction is pending and performs it after it settles", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window();
        const second = window();
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        // Meta+0 while the reconstruction is pending defers the desktop
        // creation: nothing is created and no desktop list mutation occurs.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:navigate"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        // Shift+0 while the reconstruction is pending defers the whole move.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:move"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((first.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        // Settle the reconstruction; the final pending drop retries cleanup and
        // drains the deferred requests.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.ok(countEvent(harness.logs, "ownership-taken") >= 1);
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((first.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        void controller;
    });

    it("Meta+0 focuses the trailing-most owned empty when stale excess exists", () => {
        const { harness, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        // Build [desktop-1(occupied), desktop-2(occupied), desktop-3(owned
        // empty)]: Meta+0 then occupy the trailing empty so a replacement is
        // replenished.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 2);
        // Stale excess: desktop-2 becomes empty again before reconciliation
        // runs, leaving two owned empty trailing desktops (desktop-2 and
        // desktop-3).
        focused.desktops = [DESKTOP];
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        // Meta+0 must focus the trailing-most owned empty (desktop-3), the one
        // cleanup would retain, never the removable desktop-2.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-focused-existing"), 1);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-3");
        // Reconciliation then removes the excess desktop-2 without the current
        // desktop guard blocking it, leaving exactly one trailing empty.
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 1);
        assert.equal((harness.removedDesktops[0] as { id: string }).id, "desktop-2");
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
    });

    it("Shift+0 moves into the trailing empty then appends a replacement after it settles", () => {
        const { harness, root, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        // Meta+0 creates the sole trailing owned empty.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
        // Shift+0 moves the tiled window into the trailing empty; membership is
        // written synchronously and the destination adoption is yielded.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.yields.length, 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        // Nothing is appended before the move settles.
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal(harness.flushNextYield(), true);
        // The destination is now occupied; the destination reconstruction still
        // defers the replacement until it settles.
        assert.equal(harness.createDesktopCalls.length, 1);
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(countEvent(harness.logs, "workspace-cleanup-replenished"), 1);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("an occupancy event on the trailing empty replenishes a replacement", () => {
        const { harness } = setup();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        // A window arrives on the trailing empty: it is now occupied, so the
        // occupancy reconciliation must replenish a replacement once the
        // destination reconstruction settles.
        harness.currentDesktop = { id: "desktop-2", x11DesktopNumber: 2 };
        const trailing = { id: "desktop-2", x11DesktopNumber: 2 };
        const incoming = window({ desktops: [trailing] });
        harness.windows = [...(harness.windows as unknown[]), incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:reconstruction-pending"), 1);
        assert.equal(harness.createDesktopCalls.length, 1);
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(countEvent(harness.logs, "workspace-cleanup-replenished"), 1);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("reconciliation is idempotent under repeated triggers", () => {
        const { harness, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        // The focused trailing empty stays empty: repeated reconciliation
        // neither appends duplicates nor removes it.
        for (let index = 0; index < 4; index += 1) {
            harness.emitDesktopsChanged();
        }
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal(harness.removedDesktops.length, 0);
        // After the trailing empty is occupied and a replacement replenished,
        // repeated reconciliation stays stable at exactly one trailing empty.
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 2);
        for (let index = 0; index < 4; index += 1) {
            harness.emitDesktopsChanged();
        }
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("a desktop creation failure retains the valid existing state and logs", () => {
        const { harness, controller, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        // The trailing empty becomes occupied and the replacement create fails:
        // the failure is non-destructive, specifically logged, and the valid
        // existing desktop set is retained.
        harness.createDesktopThrows = new Error("create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("cleanup never deletes pre-existing, current, or visible desktops", () => {
        const { harness, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        harness.screensList = [OUTPUT, { ...OUTPUT, name: "screen-2" }];
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
        ];
        // The harness generates monotonic ids from here so the first create is
        // desktop-4, never colliding with the pre-existing desktops.
        harness.nextDesktopNumber = 3;
        // Meta+0 appends the trailing owned empty (desktop-4); desktop-2 and
        // desktop-3 are pre-existing and never owned.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        // Occupy it and replenish: [desktop-1(occupied), 2, 3,
        // desktop-4(occupied), desktop-5(owned empty)].
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 2);
        // desktop-4 (owned) becomes empty again and is current and visible on
        // every output: it must not be removed even though desktop-5 is the
        // kept replacement.
        focused.desktops = [DESKTOP];
        harness.currentDesktop = { id: "desktop-4", x11DesktopNumber: 4 };
        harness.currentDesktopValue = { id: "desktop-4", x11DesktopNumber: 4 };
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
            "desktop-4",
            "desktop-5",
        ]);
        // Once the user navigates away, desktop-4 is no longer visible and the
        // excess is removed; the pre-existing desktops and the kept replacement
        // are untouched.
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 1);
        assert.equal((harness.removedDesktops[0] as { id: string }).id, "desktop-4");
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
            "desktop-5",
        ]);
    });
});

describe("TileController per-workspace maximize", () => {
    const WORK_AREA = { x: 0, y: 0, width: 200, height: 200 };

    function maximizeSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly root: TestTile;
        readonly target: TestTile;
        readonly focused: TestWindow;
    } {
        const state = setup();
        state.harness.clientArea = WORK_AREA;
        return state;
    }

    function setFullscreen(subject: TestWindow, value: boolean): void {
        subject.fullScreen = value;
        subject.fullScreenChanged.emit();
    }

    it("covers with the work-area geometry and preserves the exact tree and tile slot", () => {
        const { harness, root, target, focused } = maximizeSetup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(focused, writes);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.deepEqual(target.windows, [focused]);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "maximize:enter preserved"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 1);
    });

    it("restores the tile geometry on the second toggle and clears the record", () => {
        const { harness, target, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, RECT);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        // A third toggle re-enters: the record was fully cleared.
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 2);
    });

    it("ignores drag and lifecycle events while maximized without placement or retile", () => {
        const { harness, controller, root, target, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.moveResizedChanged.emit();
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.yields.length, 0);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("no-ops the maximize command while the active window is fullscreen with a specific reason", () => {
        const { harness, focused } = maximizeSetup();
        focused.fullScreen = true;
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-ignored:fullscreen"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter preserved"), 0);
    });

    it("preserves the maximize record through a fullscreen round trip and re-covers on exit", () => {
        const { harness, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        setFullscreen(focused, true);
        assert.equal(countEvent(harness.logs, "fullscreen:enter preserved"), 1);
        setFullscreen(focused, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "maximize:re-covered"), 1);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.deepEqual(focused.frameGeometry, RECT);
    });

    it("refuses to maximize a sticky window", () => {
        const { harness, focused, target } = maximizeSetup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:sticky"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 0);
    });

    it("refuses to float a maximized window before any mutation", () => {
        const { harness, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:maximized"), 1);
        // The maximize cover and record stay intact: no restore, no unmanage.
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "float-completed"), 0);
    });

    it("refuses sticky on a maximized window before any mutation", () => {
        const { harness, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-rejected:maximized"), 1);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 0);
        assert.equal(countEvent(harness.logs, "float-completed"), 0);
    });

    it("refuses a workspace move while maximized before any mutation", () => {
        const { harness, focused, target } = maximizeSetup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(countEvent(harness.logs, "workspace-move-pending"), 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        // No restore happened: the maximize cover and record stay intact.
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.tile, target);
    });

    it("refuses a workspace move on a maximized window without inspecting its restore path", () => {
        const { harness, focused, target } = maximizeSetup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        focused.tile = null;
        target.windows = [];
        target.manage = () => false;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit restore failed:assignment-failed"), 0);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
    });

    it("clears the maximize record on close and proceeds with normal removal", () => {
        const { harness, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        // Live KWin lists the removed window in its former leaf until the
        // deferred one-shot yield collapses it.
        harness.emitRemoved(focused);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        target.windows = [];
        focused.tile = null;
        assert.equal(harness.flushNextYield(), true);
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
    });

    it("keeps unrelated window addition managed while another window is maximized", () => {
        const { harness, root, target, focused } = maximizeSetup();
        // A retained empty leaf lets automatic placement absorb an added
        // window without a structural split into the preserved slot.
        const empty = tile();
        empty.manage = (value) => {
            const win = value as TestWindow;
            win.tile = empty;
            empty.windows = [win];
            return true;
        };
        root.tiles = [target, empty];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
        assert.equal(incoming.tile, empty);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 0);
        // The unrelated window's removal proceeds through the normal removal
        // path and never gets globally blocked by the maximize record.
        harness.emitRemoved(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        empty.windows = [];
        incoming.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(focused.tile, target);
    });

    it("records an already-maximized tiled window at startup preserving its state and tree", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.deepEqual(target.windows, [focused]);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        // The Meta+M toggle must not simulate the native unmaximize that alone
        // clears a startup-native classification: it is refused, not restored.
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:startup-native"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.frameGeometry, RECT);
        // A real native unmaximize transition restores the tile geometry
        // through the startup record.
        focused.maximizeMode = 0;
        focused.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.deepEqual(focused.frameGeometry, RECT);
        assert.equal(focused.tile, target);
    });

    it("leaves an already-maximized untiled ordinary window unmanaged until its state clears", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [];
        root.tiles = [target];
        harness.root = root;
        harness.active = maximizedUntiled;
        harness.windows = [maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        // The Meta+M toggle must not simulate the native unmaximize that alone
        // clears a startup-native classification: it is refused, not cleared.
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:startup-native"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 0);
        assert.equal(maximizedUntiled.tile, null);
        // A real native unmaximize transition clears the classification and
        // unblocks the scope.
        maximizedUntiled.maximizeMode = 0;
        maximizedUntiled.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 1);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps a startup-native-maximized untiled window unmanaged through a fullscreen round trip", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [];
        root.tiles = [target];
        harness.root = root;
        harness.active = maximizedUntiled;
        harness.windows = [maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        setFullscreen(maximizedUntiled, true);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        setFullscreen(maximizedUntiled, false);
        // The fullscreen exit must not place the still-classified window:
        // ordinary placement is skipped while the startup record persists.
        assert.equal(countEvent(harness.logs, "fullscreen:exit newly managed"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 0);
        // A real native unmaximize transition then clears the classification.
        maximizedUntiled.maximizeMode = 0;
        maximizedUntiled.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 1);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(controller.isEnabled, true);
    });

    it("refuses scope reconstruction while a startup-native-maximized window is classified", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [];
        root.tiles = [target];
        harness.root = root;
        harness.active = maximizedUntiled;
        harness.windows = [maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        // The untiled window leaves the only leaf empty while its scope is
        // classified, so the occupancy bijection fails and a reconstruction
        // would arm - but the startup classification refuses it.
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(controller.isEnabled, true);
    });

    it("bails non-destructively and logs a reason when the preserved slot is gone", () => {
        const { harness, root, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        focused.tile = null;
        target.windows = [];
        root.tiles = [];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:exit restore failed:tile-missing"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.frameGeometry, WORK_AREA);
    });

    it("rejects with a specific reason when there is no active window", () => {
        const { harness } = maximizeSetup();
        harness.active = null;
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:no-active-window"), 1);
    });

    it("keeps repeated maximize toggles idempotent", () => {
        const { harness, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:enter preserved"), 2);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 2);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
    });
});
