import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { type RectCapability } from "../src/boundary";
import {
    AUTOMATIC_SPLIT_TARGET_CONFIG_KEY,
    AUTOMATIC_SPLIT_TARGETS,
    DEFAULT_AUTOMATIC_SPLIT_TARGET,
    DEFAULT_DROP_OUTLINE_PREVIEW,
    DEFAULT_TILING_ALGORITHM,
    DEFAULT_WORKSPACE_MODE,
    DROP_OUTLINE_PREVIEW_CONFIG_KEY,
    PROFILE_CATALOGS,
    REGISTERED_PROFILE_ACTION_IDS,
    SessionOutputKeys,
    ShortcutOverrides,
    TILING_ALGORITHMS,
    TileController,
    WORKSPACE_MODE_CONFIG_KEY,
    WORKSPACE_MODES,
    catalogValidationDiagnostics,
    ensureTrailingEmptyDesktop,
    outputTuple,
    parseAutomaticSplitTarget,
    parseDropOutlinePreview,
    parseTilingAlgorithm,
    parseWorkspaceMode,
    validateProfile,
    resolveSequence,
    selectAutomaticSplitTarget,
    selectProfile,
    type AutomaticSplitCandidate,
    type AutomaticSplitSelectionContext,
    type ControllerEnvironment,
    type CurrentScope,
    type ProfileCatalog,
    type RowClassification,
    type TrailingEmptyDomainRequest,
} from "../src/controller";
import { buildDwindleBlueprint, type Blueprint } from "../src/layout-blueprint";
import { type Rect } from "../src/logic";
import { PRESET_KINDS, presetBlueprint } from "../src/preset-catalog";

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

// A plain two-desktop scenario with desktop-1 current/visible and desktop-2
// empty and invisible, the minimal candidate for cleanup-eligibility tests.
// Ownership plays no role in removal eligibility, so the candidate is not
// marked owned.
function prepareExcessOwnedEmpty(harness: Harness): string {
    const candidate = { id: "desktop-2", x11DesktopNumber: 2 };
    harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }, candidate];
    harness.currentDesktop = { id: "desktop-1", x11DesktopNumber: 1 };
    harness.currentDesktopValue = { id: "desktop-1", x11DesktopNumber: 1 };
    harness.removedDesktops.length = 0;
    return candidate.id;
}

function modeCleanupSetup(mode: "per-output-local" | "global-unique" | "shared"): {
    readonly harness: Harness;
    readonly controller: TileController;
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
    harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, mode);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, focused };
}

function ownCleanupDesktops(controller: TileController, ids: readonly string[]): void {
    const inspectable = controller as unknown as {
        ownedDesktopIds: Set<string>;
        localWorkspaces: Map<string, string[]>;
    };
    for (const id of ids) {
        inspectable.ownedDesktopIds.add(id);
    }
    const key = controller.outputKeyFor(OUTPUT);
    if (key !== undefined) {
        inspectable.localWorkspaces.set(key, ["desktop-1", ...ids]);
    }
}

function configureSwitchCleanupScenario(
    harness: Harness,
    controller: TileController,
    owned = ["desktop-middle", "desktop-trailing"],
): void {
    const desktop1 = { id: "desktop-1", x11DesktopNumber: 1 };
    const middle = { id: "desktop-middle", x11DesktopNumber: 2 };
    const occupied = { id: "desktop-occupied", x11DesktopNumber: 3 };
    const trailing = { id: "desktop-trailing", x11DesktopNumber: 4 };
    harness.desktopsList = [desktop1, middle, occupied, trailing];
    harness.currentDesktop = desktop1;
    harness.currentDesktopValue = desktop1;
    harness.currentDesktopForOutputOverride = () => desktop1;
    harness.windows = [harness.active, window({ desktops: [occupied] })];
    ownCleanupDesktops(controller, owned);
    const inspectable = controller as unknown as { localWorkspaces: Map<string, string[]> };
    const key = controller.outputKeyFor(OUTPUT);
    if (key !== undefined) {
        inspectable.localWorkspaces.set(key, ["desktop-1", "desktop-middle", "desktop-occupied", "desktop-trailing"]);
    }
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


function dragSetup(dropOutlinePreview = false): {
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
    harness.configValues.set(DROP_OUTLINE_PREVIEW_CONFIG_KEY, dropOutlinePreview);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, origin, target, dragged, targetWindow };
}

// The live minimum-split floor failure: four full-width rows 245px tall inside
// a 980px working height (y 44..289, 289..534, 534..779, 779..1024). A 50/50
// vertical split of a 245px row yields 122.5px halves, below KWin's 15%
// working-height floor (147px), so the split must be refused before mutating.

function startDrag(dragged: TestWindow): void {
    dragged.move = true;
    dragged.resize = false;
    dragged.interactiveMoveResizeStarted.emit();
    dragged.move = false;
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



describe("TileController binding profile catalog", () => {
    // Pinned upstream fixtures (retrieved 2026-08-14):
    // - COSMIC: pop-os/cosmic-comp master data/keybindings.ron [C-KR]
    // - Hyprland: hyprwm/Hyprland main example/hyprland.lua (the generated
    //   default embeds exactly this example config)
    // - bspwm: baskerville/bspwm master examples/sxhkdrc (canonical example;
    //   bspwm ships no WM-enforced bindings)
    const workspacePinned = (): ReadonlyArray<readonly [string, string]> =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => [`workspace-${index}`, `Meta+${index}`] as const);
    const moveWorkspacePinned = (): ReadonlyArray<readonly [string, string]> =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => [`move-workspace-${index}`, `Meta+Shift+${index}`] as const);
    // Meta+Shift+<digit> never reaches the registered action on QWERTY-family
    // layouts (see SHIFT_DIGIT_SYMBOL_ALIAS in controller.ts); every
    // move-workspace-N row carries a compatibility-alias sibling under the
    // shifted symbol actually delivered on those layouts.
    const MOVE_WORKSPACE_SYMBOL_ALIASES: ReadonlyArray<readonly [string, string]> = [
        ["move-workspace-1-symbol", "Meta+!"],
        ["move-workspace-2-symbol", "Meta+@"],
        ["move-workspace-3-symbol", "Meta+#"],
        ["move-workspace-4-symbol", "Meta+$"],
        ["move-workspace-5-symbol", "Meta+%"],
        ["move-workspace-6-symbol", "Meta+^"],
        ["move-workspace-7-symbol", "Meta+&"],
        ["move-workspace-8-symbol", "Meta+*"],
        ["move-workspace-9-symbol", "Meta+("],
    ];
    const MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS: readonly [string, string] = ["move-workspace-0-symbol", "Meta+)"];

    const COSMIC_PINNED_EXACT: ReadonlyArray<readonly [string, string]> = [
        ["focus-left", "Meta+H"],
        ["focus-down", "Meta+J"],
        ["focus-up", "Meta+K"],
        ["focus-right", "Meta+L"],
        ["focus-left-arrow", "Meta+Left"],
        ["focus-down-arrow", "Meta+Down"],
        ["focus-up-arrow", "Meta+Up"],
        ["focus-right-arrow", "Meta+Right"],
        ["move-left", "Meta+Shift+H"],
        ["move-down", "Meta+Shift+J"],
        ["move-up", "Meta+Shift+K"],
        ["move-right", "Meta+Shift+L"],
        ["move-left-arrow", "Meta+Shift+Left"],
        ["move-down-arrow", "Meta+Shift+Down"],
        ["move-up-arrow", "Meta+Shift+Up"],
        ["move-right-arrow", "Meta+Shift+Right"],
        ["float-toggle", "Meta+G"],
        ["maximize", "Meta+M"],
        ...workspacePinned(),
        ...moveWorkspacePinned(),
        ["move-workspace-0", "Meta+Shift+0"],
        ["workspace-0", "Meta+0"],
        ["resize-mode-outwards", "Meta+R"],
        ["resize-mode-inwards", "Meta+Shift+R"],
    ];

    // Unimplemented catalog rows that must never register or resolve: they are
    // truthful component requirements, not exact/additive implemented actions.
    const COSMIC_PINNED_COMPONENT_REQUIREMENTS: ReadonlyArray<readonly [string, string]> = [
        ["previous-workspace-up", "Meta+Ctrl+Up"],
        ["previous-workspace-left", "Meta+Ctrl+Left"],
        ["previous-workspace-h", "Meta+Ctrl+H"],
        ["previous-workspace-k", "Meta+Ctrl+K"],
        ["next-workspace-down", "Meta+Ctrl+Down"],
        ["next-workspace-right", "Meta+Ctrl+Right"],
        ["next-workspace-j", "Meta+Ctrl+J"],
        ["next-workspace-l", "Meta+Ctrl+L"],
        ["fullscreen", "Meta+F11"],
        ["group-toggle", "Meta+S"],
    ];

    const HYPRLAND_PINNED_EXACT: ReadonlyArray<readonly [string, string]> = [
        ["focus-left-arrow", "Meta+Left"],
        ["focus-down-arrow", "Meta+Down"],
        ["focus-up-arrow", "Meta+Up"],
        ["focus-right-arrow", "Meta+Right"],
        ["float-toggle", "Meta+V"],
        ...workspacePinned(),
        ...moveWorkspacePinned(),
        ["move-workspace-0", "Meta+Shift+0"],
        ["workspace-0", "Meta+0"],
    ];

    const HYPRLAND_PINNED_ALIASES: ReadonlyArray<readonly [string, string]> = [
        ["focus-left", "Meta+H"],
        ["focus-down", "Meta+J"],
        ["focus-up", "Meta+K"],
        ["focus-right", "Meta+L"],
        ["move-left", "Meta+Shift+H"],
        ["move-down", "Meta+Shift+J"],
        ["move-up", "Meta+Shift+K"],
        ["move-right", "Meta+Shift+L"],
        ["move-left-arrow", "Meta+Shift+Left"],
        ["move-down-arrow", "Meta+Shift+Down"],
        ["move-up-arrow", "Meta+Shift+Up"],
        ["move-right-arrow", "Meta+Shift+Right"],
        ...MOVE_WORKSPACE_SYMBOL_ALIASES,
        MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS,
    ];

    const BSPWM_PINNED_CANONICAL: ReadonlyArray<readonly [string, string]> = [
        ["focus-left", "Meta+H"],
        ["focus-down", "Meta+J"],
        ["focus-up", "Meta+K"],
        ["focus-right", "Meta+L"],
        ["move-left", "Meta+Shift+H"],
        ["move-down", "Meta+Shift+J"],
        ["move-up", "Meta+Shift+K"],
        ["move-right", "Meta+Shift+L"],
        ...workspacePinned(),
        ...moveWorkspacePinned(),
        ["move-workspace-0", "Meta+Shift+0"],
        ["workspace-0", "Meta+0"],
        ["float-toggle", "Meta+S"],
        ["resize-expand-left", "Meta+Alt+H"],
        ["resize-expand-down", "Meta+Alt+J"],
        ["resize-expand-up", "Meta+Alt+K"],
        ["resize-expand-right", "Meta+Alt+L"],
        ["resize-contract-left", "Meta+Alt+Shift+H"],
        ["resize-contract-down", "Meta+Alt+Shift+J"],
        ["resize-contract-up", "Meta+Alt+Shift+K"],
        ["resize-contract-right", "Meta+Alt+Shift+L"],
    ];

    // bspwm's prev/next-workspace and fullscreen rows are unimplemented
    // component requirements, never registered or sequence-resolvable.
    const BSPWM_PINNED_COMPONENT_REQUIREMENTS: ReadonlyArray<readonly [string, string]> = [
        ["previous-workspace", "Meta+BracketLeft"],
        ["next-workspace", "Meta+BracketRight"],
        ["fullscreen", "Meta+F"],
    ];

    // Project-required arrow aliases for the directional families. bspwm's
    // sxhkdrc ships no arrow focus and its only arrow binding (super+{Left,..}
    // bspc node -v) is a floating-window nudge, not the tiled move/swap action,
    // so the arrow rows are project parity aliases, never canonical-example.
    const BSPWM_PINNED_ALIASES: ReadonlyArray<readonly [string, string]> = [
        ["focus-left-arrow", "Meta+Left"],
        ["focus-down-arrow", "Meta+Down"],
        ["focus-up-arrow", "Meta+Up"],
        ["focus-right-arrow", "Meta+Right"],
        ["move-left-arrow", "Meta+Shift+Left"],
        ["move-down-arrow", "Meta+Shift+Down"],
        ["move-up-arrow", "Meta+Shift+Up"],
        ["move-right-arrow", "Meta+Shift+Right"],
        ...MOVE_WORKSPACE_SYMBOL_ALIASES,
        MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS,
    ];

    function projected(
        catalog: ProfileCatalog,
        classification: RowClassification,
    ): ReadonlyArray<readonly [string, string]> {
        return catalog.rows
            .filter((row) => row.classification === classification)
            .map((row) => [row.actionId, row.sequence] as const);
    }

    it("pins the cosmic catalog exactly to its upstream fixture with Meta+0 active", () => {
        assert.deepEqual(projected(PROFILE_CATALOGS.cosmic, "exact"), COSMIC_PINNED_EXACT);
        assert.deepEqual(projected(PROFILE_CATALOGS.cosmic, "compatibility-alias"), [
            ...MOVE_WORKSPACE_SYMBOL_ALIASES,
            MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS,
        ]);
        assert.deepEqual(projected(PROFILE_CATALOGS.cosmic, "deferred"), []);
        // Unimplemented rows are truthfully classified component requirements,
        // never exact rows and never resolvable.
        assert.deepEqual(
            projected(PROFILE_CATALOGS.cosmic, "component-requirement"),
            COSMIC_PINNED_COMPONENT_REQUIREMENTS,
        );
    });

    it("pins the hyprland catalog to its upstream default plus explicitly-classified parity aliases", () => {
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "exact"), HYPRLAND_PINNED_EXACT);
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "compatibility-alias"), HYPRLAND_PINNED_ALIASES);
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "deferred"), []);
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "component-requirement"), []);
    });

    it("pins the bspwm catalog to its canonical sxhkdrc rows plus project parity arrow aliases", () => {
        assert.deepEqual(projected(PROFILE_CATALOGS.bspwm, "canonical-example"), BSPWM_PINNED_CANONICAL);
        assert.deepEqual(projected(PROFILE_CATALOGS.bspwm, "compatibility-alias"), BSPWM_PINNED_ALIASES);
        assert.deepEqual(projected(PROFILE_CATALOGS.bspwm, "deferred"), []);
        assert.deepEqual(
            projected(PROFILE_CATALOGS.bspwm, "component-requirement"),
            BSPWM_PINNED_COMPONENT_REQUIREMENTS,
        );
    });

    it("classifies every row of every shipped profile", () => {
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            for (const row of profile.rows) {
                assert.equal(
                    ["exact", "canonical-example", "compatibility-alias", "deferred", "component-requirement"].includes(
                        row.classification,
                    ),
                    true,
                    `${profile.key}:${row.shortcutId}`,
                );
            }
        }
    });

    it("validates every shipped profile with zero in-profile duplicate sequences or ID conflicts", () => {
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            const validation = validateProfile(profile);
            assert.equal(validation.ok, true, profile.key);
            assert.deepEqual(validation.duplicateSequences, [], profile.key);
            assert.deepEqual(validation.shortcutIdConflicts, [], profile.key);
        }
    });

    it("rejects duplicate effective sequences and names both conflicting action IDs", () => {
        const conflicting = validateProfile({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows.filter((row) => row.classification !== "deferred"),
                { ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")!, shortcutId: "duplicate-row" },
            ],
        });
        assert.equal(conflicting.ok, false);
        assert.deepEqual(conflicting.duplicateSequences, [
            { sequence: "Meta+L", actionIds: ["focus-right", "focus-right"] },
        ]);
    });

    it("rejects duplicate shortcut names and reports both conflicting action IDs", () => {
        const conflicting = validateProfile({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows,
                { ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "maximize")!, shortcutId: "plasma-auto-tiler-float-toggle" },
            ],
        });
        assert.equal(conflicting.ok, false);
        assert.deepEqual(conflicting.shortcutIdConflicts, [
            { shortcutId: "plasma-auto-tiler-float-toggle", actionIds: ["float-toggle", "maximize"] },
        ]);
    });

    it("selects the cosmic catalog when the config is absent and when it is invalid, with a diagnostic only for invalid", () => {
        assert.deepEqual(selectProfile(undefined).profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile(undefined).diagnostics, []);
        assert.deepEqual(selectProfile(null).profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile("").profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile("cosmic").profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile("hyprland").profile, PROFILE_CATALOGS.hyprland);
        assert.deepEqual(selectProfile("bspwm").profile, PROFILE_CATALOGS.bspwm);
        const invalid = selectProfile("not-a-profile");
        assert.deepEqual(invalid.profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(invalid.diagnostics, ["profile-invalid:fallback-cosmic"]);
    });

    it("applies user override > selected baseline > profile default without touching the catalog default", () => {
        const overrides = new ShortcutOverrides();
        overrides.set("focus-right", "Meta+Alt+L");
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "focus-right", overrides), "Meta+Alt+L");
        // Switch the selected baseline; the override survives and still wins.
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "focus-right", overrides), "Meta+Alt+L");
        // Without an override the baseline wins; the catalog default is untouched.
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "focus-right"), "Meta+L");
        assert.equal(
            PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")?.sequence,
            "Meta+L",
        );
        // A baseline row wins over the cosmic profile default.
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "float-toggle"), "Meta+V");
        assert.equal(resolveSequence(PROFILE_CATALOGS.bspwm, "float-toggle"), "Meta+S");
        // An action the selected profile lacks falls back to the cosmic profile default.
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "maximize"), "Meta+M");
        // Unknown actions resolve to null.
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "no-such-action"), null);
    });

    it("never registers or resolves unimplemented component-requirement rows, in any profile", () => {
        // Truthfulness regression: fullscreen, previous/next-workspace, and
        // group rows used to be catalogued as exact/canonical-example (implying
        // implemented and additive) while registration silently skipped them.
        // They are now truthfully component requirements: never registered,
        // never sequence-resolvable, and never reported as registered.
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            const rows = profile.rows.filter((row) => row.classification === "component-requirement");
            assert.ok(rows.length > 0 || profile.key === "hyprland", profile.key);
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", profile.key);
            new TileController(harness.environment()).start();
            for (const row of rows) {
                assert.equal(
                    harness.shortcuts.some((entry) => entry.name === row.shortcutId),
                    false,
                    `${profile.key}:${row.shortcutId} must never register`,
                );
                assert.equal(
                    harness.shortcuts.some((entry) => entry.sequence === row.sequence && entry.name !== row.shortcutId),
                    false,
                    `${profile.key}:${row.actionId} sequence must not be claimed by another row`,
                );
                // The model layer cannot resolve the action to any live
                // sequence either: no baseline, no profile default.
                assert.equal(resolveSequence(profile, row.actionId), null, `${profile.key}:${row.actionId}`);
            }
        }
        // The registered-set derivation excludes every component-requirement
        // row, so no registration diagnostic or catalog claim can name them.
        for (const row of PROFILE_CATALOGS.cosmic.rows) {
            if (row.classification === "component-requirement") {
                assert.equal(REGISTERED_PROFILE_ACTION_IDS.has(row.actionId), false, row.actionId);
            }
        }
    });

    it("registers the selected profile's catalog rows, including Meta+0 under its stable ID", () => {
        const cosmic = new Harness();
        new TileController(cosmic.environment()).start();
        const cosmicSequences = new Map(cosmic.shortcuts.map((entry) => [entry.name, entry.sequence]));
        assert.equal(cosmicSequences.get("plasma-auto-tiler-focus-left"), "Meta+H");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-focus-right"), "Meta+L");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-move-left"), "Meta+Shift+H");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-workspace-0"), "Meta+0");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-move-workspace-append"), "Meta+Shift+0");
        assert.equal(countEvent(cosmic.logs, "profile-invalid:fallback-cosmic"), 0);

        const hyprland = new Harness();
        hyprland.configValues.set("shortcutProfile", "hyprland");
        new TileController(hyprland.environment()).start();
        const hyprlandSequences = new Map(hyprland.shortcuts.map((entry) => [entry.name, entry.sequence]));
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-focus-right-arrow"), "Meta+Right");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-focus-right"), "Meta+L");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-float-toggle"), "Meta+V");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-workspace-0"), "Meta+0");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-move-workspace-append"), "Meta+Shift+0");

        const invalid = new Harness();
        invalid.configValues.set("shortcutProfile", "bogus");
        new TileController(invalid.environment()).start();
        const invalidSequences = new Map(invalid.shortcuts.map((entry) => [entry.name, entry.sequence]));
        assert.equal(invalidSequences.get("plasma-auto-tiler-focus-left"), "Meta+H");
        assert.equal(countEvent(invalid.logs, "profile-invalid:fallback-cosmic"), 1);
    });

    it("registers every alias under a distinct shortcut ID and Meta+0 under the stable ID in every profile", () => {
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const names = harness.shortcuts.map((entry) => entry.name);
            assert.equal(new Set(names).size, names.length, key);
            assert.equal(names.includes("plasma-auto-tiler-workspace-0"), true, key);
            assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), true, key);
        }
    });

    it("never registers profile actions without a controller implementation as false equivalents", () => {
        const componentRequirements = [
            "plasma-auto-tiler-fullscreen",
            "plasma-auto-tiler-group-toggle",
            "plasma-auto-tiler-previous-workspace-up",
            "plasma-auto-tiler-previous-workspace-left",
            "plasma-auto-tiler-previous-workspace-h",
            "plasma-auto-tiler-previous-workspace-k",
            "plasma-auto-tiler-next-workspace-down",
            "plasma-auto-tiler-next-workspace-right",
            "plasma-auto-tiler-next-workspace-j",
            "plasma-auto-tiler-next-workspace-l",
            "plasma-auto-tiler-previous-workspace",
            "plasma-auto-tiler-next-workspace",
        ];
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const names = harness.shortcuts.map((entry) => entry.name);
            for (const shortcutId of componentRequirements) {
                assert.equal(names.includes(shortcutId), false, `${key}:${shortcutId}`);
            }
        }
    });

    it("documents the script-local registration boundary without claiming Plasma-global takeover", () => {
        // Spec H.16: script-local registration is evidence of attempted
        // registration only; no v1 behavior displaces or reassigns a Plasma
        // global shortcut. The controller emits no migration diagnostic and the
        // aggregate gate only reflects registerShortcut results.
        const { harness } = setup();
        for (const entry of harness.logs) {
            assert.equal(entry.includes("displaced"), false);
            assert.equal(entry.includes("migrated"), false);
            assert.equal(entry.includes("kglobalshortcutsrc"), false);
        }
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
    });

    it("registers identical stable shortcut IDs across reload/restart, keeping user overrides model-pure", () => {
        // Plan Unit 03 acceptance 1: every catalog row re-registers under the
        // same stable shortcut ID on reload/restart, so KGlobalAccel keeps the
        // same row and a user-customized sequence is never silently
        // overwritten. The override stays a pure model seam: reload does not
        // read or mutate KGlobalAccel and never inspects a live session.
        const first = new Harness();
        new TileController(first.environment()).start();
        const firstNames = first.shortcuts.map((entry) => entry.name);
        const restart = new Harness();
        new TileController(restart.environment()).start();
        assert.deepEqual(restart.shortcuts.map((entry) => entry.name), firstNames);
        assert.ok(firstNames.includes("plasma-auto-tiler-focus-left"));
        assert.ok(firstNames.includes("plasma-auto-tiler-workspace-0"));
        assert.ok(firstNames.includes("plasma-auto-tiler-move-workspace-append"));
        // A user override set before a profile switch still wins, and the
        // catalog-owned default is never mutated.
        const overrides = new ShortcutOverrides();
        overrides.set("focus-right", "Meta+Alt+L");
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "focus-right", overrides), "Meta+Alt+L");
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "focus-right", overrides), "Meta+Alt+L");
        assert.equal(
            PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")?.sequence,
            "Meta+L",
        );
        assert.equal(
            PROFILE_CATALOGS.hyprland.rows.find((row) => row.actionId === "focus-right")?.sequence,
            "Meta+L",
        );
    });

    it("emits per-registration inability diagnostics naming the failing shortcut ID", () => {
        const harness = new Harness();
        for (let index = 0; index < 4; index += 1) {
            harness.shortcutResults.push(true);
        }
        harness.shortcutResults.push(false);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "shortcut-register-failed:plasma-auto-tiler-focus-left"), 1);
        assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
    });

    it("reports catalog collision and ID-conflict diagnostics naming both conflicting action IDs", () => {
        const sequenceCollision = catalogValidationDiagnostics({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows.filter((row) => row.classification !== "deferred"),
                {
                    ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")!,
                    shortcutId: "duplicate-row",
                },
            ],
        });
        assert.deepEqual(sequenceCollision, ["shortcut-catalog-collision:Meta+L:focus-right:focus-right"]);
        const idConflict = catalogValidationDiagnostics({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows,
                {
                    ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "maximize")!,
                    shortcutId: "plasma-auto-tiler-float-toggle",
                    sequence: "Meta+Shift+M",
                },
            ],
        });
        assert.deepEqual(idConflict, [
            "shortcut-id-conflict:plasma-auto-tiler-float-toggle:float-toggle:maximize",
        ]);
    });

    it("emits no catalog collision diagnostic for any shipped profile", () => {
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            assert.equal(
                harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:shortcut-catalog-collision")),
                false,
                key,
            );
            assert.equal(
                harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:shortcut-id-conflict")),
                false,
                key,
            );
        }
    });

    it("registers Meta+0 under the stable ID in every profile and never registers a legacy append ID", () => {
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const meta0 = harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-workspace-0");
            assert.ok(meta0, `${key}: stable Meta+0 ID must register`);
            assert.equal(meta0?.sequence, "Meta+0", key);
            assert.equal(
                harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-workspace-append"),
                false,
                key,
            );
        }
    });

    it("preserves a user override under the stable Meta+0 ID across profile switches", () => {
        // A user-customized value for `workspace-0` survives a reload and a
        // profile switch and takes precedence over the catalog-owned default,
        // exactly like every other implemented action (plan Unit 01 acceptance 4).
        const overrides = new ShortcutOverrides();
        overrides.set("workspace-0", "Meta+Alt+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "workspace-0", overrides), "Meta+Alt+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "workspace-0", overrides), "Meta+Alt+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.bspwm, "workspace-0", overrides), "Meta+Alt+0");
        // Without an override the catalog default (Meta+0) wins and is never
        // mutated by the override layer.
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "workspace-0"), "Meta+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "workspace-0"), "Meta+0");
        assert.equal(PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "workspace-0")?.sequence, "Meta+0");
    });

    it("derives the registered action ID set in exact order and content", () => {
        // Pins the ES2017-safe explicit-loop derivation of the registered set
        // (Array.prototype.flatMap is ES2019 and this KWin QJSEngine rejects it).
        // Content and insertion order must match the previous flatMap build.
        const expected: string[] = [];
        for (const family of ["focus", "move"]) {
            for (const direction of ["left", "down", "up", "right"]) {
                expected.push(`${family}-${direction}`, `${family}-${direction}-arrow`);
            }
        }
        expected.push("float-toggle", "maximize", "resize-mode-outwards", "resize-mode-inwards");
        for (const kind of ["expand", "contract"]) {
            for (const direction of ["left", "down", "up", "right"]) {
                expected.push(`resize-${kind}-${direction}`);
            }
        }
        expected.push("move-workspace-0", "move-workspace-0-symbol", "workspace-0");
        for (let index = 1; index <= 9; index += 1) {
            expected.push(`workspace-${index}`, `move-workspace-${index}`, `move-workspace-${index}-symbol`);
        }
        assert.deepEqual([...REGISTERED_PROFILE_ACTION_IDS], expected);
    });

    it("declares every catalog reference source tag in the comparison document", () => {
        // The catalog rows are the single enumerated source: the leading
        // `[TAG]` of every row reference must resolve to a primary-source tag
        // parsed from the document's Primary source list, so neither side is a
        // duplicated literal list here.
        const lines = readFileSync("../docs/reference-wm-comparison.md", "utf8").split("\n");
        const sectionStart = lines.findIndex((line) => line.trim() === "## Primary source list");
        assert.notEqual(sectionStart, -1, "missing ## Primary source list section");
        const declared = new Set<string>();
        for (const line of lines.slice(sectionStart + 1)) {
            if (line.trim().startsWith("---")) {
                break;
            }
            const match = /^\|\s*\[([^\]]+)\]\s*\|/.exec(line);
            if (match !== null) {
                declared.add(match[1]!);
            }
        }
        const catalogTags = new Set<string>();
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            for (const row of profile.rows) {
                const match = /^\[([^\]]+)\]/.exec(row.reference);
                if (match !== null) {
                    catalogTags.add(match[1]!);
                }
            }
        }
        assert.ok(catalogTags.size > 0, "catalog must expose reference source tags");
        for (const tag of [...catalogTags].sort()) {
            assert.ok(
                declared.has(tag),
                `catalog reference source tag not declared in docs/reference-wm-comparison.md: ${tag}`,
            );
        }
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

    it("registers exactly the catalog-driven all-or-nothing action set, including Meta+0", () => {
        const { harness } = setup();
        const expected = new Set<string>([
            ...PROFILE_CATALOGS.cosmic.rows
                .filter((row) => row.classification !== "deferred" && REGISTERED_PROFILE_ACTION_IDS.has(row.actionId))
                .map((row) => row.shortcutId),
            "plasma-auto-tiler-insert-right",
            "plasma-auto-tiler-insert-left",
            "plasma-auto-tiler-insert-up",
            "plasma-auto-tiler-insert-down",
            "plasma-auto-tiler-detach",
            "plasma-auto-tiler-attach",
            "plasma-auto-tiler-sticky-toggle",
            "plasma-auto-tiler-fill-scope",
            "plasma-auto-tiler-apply-columns",
            "plasma-auto-tiler-apply-rows",
            "plasma-auto-tiler-apply-balanced-grid",
            "plasma-auto-tiler-apply-dwindle",
        ]);
        const names = harness.shortcuts.map((entry) => entry.name).sort();
        assert.deepEqual(names, [...expected].sort());
        assert.equal(names.includes("plasma-auto-tiler-workspace-0"), true);
        assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), true);
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

// Install a splitter that mirrors KWin's `CustomTile::split()` inline mutation
// under the minimum-geometry boundary. Unlike `installCapacityRejectingSplitter`
// (which returns an invalid pair without realizing the split), this splitter
// realizes the split in the live tree *before* the controller can validate the
// returned children: while `state.rejecting` is true it turns the tile into a
// layout whose first child carries zero extent on the split axis (KWin's
// below-minimum empty child). A controller that splits before preflighting
// therefore leaves the tree mutated even though `orderedChildren` then rejects
// the pair.
function installInlineMutatingRejectingSplitter(tile: TestTile, state: { rejecting: boolean }): void {
    tile.split = (direction) => {
        const horizontal = direction === 1;
        const validA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const validB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        if (state.rejecting) {
            const empty = makeTile(
                horizontal ? { x: 0, y: 0, width: 0, height: 100 } : { x: 0, y: 0, width: 100, height: 0 },
            );
            installDwindleSplitter(empty);
            installDwindleSplitter(validB);
            tile.tiles = [empty, validB];
            return [empty, validB];
        }
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

// Structural shape check for any preset blueprint: the live tree must realize
// the blueprint exactly, with the first decoded child as the left subtree and
// the second as the right subtree, and each branch carrying the orientation the
// blueprint node itself declares.
function assertPresetShape(tile: TestTile, blueprint: Blueprint): void {
    if (blueprint.kind === "leaf") {
        assert.equal(tile.isLayout, false);
        return;
    }
    assert.equal(tile.isLayout, true);
    assert.equal(tile.layoutDirection, blueprint.orientation === "horizontal" ? 1 : 2);
    const children = tile.tiles as TestTile[];
    assert.equal(children.length, 2);
    const left = children[0];
    const right = children[1];
    assert.ok(left !== undefined && right !== undefined);
    assertPresetShape(left, blueprint.left);
    assertPresetShape(right, blueprint.right);
}

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
});

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
        harness.emitCurrentDesktopChanged(null, desktop2, null);
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

describe("TileController automatic dwindle insertion preflight", () => {
    it("refuses an undersized automatic insertion before splitting, leaving the tree unmutated and the newcomer floating", () => {
        const harness = new Harness();
        // A dwindle(1) scope whose single leaf (20px wide in a 100px working
        // area) halves to 10px on a horizontal split, below the 15% working
        // width floor (15px), so the intended insertion is genuinely undersized.
        const root = tile({ x: 0, y: 0, width: 20, height: 100 });
        const first = window({ tile: root });
        root.windows = [first];
        const seam = { rejecting: true };
        installInlineMutatingRejectingSplitter(root, seam);
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

        // The intended leaf must be preflighted before any split, so a refused
        // insertion mutates nothing. Pre-change the split ran first and realized
        // an empty child inline, so the tree below is a layout holding a
        // zero-width leaf and this first assertion fails.
        assert.equal(root.isLayout, false, "the intended leaf must not be split before the refusal");
        assert.deepEqual(root.tiles, []);
        assert.deepEqual(root.windows, [first]);
        assert.equal(first.tile, root);
        // Only the newcomer stays floating: no gap, no inert scope.
        assert.equal(second.tile, null, "the impossible newcomer stays floating");
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        // The refusal must not rely on a failed split plus reconstruction
        // recovery, so no reconstruction is armed and no yield is queued.
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("still splits the insertion when the working area is unreadable instead of inventing a floor", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 20, height: 100 });
        const first = window({ tile: root });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        // No readable working area: the preflight must not invent a minimum
        // floor, so the insertion proceeds exactly as before the change.
        harness.clientArea = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);

        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(root.isLayout, true);
        const children = root.tiles as TestTile[];
        assert.equal(children.length, 2);
        assert.equal(first.tile, children[0]);
        assert.equal(second.tile, children[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("falls back to the closest eligible leaf when the intended right-spine leaf is undersized", () => {
        const harness = new Harness();
        // A dwindle(2) scope H[a, b] whose right-spine leaf `b` (50x20) is too
        // short to split vertically (20/2 = 10 < 15% of the 100px working
        // height), while `a` (50x100) is eligible. The insertion falls back to
        // splitting `a` under its own depth-one (vertical) orientation.
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 20 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The undersized intended leaf `b` is untouched; the eligible `a` is
        // split vertically and receives the newcomer on its second child.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(b.isLayout, false);
        assert.deepEqual(b.tiles, []);
        assert.equal(bWin.tile, b);
        assert.equal(a.isLayout, true);
        assert.equal(a.layoutDirection, 2);
        const aChildren = a.tiles as TestTile[];
        assert.equal(aChildren.length, 2);
        assert.equal(aWin.tile, aChildren[0]);
        assert.equal(incoming.tile, aChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("resolves an equal-distance fallback tie to the earlier compareLeaves leaf", () => {
        const harness = new Harness();
        // A dwindle(3) tree H[V[A1, A2], M] whose right-spine leaf `M` (50x20,
        // depth one, vertical) is undersized. In compareLeaves order the leaves
        // are A1 (x:0,y:0), M (x:50,y:0), A2 (x:0,y:50): M sits at the middle index, so A1
        // and A2 are both one index away. Both are eligible (depth two,
        // horizontal, 50px wide), so the earlier A1 wins the tie.
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, true);
        left.layoutDirection = 2;
        const a1 = tile({ x: 0, y: 0, width: 50, height: 50 });
        const a2 = tile({ x: 0, y: 50, width: 50, height: 50 });
        const m = tile({ x: 50, y: 0, width: 50, height: 20 });
        const a1Win = window({ tile: a1, caption: "a1" });
        const a2Win = window({ tile: a2, caption: "a2" });
        const mWin = window({ tile: m, caption: "m" });
        a1.windows = [a1Win];
        a2.windows = [a2Win];
        m.windows = [mWin];
        left.tiles = [a1, a2];
        root.tiles = [left, m];
        installDwindleSplitter(a1);
        installDwindleSplitter(a2);
        installDwindleSplitter(m);
        harness.root = root;
        harness.active = a1Win;
        harness.windows = [a1Win, a2Win, mWin];
        attachTileWriter(a1Win);
        attachTileWriter(a2Win);
        attachTileWriter(mWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [a1Win, a2Win, mWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The earlier compareLeaves candidate A1 wins the equal-distance tie;
        // M and A2 are untouched.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(m.isLayout, false);
        assert.equal(a2.isLayout, false);
        assert.equal(mWin.tile, m);
        assert.equal(a2Win.tile, a2);
        assert.equal(a1.isLayout, true);
        assert.equal(a1.layoutDirection, 1);
        const a1Children = a1.tiles as TestTile[];
        assert.equal(a1Children.length, 2);
        assert.equal(a1Win.tile, a1Children[0]);
        assert.equal(incoming.tile, a1Children[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });
});

describe("TileController automatic split target insertion", () => {
    it("keeps the default dwindle split on the deepest-right-spine leaf even when another leaf is larger", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // Absent `automaticSplitTarget` keeps the dwindle intent: the larger
        // leaf `a` is not chosen, and the deepest-right-spine `b` is split.
        assert.equal(controller.automaticSplitTargetSnapshot(), "dwindle");
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(a.isLayout, false);
        assert.equal(aWin.tile, a);
        assert.equal(b.isLayout, true);
        const bChildren = b.tiles as TestTile[];
        assert.equal(bChildren.length, 2);
        assert.equal(bWin.tile, bChildren[0]);
        assert.equal(incoming.tile, bChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("largest splits the greatest-area occupied leaf instead of the deepest-right-spine leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "largest");
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // `largest` selects the greater-area occupied leaf `a` over the
        // deepest-right-spine `b`, and `b` is untouched.
        assert.equal(controller.automaticSplitTargetSnapshot(), "largest");
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(b.isLayout, false);
        assert.equal(bWin.tile, b);
        assert.equal(a.isLayout, true);
        const aChildren = a.tiles as TestTile[];
        assert.equal(aChildren.length, 2);
        assert.equal(aWin.tile, aChildren[0]);
        assert.equal(incoming.tile, aChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("active splits the active in-scope occupied leaf over the deepest-right-spine leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "active");
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // `active` selects the active occupied leaf `a`; the deepest `b` stays
        // untouched.
        assert.equal(controller.automaticSplitTargetSnapshot(), "active");
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(b.isLayout, false);
        assert.equal(bWin.tile, b);
        assert.equal(a.isLayout, true);
        const aChildren = a.tiles as TestTile[];
        assert.equal(aChildren.length, 2);
        assert.equal(aWin.tile, aChildren[0]);
        assert.equal(incoming.tile, aChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("active falls back to the dwindle deepest-right-spine leaf when the active window is floating", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "active");
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        harness.active = incoming;
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The active window is the incoming floating window (no leaf): the
        // `active` intent falls back to the dwindle deepest-right-spine `b`.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(a.isLayout, false);
        assert.equal(aWin.tile, a);
        assert.equal(b.isLayout, true);
        const bChildren = b.tiles as TestTile[];
        assert.equal(bChildren.length, 2);
        assert.equal(bWin.tile, bChildren[0]);
        assert.equal(incoming.tile, bChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("applies the nearest-splittable fallback relative to the selected active leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "active");
        // H[V[A1, A2], M]: the active leaf A1 (20x100) is undersized for its
        // depth-two horizontal split (10 < 15px floor), while A2 and M are
        // splittable. The dwindle deepest-right-spine leaf is M, so this
        // proves the fallback resolves from the selected A1 intent, not the
        // dwindle intent.
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, true);
        left.layoutDirection = 2;
        const a1 = tile({ x: 0, y: 0, width: 20, height: 100 });
        const a2 = tile({ x: 20, y: 0, width: 30, height: 100 });
        const m = tile({ x: 50, y: 0, width: 50, height: 100 });
        const a1Win = window({ tile: a1, caption: "a1" });
        const a2Win = window({ tile: a2, caption: "a2" });
        const mWin = window({ tile: m, caption: "m" });
        a1.windows = [a1Win];
        a2.windows = [a2Win];
        m.windows = [mWin];
        left.tiles = [a1, a2];
        root.tiles = [left, m];
        installDwindleSplitter(a1);
        installDwindleSplitter(a2);
        installDwindleSplitter(m);
        harness.root = root;
        harness.active = a1Win;
        harness.windows = [a1Win, a2Win, mWin];
        attachTileWriter(a1Win);
        attachTileWriter(a2Win);
        attachTileWriter(mWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [a1Win, a2Win, mWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The selected active leaf A1 is not split (undersized), the dwindle
        // deepest M is not split, and the eligible leaf nearest to A1 by
        // stable compareLeaves ordinal (A2) receives the split.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(a1.isLayout, false);
        assert.equal(a1Win.tile, a1);
        assert.equal(m.isLayout, false);
        assert.equal(mWin.tile, m);
        assert.equal(a2.isLayout, true);
        assert.equal(a2.layoutDirection, 1);
        const a2Children = a2.tiles as TestTile[];
        assert.equal(a2Children.length, 2);
        assert.equal(a2Win.tile, a2Children[0]);
        assert.equal(incoming.tile, a2Children[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("floats the newcomer without topology mutation when largest has no occupied leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "largest");
        const root = tile(RECT, true);
        const leaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        leaf.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Collapse the owned scope down to N=0 (an empty zero-child layout
        // root), matching the removal path of the established N=0 tests.
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

        // `largest` yields no eligible occupied intended leaf on the empty
        // scope: the newcomer floats and the tree stays untouched.
        const incoming = window();
        harness.windows = [incoming];
        harness.active = incoming;
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-refused:no-eligible-leaf"), 1);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, []);
        assert.deepEqual(root.windows, []);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
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
    it("requests the same cleanup pass on every dispatcher trigger, not only a completed switch (Q7 broadened trigger)", () => {
        // The removal pass now always runs when cleanupDesktops runs,
        // regardless of the trigger; there is no longer a distinct
        // "enhanced"/switch-only cleanup call.
        const { harness, controller } = setup();
        let cleanupCalls = 0;
        const inspectable = controller as unknown as {
            cleanupDesktops: () => void;
        };
        inspectable.cleanupDesktops = () => {
            cleanupCalls += 1;
        };

        harness.emitCurrentDesktopChanged(DESKTOP, DESKTOP, OUTPUT);
        assert.equal(cleanupCalls, 1);

        cleanupCalls = 0;
        harness.screensChanged?.();
        assert.equal(cleanupCalls, 1, "output/screen changes trigger cleanup");

        cleanupCalls = 0;
        harness.emitAdded(window());
        assert.equal(cleanupCalls, 1, "window changes trigger cleanup");

        cleanupCalls = 0;
        harness.emitDesktopsChanged();
        assert.equal(cleanupCalls, 1, "desktop scope changes trigger cleanup");
    });

    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`removes every empty invisible owned desktop after a switch in ${mode} mode (no reserved trailing capacity)`, () => {
            const { harness, controller } = modeCleanupSetup(mode);
            configureSwitchCleanupScenario(harness, controller);
            harness.removedDesktops.length = 0;

            harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

            if (mode === "per-output-local") {
                // per-output-local now protects the structurally-identified
                // trailing (last-positioned) empty desktop (Q-Domain):
                // desktop-middle is still removed, but desktop-trailing
                // survives as the output's reserved trailing empty.
                assert.deepEqual(
                    harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                    ["desktop-middle"],
                );
                assert.deepEqual(
                    (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                );
                assert.deepEqual(Object.values(controller.localWorkspaceSnapshot()), [
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                ]);
                return;
            }
            if (mode === "global-unique") {
                // global-unique (unit-03) now enforces the same trailing-
                // empty invariant over its single global domain: desktop-
                // middle is still removed, but desktop-trailing (the
                // structurally-last live desktop) survives as the reserved
                // global trailing empty.
                assert.deepEqual(
                    harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                    ["desktop-middle"],
                );
                assert.deepEqual(
                    (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                );
                assert.deepEqual(Object.values(controller.globalUniqueAssignmentSnapshot()), [
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                ]);
                return;
            }
            // shared (unit-07) now enforces the same trailing-empty invariant
            // over its single global domain (the entire live desktop list):
            // desktop-middle is still removed, but desktop-trailing (the
            // structurally-last live desktop) survives as the reserved
            // global trailing empty.
            assert.deepEqual(
                harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                ["desktop-middle"],
            );
            assert.deepEqual(
                (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
                ["desktop-1", "desktop-occupied", "desktop-trailing"],
            );
            assert.deepEqual(controller.sharedWorkspaceSnapshot(), ["desktop-1", "desktop-occupied", "desktop-trailing"]);
        });
    }

    it("removes every eligible non-trailing empty invisible desktop in one per-output-local pass, protecting only the trailing one", () => {
        // enforceLocalTrailingEmpties() computes its removal set from one
        // fixed occupancy/visibility snapshot per domain and does not loop or
        // re-read state mid-pass (spec: no debounce/re-reading loop as an
        // anti-oscillation mechanism) - every eligible non-trailing empty in
        // the domain is removed together, and the structurally-last entry is
        // always protected regardless of how many other empties exist.
        const { harness, controller } = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(harness, controller, [
            "desktop-middle",
            "desktop-middle-2",
            "desktop-middle-3",
            "desktop-trailing",
        ]);
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-middle", x11DesktopNumber: 2 },
            { id: "desktop-middle-2", x11DesktopNumber: 3 },
            { id: "desktop-middle-3", x11DesktopNumber: 4 },
            { id: "desktop-occupied", x11DesktopNumber: 5 },
            { id: "desktop-trailing", x11DesktopNumber: 6 },
        ];
        const inspectable = controller as unknown as { localWorkspaces: Map<string, string[]> };
        const key = controller.outputKeyFor(OUTPUT);
        if (key !== undefined) {
            inspectable.localWorkspaces.set(key, [
                "desktop-1",
                "desktop-middle",
                "desktop-middle-2",
                "desktop-middle-3",
                "desktop-occupied",
                "desktop-trailing",
            ]);
        }

        harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

        // desktop-middle, desktop-middle-2, and desktop-middle-3 are all
        // empty and invisible in the same snapshot and are removed together;
        // desktop-trailing is the structurally-last domain entry and is
        // protected.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-middle", "desktop-middle-2", "desktop-middle-3"],
        );
        assert.deepEqual(
            (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
            ["desktop-1", "desktop-occupied", "desktop-trailing"],
        );
        // Repeated dispatches against the settled state are a pure no-op.
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    for (const mode of ["per-output-local", "global-unique"] as const) {
        it(`keeps a switch-cleanup candidate visible on another output in ${mode} mode, but still removes the other empty invisible one`, () => {
            const { harness, controller } = modeCleanupSetup(mode);
            configureSwitchCleanupScenario(harness, controller);
            const other = { ...OUTPUT, name: "screen-2" };
            harness.screensList = [OUTPUT, other];
            harness.currentDesktopForOutputOverride = (output) =>
                output === other ? { id: "desktop-middle" } : { id: "desktop-1" };

            harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

            // desktop-middle is visible on the other output and desktop-
            // trailing is the structurally-last domain entry (Q-Domain, and
            // for global-unique unit-03 the structurally-last live desktop):
            // both survive, so nothing is removed.
            assert.deepEqual(
                harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                [],
            );
        });
    }

    it("keeps switch-cleanup candidates visible on another output, and now also protects the structurally-last trailing empty (shared)", () => {
        const { harness, controller } = modeCleanupSetup("shared");
        configureSwitchCleanupScenario(harness, controller);
        const other = { ...OUTPUT, name: "screen-2" };
        harness.screensList = [OUTPUT, other];
        harness.currentDesktopForOutputOverride = (output) =>
            output === other ? { id: "desktop-middle" } : { id: "desktop-1" };

        harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

        // desktop-middle is visible on the other output, so it is
        // ineligible; desktop-trailing is the structurally-last domain entry
        // (Q-Domain) and is now protected too, so nothing is removed.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            [],
        );
    });

    it("protects occupied and uncertain switch-cleanup snapshots (ownership plays no role)", () => {
        const occupied = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(occupied.harness, occupied.controller);
        occupied.harness.windows = [
            occupied.harness.active,
            window({ desktops: [{ id: "desktop-middle" }], tile: null }),
            window({ desktops: [{ id: "desktop-occupied" }] }),
        ];
        occupied.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        // desktop-middle is occupied by the floating window and survives;
        // desktop-trailing is the structurally-last domain entry (Q-Domain)
        // and is protected too, so nothing is removed.
        assert.deepEqual(
            occupied.harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            [],
            "floating membership occupies its desktop",
        );

        const uncertain = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(uncertain.harness, uncertain.controller);
        uncertain.harness.screensList = {};
        uncertain.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        assert.equal(uncertain.harness.removedDesktops.length, 0, "unreadable visibility stops cleanup");
    });

    it("ignores sticky-only membership during switch cleanup", () => {
        const { harness, controller } = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(harness, controller);
        harness.windows = [
            harness.active,
            window({ onAllDesktops: true, desktops: [{ id: "desktop-middle" }] }),
            window({ desktops: [{ id: "desktop-occupied" }] }),
        ];

        harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

        // desktop-middle (sticky-only membership ignored, so it reads empty)
        // is removed; desktop-trailing is the structurally-last domain entry
        // (Q-Domain) and is protected.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-middle"],
        );
    });

    it("protects the structurally-last trailing empty, and still keeps the final global desktop after a switch", () => {
        // desktop-trailing is the structurally-last global desktop, so it is
        // now protected as the reserved trailing empty rather than removed.
        const trailing = modeCleanupSetup("shared");
        trailing.harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-trailing", x11DesktopNumber: 2 },
        ];
        trailing.harness.currentDesktop = { id: "desktop-1" };
        trailing.harness.currentDesktopValue = { id: "desktop-1" };
        trailing.harness.currentDesktopForOutputOverride = () => ({ id: "desktop-1" });
        ownCleanupDesktops(trailing.controller, ["desktop-trailing"]);
        trailing.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        assert.deepEqual(
            trailing.harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            [],
        );

        // The sole remaining global desktop is still never removed: with
        // only one entry, it is always the structurally-last (trailing)
        // position, which ensureTrailingEmptyDesktop's own trailing-position
        // exclusion always protects.
        const finalDesktop = modeCleanupSetup("shared");
        finalDesktop.harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        finalDesktop.harness.currentDesktop = { id: "desktop-1" };
        finalDesktop.harness.currentDesktopValue = { id: "desktop-1" };
        finalDesktop.harness.currentDesktopForOutputOverride = () => ({ id: "desktop-1" });
        ownCleanupDesktops(finalDesktop.controller, ["desktop-1"]);
        finalDesktop.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        assert.equal(finalDesktop.harness.removedDesktops.length, 0);
    });

    it("removes an empty invisible middle desktop on a non-switch trigger too (Q7 broadened trigger)", () => {
        // Proves removal now fires from the general cleanupDesktops()
        // dispatcher (here, desktopsChanged/window-removed), not only after a
        // completed workspace switch.
        const { harness, controller } = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(harness, controller);

        harness.emitDesktopsChanged();

        // desktop-middle is removed; desktop-trailing is the structurally-
        // last domain entry (Q-Domain) and is protected.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-middle"],
        );
    });

    it("keeps an owned empty visible on another output", () => {
        const { harness } = setup();
        const candidate = prepareExcessOwnedEmpty(harness);
        const secondOutput = { ...OUTPUT, name: "screen-2" };
        harness.screensList = [OUTPUT, secondOutput];
        harness.currentDesktopForOutputOverride = (output) =>
            output === secondOutput ? { id: candidate } : DESKTOP;

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
    });

    it("defers cleanup when an output current desktop is unreadable", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.currentDesktopForOutputOverride = () => null;

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        // The deferral diagnostic now fires twice: once from cleanupDesktops'
        // own top-level visibility read, and once more from the always-run
        // removal pass re-reading the same still-unreadable visibility.
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:output-visibility-unknown"), 2);
    });

    it("defers cleanup when the global current desktop is invalid", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.currentDesktopValue = null;

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:output-visibility-unknown"), 2);
    });

    it("treats floating non-sticky windows as desktop occupancy", () => {
        const { harness } = setup();
        const candidate = prepareExcessOwnedEmpty(harness);
        harness.windows = [
            harness.active,
            window({ tile: null, desktops: [{ id: candidate }] }),
        ];

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
    });

    it("excludes sticky windows from desktop occupancy", () => {
        const { harness } = setup();
        const candidate = prepareExcessOwnedEmpty(harness);
        // Add a genuine trailing empty desktop-3 after the candidate so the
        // Q-Domain trailing-empty protection does not mask the
        // sticky-exclusion behavior under test: the candidate sits mid-domain
        // and desktop-3 is the protected trailing position.
        harness.desktopsList = [
            ...(harness.desktopsList as unknown[]),
            { id: "desktop-3", x11DesktopNumber: 3 },
        ] as typeof harness.desktopsList;
        harness.windows = [
            harness.active,
            window({ onAllDesktops: true, desktops: [{ id: candidate }] }),
        ];

        harness.emitDesktopsChanged();

        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), [candidate]);
    });

    it("defers cleanup when the window list is invalid", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.windows = {};

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        // Fires twice for the same reason as the visibility-unknown case
        // above: the top-level occupancy read plus the always-run removal
        // pass's own re-read.
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:window-occupancy-unknown"), 2);
    });

    it("defers cleanup when a non-sticky window membership is invalid", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.windows = [harness.active, window({ desktops: {} })];

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:window-occupancy-unknown"), 2);
    });

    it("navigates to an existing 1-based index and never creates on an absent index", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // the overwrite above replaces the list wholesale, so reset the
        // stale create count to isolate this test's own assertions.
        harness.createDesktopCalls.length = 0;
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

    it("Meta+0 registers as the stable workspace-0 shortcut in every profile", () => {
        // Spec C/H.4/H.15: the Meta+0 row registers as
        // `plasma-auto-tiler-workspace-0` in every profile and drives the
        // append/focus controller handler; Meta+Shift+0 stays separately
        // registered as move-append.
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const names = harness.shortcuts.map((entry) => entry.name);
            assert.equal(names.includes("plasma-auto-tiler-workspace-0"), true, key);
            assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), true, key);
            const meta0 = harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-workspace-0");
            assert.equal(meta0?.sequence, "Meta+0", key);
        }
    });

    it("Meta+Shift+0 reuses the existing trailing empty rather than creating a new one, and cleanup replenishes it once it is occupied", () => {
        const { harness, focused } = setup();
        // ownTrailingEmpty settles to a single owned trailing empty
        // desktop-3 (desktop-2 was created, occupied, replenished by
        // desktop-3, then removed once vacated and invisible - see its own
        // doc comment).
        ownTrailingEmpty(harness);
        harness.removedDesktops.length = 0;
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        const createsBefore = harness.createDesktopCalls.length;
        // Meta+Shift+0 reuses the existing trailing empty desktop-3
        // (Q-Domain) instead of creating a new one, and moves the window
        // into it. desktop-1 stays present (still the harness's per-output
        // current desktop, so it is visible and protected), and desktop-3 is
        // now occupied so its replacement desktop-4 is appended.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-3",
        ]);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
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

    // Meta+Shift+<digit> never reaches the registered action on QWERTY-family
    // layouts (SHIFT_DIGIT_SYMBOL_ALIAS in controller.ts): KWin's compositor
    // input path strips Shift and delivers the shifted symbol instead. Each
    // move-workspace-N row has a distinct `-symbol` shortcut ID registered
    // under the delivered symbol sequence and dispatching to the identical
    // handler; these tests pin that the alias ID is independently invokable
    // and behaves exactly like the canonical ID, including the
    // `workspace-move-invoked` diagnostic the live diagnosis depends on.
    it("moves a tiled window via the shifted-symbol alias shortcut ID, same as the canonical ID", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2-symbol");
        assert.equal(countEvent(harness.logs, "workspace-move-invoked:2"), 1);
        const members = (focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id);
        assert.deepEqual(members, ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
    });

    it("move-workspace-append-symbol dispatches identically to move-workspace-append", () => {
        const { harness } = setup();
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // the overwrite above replaces the list wholesale, so reset the
        // stale create count to isolate this test's own assertion.
        harness.createDesktopCalls.length = 0;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append-symbol");
        assert.equal(countEvent(harness.logs, "workspace-move-invoked:0"), 1);
        assert.equal(harness.createDesktopCalls.length, 1);
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

    it("honors move-follow when the event-loop yield is unavailable (synchronous fallback)", () => {
        // Regression: the synchronous yieldOnce fallback ran the destination
        // adoption but omitted the follow write, so a tiled move completed
        // without switching the current desktop when yieldOnce was unavailable
        // or failed. The fallback must follow on the moved window's output.
        const { harness, controller, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        harness.yieldResult = false;
        const writesBefore = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(harness.yields.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        // The follow write reaches the moved window's output through the
        // per-output seam even though the yield could not be armed.
        const newWrites = harness.currentDesktopForScreenWrites.slice(writesBefore);
        assert.equal(newWrites.length, 1);
        assert.equal((newWrites[0]?.desktop as { id: string }).id, "desktop-2");
        assert.equal(newWrites[0]?.output, focused.output);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
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
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the create-failure
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        const ownedBeforeShortcut = countEvent(harness.logs, "workspace-created-owned");
        harness.createDesktopThrows = new Error("create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-created-owned"), ownedBeforeShortcut);
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
        const { harness, controller } = setup();
        // desktop-3 is the structurally-last domain entry (Q-Domain trailing
        // empty, protected); desktop-2 is a removable non-trailing empty
        // whose throwing removal this test exercises.
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
        ];
        harness.removeDesktopThrows = new Error("remove-failed");
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
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the deferred-create
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
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
        // Shift+0 while the drag is live defers the whole move: the window does
        // not move before its required target exists.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:move"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        // Drag completion drains the request: the trailing empty is created and
        // the window moves into it.
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        // The move's destination adoption settles on its yield, running
        // cleanup: desktop-1 stays present (still the harness's per-output
        // current desktop, so it is visible and protected regardless of
        // occupancy), and desktop-2 (the trailing position) is now occupied,
        // so cleanup appends its replacement trailing empty desktop-3
        // (Q-Domain reuse-and-replenish).
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
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
        // start() runs cleanupDesktops before this reconstruction is armed
        // (the sole desktop is occupied by first/second, so the fix appends
        // its own replacement trailing empty during that pass); restore the
        // pristine single-desktop precondition this test needs before
        // exercising the reconstruction-pending deferral itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
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

    it("defers Meta+0 creation during a live drag and completes after drag finish", () => {
        // Meta+0 shares the existing settle queue: a required trailing-empty
        // creation during a live drag is queued and completed after drag
        // finish, never acting mid-drag (spec F bounded drain).
        const { harness, focused } = setup();
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the deferred-create
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-deferred"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
    });

    it("defers a repeated Meta+0 during a live drag and reuses the existing trailing empty after drag finish", () => {
        // Meta+0 reuses the active output's existing trailing empty (Q-Zero)
        // rather than creating a new one, even when the invocation was
        // deferred by a live drag: the whole invocation is queued and never
        // navigates away from the drag or mutates the desktop list mid-drag.
        const { harness, focused } = setup();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        const creates = harness.createDesktopCalls.length;
        const completedBefore = countEvent(harness.logs, "workspace-zero-completed");
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-deferred"), 1);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-1");
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), completedBefore + 1);
    });

    it("defers Meta+0 creation while a reconstruction is pending and completes after it settles", () => {
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
        // start() runs cleanupDesktops before this reconstruction is armed
        // (the sole desktop is occupied by first/second, so the fix appends
        // its own replacement trailing empty during that pass); restore the
        // pristine single-desktop precondition this test needs before
        // exercising the reconstruction-pending deferral itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-deferred"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.ok(countEvent(harness.logs, "ownership-taken") >= 1);
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
        void controller;
    });

    it("Meta+0 creation or set-current failure is non-destructive and reason-logged", () => {
        // A createDesktop throw aborts before any write: no desktop is owned,
        // no current changes, and the existing desktop set is retained. The
        // sole desktop is occupied (matching setup()'s fixture), so the fix
        // means start() itself already attempts, and fails, its own
        // replacement-trailing-empty append; createDesktopThrows must be set
        // before start() (a bare Harness, not setup()) so that first attempt
        // is the one that fails, and the shortcut's own attempt afterward is
        // measured as a delta against that baseline.
        const createHarness = new Harness();
        const createRoot = tile(RECT, true);
        const createTarget = tile();
        const createFocused = window({ tile: createTarget });
        createTarget.windows = [createFocused];
        createRoot.tiles = [createTarget];
        createHarness.root = createRoot;
        createHarness.active = createFocused;
        createHarness.windows = [createFocused];
        createHarness.createDesktopThrows = new Error("create-failed");
        const createController = new TileController(createHarness.environment());
        createController.start();
        const failuresBeforeShortcut = countEvent(createHarness.logs, "workspace-append-create-failed:create-failed");
        invokeShortcut(createHarness, "plasma-auto-tiler-workspace-0");
        assert.equal(
            countEvent(createHarness.logs, "workspace-append-create-failed:create-failed"),
            failuresBeforeShortcut + 1,
        );
        assert.equal(createHarness.createDesktopCalls.length, 0);
        assert.equal(createHarness.currentDesktopWrites.length, 0);
        assert.deepEqual(createController.ownedDesktopIdSnapshot(), []);
        assert.equal(createController.isEnabled, true);
        // A set-current throw after a successful create still owns the created
        // desktop and leaves every other desktop untouched (non-destructive).
        const set = setup();
        set.harness.setCurrentDesktopThrows = new Error("set-failed");
        invokeShortcut(set.harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(set.harness.logs, "workspace-navigate-failed:set-failed"), 1);
        assert.deepEqual(set.controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        assert.equal(set.harness.createDesktopCalls.length, 1);
        assert.equal(set.controller.isEnabled, true);
    });

    it("Meta+0 fails safely when the active output has no key and never mutates", () => {
        // A stale/unknown output wrapper resolves to no key (spec E); Meta+0
        // reports the missing key and never creates or writes.
        const { harness } = setup();
        harness.active = window({ output: { ...OUTPUT, name: "screen-unknown" } });
        const writes = harness.currentDesktopForScreenWrites.length;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-absent:output-key"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    it("Meta+0 and Meta+Shift+0 reuse the same existing trailing empty instead of creating separate ones", () => {
        // Under the trailing-empty reuse model both Meta+0 and Meta+Shift+0
        // resolve the same structurally-identified trailing empty
        // (Q-Domain): Meta+0 creates it first, then Shift+0 reuses it rather
        // than creating a second one. Once the window lands there, the next
        // cleanup dispatch appends a replacement trailing empty and removes
        // the now-empty, invisible source desktop.
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
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        // desktop-1 stays present (still the harness's per-output current
        // desktop, so it is visible and protected regardless of occupancy);
        // desktop-2 is now occupied so its replacement desktop-3 is appended
        // as the new trailing empty.
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("Shift+0 creates the first trailing empty, moves into it, and cleanup replenishes the vacated trailing empty once it settles", () => {
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
        // Shift+0 creates a brand-new desktop (no existing trailing empty
        // yet) and moves the tiled window into it; membership is written
        // synchronously and the destination adoption is yielded.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
        assert.equal(harness.yields.length, 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal(harness.flushNextYield(), true);
        // Once the move settles, desktop-1 stays present (still the
        // harness's per-output current desktop, so it is visible and
        // protected), and the now-occupied trailing desktop-2 is replenished
        // with a fresh trailing empty desktop-3.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("an occupancy event on the trailing empty appends its replacement (COSMIC-style reuse)", () => {
        const { harness } = setup();
        // ownTrailingEmpty settles to a single owned trailing empty
        // desktop-3 (desktop-2 was created, occupied, replenished by
        // desktop-3, then removed once vacated and invisible).
        ownTrailingEmpty(harness);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // A window arrives on the owned trailing empty desktop-3 by any
        // means (here, an external window-added event, not through Meta+0 or
        // Meta+Shift+0): it is now occupied, so the next cleanup dispatch
        // appends exactly one replacement trailing empty desktop-4.
        // desktop-1 stays present (the harness's per-output current
        // desktop), so it is never removed.
        const trailing = { id: "desktop-3", x11DesktopNumber: 3 };
        const incoming = window({ desktops: [trailing] });
        harness.windows = [...(harness.windows as unknown[]), incoming];
        harness.emitAdded(incoming);
        assert.equal(harness.createDesktopCalls.length, 3);
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, 3);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
    });

    it("reconciliation is idempotent under repeated triggers", () => {
        const { harness } = setup();
        ownTrailingEmpty(harness);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // The owned trailing empty desktop-3 is protected (Q-Domain):
        // repeated cleanup dispatches against this unchanged state are a pure
        // no-op, no net creates or removes (spec anti-oscillation guarantee).
        const creates0 = harness.createDesktopCalls.length;
        const removals0 = harness.removedDesktops.length;
        for (let index = 0; index < 4; index += 1) {
            harness.emitDesktopsChanged();
        }
        assert.equal(harness.createDesktopCalls.length, creates0);
        assert.equal(harness.removedDesktops.length, removals0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // Meta+Shift+0 now reuses the existing trailing empty desktop-3
        // rather than creating a new one; the window is still floating (from
        // ownTrailingEmpty's float-toggle), so the move's cleanup pass runs
        // synchronously. desktop-1 stays present (still the harness's
        // per-output current desktop, so it is visible and protected), and
        // the now-occupied trailing desktop-3 is replenished with desktop-4.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, creates0 + 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        for (let index = 0; index < 4; index += 1) {
            harness.emitDesktopsChanged();
        }
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
    });

    it("a desktop creation failure is non-destructive and reason-logged", () => {
        const { harness, controller } = setup();
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the create-failure
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        // Meta+Shift+0 always creates; a create failure never mutates any
        // desktop membership or list state.
        harness.createDesktopThrows = new Error("create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("cleanup never deletes a current or visible desktop, but does remove a non-trailing empty invisible one", () => {
        const { harness, focused } = setup();
        const origin = focused.tile as unknown as TestTile | null;
        if (origin !== null) {
            origin.unmanage = (_value: unknown) => {
                focused.tile = null;
                origin.windows = [];
                return true;
            };
        }
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
        ];
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // the overwrite above replaces the list wholesale, so reset the
        // stale create count to isolate this test's own assertion.
        harness.createDesktopCalls.length = 0;
        // The harness generates monotonic ids from here so the first create is
        // desktop-4, never colliding with the pre-existing desktops.
        harness.nextDesktopNumber = 3;
        // Shift+0 reuses the pre-existing trailing empty desktop-3 (no
        // create): it is the last-positioned desktop in the output's local
        // domain and is currently empty.
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-3",
        ]);
        // desktop-1 stays present (still the harness's per-output current
        // desktop, so it is visible and protected regardless of occupancy);
        // desktop-2 is empty, invisible, and has no positional protection, so
        // it is removed; desktop-3 is now occupied so its replacement
        // desktop-4 is appended as the new trailing empty.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-2"],
        );
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
        // Repeated dispatches against the settled state are a pure no-op:
        // desktop-1 (visible) and desktop-4 (trailing) both stay protected.
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`stays stable (no oscillation) under interleaved, mixed dispatcher trigger types around a real occupation, in ${mode} mode`, () => {
            const { harness, controller } = modeCleanupSetup(mode);
            const domainSnapshot = (): readonly string[] => {
                if (mode === "per-output-local") {
                    return Object.values(controller.localWorkspaceSnapshot())[0] ?? [];
                }
                if (mode === "global-unique") {
                    return Object.values(controller.globalUniqueAssignmentSnapshot())[0] ?? [];
                }
                return controller.sharedWorkspaceSnapshot();
            };
            // start()'s own fix already appended the sole occupied desktop's
            // replacement trailing empty (desktop-2); this is the
            // precondition every step below must not disturb without cause.
            assert.equal(harness.createDesktopCalls.length, 1);

            // A burst of at least 4 different dispatcher trigger types,
            // fired back-to-back with nothing else changed, must be a pure
            // no-op after every single step (not only before/after the
            // burst as a whole): no caching across dispatches means each
            // trigger independently recomputes and finds nothing eligible.
            const assertNoChurn = (label: string, fire: () => void): void => {
                const createsBefore = harness.createDesktopCalls.length;
                const removalsBefore = harness.removedDesktops.length;
                fire();
                assert.equal(harness.createDesktopCalls.length, createsBefore, `${label}: unexpected create`);
                assert.equal(harness.removedDesktops.length, removalsBefore, `${label}: unexpected remove`);
            };
            assertNoChurn("screensChanged", () => harness.screensChanged?.());
            assertNoChurn("desktopsChanged", () => harness.emitDesktopsChanged());
            assertNoChurn("currentDesktopChanged", () =>
                harness.emitCurrentDesktopChanged(DESKTOP, DESKTOP, OUTPUT),
            );
            assertNoChurn("windowAdded", () => harness.emitAdded(window()));
            assertNoChurn("desktopsChanged (repeat)", () => harness.emitDesktopsChanged());
            assert.deepEqual(domainSnapshot(), ["desktop-1", "desktop-2"]);

            // Genuinely occupy the current trailing empty (desktop-2), then
            // immediately fire a different, unrelated trigger type before
            // any deliberate settle step. Exactly one new desktop must be
            // appended overall: the occupation event itself performs the
            // structural re-read and append synchronously (no debounce), so
            // the very next unrelated trigger must find nothing further to
            // do.
            const trailingBeforeOccupation = harness.createDesktopCalls.length;
            const trailing = { id: "desktop-2", x11DesktopNumber: 2 };
            const incoming = window({ desktops: [trailing] });
            harness.windows = [...(harness.windows as unknown[]), incoming];
            harness.emitAdded(incoming);
            harness.screensChanged?.();
            assert.equal(harness.createDesktopCalls.length, trailingBeforeOccupation + 1);
            assert.equal(harness.removedDesktops.length, 0);
            assert.deepEqual(domainSnapshot(), ["desktop-1", "desktop-2", "desktop-3"]);

            // A further burst of at least 3 more mixed-type triggers,
            // post-settle, must produce zero further net creates or
            // removes: full idempotency under arbitrary trigger mixing, not
            // only repetition of the same trigger.
            assertNoChurn("currentDesktopChanged (post-settle)", () =>
                harness.emitCurrentDesktopChanged(DESKTOP, DESKTOP, OUTPUT),
            );
            assertNoChurn("windowAdded (post-settle)", () => harness.emitAdded(window()));
            assertNoChurn("screensChanged (post-settle)", () => harness.screensChanged?.());
            assert.deepEqual(domainSnapshot(), ["desktop-1", "desktop-2", "desktop-3"]);
        });
    }
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

    it("does not let an untiled startup-maximized window suppress malformed tree reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile();
        const b = tile();
        const normal = window({ tile: a });
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        a.windows = [normal];
        b.windows = [];
        root.tiles = [a, b];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        attachTileWriter(normal);
        harness.root = root;
        harness.active = normal;
        harness.windows = [normal, maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        // The untiled startup-maximized window preserves no slot, so it must
        // not block the reconstruction of the malformed tree: the scope has
        // one owned window against two leaves, the bijection fails, and the
        // reconstruction arms instead of being refused.
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(maximizedUntiled.tile, null);
        // The reconstruction completes and the maximized window stays untiled.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.ok(normal.tile !== null);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(harness.yields.length, 0);
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

    it("defers a tiled maximized scope so additions do not split and no inert forms", () => {
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
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);

        const incoming = window();
        harness.windows = [focused, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(incoming.tile, null);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(harness.yields.length, 0);
    });

    it("refuses an insertion targeting a normal occupant leaf in a multi-leaf scope with a tiled maximized preserved tile elsewhere", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const maximizedLeaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const occupantLeaf = tile({ x: 50, y: 0, width: 50, height: 100 });
        const maximized = window({ tile: maximizedLeaf, maximizeMode: 3 });
        const occupant = window({ tile: occupantLeaf });
        maximizedLeaf.windows = [maximized];
        occupantLeaf.windows = [occupant];
        root.tiles = [maximizedLeaf, occupantLeaf];
        harness.root = root;
        harness.active = maximized;
        harness.windows = [maximized, occupant];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);

        const incoming = window();
        harness.windows = [maximized, occupant, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(incoming.tile, null);
        assert.equal(maximized.tile, maximizedLeaf);
        assert.equal(occupant.tile, occupantLeaf);
        assert.deepEqual(root.tiles, [maximizedLeaf, occupantLeaf]);
        assert.equal(harness.yields.length, 0);
    });

    it("does not defer reconstruction or insertion in a different output scope for a maximized window", () => {
        const harness = new Harness();
        const OUTPUT_B = { ...OUTPUT, name: "screen-2" };
        const desktopB = { id: "desktop-2" };
        const rootA = tile(RECT, true);
        const targetA = tile();
        const maximized = window({ tile: targetA, maximizeMode: 3 });
        targetA.windows = [maximized];
        rootA.tiles = [targetA];
        const rootB = tile(RECT, true);
        const leafB = tile();
        const winB = window({ tile: leafB, output: OUTPUT_B, desktops: [desktopB] });
        leafB.windows = [winB];
        rootB.tiles = [leafB];
        for (const entry of [leafB]) {
            entry.remove = () => {
                rootB.tiles = (rootB.tiles as TestTile[]).filter((value) => value !== entry);
                return true;
            };
        }
        installDwindleSplitter(rootB);
        attachTileWriter(winB);
        harness.rootsByDesktop.set(DESKTOP.id, rootA);
        harness.rootsByDesktop.set(desktopB.id, rootB);
        harness.root = rootA;
        harness.active = maximized;
        harness.windows = [maximized, winB];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(maximized.tile, targetA);
        assert.equal(harness.yields.length, 0);

        harness.currentDesktop = desktopB;
        harness.currentDesktopValue = desktopB;
        const incomingB = window({ output: OUTPUT_B, desktops: [desktopB] });
        attachTileWriter(incomingB);
        harness.windows = [maximized, winB, incomingB];
        harness.emitAdded(incomingB);
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 0);
        while (harness.flushNextYield()) {
            // Drain to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.ok(winB.tile !== null);
        assert.ok(incomingB.tile !== null);
        assert.equal(maximized.tile, targetA);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("recovers a deferred tiled maximized scope on native unmaximize", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(focused);
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        attachTileWriter(incoming);
        harness.windows = [focused, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(incoming.tile, null);

        focused.maximizeMode = 0;
        focused.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.ok(focused.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("settles an owned scope when a native unmaximize clears an untiled startup record", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const normal = window({ tile: target });
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [normal];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(normal);
        attachTileWriter(maximizedUntiled);
        harness.root = root;
        harness.active = normal;
        harness.windows = [normal, maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(maximizedUntiled.tile, null);

        maximizedUntiled.maximizeMode = 0;
        maximizedUntiled.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.ok(normal.tile !== null);
        assert.ok(maximizedUntiled.tile !== null);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("recovers a maximized scope when the maximized window closes", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(focused);
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        attachTileWriter(incoming);
        harness.windows = [focused, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(incoming.tile, null);

        harness.emitRemoved(focused);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        target.windows = [];
        focused.tile = null;
        harness.windows = [incoming];
        while (harness.flushNextYield()) {
            // Drain the removal collapse and the reconstruction it arms.
        }
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        const later = window();
        attachTileWriter(later);
        harness.windows = [incoming, later];
        harness.emitAdded(later);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.ok(later.tile !== null);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps repeated no-empty-leaf additions to a deferred maximized scope non-inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(focused);
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const pending: TestWindow[] = [];
        for (let index = 0; index < 3; index += 1) {
            const added = window();
            attachTileWriter(added);
            pending.push(added);
            harness.windows = [focused, ...pending];
            harness.emitAdded(added);
            assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), index + 1);
            assert.equal(added.tile, null);
            assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
            assert.equal(harness.yields.length, 0);
        }

        focused.maximizeMode = 0;
        focused.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        for (const added of pending) {
            assert.ok(added.tile !== null);
        }
        assert.ok(focused.tile !== null);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("marks a scope inert on an insertion occupant-count mismatch", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const win1 = window({ tile: a });
        const win2 = window({ tile: b });
        a.windows = [win1];
        b.windows = [win2];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = win1;
        harness.windows = [win1, win2];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const win3 = window({ tile: b });
        b.windows = [win2, win3];
        harness.windows = [win1, win2, win3];
        const incoming = window();
        harness.windows = [win1, win2, win3, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-occupant-count-mismatch"), 1);
        assert.equal(incoming.tile, null);

        const later = window();
        harness.windows = [win1, win2, win3, incoming, later];
        harness.emitAdded(later);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-occupant-count-mismatch"), 1);
        assert.equal(later.tile, null);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(controller.isEnabled, true);
    });
});

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
