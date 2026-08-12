import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const SHIPPED_BUNDLE = "contents/code/main.js";
const EXPECTED_SHORTCUT_COUNT = 27;
const SHORTCUT_REGISTERED_DIAGNOSTIC = "plasma-auto-tiler:shortcut-registered";
const STARTUP_HANDLERS_READY_DIAGNOSTIC = "plasma-auto-tiler:startup-handlers-ready";

interface KWinStubResult {
    readonly context: ReturnType<typeof createContext>;
    readonly registeredShortcuts: ReadonlyArray<readonly [string, string, string]>;
    readonly diagnostics: readonly string[];
    readonly counts: { workspaceConnects: number };
}

// Minimal KWin ambient surface for the shipped IIFE: the top-level entry
// constructs TileController and runs start(), which subscribes to four
// workspace signals and registers every shortcut. The stub records each call so
// the test can prove the top-level entry point genuinely executed rather than
// silently no-oping.
function makeKWinStub(): KWinStubResult {
    const registeredShortcuts: Array<[string, string, string]> = [];
    const diagnostics: string[] = [];
    const counts = { workspaceConnects: 0 };

    const signal = (): { connect: () => void; disconnect: () => void } => ({
        connect: () => {
            counts.workspaceConnects += 1;
        },
        disconnect: () => {},
    });

    const context = createContext({
        workspace: {
            activeWindow: () => null,
            windowList: () => [],
            windowAdded: signal(),
            windowRemoved: signal(),
            screensChanged: signal(),
            currentDesktopChanged: signal(),
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
        assert.equal(stub.registeredShortcuts.length, EXPECTED_SHORTCUT_COUNT);
        assert.ok(stub.diagnostics.includes(SHORTCUT_REGISTERED_DIAGNOSTIC));
        assert.ok(stub.diagnostics.includes(STARTUP_HANDLERS_READY_DIAGNOSTIC));
    });

    it("keeps ordered module initialization without deferred CJS wrappers", () => {
        const bundle = readFileSync(SHIPPED_BUNDLE, "utf8");
        assert.doesNotMatch(bundle, /__esm|__commonJS/);
        assert.doesNotMatch(bundle, /\b(?:init|require)_[a-z_]+\s*\(/);
    });
});
