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
        assert.doesNotMatch(schema, /engineAuthorityMode/);
    });

    it("declares the startup defaults in the KConfigXT schema", () => {
        const schema = readFileSync("contents/config/main.xml", "utf8");
        assert.match(schema, /<default>dwindle<\/default>/);
        assert.match(schema, /<default>per-output-local<\/default>/);
        assert.match(schema, /<default>cosmic<\/default>/);
        assert.match(schema, /<entry name="dropOutlinePreview" type="Bool">[\s\S]*?<default>false<\/default>/);
        assert.doesNotMatch(schema, /engineAuthorityMode/);
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
        assert.doesNotMatch(ui, /engineAuthorityMode/);
    });

    it("shares one callable-signal connector across all four Rust entries", () => {
        const capability = readFileSync("src/signal-capability.ts", "utf8");
        assert.ok(capability.includes("connectSignal"));
        assert.ok(capability.includes("isConnectableSignal"));
        assert.ok(capability.includes('"function"'));
        assert.ok(!capability.includes("globalThis"));
        assert.ok(!capability.includes("Function("));
        assert.ok(!capability.includes("setTimeout"));
        assert.ok(!capability.includes("setInterval"));
        assert.ok(!capability.includes("pollFor"));
        assert.ok(!capability.includes("fallback"));
        for (const name of ["focus-adapter-entry", "movement-adapter-entry", "resize-adapter-entry", "pointer-resize-adapter-entry"]) {
            const body = readFileSync(`src/${name}.ts`, "utf8");
            assert.ok(body.includes("signal-capability"), `${name} must use the shared connector`);
            assert.ok(body.includes("connectSignal"), `${name} must connect through the shared layer`);
            assert.ok(!body.includes('typeof signal !== "object"'), `${name} must not keep the object-only guard`);
            assert.ok(!body.includes("globalThis"), `${name} must not use globals`);
            assert.ok(!body.includes("Function("), `${name} must not use dynamic function construction`);
            assert.ok(!body.includes("pollFor"), `${name} must not poll`);
        }
    });

    it("declares windowActivated without a Rust authority dispatcher", () => {
        const globals = readFileSync("src/kwin-globals.d.ts", "utf8");
        assert.ok(globals.includes("windowActivated"));
        assert.throws(() => readFileSync("src/engine-authority.ts", "utf8"));
    });

    it("names exact window signals with window-owned stepped payload and no polling/globals/legacy", () => {
        const pointer = readFileSync("src/pointer-resize-adapter-entry.ts", "utf8");
        for (const name of ["interactiveMoveResizeStarted", "interactiveMoveResizeStepped", "interactiveMoveResizeFinished", "moveResizedChanged"]) {
            assert.ok(pointer.includes(`"${name}"`));
        }
        assert.ok(pointer.includes('readSignal(ref, "interactiveMoveResizeStepped")'));
        assert.ok(pointer.includes("onStepped"));
        assert.ok(pointer.includes("adapter.windowStepped(ref, payload)"));
        const globals = readFileSync("src/kwin-globals.d.ts", "utf8");
        assert.ok(globals.includes("interactiveMoveResizeStepped"));
        assert.ok(globals.includes("Signal1<Rect>"));
        assert.ok(globals.includes("interface Window"));
        for (const name of ["focus-adapter-entry", "movement-adapter-entry", "resize-adapter-entry", "pointer-resize-adapter-entry", "signal-capability"]) {
            const body = readFileSync(`src/${name}.ts`, "utf8");
            assert.ok(!body.includes("globalThis"));
            assert.ok(!body.includes("Function("));
            assert.ok(!body.includes("setTimeout"));
            assert.ok(!body.includes("setInterval"));
            assert.ok(!body.includes("pollFor"));
            assert.ok(!body.includes("fallback"));
            assert.ok(!/legacy/i.test(body));
        }
    });
});
