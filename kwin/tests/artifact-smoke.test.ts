import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const SHIPPED_BUNDLE = "contents/code/main.js";
const EXPECTED_SHORTCUT_COUNT = 49;
const SHORTCUT_REGISTERED_DIAGNOSTIC = "plasma-auto-tiler:shortcut-registered";
const STARTUP_HANDLERS_READY_DIAGNOSTIC = "plasma-auto-tiler:startup-handlers-ready";
const DRAG_ATTACH_SUMMARY_DIAGNOSTIC = "plasma-auto-tiler:drag-attach-summary:6:6:0";

interface KWinStubResult {
    readonly context: ReturnType<typeof createContext>;
    readonly registeredShortcuts: ReadonlyArray<readonly [string, string, string]>;
    readonly diagnostics: readonly string[];
    readonly counts: { workspaceConnects: number; windowConnects: number };
}

// Minimal KWin ambient surface for the shipped IIFE: the top-level entry
// constructs TileController and runs start(), which subscribes to four
// workspace signals, registers every shortcut, and attaches drag handling to
// every existing in-scope window. One window with the six per-window signals
// is supplied so the real per-signal attach path emits its ok/summary
// diagnostics. The stub records each call so the test can prove the top-level
// entry point genuinely executed rather than silently no-oping.
function makeKWinStub(options: { throwingGetter?: string } = {}): KWinStubResult {
    const registeredShortcuts: Array<[string, string, string]> = [];
    const diagnostics: string[] = [];
    const counts = { workspaceConnects: 0, windowConnects: 0 };

    const workspaceSignal = (): { connect: () => void; disconnect: () => void } => ({
        connect: () => {
            counts.workspaceConnects += 1;
        },
        disconnect: () => {},
    });

    // Approximates QV4's QObjectMethod shape: a QObject signal property reads
    // as a callable function whose connect/disconnect live on the function
    // prototype (QV4 installs them on Function.prototype,
    // qv4qobjectwrapper.cpp:322-323), not as an object with an own connect
    // member. This is a Node stand-in for the QJSEngine shape and is not live
    // proof that KWin delivers these signals.
    const windowSignal = (): { connect: () => void; disconnect: () => void } => {
        const method = function (): void {};
        Object.setPrototypeOf(method, {
            connect: () => {
                counts.windowConnects += 1;
            },
            disconnect: () => {},
        });
        return method as unknown as { connect: () => void; disconnect: () => void };
    };

    const geometry = { x: 0, y: 0, width: 100, height: 100 };
    const output = {
        geometry,
        name: "screen-1",
        manufacturer: "KDE",
        model: "test",
        serialNumber: "1",
    };
    const window = {
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        desktops: [{ id: "desktop-1" }],
        output,
        tile: null,
        frameGeometry: geometry,
        move: false,
        resize: false,
        outputChanged: windowSignal(),
        desktopsChanged: windowSignal(),
        tileChanged: windowSignal(),
        interactiveMoveResizeStarted: windowSignal(),
        interactiveMoveResizeStepped: windowSignal(),
        interactiveMoveResizeFinished: windowSignal(),
        moveResizedChanged: windowSignal(),
    };

    if (options.throwingGetter !== undefined) {
        Object.defineProperty(window, options.throwingGetter, {
            get: () => {
                throw new Error("pathological getter");
            },
            enumerable: false,
            configurable: true,
        });
    }

    const context = createContext({
        workspace: {
            activeWindow: () => null,
            windowList: () => [window],
            currentDesktopForScreen: () => ({ id: "desktop-1" }),
            windowAdded: workspaceSignal(),
            windowRemoved: workspaceSignal(),
            screensChanged: workspaceSignal(),
            currentDesktopChanged: workspaceSignal(),
        },
        registerShortcut: (name: string, text: string, sequence: string) => {
            registeredShortcuts.push([name, text, sequence]);
            return true;
        },
        callDBus: () => {},
        QTimer: function QTimer() {},
        console: { ...console, log: (message: string) => diagnostics.push(message) },
    });

    return { context, registeredShortcuts, diagnostics, counts };
}

describe("shipped artifact smoke execution", () => {
    it("executes the built contents/code/main.js top-level entry through a KWin stub", () => {
        const bundle = readFileSync(SHIPPED_BUNDLE, "utf8");
        const stub = makeKWinStub();
        try {
            runInContext(bundle, stub.context, { filename: SHIPPED_BUNDLE });
        } catch (error) {
            assert.fail(`evaluating ${SHIPPED_BUNDLE} threw ${String(error)}`);
        }
        assert.equal(stub.counts.workspaceConnects, 4);
        assert.equal(stub.counts.windowConnects, 6);
        assert.equal(stub.registeredShortcuts.length, EXPECTED_SHORTCUT_COUNT);
        const names = stub.registeredShortcuts.map(([name]) => name);
        assert.ok(names.includes("plasma-auto-tiler-float-toggle"));
        assert.ok(names.includes("plasma-auto-tiler-sticky-toggle"));
        assert.ok(stub.diagnostics.includes(SHORTCUT_REGISTERED_DIAGNOSTIC));
        assert.ok(stub.diagnostics.includes(STARTUP_HANDLERS_READY_DIAGNOSTIC));
        assert.ok(stub.diagnostics.includes(DRAG_ATTACH_SUMMARY_DIAGNOSTIC));
        assert.ok(stub.diagnostics.includes("plasma-auto-tiler:drag-attach-ok:interactiveMoveResizeStarted"));
        assert.ok(stub.diagnostics.includes("plasma-auto-tiler:drag-attach-ok:interactiveMoveResizeStepped"));
        assert.ok(stub.diagnostics.includes("plasma-auto-tiler:drag-attach-ok:interactiveMoveResizeFinished"));
        assert.ok(stub.diagnostics.includes("plasma-auto-tiler:drag-attach-ok:moveResizedChanged"));
        assert.ok(!stub.diagnostics.some((entry) => entry.startsWith("plasma-auto-tiler:drag-attach-failed")));
    });

    it("keeps startup alive and logs a per-signal failure when a window signal getter throws", () => {
        const stub = makeKWinStub({ throwingGetter: "moveResizedChanged" });
        const bundle = readFileSync(SHIPPED_BUNDLE, "utf8");
        try {
            runInContext(bundle, stub.context, { filename: SHIPPED_BUNDLE });
        } catch (error) {
            assert.fail(`evaluating ${SHIPPED_BUNDLE} threw ${String(error)}`);
        }
        assert.equal(stub.counts.workspaceConnects, 4);
        assert.equal(stub.counts.windowConnects, 5);
        assert.ok(stub.diagnostics.includes(STARTUP_HANDLERS_READY_DIAGNOSTIC));
        const failed = stub.diagnostics.find((entry) =>
            entry.startsWith("plasma-auto-tiler:drag-attach-failed:moveResizedChanged:"),
        );
        assert.notEqual(failed, undefined);
        assert.ok(
            failed?.includes("typeof undefined"),
            `failed line must name the observed typeof, got: ${failed}`,
        );
    });

    it("keeps ordered module initialization without deferred CJS wrappers", () => {
        const bundle = readFileSync(SHIPPED_BUNDLE, "utf8");
        assert.doesNotMatch(bundle, /__esm|__commonJS/);
        assert.doesNotMatch(bundle, /\b(?:init|require)_[a-z_]+\s*\(/);
    });
});
