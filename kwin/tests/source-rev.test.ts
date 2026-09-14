import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

import { PLAN_SOURCE_REV } from "../src/source-rev";

const REV = "0123456789abcdef0123456789abcdef01234567";

interface RevBundle {
    readonly text: string;
    readonly read: () => { PLAN_SOURCE_REV: string };
}

// Fresh esbuild bundle of the source-rev module only. A non-null define
// models the installed build's PLASMA_AUTO_TILER_SOURCE_REV bake-in; null
// models an ordinary define-free npm build.
function buildRevBundle(define: string | null): RevBundle {
    const outDir = mkdtempSync(join(tmpdir(), "pat-source-rev-"));
    const outFile = join(outDir, "main.js");
    const args: string[] = [
        "esbuild",
        "src/source-rev.ts",
        "--bundle",
        "--format=iife",
        "--target=es2017",
        "--global-name=PatSourceRev",
        `--outfile=${outFile}`,
    ];
    if (define !== null) {
        args.push(`--define:__PLASMA_AUTO_TILER_SOURCE_REV__=${JSON.stringify(define)}`);
    }
    execFileSync("npx", args, { cwd: process.cwd(), stdio: "pipe" });
    const text = readFileSync(outFile, "utf8");
    const context = createContext({});
    runInContext(text, context, { filename: outFile });
    return {
        text,
        read: () => {
            const global = (context as unknown as { PatSourceRev?: { PLAN_SOURCE_REV: string } }).PatSourceRev;
            assert.ok(global !== undefined, "iife global PatSourceRev must be exposed");
            return global;
        },
    };
}

describe("compile-time source revision identity", () => {
    it("resolves deterministically to local-dev in an ordinary define-free build", () => {
        assert.equal(PLAN_SOURCE_REV, "local-dev");
        const bundle = buildRevBundle(null);
        assert.equal(bundle.read().PLAN_SOURCE_REV, "local-dev");
        assert.doesNotMatch(bundle.text, /process\.env/);
    });

    it("bakes the exact release source revision define into the bounded constant", () => {
        const bundle = buildRevBundle(REV);
        assert.equal(bundle.read().PLAN_SOURCE_REV, REV);
        assert.ok(bundle.text.includes(`"${REV}"`), "release revision must be compiled into the bundle");
        assert.ok(
            !bundle.text.includes("__PLASMA_AUTO_TILER_SOURCE_REV__"),
            "the define must fully replace the compile-time sentinel",
        );
        assert.doesNotMatch(bundle.text, /process\.env/);
    });

    it("accepts a 64-hex sha256 git revision within the bounded shape", () => {
        const sha256Rev = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        const bundle = buildRevBundle(sha256Rev);
        assert.equal(bundle.read().PLAN_SOURCE_REV, sha256Rev);
    });

    it("falls back to local-dev for any non-bounded define value", () => {
        for (const bad of [
            "",
            "short",
            "not-a-rev",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01",
            "0123456789abcdef0123456789abcdef0123456",
        ]) {
            const bundle = buildRevBundle(bad);
            assert.equal(bundle.read().PLAN_SOURCE_REV, "local-dev", `expected local-dev for ${JSON.stringify(bad)}`);
        }
    });

    it("wires the define into build:installed only, keeping the ordinary build define-free", () => {
        const manifest = readFileSync("package.json", "utf8");
        const buildScript = (manifest.match(/"build": "((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? "";
        const installedScript = (manifest.match(/"build:installed": "((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? "";
        assert.ok(installedScript.includes("--define:__PLASMA_AUTO_TILER_SOURCE_REV__="));
        assert.ok(!buildScript.includes("--define:"), "ordinary npm build must stay define-free");
    });
});