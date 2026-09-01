import { type RectCapability } from "../src/boundary";
import { type ControllerEnvironment } from "../src/controller";

export const RECT = { x: 0, y: 0, width: 100, height: 100 };
export const OUTPUT = {
    geometry: RECT,
    name: "screen-1",
    manufacturer: "KDE",
    model: "test",
    serialNumber: "1",
};
export const DESKTOP = { id: "desktop-1" };

export interface TestWindow {
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
    outputChanged: TestSignal0;
    desktopsChanged: TestSignal0;
    tileChanged: TestSignal0;
    interactiveMoveResizeStarted: TestSignal0;
    interactiveMoveResizeStepped: TestSignal1 & { emit(): void };
    interactiveMoveResizeFinished: TestSignal0;
    moveResizedChanged: TestSignal0;
    fullScreenChanged: TestSignal0;
    maximizedChanged: TestSignal0;
}
export interface TestSignal0 {
    connect(callback: () => void): void;
    disconnect(callback: () => void): void;
    emit(): void;
    readonly subscriberCount: number;
}
export interface TestSignal1 {
    connect(callback: (geometry: RectCapability) => void): void;
    disconnect(callback: (geometry: RectCapability) => void): void;
    emit(geometry: RectCapability): void;
    readonly subscriberCount: number;
}
export type TestSignal = TestSignal0;

export interface TestTile {
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

export interface RegisteredShortcut {
    readonly name: string;
    readonly text: string;
    readonly sequence: string;
    readonly handler: () => void;
}

// A queued one-shot event-loop yield, mirroring the callDBus async callback
// seam: arming enqueues exactly one dispatch that runs once on a later
// "event-loop turn" (the harness flush).
export interface YieldEntry {
    readonly callback: () => void;
    fired: boolean;
    cancelled: boolean;
}

export function tile(
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

export function window(overrides: Partial<TestWindow> = {}): TestWindow {
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
        interactiveMoveResizeStepped: payloadSignal(),
        interactiveMoveResizeFinished: signal(),
        moveResizedChanged: signal(),
        fullScreenChanged: signal(),
        maximizedChanged: signal(),
        ...overrides,
    };
}

// Direct state setters for the keyboard eligibility gates. They set the
// read properties synchronously without emitting, so no controller signal
// side effects interfere with a single-shot gate assertion.
export function setFullscreen(subject: TestWindow, value: boolean): void {
    subject.fullScreen = value;
}

export function setSticky(subject: TestWindow, value: boolean): void {
    subject.onAllDesktops = value;
}

export function setMaximized(subject: TestWindow, mode: number): void {
    subject.maximizeMode = mode;
}

export function signal(): TestSignal0 {
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

function payloadSignal(): TestSignal1 & { emit(): void } {
    const callbacks = new Set<(geometry: RectCapability) => void>();
    return {
        connect: (next) => {
            callbacks.add(next);
        },
        disconnect: (next) => {
            callbacks.delete(next);
        },
        emit: (geometry?: RectCapability) => {
            for (const callback of callbacks) {
                callback(geometry as RectCapability);
            }
        },
        get subscriberCount(): number {
            return callbacks.size;
        },
    } as TestSignal1 & { emit(): void };
}

// Approximates QV4's QObjectMethod shape: a QObject signal property reads as
// a callable QObjectMethod function whose connect/disconnect live on the
// function prototype (QV4 installs them on Function.prototype,
// qv4qobjectwrapper.cpp:322-323), not as an object with an own connect member.
// This is a Node stand-in for the QJSEngine shape and is NOT live proof that
// KWin delivers these signals; it only proves the attach path no longer
// requires an object-valued signal with an own connect member.
export function qv4MethodSignal(): TestSignal0 & (() => void) {
    const callbacks = new Set<() => void>();
    const method = function (): void {} as TestSignal0 & (() => void);
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

export function qv4PayloadMethodSignal(): TestSignal1 & { emit(): void } & ((geometry: RectCapability) => void) {
    const callbacks = new Set<(geometry: RectCapability) => void>();
    const method = function (_geometry: RectCapability): void {} as TestSignal1 & { emit(): void } & ((geometry: RectCapability) => void);
    const proto = Object.create(Function.prototype);
    Object.defineProperties(proto, {
        connect: { value: (next: (geometry: RectCapability) => void) => callbacks.add(next) },
        disconnect: { value: (next: (geometry: RectCapability) => void) => callbacks.delete(next) },
        emit: { value: (geometry?: RectCapability) => { for (const callback of callbacks) callback(geometry as RectCapability); } },
        subscriberCount: { get: () => callbacks.size },
    });
    Object.setPrototypeOf(method, proto);
    return method;
}

export class Harness {
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
    readonly interactiveWatches: Array<{
        readonly window: unknown;
        readonly started: () => void;
        readonly finished: () => void;
        readonly stepped: (geometry: RectCapability) => void;
        readonly moveResizedChanged: () => void;
        readonly invalidated: () => void;
    }> = [];
    scheduleOnceThrows: Error | undefined;
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
                this.interactiveWatches.push({ window: target, started, finished, stepped, moveResizedChanged, invalidated });
                const surface = target as unknown as Pick<
                    TestWindow,
                    | "interactiveMoveResizeStarted"
                    | "interactiveMoveResizeStepped"
                    | "interactiveMoveResizeFinished"
                    | "moveResizedChanged"
                    | "outputChanged"
                    | "desktopsChanged"
                    | "tileChanged"
                >;
                const connected: Array<() => void> = [];
                const attachPayloadFree = (
                    name:
                        | "interactiveMoveResizeStarted"
                        | "interactiveMoveResizeFinished"
                        | "moveResizedChanged"
                        | "outputChanged"
                        | "desktopsChanged"
                        | "tileChanged",
                    handler: () => void,
                ): boolean => {
                    try {
                        const signal = surface[name];
                        signal.connect(handler);
                        connected.push(() => signal.disconnect(handler));
                        this.logs.push(`plasma-auto-tiler:drag-attach-ok:${name}`);
                        return true;
                    } catch (error) {
                        this.logs.push(
                            `plasma-auto-tiler:drag-attach-failed:${name}:${String(error)} (observed typeof ${typeof surface[name]})`,
                        );
                        return false;
                    }
                };
                const attachPayload = (handler: (geometry: RectCapability) => void): boolean => {
                    try {
                        const signal = surface.interactiveMoveResizeStepped;
                        signal.connect(handler);
                        connected.push(() => signal.disconnect(handler));
                        this.logs.push("plasma-auto-tiler:drag-attach-ok:interactiveMoveResizeStepped");
                        return true;
                    } catch (error) {
                        this.logs.push(
                            `plasma-auto-tiler:drag-attach-failed:interactiveMoveResizeStepped:${String(error)} (observed typeof ${typeof surface.interactiveMoveResizeStepped})`,
                        );
                        return false;
                    }
                };
                const attempts: ReadonlyArray<() => boolean> = [
                    () => attachPayloadFree("interactiveMoveResizeStarted", started),
                    () => attachPayload(stepped),
                    () => attachPayloadFree("interactiveMoveResizeFinished", finished),
                    () => attachPayloadFree("moveResizedChanged", moveResizedChanged),
                    () => attachPayloadFree("outputChanged", invalidated),
                    () => attachPayloadFree("desktopsChanged", invalidated),
                    () => attachPayloadFree("tileChanged", invalidated),
                ];
                let ok = 0;
                let failed = 0;
                for (const attempt of attempts) {
                    if (attempt()) {
                        ok += 1;
                    } else {
                        failed += 1;
                    }
                }
                return {
                    disconnect: () => {
                        for (const disconnect of connected) {
                            try {
                                disconnect();
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
                if (this.scheduleOnceThrows !== undefined) {
                    throw this.scheduleOnceThrows;
                }
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

export type NativePointerResizeEdge =
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";

type NativeResizeAxis = "x" | "y";
type NativeResizeSide = "negative" | "positive";

export interface NativeTileNode {
    readonly id: string;
    geometry: typeof RECT;
    ratio: number;
    parent: NativeTileNode | null;
    tiles: NativeTileNode[];
    layoutDirection: NativeResizeAxis | null;
}

export interface NativeGeometryWrite {
    readonly owner: "kwin-native-pointer-resize";
    readonly tileId: string;
    readonly geometry: typeof RECT;
    readonly ratio: number;
}

interface NativeDivider {
    readonly axis: NativeResizeAxis;
    readonly side: NativeResizeSide;
    readonly subject: NativeTileNode;
    readonly neighbor: NativeTileNode;
    readonly parentSpan: number;
    readonly initialSubject: typeof RECT;
    readonly initialNeighbor: typeof RECT;
    readonly initialBoundary: number;
}

function copyRect(rectangle: typeof RECT): typeof RECT {
    return { ...rectangle };
}

function nativeRatio(extent: number, span: number): number {
    return Math.round((extent / span) * 1000) / 1000;
}

export function nativeTile(id: string, geometry: typeof RECT): NativeTileNode {
    return {
        id,
        geometry: copyRect(geometry),
        ratio: 0,
        parent: null,
        tiles: [],
        layoutDirection: null,
    };
}

export function nativeLayout(
    id: string,
    geometry: typeof RECT,
    layoutDirection: NativeResizeAxis,
    tiles: NativeTileNode[],
): NativeTileNode {
    const layout = nativeTile(id, geometry);
    layout.layoutDirection = layoutDirection;
    layout.tiles = tiles;
    for (const child of tiles) {
        child.parent = layout;
    }
    return layout;
}

export class NativePointerResizeFixture {
    readonly interactiveMoveResizeStarted = signal();
    readonly interactiveMoveResizeStepped = payloadSignal();
    readonly interactiveMoveResizeFinished = signal();
    readonly moveResizedChanged = signal();
    readonly outputChanged = signal();
    readonly desktopsChanged = signal();
    readonly tileChanged = signal();
    readonly events: string[] = [];
    readonly nativeGeometryWrites: NativeGeometryWrite[] = [];
    readonly selectedDividers: NativeDivider[] = [];
    active = false;

    private readonly dividers: NativeDivider[] = [];
    private target: NativeTileNode | null = null;

    constructor(readonly root: NativeTileNode) {}

    start(target: NativeTileNode, edge: NativePointerResizeEdge): void {
        this.target = target;
        this.dividers.length = 0;
        for (const [axis, side] of this.axesFor(edge)) {
            const divider = this.findDivider(target, axis, side);
            if (divider === null) {
                throw new Error(`native resize divider unavailable: ${axis}:${side}`);
            }
            this.dividers.push(divider);
        }
        this.selectedDividers.splice(0, this.selectedDividers.length, ...this.dividers);
        this.active = true;
        this.events.push("interactiveMoveResizeStarted");
        this.interactiveMoveResizeStarted.emit();
    }

    move(deltaX: number, deltaY: number): void {
        if (!this.active || this.target === null) {
            return;
        }
        this.events.push("native-tile-mutation");
        for (const divider of this.dividers) {
            const pointerDelta = divider.axis === "x" ? deltaX : deltaY;
            this.mutateDivider(divider, pointerDelta);
        }
    }

    finish(escaped = false): void {
        if (!this.active) {
            return;
        }
        this.active = false;
        this.target = null;
        this.events.push(escaped ? "interactiveMoveResizeFinished:Escape" : "interactiveMoveResizeFinished");
        this.interactiveMoveResizeFinished.emit();
    }

    invalidate(kind: "outputChanged" | "desktopsChanged" | "tileChanged" | "moveResizedChanged"): void {
        this.events.push(`native-invalidation:${kind}`);
        this.active = false;
        this.target = null;
        this.dividers.length = 0;
        this[kind].emit();
    }

    private axesFor(edge: NativePointerResizeEdge): Array<readonly [NativeResizeAxis, NativeResizeSide]> {
        const horizontal = edge.includes("left")
            ? (["x", "negative"] as const)
            : edge.includes("right")
              ? (["x", "positive"] as const)
              : null;
        const vertical = edge.includes("top")
            ? (["y", "negative"] as const)
            : edge.includes("bottom")
              ? (["y", "positive"] as const)
              : null;
        return [horizontal, vertical].filter(
            (axis): axis is readonly [NativeResizeAxis, NativeResizeSide] => axis !== null,
        );
    }

    private findDivider(
        target: NativeTileNode,
        axis: NativeResizeAxis,
        side: NativeResizeSide,
    ): NativeDivider | null {
        let branch = target;
        let parent = target.parent;
        while (parent !== null) {
            if (parent.layoutDirection === axis) {
                const index = parent.tiles.indexOf(branch);
                const neighborIndex = side === "negative" ? index - 1 : index + 1;
                const neighbor = parent.tiles[neighborIndex];
                if (neighbor !== undefined) {
                    const subjectGeometry = copyRect(branch.geometry);
                    const neighborGeometry = copyRect(neighbor.geometry);
                    const initialBoundary = axis === "x"
                        ? side === "negative"
                            ? subjectGeometry.x
                            : subjectGeometry.x + subjectGeometry.width
                        : side === "negative"
                          ? subjectGeometry.y
                          : subjectGeometry.y + subjectGeometry.height;
                    return {
                        axis,
                        side,
                        subject: branch,
                        neighbor,
                        parentSpan: axis === "x" ? parent.geometry.width : parent.geometry.height,
                        initialSubject: subjectGeometry,
                        initialNeighbor: neighborGeometry,
                        initialBoundary,
                    };
                }
            }
            branch = parent;
            parent = parent.parent;
        }
        return null;
    }

    private mutateDivider(divider: NativeDivider, pointerDelta: number): void {
        const minimum = Math.ceil(divider.parentSpan * 0.15);
        const roundedBoundary = Math.round(divider.initialBoundary + pointerDelta);
        const subjectStart = divider.axis === "x" ? divider.initialSubject.x : divider.initialSubject.y;
        const subjectEnd = divider.axis === "x"
            ? divider.initialSubject.x + divider.initialSubject.width
            : divider.initialSubject.y + divider.initialSubject.height;
        const neighborStart = divider.axis === "x" ? divider.initialNeighbor.x : divider.initialNeighbor.y;
        const neighborEnd = divider.axis === "x"
            ? divider.initialNeighbor.x + divider.initialNeighbor.width
            : divider.initialNeighbor.y + divider.initialNeighbor.height;
        const lower = divider.side === "negative" ? neighborStart + minimum : subjectStart + minimum;
        const upper = divider.side === "negative" ? subjectEnd - minimum : neighborEnd - minimum;
        const boundary = Math.max(lower, Math.min(upper, roundedBoundary));
        const subject = copyRect(divider.initialSubject);
        const neighbor = copyRect(divider.initialNeighbor);
        if (divider.axis === "x") {
            if (divider.side === "negative") {
                neighbor.width = boundary - neighbor.x;
                subject.x = boundary;
                subject.width = subjectEnd - boundary;
            } else {
                subject.width = boundary - subject.x;
                neighbor.x = boundary;
                neighbor.width = neighborEnd - boundary;
            }
        } else if (divider.side === "negative") {
            neighbor.height = boundary - neighbor.y;
            subject.y = boundary;
            subject.height = subjectEnd - boundary;
        } else {
            subject.height = boundary - subject.y;
            neighbor.y = boundary;
            neighbor.height = neighborEnd - boundary;
        }
        this.writeNativeGeometry(
            divider.subject,
            subject,
            nativeRatio(divider.axis === "x" ? subject.width : subject.height, divider.parentSpan),
        );
        this.writeNativeGeometry(
            divider.neighbor,
            neighbor,
            nativeRatio(divider.axis === "x" ? neighbor.width : neighbor.height, divider.parentSpan),
        );
    }

    private writeNativeGeometry(tileToWrite: NativeTileNode, geometry: typeof RECT, ratio: number): void {
        tileToWrite.geometry = geometry;
        tileToWrite.ratio = ratio;
        this.nativeGeometryWrites.push({
            owner: "kwin-native-pointer-resize",
            tileId: tileToWrite.id,
            geometry: copyRect(geometry),
            ratio,
        });
    }
}
