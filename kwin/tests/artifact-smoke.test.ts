import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const SHIPPED_BUNDLE = "contents/code/main.js";
const LEGACY_REMOVED_DIAGNOSTIC = "plasma-auto-tiler:legacy-engine-removed";

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
    readonly dbusCalls: readonly string[];
}

// Minimal KWin ambient surface for the Group D inert entry: no TileController,
// no shortcuts, no workspace or window signal subscriptions, no Custom Tile
// actuation. The entry only starts the tray publisher heartbeat and logs the
// legacy-removed marker. Group E: route-diag/build-identity lines are gone.
function makeKWinStub(): KWinStubResult {
    const diagnostics: string[] = [];
    const dbusCalls: string[] = [];

    function QTimer(this: Record<string, unknown>): void {
        const self = this as Record<string, unknown> & {
            interval: number;
            singleShot: boolean;
            timeout: { connect: (callback: () => void) => void };
        };
        self.interval = 0;
        self.singleShot = true;
        self.timeout = { connect: () => {} };
        (this as Record<string, unknown>)["start"] = () => {};
        (this as Record<string, unknown>)["stop"] = () => {};
    }

    const context = createContext({
        callDBus: (...args: unknown[]) => {
            dbusCalls.push(String(args[3]));
        },
        QTimer: QTimer as unknown,
        console: { ...console, log: (message: string) => diagnostics.push(message) },
    });

    return { context, diagnostics, dbusCalls };
}

describe("shipped artifact smoke execution", () => {
    it("executes the built contents/code/main.js inert entry through a KWin stub", () => {
        const bundle = readFileSync(SHIPPED_BUNDLE, "utf8");
        const stub = makeKWinStub();
        try {
            runInContext(bundle, stub.context, { filename: SHIPPED_BUNDLE });
        } catch (error) {
            assert.fail(`evaluating ${SHIPPED_BUNDLE} threw ${String(error)}`);
        }
        assert.ok(stub.diagnostics.includes(LEGACY_REMOVED_DIAGNOSTIC));
        assert.ok(!stub.diagnostics.some((entry) => entry.includes("plasma-auto-tiler:route-diag")));
        assert.ok(!stub.diagnostics.some((entry) => entry.includes("drag-attach")));
        assert.ok(!bundle.includes("TileController"));
        assert.ok(!bundle.includes("registerShortcut"));
    });

    it("builds a fresh inert bundle with no legacy engine", () => {
        const outDir = mkdtempSync(join(tmpdir(), "pat-bundle-"));
        const outFile = join(outDir, "main.js");
        execFileSync("npx", ["esbuild", "src/entry.ts", "--bundle", "--format=iife", "--target=es2017", `--outfile=${outFile}`], {
            cwd: process.cwd(),
            stdio: "pipe",
        });
        const bundle = readFileSync(outFile, "utf8");
        assert.ok(bundle.includes("legacy-engine-removed"));
        assert.ok(!bundle.includes("TileController"));
        assert.ok(!bundle.includes("registerShortcut"));
        const stub = makeKWinStub();
        try {
            runInContext(bundle, stub.context, { filename: outFile });
        } catch (error) {
            assert.fail(`evaluating temp bundle threw ${String(error)}`);
        }
        assert.ok(stub.diagnostics.includes(LEGACY_REMOVED_DIAGNOSTIC));
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
