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
    clientArea: (option, output, desktop) => workspace.clientArea(option, output, desktop),
    desktops: () => {
        const value = workspace.desktops;
        if (value === undefined) {
            throw new Error("kwin-workspace-surface-missing:desktops");
        }
        return value;
    },
    screens: () => {
        const value = workspace.screens;
        if (value === undefined) {
            throw new Error("kwin-workspace-surface-missing:screens");
        }
        return value;
    },
    currentDesktop: () => {
        const value = workspace.currentDesktop;
        return value ?? null;
    },
    createDesktop: (position, name) => {
        if (typeof workspace.createDesktop !== "function") {
            throw new Error("kwin-workspace-surface-missing:createDesktop");
        }
        return workspace.createDesktop(position, name);
    },
    removeDesktop: (desktop) => {
        if (typeof workspace.removeDesktop !== "function") {
            throw new Error("kwin-workspace-surface-missing:removeDesktop");
        }
        workspace.removeDesktop(desktop as unknown as VirtualDesktop);
    },
    setCurrentDesktop: (desktop) => {
        try {
            workspace.currentDesktop = desktop as unknown as VirtualDesktop;
        } catch (error) {
            throw new Error(`kwin-workspace-surface-missing:setCurrentDesktop:${String(error)}`);
        }
    },
    setCurrentDesktopForScreen: (desktop, output) => {
        workspace.setCurrentDesktopForScreen(desktop as unknown as VirtualDesktop, output as unknown as Output);
    },
    onDesktopsChanged: (handler) => {
        const signal = workspace.desktopsChanged;
        if (signal === undefined) {
            console.log("plasma-auto-tiler:workspace-surface-missing:desktopsChanged");
            return;
        }
        signal.connect(handler);
    },
    onWindowAdded: (handler) => workspace.windowAdded.connect(handler),
    onWindowRemoved: (handler) => workspace.windowRemoved.connect(handler),
    onScreensChanged: (handler) => workspace.screensChanged.connect(handler),
    onCurrentDesktopChanged: (handler) => workspace.currentDesktopChanged.connect(handler),
    watchInteractiveWindow: (window, started, finished, stepped, moveResizedChanged, invalidated) => {
        const surface = window as unknown as Record<string, unknown>;
        const connected: Array<[string, () => void]> = [];
        const attach = (name: string, handler: () => void): boolean => {
            let value: unknown;
            try {
                value = surface[name];
                (value as { connect: (next: () => void) => void }).connect(handler);
                connected.push([name, handler]);
                console.log(`plasma-auto-tiler:drag-attach-ok:${name}`);
                return true;
            } catch (error) {
                console.log(
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
                        (surface[name] as { disconnect: (next: () => void) => void }).disconnect(handler);
                    } catch (error) {
                        void error;
                    }
                }
            },
            ok,
            failed,
        };
    },
    watchFullscreen: (window, changed) => {
        const surface = window as unknown as Record<string, unknown>;
        let value: unknown;
        try {
            value = surface["fullScreenChanged"];
            (value as { connect: (next: () => void) => void }).connect(changed);
            console.log("plasma-auto-tiler:fullscreen-attach-ok:fullScreenChanged");
            return {
                disconnect: () => {
                    try {
                        (surface["fullScreenChanged"] as { disconnect: (next: () => void) => void }).disconnect(
                            changed,
                        );
                    } catch (error) {
                        void error;
                    }
                },
                ok: 1,
                failed: 0,
            };
        } catch (error) {
            console.log(
                `plasma-auto-tiler:fullscreen-attach-failed:fullScreenChanged:${String(error)} (observed typeof ${typeof value})`,
            );
            return { disconnect: () => {}, ok: 0, failed: 1 };
        }
    },
    watchMaximize: (window, changed) => {
        const surface = window as unknown as Record<string, unknown>;
        let value: unknown;
        try {
            value = surface["maximizedChanged"];
            (value as { connect: (next: () => void) => void }).connect(changed);
            console.log("plasma-auto-tiler:maximize-attach-ok:maximizedChanged");
            return {
                disconnect: () => {
                    try {
                        (surface["maximizedChanged"] as { disconnect: (next: () => void) => void }).disconnect(
                            changed,
                        );
                    } catch (error) {
                        void error;
                    }
                },
                ok: 1,
                failed: 0,
            };
        } catch (error) {
            console.log(
                `plasma-auto-tiler:maximize-attach-failed:maximizedChanged:${String(error)} (observed typeof ${typeof value})`,
            );
            return { disconnect: () => {}, ok: 0, failed: 1 };
        }
    },
    onPendingTargetChanged: (window, handler) => {
        const surface = window as unknown as Record<string, unknown>;
        const connected: Array<[string, () => void]> = [];
        const attach = (name: string): boolean => {
            let value: unknown;
            try {
                value = surface[name];
                (value as { connect: (next: () => void) => void }).connect(handler);
                connected.push([name, handler]);
                console.log(`plasma-auto-tiler:pending-attach-ok:${name}`);
                return true;
            } catch (error) {
                console.log(
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
    // Named one-shot event-loop yield for dwindle reconstruction deferral,
    // implemented with the proven callDBus async callback seam. ListNames on
    // the session bus dispatches its callback exactly once on a real later
    // event-loop turn, after pending DeferredDelete processing, and never
    // synchronously. It holds no timer and relies on no signal. Returns false
    // only when arming the D-Bus call throws, which must fail the owning scope
    // closed rather than strand it.
    yieldOnce: (callback) => {
        try {
            callDBus(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "ListNames",
                callback,
            );
            return true;
        } catch (error) {
            void error;
            return false;
        }
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
    readConfig: (key, defaultValue) => readConfig(key, defaultValue),
    log: (message) => console.log(message),
});

controller.start();
