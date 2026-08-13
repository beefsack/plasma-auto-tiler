// Narrow KWin 6.7.3 scripting-surface subset, pinned to the KWin source
// fidelity reference recorded in
// docs/changes/custom-tile-vertical-slice/research/type-provenance.md
// (tag v6.7.3, commit 45ec9a6d0ed312a803ff5658a2a3e61f221566c6).
//
// Ambient and import-free so these declarations stay global. Strict controls:
// no `any`, `Function`, broad index signatures, unchecked casts, non-null
// assertions, or speculative KDE declarations.
//
// Output identity is session-local only: exact Output object reference
// equality plus VirtualDesktop id. KWin retains persistent topology; no stable
// identity survives restart or hotplug. Output.uuid is neither Q_PROPERTY nor
// Q_INVOKABLE and is not declared.

// src/scripting/scripting.h:
//     bool registerShortcut(const QString &, const QString &, const QString &,
//                           const QJSValue &)
declare function registerShortcut(
    name: string,
    text: string,
    sequence: string,
    callback: () => void,
): boolean;

// src/scripting/scripting.h:
//     Q_INVOKABLE void callDBus(const QString &service, const QString &path,
//                               const QString &interface, const QString &method,
//                               const QJSValue &arg1..arg9)
// Installed as a script global by src/scripting/scripting.cpp:237-251. The
// trailing argument may be a callable callback, invoked exactly once with the
// D-Bus reply arguments on a later event-loop turn (scripting.cpp:301-374); an
// error reply logs and never invokes the callback. Used here only as a
// guaranteed one-shot event-loop yield (ListNames), never for data transport.
declare function callDBus(
    service: string,
    path: string,
    dbusInterface: string,
    method: string,
    ...args: readonly unknown[]
): void;

// src/scripting/scripting.cpp installs QJSEngine::ConsoleExtension before
// evaluating the generated script.
interface Console {
    log(...values: readonly unknown[]): void;
}
declare var console: Console;

// QObject signal surface every KWin script signal exposes.
interface Signal {
    connect(callback: () => void): void;
    disconnect(callback: () => void): void;
}
interface Signal1<T> {
    connect(callback: (value: T) => void): void;
    disconnect(callback: (value: T) => void): void;
}
interface Signal3<T1, T2, T3> {
    connect(callback: (first: T1, second: T2, third: T3) => void): void;
    disconnect(callback: (first: T1, second: T2, third: T3) => void): void;
}

// Script geometry/size/point boundary values (QRect/QRectF, QSizeF, QPointF).
interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface Size {
    width: number;
    height: number;
}
interface Point {
    x: number;
    y: number;
}

// src/tiles/tile.h: Tile::LayoutDirection, values Floating=0, Horizontal=1,
// Vertical=2. Plain (non-const) enum keeps the runtime representation explicit.
declare enum LayoutDirection {
    Floating = 0,
    Horizontal = 1,
    Vertical = 2,
}

// src/virtualdesktops.h: virtual-desktop ID is a scripting-facing string
// property.
interface VirtualDesktop {
    readonly id: string;
}

// src/core/output.h: only scripting-exposed Q_PROPERTY members. uuid() is
// neither Q_PROPERTY nor Q_INVOKABLE and is excluded.
interface Output {
    readonly geometry: Rect;
    readonly name: string;
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber: string;
}

// src/window.h: required Window properties and signals, including the
// interactive move signals. Pointer signal arguments are conservatively
// nullable at the JS boundary.
interface Window {
    readonly normalWindow: boolean;
    readonly managed: boolean;
    readonly resizeable: boolean;
    readonly appletPopup: boolean;
    // QList<VirtualDesktop *> has no established JavaScript marshalling contract.
    readonly desktops: unknown;
    readonly output: Output | null;
    // Writable: src/window.h at pinned v6.7.3 declares
    //     Q_PROPERTY(KWin::Tile *tile READ requestedTile WRITE
    //     setTileCompatibility NOTIFY tileChanged)
    // Assigning null detaches the window from its requested tile (unmanage)
    // and returns it to floating.
    tile: Tile | null;
    readonly frameGeometry: Rect;
    // Read-write in the official KWin scripting API (KWin::Window -> Read-write
    // Properties -> `bool fullScreen`; https://develop.kde.org/docs/plasma/kwin/api/).
    // Declared read-only here: the controller observes fullscreen but never
    // writes it (cover-and-restore is KWin-owned).
    readonly fullScreen: boolean;
    // Documented Window property (KWin scripting API): the window's caption
    // (title) string. Read for snapshot observability only.
    readonly caption: string;
    // src/window.h exposes QML `move` / `resize`, backed by
    // isInteractiveMove() / isInteractiveResize(). Move and resize are
    // distinguished before drag state is captured.
    readonly move: boolean;
    readonly resize: boolean;
    readonly activeChanged: Signal;
    readonly desktopsChanged: Signal;
    // KWin emits the old output; re-read output for the current value.
    readonly outputChanged: Signal1<Output | null>;
    readonly tileChanged: Signal1<Tile | null>;
    readonly interactiveMoveResizeStarted: Signal;
    readonly interactiveMoveResizeStepped: Signal1<Rect>;
    readonly interactiveMoveResizeFinished: Signal;
    readonly moveResizedChanged: Signal;
    // Documented notify signal for the `fullScreen` property (KWin scripting
    // API -> KWin::Window -> Signals -> `fullScreenChanged()`). Attached via the
    // feature-detecting environment seam, never assumed present.
    readonly fullScreenChanged: Signal;
}

// src/tiles/tile.h: tile tree (tiles/windows), geometry, layout, and
// manage/unmanage. bool manage(Window *); bool unmanage(Window *).
interface Tile {
    // src/tiles/tile.h: Q_PROPERTY(KWin::RectF relativeGeometry READ
    // relativeGeometry WRITE setRelativeGeometry NOTIFY relativeGeometryChanged).
    // Writable: assigning dispatches to Tile::setRelativeGeometry (CustomTile
    // overrides it and adjusts sibling tiles at the changed shared edges). The
    // value is in screen-relative [0,1] units. The neighbor-adjusting detail is
    // source-derived and not live-proven here.
    relativeGeometry: Rect;
    readonly absoluteGeometry: Rect;
    readonly parent: Tile | null;
    // QList QObject boundaries require runtime decoding before iteration.
    readonly tiles: unknown;
    readonly windows: unknown;
    readonly isLayout: boolean;
    readonly canBeRemoved: boolean;
    manage(window: Window): boolean;
    unmanage(window: Window): boolean;
    readonly relativeGeometryChanged: Signal;
    readonly absoluteGeometryChanged: Signal;
    readonly windowGeometryChanged: Signal;
    readonly paddingChanged: Signal1<number>;
    readonly minimumSizeChanged: Signal1<Size>;
    readonly rowChanged: Signal1<number>;
    readonly isLayoutChanged: Signal1<boolean>;
    readonly childTilesChanged: Signal;
    readonly windowAdded: Signal1<Window>;
    readonly windowRemoved: Signal1<Window>;
    readonly windowsChanged: Signal;
}

// src/tiles/customtile.h: CustomTile layout direction, layoutModified(), and
// QList<CustomTile *> split(LayoutDirection).
interface CustomTile extends Tile {
    readonly layoutDirection: LayoutDirection;
    readonly layoutDirectionChanged: Signal1<LayoutDirection>;
    readonly layoutModified: Signal;
    // QList<CustomTile *> requires runtime decoding before use.
    split(direction: LayoutDirection): unknown;
    // src/tiles/customtile.h: `Q_INVOKABLE void remove()`. The void return is
    // not an acknowledgement: callers must verify the root topology afterwards.
    remove(): void;
}

// Opaque tile model exposed by RootTile; no scripting-exposed members exist.
interface TileModel {}

// src/tiles/customtile.h: RootTile::model() and RootTile::pick(QPointF)
// returning Tile *.
interface RootTile extends CustomTile {
    readonly model: TileModel;
    pick(point: Point): Tile | null;
}

// src/scripting/scripting.h: ScriptTimer (QTimer subclass with a
// Q_INVOKABLE constructor), exposed by src/scripting/scripting.cpp as the
// global `QTimer` metaobject so scripts can do `new QTimer()`. Only the
// narrow singleShot/interval/timeout/start/stop surface this project uses
// is declared.
interface QTimer {
    interval: number;
    singleShot: boolean;
    readonly timeout: Signal;
    start(): void;
    stop(): void;
}
declare const QTimer: {
    new (): QTimer;
};

// src/scripting/workspace_wrapper.h: current-workspace/output surface.
interface Workspace {
    // QList<LogicalOutput *> requires runtime decoding before iteration.
    readonly screens: unknown;
    readonly cursorPos: Point;
    readonly currentDesktop: VirtualDesktop | null;
    // Writable: src/scripting/workspace_wrapper.h declares the WRITE setter
    //     Q_PROPERTY(KWin::Window *activeWindow READ activeWindow WRITE
    //     setActiveWindow NOTIFY windowActivated)
    // at pinned v6.7.3 commit 45ec9a6d0ed312a803ff5658a2a3e61f221566c6.
    activeWindow: Window | null;
    currentDesktopForScreen(output: Output): VirtualDesktop | null;
    rootTile(output: Output, desktop: VirtualDesktop): Tile | null;
    // src/scripting/workspace_wrapper.h: Q_SCRIPTABLE QRectF clientArea(
    //     ClientAreaOption option, Output *output, VirtualDesktop *desktop)
    // const. Returns the per-output client working area (screen minus panel
    // struts). The option is the ClientAreaOption enum: WorkArea is 5.
    clientArea(option: number, output: Output, desktop: VirtualDesktop): Rect;
    // The JavaScript-only QList<Window *> boundary requires runtime decoding.
    windowList(): unknown;
    readonly windowAdded: Signal1<Window>;
    readonly windowRemoved: Signal1<Window>;
    readonly screensChanged: Signal;
    readonly currentDesktopChanged: Signal3<VirtualDesktop | null, VirtualDesktop | null, Output | null>;
}

// src/scripting/workspace_wrapper.h: the scripting workspace singleton.
declare const workspace: Workspace;
