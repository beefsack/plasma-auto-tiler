import { TileController } from "./controller";

function isKWinWindowSurface(value: unknown): value is Window {
    return (
        typeof value === "object" &&
        value !== null &&
        "activeChanged" in value &&
        "desktopsChanged" in value &&
        "outputChanged" in value &&
        "tileChanged" in value &&
        "interactiveMoveResizeStarted" in value &&
        "interactiveMoveResizeStepped" in value &&
        "interactiveMoveResizeFinished" in value
    );
}

const controller = new TileController({
    activeWindow: () => workspace.activeWindow,
    setActiveWindow: (window) => {
        // The strict WindowCapability is a structural subset of the ambient
        // Window surface; re-narrow to the full surface before writing.
        if (isKWinWindowSurface(window)) {
            workspace.activeWindow = window;
        }
    },
    currentDesktopForOutput: (output) => workspace.currentDesktopForScreen(output),
    rootTile: (output, desktop) => workspace.rootTile(output, desktop),
    windowList: () => workspace.windowList(),
    cursorPos: () => workspace.cursorPos,
    onWindowAdded: (handler) => workspace.windowAdded.connect(handler),
    onWindowRemoved: (handler) => workspace.windowRemoved.connect(handler),
    onScreensChanged: (handler) => workspace.screensChanged.connect(handler),
    onCurrentDesktopChanged: (handler) => workspace.currentDesktopChanged.connect(handler),
    watchInteractiveWindow: (window, started, finished, invalidated) => {
        window.interactiveMoveResizeStarted.connect(started);
        window.interactiveMoveResizeFinished.connect(finished);
        window.outputChanged.connect(invalidated);
        window.desktopsChanged.connect(invalidated);
        return () => {
            window.interactiveMoveResizeStarted.disconnect(started);
            window.interactiveMoveResizeFinished.disconnect(finished);
            window.outputChanged.disconnect(invalidated);
            window.desktopsChanged.disconnect(invalidated);
        };
    },
    onPendingTargetChanged: (window, handler) => {
        window.outputChanged.connect(handler);
        window.desktopsChanged.connect(handler);
        window.tileChanged.connect(handler);
        return () => {
            window.outputChanged.disconnect(handler);
            window.desktopsChanged.disconnect(handler);
            window.tileChanged.disconnect(handler);
        };
    },
    scheduleOnce: (delayMs, callback) => {
        const timer = new QTimer();
        timer.interval = delayMs;
        timer.singleShot = true;
        timer.timeout.connect(callback);
        timer.start();
        return () => {
            timer.stop();
        };
    },
    registerShortcut,
    log: (message) => console.log(message),
});

controller.start();
