import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const SHIPPED_BUNDLE = "contents/code/main.js";
const STARTUP_HANDLERS_READY_DIAGNOSTIC = "plasma-auto-tiler:startup-handlers-ready";
const DRAG_ATTACH_SUMMARY_DIAGNOSTIC = "plasma-auto-tiler:drag-attach-summary:7:7:0";

// Post-ES2017 syntax and non-transpiled built-ins this KWin QJSEngine (ES2017)
// rejects. These are the confirmed-unsupported tokens; pre-ES2017 methods are
// deliberately not listed.
const POST_ES2017_PATTERNS: ReadonlyArray<RegExp> = [
    /\.flatMap\(/,
    /\.flat\(/,
    /Object\.fromEntries/,
    /\.finally\(/,
    /Promise\.(?:allSettled|any)\(/,
    /\.(?:trimStart|trimEnd|matchAll|replaceAll)\(/,
    /\bcatch\s*\{/,
];

function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            files.push(...collectSourceFiles(full));
        } else if (full.endsWith(".ts")) {
            files.push(full);
        }
    }
    return files;
}

interface KWinStubResult {
    readonly context: ReturnType<typeof createContext>;
    readonly diagnostics: readonly string[];
    readonly counts: { workspaceConnects: number; windowConnects: number };
}

// Minimal KWin ambient surface for the shipped IIFE: the top-level entry
// constructs TileController and runs start(), which subscribes to four
// workspace signals and attaches drag handling to every existing in-scope
// window. One window with the six per-window signals is supplied so the real
// per-signal attach path emits its ok/summary diagnostics.
function makeKWinStub(options: { throwingGetter?: string } = {}): KWinStubResult {
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
            screens: [output],
            windowAdded: workspaceSignal(),
            windowRemoved: workspaceSignal(),
            screensChanged: workspaceSignal(),
            currentDesktopChanged: workspaceSignal(),
        },
        readConfig: () => undefined,
        callDBus: () => {},
        QTimer: function QTimer() {},
        console: { ...console, log: (message: string) => diagnostics.push(message) },
    });

    return { context, diagnostics, counts };
}

describe("shipped artifact smoke execution", () => {
    it("executes the built contents/code/main.js top-level entry through a KWin stub", () => {
        const bundle = readFileSync(SHIPPED_BUNDLE, "utf8");
        assert.doesNotMatch(bundle, /\bregisterShortcut\b/);
        const stub = makeKWinStub();
        try {
            runInContext(bundle, stub.context, { filename: SHIPPED_BUNDLE });
        } catch (error) {
            assert.fail(`evaluating ${SHIPPED_BUNDLE} threw ${String(error)}`);
        }
        assert.equal(stub.counts.workspaceConnects, 4);
        assert.equal(stub.counts.windowConnects, 7);
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
        assert.equal(stub.counts.windowConnects, 6);
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

    it("keeps production source and shipped bundle free of post-ES2017 built-ins", () => {
        const sources = collectSourceFiles("src");
        assert.ok(sources.length > 0);
        const texts: ReadonlyArray<readonly [string, string]> = [
            [SHIPPED_BUNDLE, readFileSync(SHIPPED_BUNDLE, "utf8")],
            ...sources.map((file) => [file, readFileSync(file, "utf8")] as const),
        ];
        for (const [file, text] of texts) {
            for (const pattern of POST_ES2017_PATTERNS) {
                assert.doesNotMatch(text, pattern, `${file} matched ${String(pattern)}`);
            }
        }
    });
});
