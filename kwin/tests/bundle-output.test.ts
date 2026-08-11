import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("production bundle compatibility", () => {
    it("uses the declared ES2017 IIFE target without optional catch bindings", () => {
        const manifest = readFileSync("package.json", "utf8");
        const bundle = readFileSync("contents/code/main.js", "utf8");

        assert.match(
            manifest,
            /"build": "rm -rf dist && esbuild src\/entry\.ts --bundle --format=iife --target=es2017 --outfile=contents\/code\/main\.js"/,
        );
        assert.match(bundle, /^"use strict";\n\(\(\) => \{/);
        assert.doesNotMatch(bundle, /\bcatch\s*\{/);
        assert.doesNotMatch(bundle, /\?\./);
        assert.doesNotMatch(bundle, /^\s*(?:import|export)\s/m);
        assert.doesNotMatch(bundle, /node:|sourceMappingURL/);
    });
});
