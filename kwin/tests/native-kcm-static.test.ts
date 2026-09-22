import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

const schema = read("contents/config/main.xml");
const scriptMetadata = JSON.parse(read("metadata.json")) as Record<string, unknown>;
const nativeMetadata = JSON.parse(read("native-effect/metadata.json")) as {
    KPlugin: { Id: string; Name: string; Description: string; EnabledByDefault: boolean };
    "X-KDE-ConfigModule": string;
};
const kcmMetadata = JSON.parse(read("native-effect/activeborderconfig_module.json")) as {
    KPlugin: { Id: string; Name: string; Description: string; Icon: string; License: string };
};
const cmake = read("native-effect/CMakeLists.txt").replace(/\s+/g, " ");
const kcfg = read("native-effect/activeborderconfig.kcfg");
const module = read("native-effect/activeborderconfig_module.cpp");
const effect = read("native-effect/activewindowborder.cpp");
const logic = read("native-effect/activeborderlogic.h");
const ui = read("native-effect/activeborderconfig.ui");

const SCRIPT_SETTINGS = {
    workspaceMode: { type: "Enum", defaultValue: "per-output-local" },
    shortcutProfile: { type: "Enum", defaultValue: "cosmic" },
    innerGap: { type: "Int", defaultValue: "8" },
    outerGap: { type: "Int", defaultValue: "8" },
} as const;

function schemaEntries(): Record<string, { type: string; defaultValue: string }> {
    const entries: Record<string, { type: string; defaultValue: string }> = {};
    for (const match of schema.matchAll(/<entry name="([^"]+)" type="([^"]+)">([\s\S]*?)<\/entry>/g)) {
        const name = match[1];
        const type = match[2];
        const content = match[3];
        if (name === undefined || type === undefined || content === undefined) {
            assert.fail("entry match must declare name, type, and content");
        }
        const defaultMatch = content.match(/<default>([^<]*)<\/default>/);
        if (defaultMatch === null) {
            assert.fail(`${name} must declare a default`);
        }
        const defaultValue = defaultMatch[1];
        if (defaultValue === undefined) {
            assert.fail(`${name} must declare a default value`);
        }
        entries[name] = { type, defaultValue };
    }
    return entries;
}

describe("native KCM static contract", () => {
    it("discovers the native effect and installs its effect and KCM plugins in KWin namespaces", () => {
        assert.equal(nativeMetadata.KPlugin.Id, "plasma-auto-tiler-active-border");
        assert.equal(nativeMetadata.KPlugin.EnabledByDefault, false);
        assert.equal(
            nativeMetadata["X-KDE-ConfigModule"],
            "plasma-auto-tiler-active-border_config",
        );
        assert.equal(kcmMetadata.KPlugin.Id, "plasma-auto-tiler-active-border_config");
        for (const field of ["Name", "Description", "Icon", "License"] as const) {
            assert.notEqual(kcmMetadata.KPlugin[field], "");
        }
        assert.match(module, /K_PLUGIN_CLASS_WITH_JSON\(KWin::ActiveBorderConfigModule, "activeborderconfig_module\.json"\)/);
        assert.match(
            cmake,
            /kcoreaddons_add_plugin\(plasma-auto-tiler-active-border INSTALL_NAMESPACE "kwin\/effects\/plugins"/,
        );
        assert.match(
            cmake,
            /kcoreaddons_add_plugin\(plasma-auto-tiler-active-border_config INSTALL_NAMESPACE "kwin\/effects\/configs"/,
        );
        assert.match(cmake, /activeborderconfig_module\.json/);
        assert.ok(cmake.includes("add_test(NAME native-effect-metadata-factory-validation"));
        assert.ok(cmake.includes("-P ${CMAKE_CURRENT_SOURCE_DIR}/validate-metadata.cmake"));
        assert.ok(cmake.includes("add_test(NAME native-effect-unified-lifecycle"));
        assert.ok(cmake.includes("validate-unified-lifecycle.cmake"));
    });

    it("brands the surviving effect Plasma Auto Tiler and keeps exactly one effect plugin", () => {
        assert.equal(nativeMetadata.KPlugin.Name, "Plasma Auto Tiler");
        assert.notEqual(nativeMetadata.KPlugin.Description, "");
        assert.match(nativeMetadata.KPlugin.Description, /Plasma Auto Tiler/);
        assert.equal(kcmMetadata.KPlugin.Name, "Plasma Auto Tiler");
        // Exactly one effect plugin target plus the KCM config target; the
        // standalone drag-oracle effect, factory, metadata, and validation
        // script are gone while the oracle Rust test target stays.
        assert.equal(
            (cmake.match(/INSTALL_NAMESPACE "kwin\/effects\/plugins"/g) ?? []).length,
            1,
        );
        assert.ok(cmake.includes("drag_oracle_ffi.h"));
        assert.ok(cmake.includes("plasma-auto-tiler-drag-oracle-rs"));
        assert.ok(cmake.includes("native-effect-drag-oracle-rs"));
        for (const residue of [
            "dragoracle.h",
            "dragoracle.cpp",
            "dragoracle-metadata.json",
            "validate-dragoracle.cmake",
            "native-effect-drag-oracle-validation",
            "kcoreaddons_add_plugin(plasma-auto-tiler-drag-oracle",
        ]) {
            assert.ok(!cmake.includes(residue), `expected no CMake residue: ${residue}`);
        }
        for (const residue of [
            "DragOracleEffect",
            "dragoracle-metadata.json",
            "plasma-auto-tiler-drag-oracle",
        ]) {
            assert.ok(!effect.includes(residue), `expected no survivor residue: ${residue}`);
        }
    });

    it("keeps the four supported script keys and defaults identical between schema and native KCM", () => {
        assert.deepEqual(schemaEntries(), SCRIPT_SETTINGS);
        assert.match(kcfg, /<group name="Effect-plasma-auto-tiler-active-border">/);

        for (const [key, setting] of Object.entries(SCRIPT_SETTINGS)) {
            if (key === "innerGap" || key === "outerGap") {
                continue;
            }
            const defaultExpression = `QStringLiteral("${setting.defaultValue}")`;
            assert.match(
                module,
                new RegExp(
                    `readEntry\\(QStringLiteral\\("${key}"\\), ${defaultExpression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
                ),
            );
            assert.match(module, new RegExp(`writeEntry\\(QStringLiteral\\("${key}"\\)`));
        }
        for (const key of ["innerGap", "outerGap"]) {
            assert.match(module, new RegExp(`readBoundedGap\\(group, QStringLiteral\\("${key}"\\)\\)`));
            assert.match(module, new RegExp(`isBoundedGapRawValid\\(group, QStringLiteral\\("${key}"\\)\\)`));
            assert.match(module, new RegExp(`writeEntry\\(QStringLiteral\\("${key}"\\)`));
            assert.match(module, new RegExp(`${key}SpinBox->setValue\\(8\\)`));
            assert.match(module, new RegExp(`${key}SpinBox->value\\(\\)`));
        }

        assert.match(module, /workspaceModeCombo->findData\(QStringLiteral\("per-output-local"\)\)/);
        assert.match(module, /shortcutProfileCombo->findData\(QStringLiteral\("cosmic"\)\)/);
        assert.doesNotMatch(module, /engineAuthorityModeCombo/);
        assert.doesNotMatch(module, /tilingAlgorithm|automaticSplitTarget|dropOutlinePreview/);
        assert.match(module, /innerGapSpinBox->setValue\(8\)/);
        assert.match(module, /outerGapSpinBox->setValue\(8\)/);
    });

    it("reads and writes supported script settings only through the script config group", () => {
        assert.equal((module.match(/Script-plasma-auto-tiler-kwin/g) ?? []).length, 2);
        assert.doesNotMatch(module, /Effect-plasma-auto-tiler-kwin/);
        assert.match(module, /const QString workspaceMode = group\.readEntry\(QStringLiteral\("workspaceMode"\), QStringLiteral\("per-output-local"\)\)/);
        assert.match(module, /select\(m_ui\.workspaceModeCombo, workspaceMode, QStringLiteral\("per-output-local"\)\)/);
        assert.doesNotMatch(module, /tilingAlgorithm|automaticSplitTarget|dropOutlinePreview/);
    });

    it("does not expose global shortcut mutation APIs", () => {
        for (const forbidden of [
            /KGlobalAccel/,
            /globalShortcut/i,
            /registerGlobalShortcut/,
            /unregisterGlobalShortcut/,
            /setGlobalShortcut/,
        ]) {
            assert.doesNotMatch(module, forbidden);
        }
    });

    it("keeps border settings in the native group and hot-applies through the native effect", () => {
        assert.match(kcfg, /<group name="Effect-plasma-auto-tiler-active-border">/);
        assert.match(kcfg, /<entry name="UseThemeColor" type="Bool">[\s\S]*?<default>true<\/default>/);
        assert.match(module, /ActiveBorderConfig::instance\(QStringLiteral\("kwinrc"\)\)/);
        assert.match(module, /QString ActiveBorderConfigModule::effectService\(\)[\s\S]*?QStringLiteral\("org\.kde\.KWin"\)/);
        assert.match(module, /QString ActiveBorderConfigModule::effectPath\(\)[\s\S]*?QStringLiteral\("\/Effects"\)/);
        assert.match(module, /QString ActiveBorderConfigModule::effectInterface\(\)[\s\S]*?QStringLiteral\("org\.kde\.kwin\.Effects"\)/);
        assert.match(module, /QString ActiveBorderConfigModule::effectMethod\(\)[\s\S]*?QStringLiteral\("reconfigureEffect"\)/);
        assert.match(module, /QString ActiveBorderConfigModule::effectName\(\)[\s\S]*?QStringLiteral\("plasma-auto-tiler-active-border"\)/);
        assert.match(module, /QDBusInterface interface\(effectService\(\), effectPath\(\), effectInterface\(\)/);
        assert.match(module, /interface\.call\(effectMethod\(\), effectName\(\)\)/);
        assert.match(module, /requestEffectReconfigure\(\)/);
        assert.match(effect, /void ActiveWindowBorderEffect::reconfigure\(ReconfigureFlags\)/);
        assert.match(effect, /ActiveBorderConfig::self\(\)->read\(\);[\s\S]*updateOutline\(\);/);
        assert.match(effect, /ActiveBorderConfig::useThemeColor\(\)/);
        assert.match(effect, /if \(useThemeColor\)[\s\S]*?KColorScheme::isColorSetSupported/);
        assert.match(effect, /activeBorderColor\(themeColor, fallback, useThemeColor\)/);
        assert.doesNotMatch(module, /UseThemeColor/);
        assert.match(effect, /KColorScheme::isColorSetSupported\(colorConfig, KColorScheme::Selection\)/);
        assert.match(logic, /themeColor\.isValid\(\) && themeColor\.alpha\(\) > 0/);
        assert.match(logic, /activeBorderColor\(const QColor &themeColor, const QColor &fallbackColor, bool useThemeColor\)/);
        assert.match(logic, /useThemeColor && themeColor\.isValid/);
        assert.match(logic, /QRectF activeBorderInnerRect\(/);
        assert.match(effect, /const QRectF innerRect = activeBorderInnerRect\(state\.innerRect, gap\)/);
        assert.match(effect, /setInnerRect\(window \? window->windowItem\(\)->mapFromScene\(innerRect\) : RectF\(\)\)/);
        assert.match(effect, /const bool visible = state\.visible && initialOk/);
        assert.match(effect, /setVisible\(visible\)/);
        assert.match(effect, /addRepaintFull\(\)/);
    });

    it("keeps a single engine with no authority mode switch", () => {
        assert.doesNotMatch(module, /engineAuthorityMode/);
        assert.doesNotMatch(module, /engineAuthorityChanged/);
        assert.doesNotMatch(module, /rust-development/);
    });

    it("tracks supported script controls without rewriting untouched keys", () => {
        assert.match(module, /unmanagedWidgetChangeState\(/);
        assert.match(module, /unmanagedWidgetDefaultState\(/);
        assert.match(module, /const bool borderChanged = managedWidgetChangeState\(\)/);
        assert.doesNotMatch(module, /setNeedsSave\(false\)/);
        assert.match(module, /if \(!m_loadedInnerGapRawValid \|\| !m_loadedOuterGapRawValid \|\| current != m_loadedScriptValues\)/);
        assert.match(module, /if \(!m_loadedInnerGapRawValid \|\| current\.value\(QStringLiteral\("innerGap"\)\) != m_loadedScriptValues/);
        assert.match(module, /if \(!m_loadedOuterGapRawValid \|\| current\.value\(QStringLiteral\("outerGap"\)\) != m_loadedScriptValues/);
        assert.match(module, /m_loadedScriptValues = \{/);
    });

    it("associates every labeled native control with its buddy", () => {
        for (const [label, control] of [
            ["label_workspaceMode", "workspaceModeCombo"],
            ["label_shortcutProfile", "shortcutProfileCombo"],
            ["label_innerGap", "innerGapSpinBox"],
            ["label_outerGap", "outerGapSpinBox"],
            ["label_BorderColor", "kcfg_BorderColor"],
            ["label_BorderWidth", "kcfg_BorderWidth"],
            ["label_BorderRadius", "kcfg_BorderRadius"],
            ["label_BorderGap", "kcfg_BorderGap"],
        ]) {
            assert.match(ui, new RegExp(`name="${label}"[\\s\\S]*?<property name="buddy">[\\s\\S]*?<cstring>${control}</cstring>`));
        }
    });

    it("manages the theme override through KConfigXT without disabling the fallback color", () => {
        assert.match(ui, /name="kcfg_UseThemeColor"/);
        assert.match(ui, /Use theme highlight color when available/);
        assert.match(ui, /When disabled, the configured color is always used/);
        assert.doesNotMatch(ui, /kcfg_BorderColor[\s\S]{0,400}?enabled[\s\S]{0,20}?false/);
    });

    it("explains gap reload versus session restart and retires the generic metadata KCM only after native discovery exists", () => {
        assert.equal(scriptMetadata["X-KDE-ConfigModule"], undefined);
        assert.doesNotMatch(read("metadata.json"), /kcm_kwin4_genericscripted/);
        assert.ok(nativeMetadata["X-KDE-ConfigModule"]);
        assert.doesNotMatch(ui, /engine authority/i);
        assert.doesNotMatch(ui, /Rust is development-only/);
        assert.doesNotMatch(ui, /clears current transient Script ambiguity/);
        assert.doesNotMatch(ui, /engine authority[^.]*apply immediately/i);
        assert.doesNotMatch(ui, /engine authority[^.]*takes effect immediately/i);
        assert.match(ui, /startup settings require a session restart/i);
        assert.doesNotMatch(ui, /unconsumed settings have no running effect/i);
        assert.match(ui, /Gap settings can reload/i);
        assert.match(ui, /Saving gaps marks a reload as required/i);
        assert.doesNotMatch(ui, /Other script settings require a script reload or session restart\./);
        assert.doesNotMatch(ui, /Script settings do not hot-apply; reload the script or restart the session\./);
    });
});
