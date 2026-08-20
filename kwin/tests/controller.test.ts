import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type RectCapability } from "../src/boundary";
import {
    DEFAULT_WORKSPACE_MODE,
    SessionOutputKeys,
    TileController,
    WORKSPACE_MODE_CONFIG_KEY,
    WORKSPACE_MODES,
    outputTuple,
    parseWorkspaceMode,
    type ControllerEnvironment,
} from "../src/controller";

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
    connect(callback: (geometry?: RectCapability) => void): void;
    disconnect(callback: (geometry?: RectCapability) => void): void;
    emit(geometry?: RectCapability): void;
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
    const callbacks = new Set<(geometry?: RectCapability) => void>();
    return {
        connect: (next) => {
            callbacks.add(next);
        },
        disconnect: (next) => {
            callbacks.delete(next);
        },
        emit: (geometry) => {
            for (const callback of callbacks) {
                callback(geometry);
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
    readonly configValues = new Map<string, unknown>();
    readonly scheduled: { delayMs: number; callback: () => void; cancelled: boolean }[] = [];
    readonly activeWrites: unknown[] = [];
    yieldResult = true;
    readonly yields: YieldEntry[] = [];
    added: ((value: unknown) => void) | undefined;
    removed: ((value: unknown) => void) | undefined;
    screensChanged: (() => void) | undefined;
    desktopChanged: ((previous: unknown, current: unknown, output: unknown) => void) | undefined;
    desktopsChanged: (() => void) | undefined;
    desktopsList: unknown = [DESKTOP];
    desktopReads = 0;
    screensList: unknown = [OUTPUT];
    readonly screenReadValues: unknown[] = [];
    activeScreenValue: unknown = null;
    currentDesktopValue: unknown = DESKTOP;
    createDesktopThrows: Error | undefined;
    removeDesktopThrows: Error | undefined;
    setCurrentDesktopThrows: Error | undefined;
    desktopsThrows: Error | undefined;
    // Optional per-output current-desktop read model (global-unique tests). When
    // set, `currentDesktopForOutput` reports the override's value per output
    // (mirroring KWin's independent per-output current desktop); otherwise the
    // legacy single global `currentDesktop` value is reported for every output,
    // preserving existing single-output test behavior.
    currentDesktopForOutputOverride: ((output: unknown) => unknown) | undefined;
    readonly createDesktopCalls: Array<{ position: number; name: string }> = [];
    readonly removedDesktops: unknown[] = [];
    onDesktopRemoved: ((desktop: unknown) => void) | undefined;
    readonly currentDesktopWrites: unknown[] = [];
    readonly currentDesktopForScreenWrites: Array<{ desktop: unknown; output: unknown }> = [];
    // Per-output current desktop recorded from setCurrentDesktopForScreen writes
    // (test assertion only; the environment's read seam still models a global
    // current so existing single-output behavior is unchanged).
    readonly currentDesktopByOutput = new Map<unknown, unknown>();
    nextDesktopNumber = 1;
    throwOnLog = false;
    readonly logs: string[] = [];
    readonly showOutlineCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
    hideOutlineCalls = 0;

    environment(): ControllerEnvironment {
        return {
            activeWindow: () => this.active,
            setActiveWindow: (window) => {
                this.writtenActive = window;
                this.activeWrites.push(window);
            },
            currentDesktopForOutput: (output) =>
                this.currentDesktopForOutputOverride !== undefined
                    ? this.currentDesktopForOutputOverride(output)
                    : this.currentDesktop,
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
                this.desktopReads += 1;
                if (this.desktopsThrows !== undefined) {
                    throw this.desktopsThrows;
                }
                return this.desktopsList;
            },
            screens: () => this.screenReadValues.shift() ?? this.screensList,
            activeScreen: () => this.activeScreenValue,
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
                this.onDesktopRemoved?.(desktop);
            },
            setCurrentDesktop: (desktop) => {
                if (this.setCurrentDesktopThrows !== undefined) {
                    throw this.setCurrentDesktopThrows;
                }
                this.currentDesktopWrites.push(desktop);
                this.currentDesktopValue = desktop;
            },
            setCurrentDesktopForScreen: (desktop, output) => {
                if (this.setCurrentDesktopThrows !== undefined) {
                    throw this.setCurrentDesktopThrows;
                }
                this.currentDesktopForScreenWrites.push({ desktop, output });
                this.currentDesktopByOutput.set(output, desktop);
                this.currentDesktopWrites.push(desktop);
                this.currentDesktopValue = desktop;
            },
            onDesktopsChanged: (handler) => {
                this.desktopsChanged = handler;
            },
            watchInteractiveWindow: (target, started, finished, stepped, moveResizedChanged, invalidated) => {
                const connected: Array<[string, (geometry: RectCapability) => void]> = [];
                const attach = (name: string, handler: (geometry: RectCapability) => void): boolean => {
                    let value: unknown;
                    try {
                        value = (target as unknown as Record<string, unknown>)[name];
                        (value as { connect: (next: (geometry: RectCapability) => void) => void }).connect(handler);
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
                const attempts: ReadonlyArray<readonly [string, (geometry: RectCapability) => void]> = [
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
                                (
                                    target as unknown as Record<
                                        string,
                                        { disconnect: (next: (geometry: RectCapability) => void) => void }
                                    >
                                )[name]!.disconnect(handler);
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
            readConfig: (key, defaultValue) => {
                const stored = this.configValues.get(key);
                return stored === undefined ? defaultValue : stored;
            },
            log: (message) => {
                if (this.throwOnLog) {
                    throw new Error("log sink failed");
                }
                this.logs.push(message);
            },
            showOutline: (x, y, w, h) => {
                this.showOutlineCalls.push({ x, y, w, h });
            },
            hideOutline: () => {
                this.hideOutlineCalls += 1;
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

    emitCurrentDesktopChanged(previous: unknown, current: unknown, output: unknown): void {
        if (this.desktopChanged !== undefined) {
            this.desktopChanged(previous, current, output);
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

// Create one owned trailing empty through Meta+Shift+0 (creating desktop-2,
// since none exists yet) and move the focused floating window into it, then
// return the window to desktop-1 and let one more cleanup dispatch settle.
// Under the trailing-empty reuse model, landing on desktop-2 immediately
// replenishes a fresh trailing empty desktop-3 (synchronously, since the
// move is floating), and once the window returns to desktop-1, the vacated
// non-trailing desktop-2 is removed on the next dispatch, leaving desktop-3
// as the sole owned trailing empty (Q-Manual: non-trailing empties stay
// cleanup-eligible). Two desktops are created in total (desktop-2, then its
// replacement desktop-3), and one is removed (desktop-2); callers that care
// about the delta since calling this helper should reset
// harness.removedDesktops afterward.
function ownTrailingEmpty(harness: Harness): void {
    const focused = harness.active as TestWindow;
    const origin = focused.tile as unknown as TestTile | null;
    if (origin !== null) {
        origin.unmanage = (_value: unknown) => {
            focused.tile = null;
            origin.windows = [];
            return true;
        };
    }
    invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
    invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
    focused.desktops = [DESKTOP];
    harness.currentDesktop = DESKTOP;
    harness.currentDesktopValue = DESKTOP;
    harness.emitDesktopsChanged();
}

// Occupied directional target for a swap: the active window in `source` and a
// second in-scope window in `target`, both with the attach tile writer installed
// so guarded `window.tile` writes maintain the tile window lists exactly as
// setTileCompatibility does on KWin. The shared `writes` array records every
// guarded write in deterministic order.


function invokeShortcut(harness: Harness, name: string): void {
    const shortcut = harness.shortcuts.find((entry) => entry.name === name);
    if (shortcut === undefined) {
        throw new Error(`missing registered shortcut: ${name}`);
    }
    shortcut.handler();
}

// Simulates KWin's tile window-list maintenance on a guarded `window.tile`
// write (the attach half of setTileCompatibility): the window leaves the
// previous tile's window list and joins the target's. Each write is recorded
// so tests can assert deterministic order and count.




// The live minimum-split floor failure: four full-width rows 245px tall inside
// a 980px working height (y 44..289, 289..534, 534..779, 779..1024). A 50/50
// vertical split of a 245px row yields 122.5px halves, below KWin's 15%
// working-height floor (147px), so the split must be refused before mutating.



function countEvent(logs: readonly string[], event: string): number {
    return logs.filter((entry) => entry === `plasma-auto-tiler:${event}`).length;
}

// A dwindle(2) scope H[a, b] where dragging `a` onto `b` with a left-horizontal
// split leaves `a` floating (the drop manage reports success but never
// assigns), so the occupancy bijection fails on the origin collapse and queues
// a full reconstruction instead of the steady-state acceptance path.




// Install a splitter that mirrors KWin's dwindle chain construction: each
// split turns the tile into a layout with two children whose geometry follows
// the requested orientation (1 = horizontal, 2 = vertical), and installs the
// same splitter on both children so the chain can keep growing.

// Install a configurable splitter that models the KWin minimum-geometry
// boundary. While `state.rejecting` is true it yields a split result whose
// children carry invalid geometry (the strict `orderedChildren` check rejects
// the pair) and does not realize the split in the live tree, so a capacity
// rejection leaves the scope structurally unchanged and retryable. When
// `state.rejecting` is false it behaves exactly like `installDwindleSplitter`,
// realizing a valid dwindle chain.



// Install a splitter that returns placeholder children whose own split()
// throws, while realizing the live tree with distinct children under
// `tile.tiles`. A rebuild that retains a returned child handle and splits it
// on a later structural call fails here; the guarded rebuild re-resolves the
// root and fresh-decodes `tile.tiles` after every split, so it succeeds.



describe("TileController workspace mode and per-output seams (Unit 04)", () => {
    it("parses workspaceMode: missing selects per-output-local, each valid mode parses, invalid falls back", () => {
        assert.equal(DEFAULT_WORKSPACE_MODE, "per-output-local");
        assert.deepEqual(WORKSPACE_MODES, ["per-output-local", "global-unique", "shared"]);
        for (const missing of [undefined, null, ""]) {
            const parsed = parseWorkspaceMode(missing);
            assert.equal(parsed.mode, "per-output-local");
            assert.deepEqual(parsed.diagnostics, []);
        }
        for (const mode of WORKSPACE_MODES) {
            const parsed = parseWorkspaceMode(mode);
            assert.equal(parsed.mode, mode);
            assert.deepEqual(parsed.diagnostics, []);
        }
        const fallback = parseWorkspaceMode("bogus-mode");
        assert.equal(fallback.mode, "per-output-local");
        assert.deepEqual(fallback.diagnostics, ["workspace-mode-invalid:fallback-per-output-local"]);
    });

    it("selects workspaceMode from readConfig at startup with default and diagnostic fallback", () => {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.workspaceModeSnapshot(), "global-unique");
        assert.equal(countEvent(harness.logs, "workspace-mode-invalid:fallback-per-output-local"), 0);

        const missing = new Harness();
        const missingController = new TileController(missing.environment());
        missingController.start();
        assert.equal(missingController.workspaceModeSnapshot(), "per-output-local");
        assert.equal(countEvent(missing.logs, "workspace-mode-invalid:fallback-per-output-local"), 0);

        const invalid = new Harness();
        invalid.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "not-a-mode");
        const invalidController = new TileController(invalid.environment());
        invalidController.start();
        assert.equal(invalidController.workspaceModeSnapshot(), "per-output-local");
        assert.equal(countEvent(invalid.logs, "workspace-mode-invalid:fallback-per-output-local"), 1);
    });

    it("routes navigation through setCurrentDesktopForScreen on the active window's output", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopForScreenWrites.length, 1);
        assert.equal((harness.currentDesktopForScreenWrites[0]?.desktop as { id: string }).id, "desktop-2");
        assert.equal(harness.currentDesktopForScreenWrites[0]?.output, OUTPUT);
        assert.equal(harness.currentDesktopWrites.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
    });

    it("falls back to the global current-desktop write when no active window output exists", () => {
        const { harness } = setup();
        harness.active = null;
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 1);
        assert.equal((harness.currentDesktopWrites[0] as { id: string }).id, "desktop-2");
    });

    it("preserves the output argument of currentDesktopChanged through the typed boundary", () => {
        const harness = new Harness();
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.currentDesktopChangeOutput(), null);
        harness.emitCurrentDesktopChanged(null, DESKTOP, OUTPUT);
        assert.equal(controller.currentDesktopChangeOutput(), OUTPUT);
        // A non-output argument is never adopted as the affected output.
        harness.emitCurrentDesktopChanged(null, DESKTOP, null);
        assert.equal(controller.currentDesktopChangeOutput(), OUTPUT);
    });

    it("derives the output tuple from manufacturer/model/serial/name", () => {
        assert.equal(outputTuple(OUTPUT), "KDE\u0000test\u00001\u0000screen-1");
        assert.equal(outputTuple({ ...OUTPUT }), outputTuple(OUTPUT));
        assert.notEqual(outputTuple({ ...OUTPUT, name: "other" }), outputTuple(OUTPUT));
        assert.notEqual(outputTuple({ ...OUTPUT, serialNumber: "2" }), outputTuple(OUTPUT));
    });

    it("assigns deterministic session output keys with first-seen distinct keys for same-tuple outputs", () => {
        const registry = new SessionOutputKeys();
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        registry.rebuild([e, l]);
        const keyE = registry.keyFor(e);
        const keyL = registry.keyFor(l);
        assert.notEqual(keyE, undefined);
        assert.notEqual(keyL, undefined);
        assert.notEqual(keyE, keyL);
        // Same first-seen order across a rebuild is stable.
        registry.rebuild([e, l]);
        assert.equal(registry.keyFor(e), keyE);
        assert.equal(registry.keyFor(l), keyL);
        // A surviving output keeps its key; a distinct tuple gets its own key.
        const a = { ...OUTPUT, name: "screen-a" };
        const b = { ...OUTPUT, name: "screen-b" };
        const other = new SessionOutputKeys();
        other.rebuild([a, b]);
        const keyA = other.keyFor(a);
        const keyB = other.keyFor(b);
        assert.notEqual(keyA, undefined);
        assert.notEqual(keyB, undefined);
        assert.notEqual(keyA, keyB);
        other.rebuild([a, b]);
        assert.equal(other.keyFor(a), keyA);
        assert.equal(other.keyFor(b), keyB);
        // An output tuple rename (name change) is a new physical identity per
        // spec E (matched by the ordered 4-tuple), so it gets a fresh key and
        // never reuses another output's key.
        const renamed = { ...a, name: "screen-a2" };
        other.rebuild([renamed, b]);
        assert.notEqual(other.keyFor(renamed), keyA);
        assert.notEqual(other.keyFor(renamed), keyB);
        assert.equal(other.keyFor(b), keyB);
    });

    it("resolves distinct equivalent output wrappers by tuple, never by object identity", () => {
        // KWin can expose the same physical output through distinct QJS wrappers
        // (workspace.screens, a window's `output` property, workspace.activeScreen).
        // A foreign wrapper with the same physical tuple resolves to the same
        // key as the rebuild's own object, and a colliding tuple resolves to the
        // first-seen key deterministically.
        const registry = new SessionOutputKeys();
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        registry.rebuild([e, l]);
        const keyE = registry.keyFor(e);
        const keyL = registry.keyFor(l);
        // Distinct equivalent objects (spread copies) for both outputs resolve
        // deterministically with no identity dependency. The colliding tuple
        // cannot distinguish the two physical outputs, so every foreign wrapper
        // of that tuple resolves to the first-seen key (spec E collision).
        assert.equal(registry.keyFor({ ...e }), keyE);
        assert.equal(registry.keyFor({ ...e }), keyE);
        assert.equal(registry.keyFor({ ...l }), keyE);
        assert.equal(registry.keyFor({ ...l }), keyE);
        // The rebuild's own identity objects still resolve to their distinct
        // first-seen keys.
        assert.equal(registry.keyFor(e), keyE);
        assert.equal(registry.keyFor(l), keyL);
        // Distinct equivalent objects with distinct tuples keep distinct keys.
        const a = { ...OUTPUT, name: "screen-a" };
        const b = { ...OUTPUT, name: "screen-b" };
        const registry2 = new SessionOutputKeys();
        registry2.rebuild([a, b]);
        const keyA = registry2.keyFor(a);
        const keyB = registry2.keyFor(b);
        assert.equal(registry2.keyFor({ ...a }), keyA);
        assert.equal(registry2.keyFor({ ...b }), keyB);
        // A foreign wrapper of a colliding same-tuple pair resolves to the
        // first-seen key (spec E collision is inherently ambiguous).
        const registry3 = new SessionOutputKeys();
        const e3 = { ...OUTPUT, name: "screen-a" };
        const l3 = { ...OUTPUT, name: "screen-a" };
        registry3.rebuild([e3, l3]);
        const keyE3 = registry3.keyFor(e3);
        const keyL3 = registry3.keyFor(l3);
        assert.notEqual(keyE3, undefined);
        assert.notEqual(keyL3, undefined);
        assert.notEqual(keyE3, keyL3);
        assert.equal(registry3.keyFor({ ...e3 }), keyE3);
    });

    it("resolves a stale or unknown output safely to undefined with one diagnostic per tuple", () => {
        // A wrapper whose tuple matches no current rebuild entry (a disconnected
        // output or one never seen) resolves to undefined and is reported once
        // per session tuple through the diagnostic callback.
        const reported: string[] = [];
        const registry = new SessionOutputKeys((tuple) => {
            reported.push(tuple);
        });
        const a = { ...OUTPUT, name: "screen-a" };
        const b = { ...OUTPUT, name: "screen-b" };
        registry.rebuild([a, b]);
        assert.notEqual(registry.keyFor(a), undefined);
        // A stale wrapper for a disconnected output resolves to undefined; the
        // still-connected output keeps resolving by identity.
        const stale = { ...a };
        registry.rebuild([b]);
        assert.notEqual(registry.keyFor(b), undefined);
        assert.equal(registry.keyFor(stale), undefined);
        assert.equal(registry.keyFor({ ...a }), undefined);
        // An unknown tuple (never seen) is also a safe undefined.
        assert.equal(registry.keyFor({ ...OUTPUT, name: "screen-z" }), undefined);
        assert.equal(registry.keyFor({ ...OUTPUT, name: "screen-z" }), undefined);
        // Two distinct unknown/stale tuples were reported exactly once each.
        assert.equal(reported.length, 2);
        assert.equal(reported[0], outputTuple(stale));
        assert.equal(reported[1], outputTuple({ ...OUTPUT, name: "screen-z" }));
        // Connected-output lookups never emit an unknown diagnostic.
        assert.notEqual(registry.keyFor(b), undefined);
        assert.equal(reported.length, 2);
    });

    it("exposes deterministic session output keys from the controller and keeps them across screensChanged", () => {
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        const harness = new Harness();
        harness.screensList = [e, l];
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(e);
        const keyL = controller.outputKeyFor(l);
        assert.notEqual(keyE, undefined);
        assert.notEqual(keyL, undefined);
        assert.notEqual(keyE, keyL);
        harness.screensChanged?.();
        assert.equal(controller.outputKeyFor(e), keyE);
        assert.equal(controller.outputKeyFor(l), keyL);
    });

    it("resolves distinct window/activeScreen output wrappers through the controller and reports stale ones once", () => {
        // A window's `output` property and `workspace.activeScreen` can be
        // distinct QJS wrappers of the physical outputs observed in
        // `workspace.screens`. The controller resolves them by physical tuple
        // (never object identity) and reports a stale/unknown output wrapper
        // with one diagnostic per session tuple.
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        const harness = new Harness();
        harness.screensList = [e, l];
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(e);
        const keyL = controller.outputKeyFor(l);
        assert.notEqual(keyE, undefined);
        assert.notEqual(keyL, undefined);
        // A distinct wrapper object with the same physical tuple as a connected
        // screen resolves to that screen's deterministic first-seen key.
        const foreignE = { ...e };
        assert.equal(controller.outputKeyFor(foreignE), keyE);
        assert.equal(controller.outputKeyFor({ ...e }), keyE);
        // The rebuild's own identity objects keep their distinct first-seen
        // keys even under a same-tuple collision.
        assert.equal(controller.outputKeyFor(e), keyE);
        assert.equal(controller.outputKeyFor(l), keyL);
        // A stale wrapper (no matching connected tuple) is a safe undefined and
        // emits exactly one diagnostic for its tuple.
        const stale = { ...e, name: "screen-removed" };
        assert.equal(controller.outputKeyFor(stale), undefined);
        assert.equal(controller.outputKeyFor({ ...stale }), undefined);
        assert.equal(countEvent(harness.logs, "workspace-output-key-unavailable"), 1);
    });

    it("migrates startup state non-destructively: pre-existing desktops resolve into the session primary's list, and the trailing one is protected", () => {
        // Per-output-local reconciliation rebuilds the mapping and enforces
        // the trailing-empty invariant (Q-Domain): the pre-existing set is
        // adopted as logical entries with no owned desktop created.
        // Pre-existing desktops are never marked owned, and the
        // structurally-last one is protected as the trailing empty even
        // though it is invisible.
        const harness = new Harness();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        harness.nextDesktopNumber = 2;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), []);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
        // Repeated reconciliation leaves the set untouched (idempotent).
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), []);
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, 0);
    });

    it("desktop identity is id-based: a renamed/reordered wrapper keeps ownership", () => {
        const { harness, controller } = setup();
        // ownTrailingEmpty settles to a single owned trailing empty
        // desktop-3 (desktop-2 was created, occupied, replenished by
        // desktop-3, then removed once vacated and invisible).
        ownTrailingEmpty(harness);
        harness.removedDesktops.length = 0;
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // Make desktop-3 current so cleanup cannot remove it, isolating
        // identity tracking from removal eligibility (ownership plays no
        // role in removal, but identity is still tracked by id).
        harness.currentDesktop = { id: "desktop-3", x11DesktopNumber: 3 };
        harness.currentDesktopValue = { id: "desktop-3", x11DesktopNumber: 3 };
        // Simulate a rename/reorder: a fresh wrapper for the owned desktop
        // (same id, new number) placed at a different position. Identity is
        // the id string, so ownership is still recognized after the
        // reconciliation rebuild.
        harness.desktopsList = [
            { id: "desktop-3", x11DesktopNumber: 9 },
            { id: "desktop-1", x11DesktopNumber: 1 },
        ];
        const createsBefore = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, createsBefore);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-3"]);
    });

    it("preserves one-output logical behavior through the per-output migration", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        // Move-follow writes membership then follows on the single output.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal(harness.currentDesktopForScreenWrites.length, 1);
        assert.equal(harness.currentDesktopForScreenWrites[0]?.output, OUTPUT);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // Navigation also writes through the per-output seam on the single output.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        assert.equal(harness.currentDesktopForScreenWrites.length, 2);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-1");
    });
});

describe("TileController per-output-local workspaces (Unit 05)", () => {
    const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
    const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
    const DESKTOP_1 = { id: "desktop-1", x11DesktopNumber: 1 };
    const DESKTOP_2 = { id: "desktop-2", x11DesktopNumber: 2 };

    // Two-output session where every window starts untiled on desktop-1 and the
    // global current desktop is null so no scope is owned and no tiling
    // reconstruction is armed. All moves below are floating moves: membership
    // write + follow only, never a tile-tree mutation. There is no replenish,
    // ever: startup reconciliation creates nothing. desktop-1 is the sole
    // pre-existing desktop and resolves into E's list (session primary); L
    // starts with no desktops and gets its own local list purely from
    // move/navigate actions below.
    function twoOutputSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly wE: TestWindow;
        readonly wL1: TestWindow;
        readonly wL2: TestWindow;
        readonly wL3: TestWindow;
    } {
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wE = window({ output: OUTPUT_E });
        const wL1 = window({ output: OUTPUT_L });
        const wL2 = window({ output: OUTPUT_L });
        const wL3 = window({ output: OUTPUT_L });
        harness.windows = [wE, wL1, wL2, wL3];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller, wE, wL1, wL2, wL3 };
    }

    // Float a window through the sticky toggle (floating on the desktop it
    // belongs to) and then clear the all-desktops pin: the window stays
    // floating and movable, with no tile tree involved.
    function makeFloating(harness: Harness, win: TestWindow): void {
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.active = win;
        const enabledBaseline = countEvent(harness.logs, "sticky-enabled");
        const disabledBaseline = countEvent(harness.logs, "sticky-disabled");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-enabled"), enabledBaseline + 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), disabledBaseline + 1);
    }

    function moveToTrailing(harness: Harness, win: TestWindow): void {
        harness.currentDesktop = DESKTOP_1;
        harness.active = win;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
    }

    function twoLocalLists(
        controller: TileController,
    ): [readonly string[], readonly string[]] {
        const snapshot = controller.localWorkspaceSnapshot();
        const lists = Object.values(snapshot);
        return [lists[0] ?? [], lists[1] ?? []];
    }

    it("creates no automatic trailing empty at startup (no replenish, ever); every pre-existing desktop resolves to the session primary output", () => {
        // No replenish exists any more: a fresh two-output startup creates
        // nothing. Every pre-existing desktop is unassigned, so it resolves
        // into the session primary output's list (spec E hotplug), never the
        // other output's.
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.removedDesktops.length, 0);
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2"]);
        assert.deepEqual([...lIds], []);
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        const [eAgain, lAgain] = twoLocalLists(controller);
        assert.deepEqual([...eAgain], ["desktop-1", "desktop-2"]);
        assert.deepEqual([...lAgain], []);
    });

    it("reconciles a one-desktop two-output startup with no automatic trailing empty on either output", () => {
        // Regression coverage retargeted: the singleton global-desktop guard
        // used to skip per-output-local reconciliation entirely; it must
        // still run the mapping rebuild even for a single pre-existing
        // desktop across multiple outputs, but with no replenish it creates
        // nothing and never removes the pre-existing desktop.
        const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
        const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual(
            (harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id),
            ["desktop-1"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], []);
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1"]);
        assert.deepEqual([...lIds], []);
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("keeps two-output local sets distinct and navigates only the active output's list", () => {
        // Every default test window starts occupying desktop-1 (the shared
        // test fixture default), so under the trailing-empty reuse model
        // each Shift+0 below either reuses the target output's existing
        // empty trailing desktop or creates one when none exists yet, and
        // each move that vacates a domain's current trailing empty
        // immediately replenishes it. wE's own move ends up reusing E's own
        // still-empty desktop-3 (created by an earlier cross-output
        // replenish) rather than creating a fifth desktop.
        const { harness, controller, wE, wL1, wL2, wL3 } = twoOutputSetup();
        for (const win of [wE, wL1, wL2, wL3]) {
            makeFloating(harness, win);
        }
        moveToTrailing(harness, wL1);
        moveToTrailing(harness, wL2);
        moveToTrailing(harness, wL3);
        moveToTrailing(harness, wE);
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-3", "desktop-7"]);
        assert.deepEqual([...lIds], ["desktop-2", "desktop-4", "desktop-5", "desktop-6"]);
        assert.equal(new Set([...eIds, ...lIds]).size, eIds.length + lIds.length);

        // Selection on E changes only E's current desktop.
        harness.active = wE;
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-3");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        assert.equal(
            (harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1]?.output as {
                name: string;
            }).name,
            "screen-e",
        );

        // Selection on L changes only L's current desktop.
        harness.active = wL1;
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-4");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_E), false);
    });

    it("reconciliation is stable across repeated triggers and creates or removes nothing extra", () => {
        // Every default test window starts occupying desktop-1, so wE's move
        // creates desktop-2 (occupied) and its replenishment desktop-3
        // (E's trailing empty); L has no desktops yet, so the same cleanup
        // dispatch also seeds its own initial trailing empty desktop-4
        // (Q-Domain: one trailing empty per connected output). wL1's later
        // move reuses desktop-4 and replenishes desktop-5 as L's trailing.
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        let [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lIds], ["desktop-4", "desktop-5"]);
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lIds], ["desktop-4", "desktop-5"]);
    });

    it("Meta+Shift+0 creates a new desktop on the active output's list and moves into it, and cleanup seeds L's own trailing empty", () => {
        // desktop-1 starts occupied by every default test window (wE, wL1,
        // wL2, wL3), so E's domain has no reusable trailing empty and
        // Shift+0 creates desktop-2, moves wE in, and the same cleanup
        // dispatch replenishes desktop-3 as E's new trailing empty and seeds
        // L's own initial trailing empty desktop-4 (Q-Domain: one trailing
        // empty per connected output, maintained even for an output with no
        // moves of its own yet).
        const { harness, controller, wE } = twoOutputSetup();
        makeFloating(harness, wE);
        harness.currentDesktopByOutput.clear();
        moveToTrailing(harness, wE);
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-2");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        for (const write of harness.currentDesktopForScreenWrites) {
            assert.equal(write.output, OUTPUT_E);
        }
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lIds], ["desktop-4"]);
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-workspace-0"),
            true,
        );
    });

    it("refuses sticky, fullscreen, and maximized per-output moves before any mutation", () => {
        const sticky = twoOutputSetup();
        makeFloating(sticky.harness, sticky.wE);
        const enabledBaseline = countEvent(sticky.harness.logs, "sticky-enabled");
        invokeShortcut(sticky.harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(sticky.harness.logs, "sticky-enabled"), enabledBaseline + 1);
        const createsBefore = sticky.harness.createDesktopCalls.length;
        sticky.harness.active = sticky.wE;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(sticky.harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(sticky.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(sticky.harness.createDesktopCalls.length, createsBefore);

        const fullscreen = twoOutputSetup();
        makeFloating(fullscreen.harness, fullscreen.wE);
        const createsFs = fullscreen.harness.createDesktopCalls.length;
        fullscreen.wE.fullScreen = true;
        fullscreen.harness.active = fullscreen.wE;
        invokeShortcut(fullscreen.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(fullscreen.harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(fullscreen.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(fullscreen.harness.createDesktopCalls.length, createsFs);

        const maximized = setup();
        maximized.harness.screensList = [OUTPUT_E, OUTPUT_L];
        maximized.harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        const createsMax = maximized.harness.createDesktopCalls.length;
        invokeShortcut(maximized.harness, "plasma-auto-tiler-maximize");
        invokeShortcut(maximized.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(maximized.harness.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(maximized.harness.currentDesktopWrites.length, 0);
        assert.equal(maximized.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(maximized.harness.createDesktopCalls.length, createsMax);
    });

    it("marks a removed output's owned empties as cleanup candidates once it disconnects, and a replug creates nothing (no replenish)", () => {
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        // Under the trailing-empty reuse model wE's move replenishes E's
        // list to [desktop-1, desktop-2, desktop-3] (desktop-2 occupied by
        // wE, desktop-3 the fresh trailing empty) and wL1's move replenishes
        // L's list to [desktop-4, desktop-5]. Protect desktop-2 (E's owned,
        // occupied, non-trailing desktop) as E's own distinct current
        // desktop so it survives while E stays connected, then vacate it
        // externally (as if the window moved without going through the
        // controller) so it is empty but still shown current on E. L's own
        // real current desktop (desktop-4, where wL1 actually sits) is
        // preserved unchanged through the override so nothing artificially
        // protects an unrelated desktop.
        const survivorRealCurrent = harness.currentDesktopByOutput.get(OUTPUT_L);
        harness.currentDesktopForOutputOverride = (output) =>
            output === OUTPUT_E
                ? { id: "desktop-2", x11DesktopNumber: 2 }
                : (survivorRealCurrent as { id: string; x11DesktopNumber: number });
        harness.currentDesktopValue = survivorRealCurrent as { id: string; x11DesktopNumber: number };
        wE.desktops = [DESKTOP_1];
        const survivorCurrent = harness.currentDesktopByOutput.get(OUTPUT_L);
        const [, survivorList] = twoLocalLists(controller);
        harness.removedDesktops.length = 0;
        // Disconnect E: its still-empty owned desktop-2 is no longer visible
        // (E is dropped from screens()) and becomes a cleanup candidate; E's
        // trailing desktop-3 is also orphaned (its domain is dropped from
        // the mapping) but stays invisible-empty too, so both are removed;
        // L's mapping and current desktop are unchanged and the pre-existing
        // desktop-1 is never removed.
        harness.screensList = [OUTPUT_L];
        harness.screensChanged?.();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-3"],
        );
        const after = controller.localWorkspaceSnapshot();
        const afterLists = Object.values(after);
        assert.deepEqual(afterLists[0] ?? [], survivorList);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_L), survivorCurrent);
        // Replug the identical tuple: matched by first-seen order, it gets its
        // key back. With no replenish beyond the trailing-empty invariant,
        // the pre-existing, unassigned desktop-1 resolves back to E (the
        // session primary), then E's cleanup dispatch replenishes its own
        // trailing empty since desktop-1 is occupied (by wL2/wL3, never
        // moved); L is untouched.
        harness.screensList = [OUTPUT_L, OUTPUT_E];
        harness.screensChanged?.();
        assert.equal(controller.outputKeyFor(OUTPUT_E), "output-0");
        assert.equal(controller.outputKeyFor(OUTPUT_L), "output-1");
        const replug = controller.localWorkspaceSnapshot();
        assert.deepEqual(
            Object.values(replug).map((list) => [...list]).sort(),
            [["desktop-1", "desktop-6"], ["desktop-4", "desktop-5"]],
        );
        assert.deepEqual(
            [...controller.ownedDesktopIdSnapshot()].sort(),
            ["desktop-4", "desktop-5", "desktop-6"],
        );
    });

    it("removes a non-owned pre-existing desktop left orphaned after its primary output disconnects", () => {
        // desktop-1 and desktop-2 both pre-exist the controller (never
        // plugin-created, so never in ownedDesktopIds) and both resolve into
        // E's list (session primary); neither holds any window. currentDesktop
        // is null through startup so visibility is unreadable and the startup
        // cleanup dispatch defers (no create/replenish), matching
        // twoOutputSetup's own pattern.
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.windows = [];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const [eIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], []);
        // Make current-desktop state readable (desktop-2 current on every
        // output), then disconnect E (the primary): its whole local list,
        // including the non-owned desktop-1, is dropped from the mapping
        // (rebuildLocalMapping). L, the sole remaining connected output,
        // reports desktop-2 current (matching the global current), so
        // desktop-1 is empty and invisible on every connected output and
        // must be removed even though it was never in ownedDesktopIds - the
        // structural, ownership-independent sweep this fix adds.
        harness.currentDesktop = DESKTOP_2;
        harness.currentDesktopValue = DESKTOP_2;
        harness.removedDesktops.length = 0;
        harness.screensList = [OUTPUT_L];
        harness.screensChanged?.();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-1"],
        );
    });

    it("keeps per-output local lists id-keyed across a desktop rename/reorder", () => {
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        harness.removedDesktops.length = 0;
        const before = controller.localWorkspaceSnapshot();
        // Under the trailing-empty reuse model each move's cleanup dispatch
        // replenishes a fresh trailing empty, so E ends up owning
        // [desktop-1, desktop-2, desktop-3] and L owning [desktop-4,
        // desktop-5] before the rename. Simulate a rename/reorder: the same
        // desktop ids, all still present, with new numbers in a different
        // global order. Identity is the id string, so the mapping is
        // unchanged and no owned desktop is removed.
        harness.desktopsList = [
            { id: "desktop-3", x11DesktopNumber: 30 },
            { id: "desktop-5", x11DesktopNumber: 50 },
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-4", x11DesktopNumber: 40 },
            { id: "desktop-2", x11DesktopNumber: 20 },
        ];
        harness.emitDesktopsChanged();
        assert.deepEqual(controller.localWorkspaceSnapshot(), before);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("disambiguates same-tuple outputs by first-seen order and navigates independently", () => {
        // Two outputs with an identical tuple are indistinguishable by the
        // scriptable API (spec E collision): deterministic fallback is
        // first-seen assignment order, stable within a session but not across
        // a plug/replug reorder. This is a documented limitation, not an error.
        const sameA = { ...OUTPUT };
        const sameB = { ...OUTPUT };
        const harness = new Harness();
        harness.screensList = [sameA, sameB];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wA = window({ output: sameA });
        const wB = window({ output: sameB });
        harness.windows = [wA, wB];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const keyA = controller.outputKeyFor(sameA);
        const keyB = controller.outputKeyFor(sameB);
        assert.notEqual(keyA, keyB);
        assert.equal(controller.outputKeyFor(sameA), keyA);
        // Both outputs still select independently through the same-tuple keys.
        harness.currentDesktop = DESKTOP_1;
        harness.active = wA;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopForScreenWrites.length, 1);
        assert.equal(harness.currentDesktopForScreenWrites[0]?.output, sameA);
        assert.equal((harness.currentDesktopByOutput.get(sameA) as { id: string }).id, "desktop-2");
    });

    it("selects the active screen's local target with no focused window (activeScreen = L)", () => {
        // Spec D common: with no focused window the active output is
        // `workspace.activeScreen`. Under the trailing-empty reuse model
        // each of L's three moves (wL1, wL2, wL3) occupies L's current
        // trailing empty and the same cleanup dispatch replenishes a fresh
        // one, leaving L owning locals [desktop-2, desktop-4, desktop-5,
        // desktop-6], so Meta+2 selects L's local 2nd (desktop-4) through
        // the per-output write only; E is never resolved positionally and
        // stays unchanged.
        const { harness, wE, wL1, wL2, wL3 } = twoOutputSetup();
        for (const win of [wE, wL1, wL2, wL3]) {
            makeFloating(harness, win);
        }
        moveToTrailing(harness, wL1);
        moveToTrailing(harness, wL2);
        moveToTrailing(harness, wL3);
        moveToTrailing(harness, wE);
        harness.active = null;
        harness.activeScreenValue = OUTPUT_L;
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-4");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_E), false);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-4");
        assert.equal(last?.output, OUTPUT_L);
    });

    it("Meta+0 creates a new desktop on the active output only when none exists yet, leaving the other output unchanged", () => {
        // E has no trailing empty yet at this point in the scenario, so
        // Meta+0 must create one; it acts through the per-output seam on E
        // only, and L's current desktop is untouched.
        const { harness, wE } = twoOutputSetup();
        const creates = harness.createDesktopCalls.length;
        harness.active = wE;
        harness.currentDesktopByOutput.clear();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-2");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-2");
        assert.equal(last?.output, OUTPUT_E);
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
    });

    it("Meta+0 reuses the owned trailing empty already appended at startup for the sole occupied desktop", () => {
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends and owns its own replacement trailing empty
        // (desktop-2) during start() itself; Meta+0 must reuse it rather
        // than create a second one, and never removes a pre-existing
        // desktop.
        const { harness, controller, focused } = setup();
        const creates = harness.createDesktopCalls.length;
        assert.equal(creates, 1);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id).includes("desktop-1"), true);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-1"]);
        assert.equal(harness.removedDesktops.length, 0);
        // Meta+0 again reuses the still-unoccupied trailing empty rather
        // than creating a second one (Q-Domain: exactly one trailing empty
        // per domain).
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
    });

    it("occupying an owned empty desktop replenishes its trailing empty once, and repeated cleanup creates or removes nothing further", () => {
        // Q-Domain: occupying E's trailing desktop-2 replenishes a fresh
        // trailing empty desktop-3 synchronously as part of the same move
        // (matching "reconciliation is stable" above); the same cleanup
        // dispatch also seeds L's own initial trailing empty desktop-4,
        // since L is a connected output with no desktops of its own yet.
        // Repeated cleanup dispatches afterward are idempotent: nothing
        // further is created or removed and both lists are unchanged.
        const { harness, controller, wE } = twoOutputSetup();
        makeFloating(harness, wE);
        harness.currentDesktopByOutput.clear();
        moveToTrailing(harness, wE);
        const [eBefore, lBefore] = twoLocalLists(controller);
        assert.deepEqual([...eBefore], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lBefore], ["desktop-4"]);
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 0);
        const [eAfter, lAfter] = twoLocalLists(controller);
        assert.deepEqual([...eAfter], [...eBefore]);
        assert.deepEqual([...lAfter], [...lBefore]);
    });

    it("Meta+0 creation failure is non-destructive and reason-logged (per-output-local)", () => {
        // The sole desktop is occupied (matching setup()'s fixture), so the
        // fix means start() itself already attempts, and fails, its own
        // replacement-trailing-empty append; createDesktopThrows must be set
        // before start() (a bare Harness, not setup()) so that first attempt
        // is the one that fails, and the shortcut's own attempt afterward is
        // measured as a delta against that baseline.
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.createDesktopThrows = new Error("create-failed");
        const controller = new TileController(harness.environment());
        controller.start();
        const failuresBeforeShortcut = countEvent(harness.logs, "workspace-append-create-failed:create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(
            countEvent(harness.logs, "workspace-append-create-failed:create-failed"),
            failuresBeforeShortcut + 1,
        );
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), []);
        assert.equal(controller.isEnabled, true);
    });

    it("removes E's mid-list empty without disturbing E's own trailing empty or L's independent trailing empty (Q-MultiOutput non-confusability)", () => {
        // Build E: [desktop-1(occupied by wL2/wL3, never moved), desktop-2
        // (occupied by wE), desktop-3(E's trailing empty)] and L: [desktop-4
        // (occupied by wL1), desktop-5(L's trailing empty)], exactly matching
        // "reconciliation is stable across repeated triggers" above.
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        const [eBefore, lBefore] = twoLocalLists(controller);
        assert.deepEqual([...eBefore], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lBefore], ["desktop-4", "desktop-5"]);

        // Vacate wE from desktop-2 externally (as if moved outside the
        // controller, mirroring "marks a removed output's owned empties..."
        // above), leaving desktop-2 empty but mid-list on E's domain (not
        // E's own trailing desktop-3), and make it invisible on every
        // connected output by pointing each output's current desktop at its
        // own domain's trailing empty (Q-Manual: a non-trailing empty stays
        // cleanup-eligible only when empty and invisible everywhere).
        wE.desktops = [];
        harness.currentDesktopForOutputOverride = (output) =>
            output === OUTPUT_E
                ? { id: "desktop-3", x11DesktopNumber: 3 }
                : { id: "desktop-5", x11DesktopNumber: 5 };
        harness.currentDesktopValue = { id: "desktop-5", x11DesktopNumber: 5 };
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;

        // Trigger cleanup via a non-switch dispatcher (Q7: cleanup fires on
        // every dispatch trigger, not only a completed desktop switch) - an
        // unrelated window add, never emitCurrentDesktopChanged.
        const extra = window({ output: OUTPUT_L });
        harness.windows = [...(harness.windows as TestWindow[]), extra];
        harness.emitAdded(extra);

        // Only E's mid-list empty (desktop-2) is removed: an ordinary
        // non-trailing cleanup-eligible desktop. Nothing is created (nothing
        // was occupied that needed replenishing).
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-2"],
        );
        assert.equal(harness.createDesktopCalls.length, creates);

        // E's own trailing empty (desktop-3) and L's own trailing empty
        // (desktop-5) both survive, structurally protected as the last
        // entry of their own independent per-output domain - the exact
        // Q-MultiOutput property: E's mid-list removal never touches L's
        // domain, and the two protections never become adjacent/confusable.
        const [eAfter, lAfter] = twoLocalLists(controller);
        assert.deepEqual([...eAfter], ["desktop-1", "desktop-3"]);
        assert.deepEqual([...lAfter], ["desktop-4", "desktop-5"]);

        // A repeated non-switch dispatch afterward is idempotent: no further
        // creates or removes, confirming no oscillation from the
        // multi-output interaction.
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 1);
        const [eFinal, lFinal] = twoLocalLists(controller);
        assert.deepEqual([...eFinal], ["desktop-1", "desktop-3"]);
        assert.deepEqual([...lFinal], ["desktop-4", "desktop-5"]);
    });

    it("three simultaneously connected outputs each develop their own distinct, non-overlapping local trailing empty", () => {
        // Generalizes twoOutputSetup to three outputs connected and occupied
        // at once (spec Q-Domain: one trailing empty per connected output,
        // not per output-pair). All three windows start on the pre-existing
        // desktop-1, which resolves into E's list (session primary); L and N
        // start with no desktops of their own, exactly as L does in
        // twoOutputSetup. Each output's own move-append creates its own
        // occupied desktop and the same cleanup dispatch replenishes that
        // output's own trailing empty while also seeding an initial trailing
        // empty for any other connected output still lacking one.
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        for (const win of [wE, wL, wN]) {
            makeFloating(harness, win);
        }
        // wE's move creates desktop-2 (occupied) and the same cleanup
        // dispatch replenishes desktop-3 as E's own trailing empty, and
        // seeds L's and N's own initial trailing empties (desktop-4 and
        // desktop-5 respectively) since both are connected outputs with no
        // desktops of their own yet.
        moveToTrailing(harness, wE);
        // wL reuses its just-seeded trailing desktop-4 and the same cleanup
        // dispatch replenishes desktop-6 as L's fresh trailing empty.
        moveToTrailing(harness, wL);
        // wN reuses its just-seeded trailing desktop-5 and the same cleanup
        // dispatch replenishes desktop-7 as N's fresh trailing empty.
        moveToTrailing(harness, wN);

        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const keyN = controller.outputKeyFor(OUTPUT_N) as string;
        assert.equal(new Set([keyE, keyL, keyN]).size, 3);

        const snapshot = controller.localWorkspaceSnapshot();
        assert.deepEqual([...(snapshot[keyE] ?? [])], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...(snapshot[keyL] ?? [])], ["desktop-4", "desktop-6"]);
        assert.deepEqual([...(snapshot[keyN] ?? [])], ["desktop-5", "desktop-7"]);

        // The three domains are structurally distinct: no desktop id is a
        // member of more than one output's local list.
        const allIds = [...(snapshot[keyE] ?? []), ...(snapshot[keyL] ?? []), ...(snapshot[keyN] ?? [])];
        assert.equal(new Set(allIds).size, allIds.length);

        // A repeated cleanup dispatch afterward is idempotent: nothing
        // further is created or removed, matching "reconciliation is stable
        // across repeated triggers" above but for three simultaneous
        // domains.
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        const after = controller.localWorkspaceSnapshot();
        assert.deepEqual([...(after[keyE] ?? [])], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...(after[keyL] ?? [])], ["desktop-4", "desktop-6"]);
        assert.deepEqual([...(after[keyN] ?? [])], ["desktop-5", "desktop-7"]);
    });

    it("disconnecting one of three connected outputs removes only its own empty, invisible desktops and leaves the two survivors' local lists and current desktops completely unaffected", () => {
        // Builds on the same three-output occupied state as the test above,
        // then disconnects N (matching "marks a removed output's owned
        // empties..." above, but with a third, uninvolved survivor present).
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        for (const win of [wE, wL, wN]) {
            makeFloating(harness, win);
        }
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL);
        moveToTrailing(harness, wN);

        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const before = controller.localWorkspaceSnapshot();
        const eBefore = [...(before[keyE] ?? [])];
        const lBefore = [...(before[keyL] ?? [])];
        const currentEBefore = harness.currentDesktopByOutput.get(OUTPUT_E);
        const currentLBefore = harness.currentDesktopByOutput.get(OUTPUT_L);

        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        // Disconnect N: its own trailing empty (desktop-7) is now empty and
        // invisible (N is dropped from screens()) and becomes cleanup-
        // eligible; N's occupied desktop-5 (still holding wN) is not empty,
        // so it is never removed, purely orphaned out of every domain's
        // local list. E's and L's own local lists and current desktops are
        // completely untouched, and no desktop is created purely as a
        // result of the disconnect (disconnect never replenishes).
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();

        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-7"],
        );
        assert.equal(harness.createDesktopCalls.length, creates);

        const after = controller.localWorkspaceSnapshot();
        assert.deepEqual([...(after[keyE] ?? [])], eBefore);
        assert.deepEqual([...(after[keyL] ?? [])], lBefore);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_E), currentEBefore);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_L), currentLBefore);
    });

    it("rapid disconnect/reconnect flapping of one output, interleaved with a window occupying its own trailing empty mid-flap, converges to exactly one trailing empty per output with no residual oscillation (per-output-local)", () => {
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        moveToTrailing(harness, wE);
        const [eBefore] = twoLocalLists(controller);
        assert.deepEqual([...eBefore], ["desktop-1", "desktop-2", "desktop-3"]);

        // Flap L rapidly (disconnect/reconnect back-to-back, nothing else
        // changed), then, mid-flap and before anything settles, move a
        // window onto L (seeding its own trailing empty for the first
        // time), then flap once more.
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        makeFloating(harness, wL1);
        moveToTrailing(harness, wL1);
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();

        // E's own domain, never touched by L's flapping, is unaffected.
        const [eAfter, lAfter] = twoLocalLists(controller);
        assert.deepEqual([...eAfter], ["desktop-1", "desktop-2", "desktop-3"]);
        // L converges to exactly its one occupied desktop (wL1's move) plus
        // exactly one trailing empty: no duplicates, no leftover churn from
        // the flap itself.
        assert.equal(lAfter.length, 2);
        assert.equal(new Set(lAfter).size, 2);

        // A further settle dispatch against this converged state is a pure
        // no-op: repeated flapping leaves no residual oscillation.
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        const [eFinal, lFinal] = twoLocalLists(controller);
        assert.deepEqual([...eFinal], eAfter);
        assert.deepEqual([...lFinal], lAfter);
    });
});

describe("TileController global-unique workspaces (Unit 06)", () => {
    const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
    const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
    const DESKTOP_1 = { id: "desktop-1" };
    const DESKTOP_3 = { id: "desktop-3" };
    const DESKTOP_4 = { id: "desktop-4" };
    const DESKTOP_5 = { id: "desktop-5" };
    const DESKTOP_7 = { id: "desktop-7" };
    const DESKTOP_8 = { id: "desktop-8" };

    // Two-output global-unique session. Startup reconciliation assigns every
    // pre-existing desktop to the session primary output (E); with no
    // replenish there is no automatic per-output trailing empty. The spec
    // H.12 exact example (E owns [1,2,4], L owns [3,5,6]) is constructed
    // through the deterministic session seeding seam. Per-output current
    // desktops are modeled through the harness override so the
    // visible-target swap detection sees independent per-output currents.
    function globalUniqueSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly keyE: string;
        readonly keyL: string;
        readonly wE: TestWindow;
        readonly wL: TestWindow;
    } {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
            { id: "desktop-4", x11DesktopNumber: 4 },
            { id: "desktop-5", x11DesktopNumber: 5 },
            { id: "desktop-6", x11DesktopNumber: 6 },
            // desktop-7 and desktop-8 stand in for E's and L's owned trailing
            // empty (no replenish exists, so nothing auto-creates these; they
            // are seeded directly as the deterministic baseline the tests
            // below build on).
            { id: "desktop-7", x11DesktopNumber: 7 },
            { id: "desktop-8", x11DesktopNumber: 8 },
        ];
        harness.nextDesktopNumber = 8;
        // Null currents at startup so no window is in scope and no dwindle
        // reconstruction is armed (the same pattern as the Unit 05 two-output
        // setup); per-output currents are modeled after startup.
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        harness.windows = [wE, wL];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const inspectable = controller as unknown as { ownedDesktopIds: Set<string> };
        inspectable.ownedDesktopIds.add("desktop-7");
        inspectable.ownedDesktopIds.add("desktop-8");
        controller.seedGlobalUniqueAssignment({
            [keyE]: ["desktop-1", "desktop-2", "desktop-4", "desktop-7"],
            [keyL]: ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        });
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_3);
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        return { harness, controller, keyE, keyL, wE, wL };
    }

    it("Meta+0 registers as the stable workspace-0 shortcut alongside Meta+Shift+0", () => {
        const { harness } = globalUniqueSetup();
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-workspace-0"),
            true,
        );
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-move-workspace-append"),
            true,
        );
    });

    it("selects the nth member of the active output's assigned subset via per-output writes (E 3rd = 4, L 2nd = 5)", () => {
        // Spec H.12: E owns [1,2,4], L owns [3,5,6] (plus owned trailing
        // empties). Meta+3 on E selects global 4; Meta+2 on L selects global 5.
        const onE = globalUniqueSetup();
        onE.harness.active = onE.wE;
        onE.harness.currentDesktopByOutput.delete(OUTPUT_L);
        invokeShortcut(onE.harness, "plasma-auto-tiler-workspace-3");
        assert.equal((onE.harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-4");
        assert.equal(onE.harness.currentDesktopByOutput.has(OUTPUT_L), false);
        const lastE = onE.harness.currentDesktopForScreenWrites[
            onE.harness.currentDesktopForScreenWrites.length - 1
        ];
        assert.equal((lastE?.desktop as { id: string }).id, "desktop-4");
        assert.equal(lastE?.output, OUTPUT_E);

        const onL = globalUniqueSetup();
        onL.harness.active = onL.wL;
        onL.harness.currentDesktopByOutput.delete(OUTPUT_E);
        invokeShortcut(onL.harness, "plasma-auto-tiler-workspace-2");
        assert.equal((onL.harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-5");
        assert.equal(onL.harness.currentDesktopByOutput.has(OUTPUT_E), false);
        const lastL = onL.harness.currentDesktopForScreenWrites[
            onL.harness.currentDesktopForScreenWrites.length - 1
        ];
        assert.equal((lastL?.desktop as { id: string }).id, "desktop-5");
        assert.equal(lastL?.output, OUTPUT_L);
    });

    it("selects the active screen's assigned subset member with no focused window (activeScreen = L)", () => {
        // Spec D common: with no focused window the active output is
        // `workspace.activeScreen`. L's assigned subset is [3,5,6,8] ordered by
        // x11DesktopNumber, so Meta+2 selects global desktop-5 via the
        // per-output write only; E's subset is never used as a substitute and E
        // stays unchanged.
        const { harness } = globalUniqueSetup();
        harness.active = null;
        harness.activeScreenValue = OUTPUT_L;
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        const writesBefore = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-5");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_E), false);
        assert.equal(harness.currentDesktopForScreenWrites.length, writesBefore + 1);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-5");
        assert.equal(last?.output, OUTPUT_L);
    });

    it("no-ops with a diagnostic when neither a focused window nor activeScreen is available (global-unique)", () => {
        const { harness } = globalUniqueSetup();
        harness.active = null;
        harness.activeScreenValue = null;
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-active-screen-unavailable"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
    });

    it("an absent subset index is a specific no-op with no write", () => {
        const { harness, wE } = globalUniqueSetup();
        harness.active = wE;
        const writes = harness.currentDesktopForScreenWrites.length;
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-9");
        assert.equal(countEvent(harness.logs, "workspace-navigate-absent:9"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, createsBefore);
    });

    it("applies the visible-target swap before navigation: target moves to the active output, prior current to the other, assignments follow", () => {
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        // L already shows global desktop-4 (E's 3rd subset member).
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_4);
        harness.active = wE;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-3");
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 1);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-4");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-1");
        // One assigned current desktop per affected output; the swap moved
        // desktop-1 to L and left desktop-4 assigned to E.
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(snapshot[keyE]?.slice().sort(), ["desktop-2", "desktop-4", "desktop-7"]);
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-1", "desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        );
        // The swap writes come first (target to the active output, prior
        // current to the other output); the navigation follow write re-asserts
        // the target on the active output last.
        const writes = harness.currentDesktopForScreenWrites;
        const swapWrites = writes.slice(-3);
        assert.equal((swapWrites[0]?.desktop as { id: string }).id, "desktop-4");
        assert.equal(swapWrites[0]?.output, OUTPUT_E);
        assert.equal((swapWrites[1]?.desktop as { id: string }).id, "desktop-1");
        assert.equal(swapWrites[1]?.output, OUTPUT_L);
        assert.equal((swapWrites[2]?.desktop as { id: string }).id, "desktop-4");
        assert.equal(swapWrites[2]?.output, OUTPUT_E);
    });

    it("move-follow applies the visible-target swap before the membership write and follow", () => {
        const { harness, controller, keyE, keyL, wL } = globalUniqueSetup();
        // E already shows global desktop-5 (L's 2nd subset member).
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_5);
        harness.active = wL;
        wL.desktops = [DESKTOP_3];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 1);
        assert.deepEqual((wL.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-5"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-5");
        // L's prior current desktop-3 moved to E, so the swap preserves one
        // assigned current per affected output.
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-3");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyE]?.slice().sort(),
            ["desktop-1", "desktop-2", "desktop-3", "desktop-4", "desktop-7"],
        );
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-5", "desktop-6", "desktop-8"]);
    });

    it("Meta+Shift+0 reuses the active output's own trailing empty instead of creating a new desktop", () => {
        // Meta+Shift+0 reuses the structurally-identified trailing empty of
        // the active output's own assignment group (desktop-8, L's highest
        // x11DesktopNumber member, currently empty) rather than always
        // creating.
        const { harness, controller, keyL, wL } = globalUniqueSetup();
        harness.active = wL;
        wL.desktops = [DESKTOP_3];
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_3);
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, createsBefore);
        assert.deepEqual((wL.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-8"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-8");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        );
    });

    it("Meta+Shift+0 creates and assigns exactly one desktop only when the active output's own domain lacks a trailing empty", () => {
        // Each output's domain is its own assignment group ordered by
        // x11DesktopNumber - occupying desktop-8 (the structurally-last
        // member of L's own group) is what removes L's trailing empty; E's
        // group and trailing empty are untouched.
        const { harness, controller, keyL, wL } = globalUniqueSetup();
        const occupant = window({ output: OUTPUT_L, desktops: [DESKTOP_8] });
        harness.windows = [...(harness.windows as unknown[]), occupant];
        harness.active = wL;
        wL.desktops = [DESKTOP_3];
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_3);
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.deepEqual((wL.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-9"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-9");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-3", "desktop-5", "desktop-6", "desktop-8", "desktop-9"],
        );
    });

    it("refuses sticky, fullscreen, and maximized moves before any write or create", () => {
        const sticky = globalUniqueSetup();
        sticky.harness.active = sticky.wE;
        sticky.harness.currentDesktop = DESKTOP_1;
        sticky.harness.currentDesktopValue = DESKTOP_1;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-sticky-toggle");
        const createsBefore = sticky.harness.createDesktopCalls.length;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(sticky.harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(sticky.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(sticky.harness.createDesktopCalls.length, createsBefore);

        const fullscreen = globalUniqueSetup();
        fullscreen.harness.active = fullscreen.wE;
        fullscreen.wE.fullScreen = true;
        const createsFs = fullscreen.harness.createDesktopCalls.length;
        invokeShortcut(fullscreen.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(fullscreen.harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(fullscreen.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(fullscreen.harness.createDesktopCalls.length, createsFs);

        // A tiled window so the maximize action can record it.
        const maximized = new Harness();
        maximized.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        maximized.screensList = [OUTPUT_E, OUTPUT_L];
        maximized.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
            { id: "desktop-4", x11DesktopNumber: 4 },
            { id: "desktop-5", x11DesktopNumber: 5 },
            { id: "desktop-6", x11DesktopNumber: 6 },
        ];
        maximized.nextDesktopNumber = 6;
        maximized.currentDesktop = DESKTOP_1;
        maximized.currentDesktopValue = DESKTOP_1;
        maximized.currentDesktopForOutputOverride = (output) =>
            maximized.currentDesktopByOutput.get(output) ?? maximized.currentDesktop;
        const maxRoot = tile(RECT, true);
        const maxTarget = tile();
        const maxWE = window({ tile: maxTarget, output: OUTPUT_E });
        maxTarget.windows = [maxWE];
        maxRoot.tiles = [maxTarget];
        maximized.root = maxRoot;
        maximized.windows = [maxWE];
        maximized.active = maxWE;
        maximized.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        const maxController = new TileController(maximized.environment());
        maxController.start();
        const createsMax = maximized.createDesktopCalls.length;
        invokeShortcut(maximized, "plasma-auto-tiler-maximize");
        invokeShortcut(maximized, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(maximized.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(maximized.currentDesktopForScreenWrites.length, 0);
        assert.equal(maximized.createDesktopCalls.length, createsMax);
    });

    it("cleanup removes every empty, invisible desktop after a disconnect, including the disconnected output's former trailing empty, but reserves the surviving output's own trailing empty", () => {
        const { harness, controller, keyL, wL } = globalUniqueSetup();
        // wE and wL both stay floating on desktop-1 and desktop-3 protects the
        // other current desktop, so the screens change arms no reconstruction
        // and cleanup runs immediately (the Unit 05 hotplug pattern).
        wL.desktops = [DESKTOP_3];
        harness.removedDesktops.length = 0;
        // Disconnect E: rebuildGlobalUniqueMapping folds E's now-unassigned
        // desktops (including its former trailing empty, desktop-7) into L's
        // group since L is the sole remaining connected output. desktop-7 is
        // NOT adopted/protected as L's trailing - L's own group already had
        // desktop-8 as its structurally-last member, so desktop-7 is
        // immediately cleanup-eligible. desktop-1 (occupied) and desktop-3
        // (current on L) also survive; every other empty invisible desktop is
        // removed regardless of ownership.
        harness.screensList = [OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        harness.screensChanged?.();
        // The scope change on L can arm a reconstruction (its floating window
        // becomes the current scope's candidate), which defers cleanup until
        // it settles.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-4", "desktop-5", "desktop-6", "desktop-7"],
        );
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(snapshot), [keyL]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-1", "desktop-3", "desktop-8"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-8"]);
    });

    it("cleanup never removes a current or visible desktop, regardless of ownership", () => {
        const { harness, controller } = globalUniqueSetup();
        // L shows its owned trailing desktop-8 (current + visible), so it
        // survives; every other empty invisible desktop is removed.
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_8);
        harness.removedDesktops.length = 0;
        harness.screensList = [OUTPUT_L];
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-3", "desktop-4", "desktop-5", "desktop-6", "desktop-7"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-8"]);
    });

    it("Meta+0 reuses the active output's own trailing empty and focuses it, leaving the other output's assignment and current desktop unchanged", () => {
        // Meta+0 reuses the structurally-identified trailing empty of the
        // active output's own assignment group (E's own group's highest
        // x11DesktopNumber member, desktop-7) - never a different output's
        // trailing, and never applying globalUniqueSwapIfVisibleElsewhere on
        // this path. L's assignment and current desktop are untouched.
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        harness.active = wE;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-7");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 0);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-7");
        assert.equal(last?.output, OUTPUT_E);
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyE]?.slice().sort(),
            ["desktop-1", "desktop-2", "desktop-4", "desktop-7"],
        );
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        );
    });

    it("Meta+0 creates and assigns exactly one desktop when the active output's own domain lacks a trailing empty (global-unique)", () => {
        // Occupying desktop-7 (the structurally-last member of E's own
        // group) is what removes E's own trailing empty - each output's
        // domain is its own assignment group, not a shared global one.
        // Meta+0 then creates exactly one owned desktop, assigns it to E,
        // focuses it, and leaves L unchanged.
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        const occupant = window({ output: OUTPUT_E, desktops: [DESKTOP_7] });
        harness.windows = [...(harness.windows as unknown[]), occupant];
        harness.active = wE;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-9");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyE]?.slice().sort(),
            ["desktop-1", "desktop-2", "desktop-4", "desktop-7", "desktop-9"],
        );
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-3", "desktop-5", "desktop-6", "desktop-8"]);
    });

    it("cleanupDesktops-equivalent dispatch is idempotent against unchanged global-unique state (no net creates/removes)", () => {
        // Two consecutive dispatches against unchanged state produce zero net
        // creates/removes - the single-pass ensureTrailingEmptyDesktop-backed
        // enforcement (unit-03) is structural and re-reads live state on every
        // call rather than looping or debouncing.
        const { harness } = globalUniqueSetup();
        // Settle the fixture's initial empty/invisible desktops first (they
        // are removed on the first dispatch), then assert the second and
        // third dispatches against the now-settled state are pure no-ops.
        harness.emitDesktopsChanged();
        const creates = harness.createDesktopCalls.length;
        harness.removedDesktops.length = 0;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("Meta+0 never applies the cross-output swap on the trailing-empty reuse path, even when the target happens to be currently shown on a different output", () => {
        // E's own trailing empty (desktop-7) happens to currently be shown as
        // L's current desktop. The trailing-empty reuse path must reuse it
        // directly on E without ever calling globalUniqueSwapIfVisibleElsewhere
        // - no cross-output swap, and L's current desktop and assignment are
        // left completely untouched (unlike ordinary swap-eligible navigation).
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_7);
        harness.active = wE;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 0);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-7");
        // L's current desktop is untouched - not swapped to E's prior current.
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-7");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(snapshot[keyE]?.slice().sort(), ["desktop-1", "desktop-2", "desktop-4", "desktop-7"]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-3", "desktop-5", "desktop-6", "desktop-8"]);
    });

    it("each connected output ends up with exactly one trailing empty in its own domain, not one shared global one", () => {
        const { harness, controller, keyE, keyL } = globalUniqueSetup();
        harness.emitDesktopsChanged();
        // After settling, only the current desktop and each output's own
        // structurally-last (trailing) member survive per domain - E keeps
        // desktop-1 (current) and desktop-7 (E's own trailing); L keeps
        // desktop-3 (current) and desktop-8 (L's own trailing). They are
        // distinct, per-output trailing empties, not one shared global one.
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(snapshot[keyE]?.slice().sort(), ["desktop-1", "desktop-7"]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-3", "desktop-8"]);
    });

    it("a newly connected output gets a freshly created trailing empty, never an adopted spare desktop", () => {
        const { harness, controller } = globalUniqueSetup();
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const wN = window({ output: OUTPUT_N });
        harness.windows = [...(harness.windows as unknown[]), wN];
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        const creates = harness.createDesktopCalls.length;
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        const keyN = controller.outputKeyFor(OUTPUT_N) as string;
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.equal(snapshot[keyN]?.length, 1);
        assert.equal(harness.createDesktopCalls[harness.createDesktopCalls.length - 1] !== undefined, true);
    });

    it("literal-last-wins: a disconnect can protect a higher-numbered folded-in trailing empty over the survivor's own lower-numbered trailing empty, and self-heals once occupied (accepted adversarial ordering, not a bug)", () => {
        const { harness, controller, keyE, keyL, wL } = globalUniqueSetup();
        // Inverse of the existing disconnect test's ordering: give E the
        // *higher*-numbered trailing empty (desktop-8) and L the *lower*-
        // numbered one (desktop-7), so once E's group folds into L's after
        // disconnect, L's own former trailing (desktop-7) is no longer the
        // structurally-last member of the merged group.
        controller.seedGlobalUniqueAssignment({
            [keyE]: ["desktop-1", "desktop-2", "desktop-4", "desktop-8"],
            [keyL]: ["desktop-3", "desktop-5", "desktop-6", "desktop-7"],
        });
        wL.desktops = [DESKTOP_3];
        harness.removedDesktops.length = 0;
        // Disconnect E: rebuildGlobalUniqueMapping folds E's now-unassigned
        // desktops (including its former trailing, desktop-8) into L's
        // group. Per globalUniqueOrdered's x11-ascending sort, desktop-8 -
        // not L's own former trailing desktop-7 - is now the structurally-
        // last member of the merged group and is protected; desktop-7
        // becomes an ordinary non-trailing empty and is removed like any
        // other (Q-Manual, ownership-independent). This is the deliberately
        // accepted inverse of "cleanup removes every empty ... reserves the
        // surviving output's own trailing empty": here the folded-in
        // desktop wins protection over the survivor's own true trailing.
        // The last-remaining-global-desktop floor is not implicated (many
        // live desktops remain throughout).
        harness.screensList = [OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-4", "desktop-5", "desktop-6", "desktop-7"],
        );
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(snapshot), [keyL]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-1", "desktop-3", "desktop-8"]);

        // Self-heal: once a window lands on the protected-but-"wrong"
        // trailing empty (desktop-8), L's group's last position is occupied,
        // so the next cleanup dispatch appends exactly one new trailing
        // empty (desktop-9, the next increasing x11 number) - convergence
        // back to the single-trailing invariant, confirming this is a
        // temporary, self-correcting property, not a lasting defect.
        const occupant = window({ output: OUTPUT_L, desktops: [DESKTOP_8] });
        harness.windows = [...(harness.windows as unknown[]), occupant];
        const createsBefore = harness.createDesktopCalls.length;
        harness.removedDesktops.length = 0;
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.equal(harness.removedDesktops.length, 0);
        const healedSnapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            healedSnapshot[keyL]?.slice().sort(),
            ["desktop-1", "desktop-3", "desktop-8", "desktop-9"],
        );

        // A further dispatch against this now-converged state is a pure
        // no-op - no extra creates/removes.
        const createsAfterHeal = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, createsAfterHeal);
        assert.equal(harness.removedDesktops.length, 0);

        // No ownership Set reintroduced beyond the fixture's own seeding -
        // every surviving/created desktop is reachable purely through the
        // structural globalUniqueOrdered domain.
        assert.deepEqual(
            [...controller.ownedDesktopIdSnapshot()].sort(),
            ["desktop-8", "desktop-9"],
        );
    });

    it("a third simultaneously connected output develops its own distinct trailing empty, and disconnecting it folds only its own desktops into the primary output's group, leaving the other survivor's own group and current desktop completely unaffected (global-unique)", () => {
        // Generalizes globalUniqueSetup to three outputs connected at once
        // (Q-Domain: one trailing empty per connected output, not per
        // output-pair). N's own desktops are seeded with deliberately low
        // x11DesktopNumbers so folding them into E (the primary) on
        // disconnect never displaces E's own trailing desktop-7 as the
        // merged group's structurally-last member - that adversarial
        // ordering interaction is already covered by the "literal-last-wins"
        // test above; this test isolates the plain multi-output case.
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
            { id: "desktop-4", x11DesktopNumber: 4 },
            { id: "desktop-5", x11DesktopNumber: 5 },
            { id: "desktop-6", x11DesktopNumber: 6 },
            { id: "desktop-7", x11DesktopNumber: 7 },
            { id: "desktop-8", x11DesktopNumber: 8 },
            { id: "desktop-9", x11DesktopNumber: -2 },
            { id: "desktop-10", x11DesktopNumber: -1 },
        ];
        harness.nextDesktopNumber = 10;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N, desktops: [{ id: "desktop-9" }] });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const keyN = controller.outputKeyFor(OUTPUT_N) as string;
        assert.equal(new Set([keyE, keyL, keyN]).size, 3);
        controller.seedGlobalUniqueAssignment({
            [keyE]: ["desktop-1", "desktop-2", "desktop-4", "desktop-7"],
            [keyL]: ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
            [keyN]: ["desktop-9", "desktop-10"],
        });
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-1", x11DesktopNumber: 1 });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3", x11DesktopNumber: 3 });
        harness.currentDesktopByOutput.set(OUTPUT_N, { id: "desktop-9", x11DesktopNumber: -2 });
        harness.currentDesktop = { id: "desktop-1", x11DesktopNumber: 1 };
        harness.currentDesktopValue = { id: "desktop-1", x11DesktopNumber: 1 };

        // Settle the freshly seeded fixture once (sweeps its own dangling,
        // never-occupied spare desktops down to current+trailing per
        // domain) so the disconnect assertions below measure only the
        // delta caused by N leaving, not the fixture's own first-ever
        // reconciliation sweep.
        harness.emitDesktopsChanged();

        // The three domains are structurally distinct: no desktop id is a
        // member of more than one output's own assignment group.
        const before = controller.globalUniqueAssignmentSnapshot();
        const allIds = [...(before[keyE] ?? []), ...(before[keyL] ?? []), ...(before[keyN] ?? [])];
        assert.equal(new Set(allIds).size, allIds.length);
        const lBefore = [...(before[keyL] ?? [])].sort();
        const currentLBefore = harness.currentDesktopByOutput.get(OUTPUT_L);

        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        // Disconnect N: its occupied desktop-9 (holding wN) is not empty
        // and is folded into E's group rather than dropped; its empty
        // desktop-10 folds in too but, being lower-numbered than E's own
        // desktop-7, never becomes the merged group's trailing position, so
        // it is removed like any other ordinary empty invisible desktop
        // (Q-Manual). No desktop is created purely as a result of the
        // disconnect (disconnect never replenishes). L's own group and
        // current desktop are completely untouched.
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_N);
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-10"],
        );
        assert.equal(harness.createDesktopCalls.length, creates);
        const after = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(after).sort(), [keyE, keyL].sort());
        assert.deepEqual([...(after[keyE] ?? [])].sort(), ["desktop-1", "desktop-7", "desktop-9"]);
        assert.deepEqual([...(after[keyL] ?? [])].sort(), lBefore);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_L), currentLBefore);
    });

    it("output replug (disconnect then reconnect the identical output) creates a fresh trailing empty for the returning output, never adopting a spare desktop left over from before it disconnected (global-unique)", () => {
        const { harness, controller, keyE, keyL } = globalUniqueSetup();
        const formerLIds = ["desktop-3", "desktop-5", "desktop-6", "desktop-8"];
        harness.removedDesktops.length = 0;
        // Disconnect L: its group folds into E, the primary.
        harness.screensList = [OUTPUT_E];
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        const afterDisconnect = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(afterDisconnect), [keyE]);
        // Reconnect the identical output tuple: matched by first-seen order,
        // it gets its own session key back (spec E), but with no adopted
        // spare - reconciliation creates exactly one brand-new desktop as
        // its trailing empty, distinct from every one of its former ids
        // (all of which were either removed or folded permanently into E).
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        const creates = harness.createDesktopCalls.length;
        harness.screensChanged?.();
        settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.equal(controller.outputKeyFor(OUTPUT_L), keyL);
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        const replugged = controller.globalUniqueAssignmentSnapshot();
        assert.equal(replugged[keyL]?.length, 1);
        const newTrailingId = (replugged[keyL] as readonly string[])[0] as string;
        assert.equal(formerLIds.includes(newTrailingId), false);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-1");
    });
});

describe("TileController shared workspaces (Unit 07)", () => {
    const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
    const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
    const DESKTOP_1 = { id: "desktop-1", x11DesktopNumber: 1 };
    const DESKTOP_2 = { id: "desktop-2", x11DesktopNumber: 2 };

    // Two-output shared session: every output shows the same logical desktop
    // and the global list IS the shared set (spec D3). With no replenish,
    // startup creates nothing; desktop-3 is seeded directly as the owned
    // trailing empty the tests below build on. All moves below are floating
    // moves (membership write + follow only, never a tile-tree mutation).
    // Per-output currents are modeled through the override so the
    // synchronized state is observable per output.
    function sharedSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly wE: TestWindow;
        readonly wL: TestWindow;
    } {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2, { id: "desktop-3", x11DesktopNumber: 3 }];
        harness.nextDesktopNumber = 3;
        // Null currents at startup so no scope is owned and no dwindle
        // reconstruction is armed (the same pattern as the Unit 05 two-output
        // setup); tests set a current when they need a window in scope.
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        harness.windows = [wE, wL];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        (controller as unknown as { ownedDesktopIds: Set<string> }).ownedDesktopIds.add("desktop-3");
        return { harness, controller, wE, wL };
    }

    // Model both outputs already showing the shared desktop-1 without firing a
    // scope event, so navigation assertions start from the spec H.13 state.
    function bothOnDesktopOne(harness: Harness): void {
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_1);
    }

    // Float a window through the sticky toggle and clear the pin so it is
    // floating and movable on the desktop it belongs to, with no tile tree.
    function makeSharedFloating(harness: Harness, win: TestWindow): void {
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.active = win;
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
    }

    function bothOutputsOn(harness: Harness): [string, string] {
        const e = harness.currentDesktopByOutput.get(OUTPUT_E) ?? harness.currentDesktop;
        const l = harness.currentDesktopByOutput.get(OUTPUT_L) ?? harness.currentDesktop;
        return [(e as { id: string }).id, (l as { id: string }).id];
    }

    it("Meta+0 registers as the stable workspace-0 shortcut and Meta+Shift+0 remains registered (shared)", () => {
        const { harness } = sharedSetup();
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-workspace-0"),
            true,
        );
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-move-workspace-append"),
            true,
        );
    });

    it("holds one global ordered shared desktop-id set with one owned trailing empty, duplicate-free on repeat", () => {
        // Spec D3/F: the shared set is the ordered live global list plus the one
        // owned trailing empty created by startup reconciliation. A repeated
        // reconciliation creates no duplicate and removes nothing.
        const { harness, controller } = sharedSetup();
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3"]);
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("Meta+2 writes the same desktop id to E and L (spec H.10/H.13)", () => {
        // Spec H.10: mode shared, Meta+2 sets E and L to the same desktop id;
        // H.13: both show logical 1, Meta+2 changes both to logical 2. The
        // synchronization iterates setCurrentDesktopForScreen over every
        // connected output; no window output ever moves.
        const { harness, wE } = sharedSetup();
        bothOnDesktopOne(harness);
        harness.active = wE;
        assert.deepEqual(bothOutputsOn(harness), ["desktop-1", "desktop-1"]);
        const writesBefore = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        const newWrites = harness.currentDesktopForScreenWrites.slice(writesBefore);
        assert.equal(newWrites.length, 2);
        for (const write of newWrites) {
            assert.equal((write.desktop as { id: string }).id, "desktop-2");
        }
        assert.deepEqual(
            newWrites.map((write) => write.output).sort((a, b) => (a as { name: string }).name.localeCompare((b as { name: string }).name)),
            [OUTPUT_E, OUTPUT_L],
        );
    });

    it("synchronizes every output with no focused window (activeScreen unavailable)", () => {
        // Shared navigation is output-agnostic: it synchronizes every connected
        // output regardless of focus, so the absence of a focused window and an
        // unavailable activeScreen never blocks the shared write.
        const { harness } = sharedSetup();
        harness.active = null;
        harness.activeScreenValue = null;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
    });

    it("an absent shared index is a specific no-op with no write or create", () => {
        const { harness } = sharedSetup();
        harness.active = null;
        const writes = harness.currentDesktopForScreenWrites.length;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-9");
        assert.equal(countEvent(harness.logs, "workspace-navigate-absent:9"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    it("Meta+Shift+2 moves the eligible active window then synchronizes all outputs", () => {
        // Spec D3 move-follow: single membership write on the active window's
        // output, then switch every output to the shared target.
        const { harness, wE } = sharedSetup();
        makeSharedFloating(harness, wE);
        harness.active = wE;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        // The other output's window is untouched: its membership is unchanged
        // and no window ever transfers outputs implicitly.
        assert.deepEqual((wE.output as { name: string }).name, "screen-e");
    });

    it("Meta+Shift+0 reuses the existing structurally-last trailing empty, and cleanup replenishes it once it is occupied", () => {
        const { harness, controller, wE } = sharedSetup();
        makeSharedFloating(harness, wE);
        harness.active = wE;
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        // The destination is the existing trailing empty desktop-3 (the
        // structurally-last domain entry), reused rather than created for
        // the move itself. desktop-3 is now occupied, so the same pass's
        // cleanup replenishes it with a new trailing empty (desktop-4);
        // desktop-2 (never occupied, not the trailing position once
        // desktop-4 exists) is swept in the same pass.
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-3"]);
        assert.deepEqual(bothOutputsOn(harness), ["desktop-3", "desktop-3"]);
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-2"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3", "desktop-4"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-3", "desktop-4"]);
    });

    it("Meta+Shift+0 creates a shared desktop when no trailing empty exists, and cleanup replenishes it once occupied", () => {
        // Single pre-existing desktop, itself occupied by the moving window's
        // future scope: the move-append path finds no trailing empty to
        // reuse (the sole desktop is the window's own current desktop) and
        // creates the destination desktop-2. Once occupied by the move,
        // desktop-2 is the trailing position, so cleanup replenishes it with
        // a further trailing empty (desktop-3) in the same pass.
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        harness.windows = [wE];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
        assert.equal(harness.createDesktopCalls.length, 0);
        makeSharedFloating(harness, wE);
        harness.active = wE;
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        // One destination is created for the move (desktop-2); it then
        // becomes occupied and is the trailing position, so the same pass's
        // cleanup replenishes it with a new trailing empty (desktop-3).
        const createdId = (harness.createDesktopCalls[createsBefore] as { position: number; name: string });
        assert.equal(createdId.name, "2");
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.equal(harness.createDesktopCalls.length, createsBefore + 2);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-2", "desktop-3"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("refuses sticky, fullscreen, and maximized shared moves before any write or create", () => {
        const sticky = sharedSetup();
        makeSharedFloating(sticky.harness, sticky.wE);
        const enabledBaseline = countEvent(sticky.harness.logs, "sticky-enabled");
        invokeShortcut(sticky.harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(sticky.harness.logs, "sticky-enabled"), enabledBaseline + 1);
        const createsBefore = sticky.harness.createDesktopCalls.length;
        sticky.harness.active = sticky.wE;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(sticky.harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(sticky.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(sticky.harness.createDesktopCalls.length, createsBefore);

        const fullscreen = sharedSetup();
        makeSharedFloating(fullscreen.harness, fullscreen.wE);
        fullscreen.wE.fullScreen = true;
        const createsFs = fullscreen.harness.createDesktopCalls.length;
        fullscreen.harness.active = fullscreen.wE;
        invokeShortcut(fullscreen.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(fullscreen.harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(fullscreen.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(fullscreen.harness.createDesktopCalls.length, createsFs);

        // A tiled window so the maximize action can record it.
        const maximized = new Harness();
        maximized.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        maximized.screensList = [OUTPUT_E, OUTPUT_L];
        maximized.desktopsList = [DESKTOP_1, DESKTOP_2];
        maximized.nextDesktopNumber = 2;
        maximized.currentDesktop = DESKTOP_1;
        maximized.currentDesktopValue = DESKTOP_1;
        maximized.currentDesktopForOutputOverride = (output) =>
            maximized.currentDesktopByOutput.get(output) ?? maximized.currentDesktop;
        const maxRoot = tile(RECT, true);
        const maxTarget = tile();
        const maxWE = window({ tile: maxTarget, output: OUTPUT_E });
        maxTarget.windows = [maxWE];
        maxRoot.tiles = [maxTarget];
        maximized.root = maxRoot;
        maximized.windows = [maxWE];
        maximized.active = maxWE;
        maximized.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        const maxController = new TileController(maximized.environment());
        maxController.start();
        const createsMax = maximized.createDesktopCalls.length;
        invokeShortcut(maximized, "plasma-auto-tiler-maximize");
        invokeShortcut(maximized, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(maximized.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(maximized.currentDesktopForScreenWrites.length, 0);
        assert.equal(maximized.createDesktopCalls.length, createsMax);
    });

    it("cleanup never removes the current shared desktop, but removes every other empty invisible non-trailing one", () => {
        // The owned trailing empty (desktop-3) becomes the synchronized
        // current desktop on every output; a reconciliation must keep it
        // (current + visible, and also the structurally-last domain entry).
        // The other empty desktops (desktop-1 and desktop-2, neither the
        // trailing position, no windows in scope) are removed. Windows are
        // cleared so no scope/reconstruction defers cleanup.
        const { harness, controller } = sharedSetup();
        harness.windows = [];
        harness.active = null;
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-3" });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3" });
        harness.currentDesktop = { id: "desktop-3" };
        harness.currentDesktopValue = { id: "desktop-3" };
        harness.removedDesktops.length = 0;
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-1", "desktop-2"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-3"]);
    });

    it("hotplug adds a new output at the current shared workspace and never creates a desktop", () => {
        const { harness, controller } = sharedSetup();
        harness.active = null;
        // Plain navigation never triggers cleanup, so the owned desktop-3
        // stays present even though it is now empty and invisible.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3"]);
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        // Disconnect L: no desktop is created, and the connected output's
        // current desktop is untouched.
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-2");
        // Reconnect the identical tuple: it joins the current shared workspace
        // (desktop-2) without creating a desktop.
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    it("a throwing shared sync write is reported and never corrupts state (rollback-safe)", () => {
        // A per-output write failure is reported per output and the remaining
        // outputs still synchronize; the current desktop state is never left
        // partially mutated beyond the failed write itself.
        const { harness, controller } = sharedSetup();
        harness.active = null;
        harness.setCurrentDesktopThrows = new Error("sync-failed");
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-navigate-failed:sync-failed"), 2);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("a failing move-append create is non-destructive and leaves the shared set unchanged", () => {
        // When createDesktop throws, the move-append aborts before any write:
        // the window stays put, no current changes, and the shared set is
        // intact (repeat/failure-safe).
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        harness.windows = [wE];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        makeSharedFloating(harness, wE);
        harness.active = wE;
        harness.createDesktopThrows = new Error("create-failed");
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-1"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
    });

    it("Meta+0 reuses the existing structurally-last trailing empty and synchronizes every output (spec D3)", () => {
        // desktop-3 is the existing owned trailing empty; Meta+0 reuses it
        // rather than creating, and synchronizes both E and L to it.
        const { harness, controller } = sharedSetup();
        bothOnDesktopOne(harness);
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-3", "desktop-3"]);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
    });

    it("Meta+0 is a no-op when the trailing empty is already the shared current desktop (Q-Zero)", () => {
        const { harness, controller } = sharedSetup();
        harness.currentDesktop = { id: "desktop-3" };
        harness.currentDesktopValue = { id: "desktop-3" };
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-3" });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3" });
        const writes = harness.currentDesktopForScreenWrites.length;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-no-op:already-there"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("Meta+0 creates exactly one shared desktop when no trailing empty exists and synchronizes all outputs", () => {
        // A single pre-existing desktop, occupied by a window: the sole
        // domain entry is not empty, so there is no trailing empty to reuse,
        // and Meta+0 creates the shared destination exactly once.
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        harness.windows = [window({ output: OUTPUT_E, desktops: [DESKTOP_1] })];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
        harness.active = null;
        harness.activeScreenValue = OUTPUT_E;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-2"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2"]);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("Meta+0 shared create failure is non-destructive and reason-logged", () => {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        harness.windows = [window({ output: OUTPUT_E, desktops: [DESKTOP_1] })];
        const controller = new TileController(harness.environment());
        controller.start();
        harness.activeScreenValue = OUTPUT_E;
        harness.createDesktopThrows = new Error("create-failed");
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("Meta+0 shared sync write failure is reported per output and never corrupts state", () => {
        const { harness, controller } = sharedSetup();
        harness.active = null;
        harness.setCurrentDesktopThrows = new Error("sync-failed");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-navigate-failed:sync-failed"), 2);
        // The existing trailing empty (desktop-3) is reused, not created;
        // only the per-output sync write fails.
        assert.deepEqual(
            [...controller.sharedWorkspaceSnapshot()],
            ["desktop-1", "desktop-2", "desktop-3"],
        );
    });

    it("repeated cleanupDesktops dispatches against unchanged shared state are idempotent (no net creates or removes)", () => {
        const { harness, controller } = sharedSetup();
        harness.windows = [];
        harness.active = null;
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-3" });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3" });
        harness.currentDesktop = { id: "desktop-3" };
        harness.currentDesktopValue = { id: "desktop-3" };
        harness.emitDesktopsChanged();
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        const snapshot = [...controller.sharedWorkspaceSnapshot()];
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], snapshot);
    });

    it("three simultaneously connected outputs all synchronize onto the same single shared desktop, and disconnecting one down to two survivors stays fully synchronized with no spurious create (shared)", () => {
        // Generalizes sharedSetup to three outputs (Q-Domain: shared has one
        // global trailing empty regardless of output count; synchronizeShared
        // forces every connected output onto the same desktop by design).
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2, { id: "desktop-3", x11DesktopNumber: 3 }];
        harness.nextDesktopNumber = 3;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        (controller as unknown as { ownedDesktopIds: Set<string> }).ownedDesktopIds.add("desktop-3");

        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_N, DESKTOP_1);
        harness.active = wE;
        const onAll = (): [string, string, string] => [
            (harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id,
            (harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id,
            (harness.currentDesktopByOutput.get(OUTPUT_N) as { id: string }).id,
        ];
        // Meta+2 synchronizes all three connected outputs, not just a pair.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(onAll(), ["desktop-2", "desktop-2", "desktop-2"]);

        // Disconnect N: no desktop is created purely from the disconnect,
        // and E's/L's synchronized current desktop is unaffected.
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_N);
        harness.screensChanged?.();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual(
            [
                (harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id,
                (harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id,
            ],
            ["desktop-2", "desktop-2"],
        );

        // Reconnect N: it joins the current shared workspace without
        // creating a desktop, restoring full three-output synchronization.
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.screensChanged?.();
        assert.deepEqual(onAll(), ["desktop-2", "desktop-2", "desktop-2"]);
        assert.equal(harness.createDesktopCalls.length, creates);
    });
});

// Live-confirmed regression (unit-07 attempt-02): a fresh single-output,
// single-desktop session where that desktop is currently empty is correct
// (nothing to do). But the very first window ever placed on that sole
// desktop, with no prior Meta+0/Meta+Shift+0, previously failed to append a
// replacement trailing empty in any mode, because cleanupDesktops() guarded
// its reconciliation/enforcement calls behind an unconditional
// desktops.length <= 1 (plus, for per-output-local/global-unique, a single
// connected output) early return that never inspected occupancy. That guard
// is now removed; ensureTrailingEmptyDesktop's own structural last-position-
// if-empty check keeps the true no-op case (step 1 below) a no-op.
describe("TileController trailing-empty invariant on first occupation (Unit 07 live regression)", () => {
    function singleDesktopModeSetup(mode: "per-output-local" | "global-unique" | "shared"): {
        readonly harness: Harness;
        readonly controller: TileController;
    } {
        const harness = new Harness();
        harness.root = tile(RECT, true);
        if (mode !== "per-output-local") {
            harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, mode);
        }
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller };
    }

    function modeSnapshot(controller: TileController, mode: "per-output-local" | "global-unique" | "shared"): readonly string[] {
        if (mode === "per-output-local") {
            return Object.values(controller.localWorkspaceSnapshot())[0] ?? [];
        }
        if (mode === "global-unique") {
            return Object.values(controller.globalUniqueAssignmentSnapshot())[0] ?? [];
        }
        return controller.sharedWorkspaceSnapshot();
    }

    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`a fresh single-output, single-empty-desktop session creates nothing on start in ${mode} mode`, () => {
            const { harness } = singleDesktopModeSetup(mode);
            assert.equal(harness.createDesktopCalls.length, 0);
            assert.deepEqual((harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id), [
                "desktop-1",
            ]);
        });

        it(`the first window ever placed on the sole desktop appends a replacement trailing empty in ${mode} mode`, () => {
            const { harness, controller } = singleDesktopModeSetup(mode);
            const first = window();
            harness.windows = [first];
            harness.emitAdded(first);
            // Placing the first window into the empty root tile arms a
            // reconstruction (no tile tree exists yet); cleanup defers until
            // it settles, matching the existing deferred-reconstruction
            // pattern used elsewhere in this file.
            let settled = 0;
            while (harness.yields.length > 0 && settled < 10) {
                harness.flushNextYield();
                settled += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 1);
            assert.deepEqual((harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id), [
                "desktop-1",
                "desktop-2",
            ]);
            assert.deepEqual(modeSnapshot(controller, mode), ["desktop-1", "desktop-2"]);
        });

        it(`a second window occupying the replacement trailing empty appends another, and the prior one survives, in ${mode} mode`, () => {
            const { harness, controller } = singleDesktopModeSetup(mode);
            const first = window();
            harness.windows = [first];
            harness.emitAdded(first);
            let settledFirst = 0;
            while (harness.yields.length > 0 && settledFirst < 10) {
                harness.flushNextYield();
                settledFirst += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 1);
            const trailing = { id: "desktop-2", x11DesktopNumber: 2 };
            const incoming = window({ desktops: [trailing] });
            harness.windows = [...(harness.windows as unknown[]), incoming];
            harness.emitAdded(incoming);
            let settledSecond = 0;
            while (harness.yields.length > 0 && settledSecond < 10) {
                harness.flushNextYield();
                settledSecond += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 2);
            assert.deepEqual((harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id), [
                "desktop-1",
                "desktop-2",
                "desktop-3",
            ]);
            assert.deepEqual(modeSnapshot(controller, mode), ["desktop-1", "desktop-2", "desktop-3"]);
        });

        it(`repeated cleanup dispatches after the first occupation's append settles are idempotent in ${mode} mode`, () => {
            const { harness, controller } = singleDesktopModeSetup(mode);
            const first = window();
            harness.windows = [first];
            harness.emitAdded(first);
            let settled = 0;
            while (harness.yields.length > 0 && settled < 10) {
                harness.flushNextYield();
                settled += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 1);
            const creates = harness.createDesktopCalls.length;
            const removals = harness.removedDesktops.length;
            const snapshot = modeSnapshot(controller, mode);
            harness.emitDesktopsChanged();
            harness.emitDesktopsChanged();
            assert.equal(harness.createDesktopCalls.length, creates);
            assert.equal(harness.removedDesktops.length, removals);
            assert.deepEqual(modeSnapshot(controller, mode), snapshot);
        });
    }
});
