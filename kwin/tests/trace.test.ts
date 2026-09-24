import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

import { KWIN_TRACE_ENABLED } from "../src/trace";

function traceValue(define: string | null): boolean {
    const outDir = mkdtempSync(join(tmpdir(), "pat-trace-"));
    const outFile = join(outDir, "main.js");
    const args = [
        "esbuild",
        "src/trace.ts",
        "--bundle",
        "--format=iife",
        "--target=es2017",
        "--global-name=PatTrace",
        `--outfile=${outFile}`,
    ];
    if (define !== null) {
        args.push(`--define:__PLASMA_AUTO_TILER_TRACE__=${JSON.stringify(define)}`);
    }
    execFileSync("npx", args, { cwd: process.cwd(), stdio: "pipe" });
    const context = createContext({});
    runInContext(readFileSync(outFile, "utf8"), context, { filename: outFile });
    const global = (context as unknown as { PatTrace?: { KWIN_TRACE_ENABLED: boolean } }).PatTrace;
    assert.ok(global !== undefined, "trace IIFE must be exposed");
    return global.KWIN_TRACE_ENABLED;
}

function dragLogs(define: string | null, cancelled = false): string[] {
    const outDir = mkdtempSync(join(tmpdir(), "pat-trace-drag-"));
    const outFile = join(outDir, "main.js");
    const args = [
        "esbuild",
        "src/drag-oracle-pull.ts",
        "--bundle",
        "--format=iife",
        "--target=es2017",
        "--global-name=PatTraceDrag",
        `--outfile=${outFile}`,
    ];
    if (define !== null) {
        args.push(`--define:__PLASMA_AUTO_TILER_TRACE__=${JSON.stringify(define)}`);
    }
    execFileSync("npx", args, { cwd: process.cwd(), stdio: "pipe" });
    const context = createContext({});
    runInContext(readFileSync(outFile, "utf8"), context, { filename: outFile });
    const global = (context as unknown as { PatTraceDrag?: { DragOraclePull: new (env: unknown) => { pullVerdict: () => void } } }).PatTraceDrag;
    assert.ok(global !== undefined, "drag trace IIFE must be exposed");
    const logs: string[] = [];
    const pull = new global.DragOraclePull({
        callDbus: (_service: unknown, _path: unknown, _iface: unknown, _method: unknown, callback: (reply: unknown) => void): void => {
            callback(JSON.stringify({
                v: 1,
                cancelled,
                finalRect: { x: 0, y: 0, w: 1, h: 1 },
                windowIdentity: "win-1",
                correlation: "drag-1",
                reason: cancelled ? "no-change" : "ok-moved",
            }));
        },
        log: (message: string): void => {
            logs.push(message);
        },
        routePointer: (): void => {},
    });
    pull.pullVerdict();
    return logs;
}

describe("compile-time KWin trace gate", () => {
    it("is disabled in ordinary builds and enabled only by the exact trace define", () => {
        assert.equal(KWIN_TRACE_ENABLED, true);
        assert.equal(traceValue(null), false);
        assert.equal(traceValue("1"), true);
        assert.equal(traceValue("true"), false);
    });

    it("keeps trace build opt-in from the development launcher", () => {
        const manifest = readFileSync("package.json", "utf8");
        const start = readFileSync("../scripts/start-test.sh", "utf8");
        assert.match(manifest, /"build:trace":.*__PLASMA_AUTO_TILER_TRACE__/);
        assert.match(start, /PLASMA_AUTO_TILER_TRACE/);
        assert.match(start, /build:trace/);
    });

    it("suppresses ordinary drag hook detail while retaining it in a trace bundle", () => {
        assert.deepEqual(dragLogs(null), []);
        assert.deepEqual(dragLogs("1"), [
            "plasma-auto-tiler:route-diag:drag-pull action=dispatch",
            "plasma-auto-tiler:route-diag:drag-verdict cancelled=false correlation=drag-1 reason=ok-moved",
        ]);
    });

    it("emits the cancelled rejection in normal mode with correlation and reason", () => {
        assert.deepEqual(dragLogs(null, true), [
            "plasma-auto-tiler:route-diag:drag-cancelled correlation=drag-1 reason=no-change",
        ]);
        assert.deepEqual(dragLogs("1", true), [
            "plasma-auto-tiler:route-diag:drag-pull action=dispatch",
            "plasma-auto-tiler:route-diag:drag-verdict cancelled=true correlation=drag-1 reason=no-change",
            "plasma-auto-tiler:route-diag:drag-cancelled correlation=drag-1 reason=no-change",
        ]);
    });
});
