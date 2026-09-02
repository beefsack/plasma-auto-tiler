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

    it("keeps the bundle free of post-ES2017 non-transpiled built-ins", () => {
        const bundle = readFileSync("contents/code/main.js", "utf8");
        assert.doesNotMatch(bundle, /\.flatMap\(/);
        assert.doesNotMatch(bundle, /\.flat\(/);
        assert.doesNotMatch(bundle, /Object\.fromEntries/);
        assert.doesNotMatch(bundle, /\.finally\(/);
        assert.doesNotMatch(bundle, /Promise\.(?:allSettled|any)\(/);
        assert.doesNotMatch(bundle, /\.(?:trimStart|trimEnd|matchAll|replaceAll)\(/);
    });

    it("keeps the script metadata free of the retired generic KCM link", () => {
        const metadata = readFileSync("metadata.json", "utf8");
        const schema = readFileSync("contents/config/main.xml", "utf8");
        assert.doesNotMatch(metadata, /"X-KDE-ConfigModule"/);
        assert.match(schema, /<entry name="tilingAlgorithm" type="Enum">/);
        assert.match(schema, /<entry name="automaticSplitTarget" type="Enum">/);
        assert.match(schema, /<entry name="workspaceMode" type="Enum">/);
        assert.match(schema, /<entry name="shortcutProfile" type="Enum">/);
        assert.match(schema, /<entry name="dropOutlinePreview" type="Bool">/);
    });

    it("declares the startup defaults in the KConfigXT schema", () => {
        const schema = readFileSync("contents/config/main.xml", "utf8");
        assert.match(schema, /<default>dwindle<\/default>/);
        assert.match(schema, /<default>per-output-local<\/default>/);
        assert.match(schema, /<default>cosmic<\/default>/);
        assert.match(schema, /<entry name="dropOutlinePreview" type="Bool">[\s\S]*?<default>false<\/default>/);
        for (const preset of ["columns", "rows", "balanced-grid", "dwindle"]) {
            assert.match(schema, new RegExp(`<choice name="${preset}" value="${preset}"\\/>`));
        }
        for (const target of ["dwindle", "largest", "active"]) {
            assert.match(schema, new RegExp(`<choice name="${target}" value="${target}"\\/>`));
        }
        for (const mode of ["per-output-local", "global-unique", "shared"]) {
            assert.match(schema, new RegExp(`<choice name="${mode}" value="${mode}"\\/>`));
        }
        for (const profile of ["cosmic", "hyprland", "bspwm"]) {
            assert.match(schema, new RegExp(`<choice name="${profile}" value="${profile}"\\/>`));
        }
    });

    it("declares the standard KCM UI with kcfg-bound controls", () => {
        const ui = readFileSync("contents/ui/config.ui", "utf8");
        assert.match(ui, /<widget class="QWidget"/);
        for (const entry of ["tilingAlgorithm", "automaticSplitTarget", "workspaceMode", "shortcutProfile"]) {
            assert.match(ui, new RegExp(`name="kcfg_${entry}"`));
        }
        assert.match(ui, /<widget class="QCheckBox" name="kcfg_dropOutlinePreview">/);
    });
});
