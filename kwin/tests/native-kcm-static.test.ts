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
const scriptKcmMetadata = JSON.parse(read("native-effect/scriptconfig_module.json")) as {
    KPlugin: { Id: string; Name: string; Description: string; Icon: string; License: string };
};
const cmake = read("native-effect/CMakeLists.txt").replace(/\s+/g, " ");
const kcfg = read("native-effect/activeborderconfig.kcfg");
const effectFactory = read("native-effect/activeborderconfig_module.cpp");
const effectFactoryHeader = read("native-effect/activeborderconfig_module.h");
const scriptFactory = read("native-effect/scriptconfig_module.cpp");
const scriptFactoryHeader = read("native-effect/scriptconfig_module.h");
const unified = read("native-effect/unifiedsettings_module.cpp");
const unifiedHeader = read("native-effect/unifiedsettings_module.h");
const unifiedUi = read("native-effect/unifiedsettings.ui");
const effect = read("native-effect/activewindowborder.cpp");
const logic = read("native-effect/activeborderlogic.h");

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
    it("discovers the native effect and installs both KCM plugins in KWin namespaces", () => {
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
        assert.match(effectFactory, /K_PLUGIN_CLASS_WITH_JSON\(KWin::ActiveBorderConfigModule, "activeborderconfig_module\.json"\)/);
        assert.match(
            cmake,
            /kcoreaddons_add_plugin\(plasma-auto-tiler-active-border INSTALL_NAMESPACE "kwin\/effects\/plugins"/,
        );
        assert.match(
            cmake,
            /kcoreaddons_add_plugin\(plasma-auto-tiler-active-border_config INSTALL_NAMESPACE "kwin\/effects\/configs"/,
        );
        assert.match(cmake, /activeborderconfig_module\.json/);
        assert.match(cmake, /scriptconfig_module\.json/);
        assert.match(
            cmake,
            /kcoreaddons_add_plugin\(plasma-auto-tiler-kwin_config INSTALL_NAMESPACE "kwin\/scripts\/configs"/,
        );
        assert.match(scriptFactory, /K_PLUGIN_CLASS_WITH_JSON\(KWin::ScriptConfigModule, "scriptconfig_module\.json"\)/);
        assert.equal(scriptKcmMetadata.KPlugin.Id, "plasma-auto-tiler-kwin_config");
        for (const field of ["Name", "Description", "Icon", "License"] as const) {
            assert.notEqual(scriptKcmMetadata.KPlugin[field], "");
        }
        assert.doesNotMatch(scriptKcmMetadata.KPlugin.Description, /shortcut profile/i);
        assert.ok(cmake.includes("add_test(NAME native-effect-metadata-factory-validation"));
        assert.ok(cmake.includes("-P ${CMAKE_CURRENT_SOURCE_DIR}/validate-metadata.cmake"));
        assert.ok(cmake.includes("add_test(NAME native-effect-unified-lifecycle"));
        assert.ok(cmake.includes("validate-unified-lifecycle.cmake"));
    });

    it("shares one unified page through both existing factories and discovery routes", () => {
        assert.equal(
            scriptMetadata["X-KDE-ConfigModule"],
            "kwin/scripts/configs/plasma-auto-tiler-kwin_config",
        );
        assert.doesNotMatch(read("metadata.json"), /kcm_kwin4_genericscripted/);
        assert.ok(nativeMetadata["X-KDE-ConfigModule"]);
        for (const header of [effectFactoryHeader, scriptFactoryHeader]) {
            assert.match(header, /#include "unifiedsettings_module\.h"/);
        }
        assert.match(effectFactoryHeader, /class ActiveBorderConfigModule : public UnifiedSettingsModule/);
        assert.match(scriptFactoryHeader, /class ScriptConfigModule : public UnifiedSettingsModule/);
        assert.match(unifiedHeader, /class UnifiedSettingsModule : public KCModule/);
        assert.match(unifiedHeader, /#include "ui_unifiedsettings\.h"/);
        assert.match(unifiedHeader, /::Ui::UnifiedSettings m_ui/);
        // Thin factories carry no widget or reconfigure internals.
        for (const factory of [effectFactory, scriptFactory]) {
            assert.doesNotMatch(factory, /workspaceModeCombo|innerGapSpinBox|outerGapSpinBox/);
            assert.doesNotMatch(factory, /requestEffectReconfigure|requestScriptReconfigure/);
            assert.doesNotMatch(factory, /Script-plasma-auto-tiler-kwin/);
        }
        // Single unified sourceset feeds both plugins and every KCM test binary.
        assert.match(cmake, /unifiedsettings_module\.cpp/);
        assert.match(cmake, /unifiedsettings_module\.h/);
        assert.match(cmake, /ki18n_wrap_ui\(unified_kcm_SOURCES unifiedsettings\.ui\)/);
        assert.doesNotMatch(cmake, /activeborderconfig\.ui/);
        assert.doesNotMatch(cmake, /scriptconfig\.ui/);
        assert.ok(cmake.includes("add_test(NAME native-script-config-discovery-validation"));
        assert.ok(cmake.includes("-P ${CMAKE_CURRENT_SOURCE_DIR}/validate-scriptconfig.cmake"));
        // Unified page hosts border, shortcut, script, and status groups together.
        for (const token of [
            "kcfg_BorderColor",
            "kcfg_BorderWidth",
            "kcfg_DragPreviewColor",
            "kcfg_GroupUnderlayColor",
            "kcfg_GroupUnderlayExtension",
            "workspaceModeCombo",
            "innerGapSpinBox",
            "outerGapSpinBox",
            "shortcutApplyButton",
            "scriptStatusLabel",
        ]) {
            assert.match(unifiedUi, new RegExp(token));
        }
        assert.match(unified, /QString UnifiedSettingsModule::effectService\(\)/);
        assert.match(unified, /QString UnifiedSettingsModule::scriptService\(\)/);
    });

    it("brands the surviving effect Plasma Auto Tiler and keeps exactly one effect plugin", () => {
        assert.equal(nativeMetadata.KPlugin.Name, "Plasma Auto Tiler");
        assert.notEqual(nativeMetadata.KPlugin.Description, "");
        assert.match(nativeMetadata.KPlugin.Description, /Plasma Auto Tiler/);
        assert.equal(kcmMetadata.KPlugin.Name, "Plasma Auto Tiler");
        // Exactly one effect plugin target plus the KCM config target; the
        // standalone drag-oracle effect, factory, metadata, and validation
        // script are gone while the unified effect-ffi Rust target and the
        // oracle/group Rust tests stay.
        assert.equal(
            (cmake.match(/INSTALL_NAMESPACE "kwin\/effects\/plugins"/g) ?? []).length,
            1,
        );
        assert.ok(cmake.includes("drag_oracle_ffi.h"));
        assert.ok(cmake.includes("plasma-auto-tiler-effect-ffi-rs"));
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

    it("keeps the four supported script keys and defaults identical between schema and the unified script KCM", () => {
        // defaultTiled is schema-only (tray persist + script readConfig for
        // newly discovered workspaces); the unified KCM intentionally owns
        // only workspaceMode/innerGap/outerGap, so it is asserted separately.
        const entries = schemaEntries();
        assert.deepEqual(entries["defaultTiled"], { type: "Bool", defaultValue: "true" });
        const { defaultTiled: _ignored, ...rest } = entries;
        assert.deepEqual(rest, SCRIPT_SETTINGS);
        assert.match(kcfg, /<group name="Effect-plasma-auto-tiler-active-border">/);

        for (const [key, setting] of Object.entries(SCRIPT_SETTINGS)) {
            if (key === "innerGap" || key === "outerGap" || key === "shortcutProfile") {
                continue;
            }
            const defaultExpression = `QStringLiteral("${setting.defaultValue}")`;
            assert.match(
                unified,
                new RegExp(
                    `readEntry\\(QStringLiteral\\("${key}"\\), ${defaultExpression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
                ),
            );
            assert.match(unified, new RegExp(`writeEntry\\(QStringLiteral\\("${key}"\\)`));
        }
        for (const key of ["innerGap", "outerGap"]) {
            assert.match(unified, new RegExp(`readBoundedGap\\(group, QStringLiteral\\("${key}"\\)\\)`));
            assert.match(unified, new RegExp(`isBoundedGapRawValid\\(group, QStringLiteral\\("${key}"\\)\\)`));
            assert.match(unified, new RegExp(`writeEntry\\(QStringLiteral\\("${key}"\\)`));
            assert.match(unified, new RegExp(`${key}SpinBox->setValue\\((8|kGapDefault)\\)`));
            assert.match(unified, new RegExp(`${key}SpinBox->value\\(\\)`));
        }

        assert.match(unified, /workspaceModeCombo->findData\(QStringLiteral\("per-output-local"\)\)/);
        assert.doesNotMatch(unified, /shortcutProfileCombo/);
        assert.doesNotMatch(unified, /readEntry\(QStringLiteral\("shortcutProfile"\)/);
        assert.doesNotMatch(unified, /writeEntry\(QStringLiteral\("shortcutProfile"\)/);
        assert.doesNotMatch(unified, /engineAuthorityModeCombo/);
        assert.doesNotMatch(unified, /tilingAlgorithm|automaticSplitTarget|dropOutlinePreview/);
        assert.match(unified, /innerGapSpinBox->setValue\((8|kGapDefault)\)/);
        assert.match(unified, /outerGapSpinBox->setValue\((8|kGapDefault)\)/);
        for (const factory of [effectFactory, scriptFactory]) {
            assert.doesNotMatch(factory, /workspaceModeCombo|shortcutProfileCombo|innerGapSpinBox|outerGapSpinBox/);
            assert.doesNotMatch(factory, /Script-plasma-auto-tiler-kwin/);
        }
    });

    it("reads and writes supported script settings only through the script config group", () => {
        assert.equal((unified.match(/Script-plasma-auto-tiler-kwin/g) ?? []).length, 2);
        assert.doesNotMatch(unified, /Effect-plasma-auto-tiler-kwin/);
        assert.match(unified, /const QString workspaceMode = group\.readEntry\(QStringLiteral\("workspaceMode"\), QStringLiteral\("per-output-local"\)\)/);
        assert.match(unified, /select\(m_ui\.workspaceModeCombo, workspaceMode, QStringLiteral\("per-output-local"\)\)/);
        assert.doesNotMatch(unified, /tilingAlgorithm|automaticSplitTarget|dropOutlinePreview/);
    });

    it("does not expose global shortcut mutation APIs", () => {
        for (const forbidden of [
            /KGlobalAccel/,
            /globalShortcut/i,
            /registerGlobalShortcut/,
            /unregisterGlobalShortcut/,
            /setGlobalShortcut/,
        ]) {
            assert.doesNotMatch(unified, forbidden);
            assert.doesNotMatch(unifiedHeader, forbidden);
        }
    });

    it("keeps border settings in the native group and hot-applies through the native effect", () => {
        assert.match(kcfg, /<group name="Effect-plasma-auto-tiler-active-border">/);
        assert.match(kcfg, /<entry name="UseThemeColor" type="Bool">[\s\S]*?<default>true<\/default>/);
        assert.match(unified, /ActiveBorderConfig::instance\(QStringLiteral\("kwinrc"\)\)/);
        assert.match(unified, /QString UnifiedSettingsModule::effectService\(\)[\s\S]*?QStringLiteral\("org\.kde\.KWin"\)/);
        assert.match(unified, /QString UnifiedSettingsModule::effectPath\(\)[\s\S]*?QStringLiteral\("\/Effects"\)/);
        assert.match(unified, /QString UnifiedSettingsModule::effectInterface\(\)[\s\S]*?QStringLiteral\("org\.kde\.kwin\.Effects"\)/);
        assert.match(unified, /QString UnifiedSettingsModule::effectMethod\(\)[\s\S]*?QStringLiteral\("reconfigureEffect"\)/);
        assert.match(unified, /QString UnifiedSettingsModule::effectName\(\)[\s\S]*?QStringLiteral\("plasma-auto-tiler-active-border"\)/);
        assert.match(unified, /QDBusInterface interface\(effectService\(\), effectPath\(\), effectInterface\(\)/);
        assert.match(unified, /interface\.call\(effectMethod\(\), effectName\(\)\)/);
        assert.match(unified, /requestEffectReconfigure\(\)/);
        assert.match(unified, /m_effectReconfigurePending/);
        assert.match(unified, /markAsChanged\(\)/);
        assert.match(effect, /void ActiveWindowBorderEffect::reconfigure\(ReconfigureFlags\)/);
        assert.match(effect, /ActiveBorderConfig::self\(\)->read\(\);[\s\S]*updateOutline\(\);/);
        assert.match(effect, /ActiveBorderConfig::useThemeColor\(\)/);
        assert.match(effect, /if \(useThemeColor\)[\s\S]*?KColorScheme::isColorSetSupported/);
        assert.match(effect, /activeBorderColor\(themeColor, fallback, useThemeColor\)/);
        assert.doesNotMatch(unified, /UseThemeColor/);
        assert.match(effect, /KColorScheme::isColorSetSupported\(colorConfig, KColorScheme::Selection\)/);
        assert.match(logic, /activeBorderColor\(const QColor &themeColor, const QColor &fallbackColor, bool useThemeColor\)/);
        assert.match(logic, /#include "visual_policy_ffi\.h"/);
        assert.match(logic, /themeValid \? themeColor\.alpha\(\) : 0/);
        assert.match(logic, /visual_border_use_theme\(useThemeColor \? 1 : 0, themeValid \? 1 : 0/);
        assert.match(logic, /QRectF activeBorderInnerRect\(/);
        assert.match(effect, /const QRectF innerRect = activeBorderInnerRect\(state\.innerRect, gap\)/);
        assert.match(effect, /setInnerRect\(window \? window->windowItem\(\)->mapFromScene\(innerRect\) : RectF\(\)\)/);
        assert.match(effect, /const bool visible = state\.visible;/);
        assert.match(effect, /setVisible\(visible\)/);
        assert.match(effect, /addRepaintFull\(\)/);
    });

    it("keeps a single engine with no authority mode switch", () => {
        assert.doesNotMatch(unified, /engineAuthorityMode/);
        assert.doesNotMatch(unified, /engineAuthorityChanged/);
        assert.doesNotMatch(unified, /rust-development/);
    });

    it("tracks supported script controls without rewriting untouched keys", () => {
        assert.match(unified, /unmanagedWidgetChangeState\(/);
        assert.match(unified, /unmanagedWidgetDefaultState\(/);
        assert.match(unified, /managedWidgetChangeState\(\)/);
        assert.doesNotMatch(unified, /setNeedsSave\(false\)/);
        assert.match(unified, /const bool widgetsChanged =/);
        assert.match(unified, /const bool scriptRetryArmed = m_gapReconfigurePending/);
        assert.match(unified, /if \(!widgetsChanged && !scriptRetryArmed\)/);
        assert.match(unified, /if \(!m_loadedInnerGapRawValid\s*\|\|\s*current\.value\(QStringLiteral\("innerGap"\)\) != m_loadedScriptValues/);
        assert.match(unified, /if \(!m_loadedOuterGapRawValid\s*\|\|\s*current\.value\(QStringLiteral\("outerGap"\)\) != m_loadedScriptValues/);
        assert.match(unified, /m_loadedScriptValues = \{/);
    });

    it("associates every labeled unified control with its buddy", () => {
        for (const [label, control] of [
            ["label_workspaceMode", "workspaceModeCombo"],
            ["label_innerGap", "innerGapSpinBox"],
            ["label_outerGap", "outerGapSpinBox"],
        ]) {
            assert.match(unifiedUi, new RegExp(`name="${label}"[\\s\\S]*?<property name="buddy">[\\s\\S]*?<cstring>${control}</cstring>`));
        }
        assert.doesNotMatch(unifiedUi, /shortcutProfileCombo/);
        assert.doesNotMatch(unifiedUi, /label_shortcutProfile/);
        for (const [label, control] of [
            ["label_BorderColor", "kcfg_BorderColor"],
            ["label_BorderWidth", "kcfg_BorderWidth"],
            ["label_BorderRadius", "kcfg_BorderRadius"],
            ["label_BorderGap", "kcfg_BorderGap"],
            ["label_DragPreviewColor", "kcfg_DragPreviewColor"],
            ["label_GroupUnderlayColor", "kcfg_GroupUnderlayColor"],
            ["label_GroupUnderlayExtension", "kcfg_GroupUnderlayExtension"],
        ]) {
            assert.match(unifiedUi, new RegExp(`name="${label}"[\\s\\S]*?<property name="buddy">[\\s\\S]*?<cstring>${control}</cstring>`));
        }
    });

    it("exposes translucent group underlay color and extension through KConfigXT", () => {
        assert.match(kcfg, /<entry name="GroupUnderlayColor" type="Color">[\s\S]*?<default>#40808080<\/default>/);
        assert.match(kcfg, /<entry name="GroupUnderlayExtension" type="Double">[\s\S]*?<default>-1<\/default>/);
        assert.match(kcfg, /<entry name="BorderColor" type="Color">/);
        assert.match(kcfg, /<entry name="DragPreviewColor" type="Color">/);
        assert.match(unifiedUi, /name="kcfg_GroupUnderlayColor"/);
        assert.match(unifiedUi, /name="kcfg_GroupUnderlayExtension"/);
        assert.match(unifiedUi, /Match border width/);
        assert.match(effect, /groupUnderlayColor\(\)/);
        assert.match(effect, /groupUnderlayExtension\(\)/);
        assert.match(effect, /updateGroupUnderlayFill/);
        assert.match(effect, /groupUnderlayOuterRect/);
        assert.match(effect, /groupUnderlayEffectiveExtension\(/);
        assert.match(logic, /groupUnderlayEffectiveExtension/);
    });

    it("manages the theme override through KConfigXT without disabling the fallback color", () => {
        assert.match(unifiedUi, /name="kcfg_UseThemeColor"/);
        assert.match(unifiedUi, /Use theme highlight color when available/);
        assert.match(unifiedUi, /When disabled, the configured color is always used/);
        assert.doesNotMatch(unifiedUi, /kcfg_BorderColor[\s\S]{0,400}?enabled[\s\S]{0,20}?false/);
    });

    it("routes script settings through the native script KCM on the shared unified page", () => {
        assert.match(unifiedHeader, /requestScriptReconfigure/);
        assert.match(unifiedHeader, /isScriptRestartRequired/);
        assert.match(unifiedHeader, /isGapReconfigurePending/);
        assert.match(unified, /m_gapReconfigurePending/);
        assert.match(unified, /if \(gapChanged \|\| scriptRetryArmed\)/);
        assert.match(unified, /if \(!widgetsChanged\)/);
        assert.match(unified, /This retry saved nothing/);
        assert.match(unified, /Session restart remains required for workspace mode/);
        assert.doesNotMatch(unified, /startup settings/);
        assert.match(unified, /retry on the next save/);
        assert.match(unified, /startupWritten/);
        assert.doesNotMatch(unified, /"keys=workspaceMode,shortcutProfile"/);
        assert.match(unified, /lcScriptConfig/);
        assert.match(unified, /plasmaautotiler\.script-config op=/);
        assert.match(unified, /logScriptConfig\("save", "persist", "ok"/);
        assert.match(unified, /logScriptConfig\("save", "reconfigure", "sent-unconfirmed"/);
        assert.match(unified, /logScriptConfig\("save", "reconfigure", "failed"/);
        assert.match(unified, /retry-on-next-save/);
        assert.match(unified, /logScriptConfig\("save", "startup", "restart-required"/);
        assert.doesNotMatch(unifiedUi, /engine authority/i);
        assert.doesNotMatch(unifiedUi, /Rust is development-only/);
        assert.doesNotMatch(unifiedUi, /clears current transient Script ambiguity/);
        assert.doesNotMatch(unifiedUi, /engine authority[^.]*apply immediately/i);
        assert.doesNotMatch(unifiedUi, /engine authority[^.]*takes effect immediately/i);
        assert.doesNotMatch(unifiedUi, /tilerReloadButton|tilerReloadStatusLabel|Reload Tiler/);
        assert.match(unifiedUi, /Tiling gaps and workspace mode are on this page\./);
        assert.doesNotMatch(unifiedUi, /unconsumed settings have no running effect/i);
        assert.match(unifiedUi, /workspace mode requires a session restart/i);
        assert.match(unifiedUi, /requires session restart/);
        assert.match(unifiedUi, /Saving changed gaps sends one typed KWin reconfigure request/);
        assert.match(unifiedUi, /never claims the running tiler applied the settings/);
        assert.doesNotMatch(unifiedUi, /shortcut profile/i);
        assert.doesNotMatch(unifiedUi, /unconsumed settings have no running effect/i);
        assert.doesNotMatch(read("metadata.json"), /Other script settings require a script reload or session restart\./);
    });
});
