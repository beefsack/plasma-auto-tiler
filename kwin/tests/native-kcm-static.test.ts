import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { planShortcutCatalog } from "../src/plan-adapter-entry";
import { workspaceShortcutCatalog } from "../src/workspace-native";

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
const reconcilerHeader = read("native-effect/shortcutreconciler.h");
const reconciler = read("native-effect/shortcutreconciler.cpp");
const effect = read("native-effect/activewindowborder.cpp");
const logic = read("native-effect/activeborderlogic.h");

const SCRIPT_SETTINGS = {
    workspaceMode: { type: "Enum", defaultValue: "per-output-local" },
    shortcutProfile: { type: "Enum", defaultValue: "cosmic" },
    sameAxisMove: { type: "Enum", defaultValue: "cosmic-wrap" },
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
            assert.doesNotMatch(factory, /workspaceModeCombo|sameAxisMoveCombo|innerGapSpinBox|outerGapSpinBox/);
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
            "sameAxisMoveCombo",
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

    it("keeps the five supported script keys and defaults identical between schema and the unified script KCM", () => {
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
        assert.match(unified, /sameAxisMoveCombo->findData\(QStringLiteral\("cosmic-wrap"\)\)/);
        assert.doesNotMatch(unified, /shortcutProfileCombo/);
        assert.doesNotMatch(unified, /readEntry\(QStringLiteral\("shortcutProfile"\)/);
        assert.doesNotMatch(unified, /writeEntry\(QStringLiteral\("shortcutProfile"\)/);
        assert.doesNotMatch(unified, /engineAuthorityModeCombo/);
        assert.doesNotMatch(unified, /tilingAlgorithm|automaticSplitTarget|dropOutlinePreview/);
        assert.match(unified, /innerGapSpinBox->setValue\((8|kGapDefault)\)/);
        assert.match(unified, /outerGapSpinBox->setValue\((8|kGapDefault)\)/);
        for (const factory of [effectFactory, scriptFactory]) {
            assert.doesNotMatch(factory, /workspaceModeCombo|shortcutProfileCombo|sameAxisMoveCombo|innerGapSpinBox|outerGapSpinBox/);
            assert.doesNotMatch(factory, /Script-plasma-auto-tiler-kwin/);
        }
    });

    it("reads and writes supported script settings only through the script config group", () => {
        assert.equal((unified.match(/Script-plasma-auto-tiler-kwin/g) ?? []).length, 2);
        assert.doesNotMatch(unified, /Effect-plasma-auto-tiler-kwin/);
        assert.match(unified, /const QString workspaceMode = group\.readEntry\(QStringLiteral\("workspaceMode"\), QStringLiteral\("per-output-local"\)\)/);
        assert.match(unified, /select\(m_ui\.workspaceModeCombo, workspaceMode, QStringLiteral\("per-output-local"\)\)/);
        assert.match(unified, /readSameAxisMove\(group\)/);
        assert.match(unified, /select\(m_ui\.sameAxisMoveCombo, sameAxisMove, QStringLiteral\("cosmic-wrap"\)\)/);
        assert.match(unified, /writeEntry\(QStringLiteral\("sameAxisMove"\)/);
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
            ["label_sameAxisMove", "sameAxisMoveCombo"],
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

    it("routes script settings through the native script KCM on the shared unified page", () => {        assert.match(unifiedHeader, /requestScriptReconfigure/);
        assert.match(unifiedHeader, /isScriptRestartRequired/);
        assert.match(unifiedHeader, /isGapReconfigurePending/);
        assert.match(unified, /m_gapReconfigurePending/);
        assert.match(unified, /const bool liveChanged = gapChanged \|\| sameAxisMoveChanged/);
        assert.match(unified, /if \(liveChanged \|\| scriptRetryArmed\)/);
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

    it("lists the full shortcut catalog with staged Keep-Disable and Authentic-Compatible presets", () => {
        // Conflict list widgets on the shared page.
        assert.match(unifiedUi, /name="shortcutConflictList"/);
        assert.match(unifiedUi, /name="shortcutConflictHintLabel"/);
        assert.match(unifiedUi, /name="shortcutAuthenticButton"/);
        assert.match(unifiedUi, /name="shortcutCompatibleButton"/);
        assert.match(unifiedUi, /checked = Keep, unchecked = Disable/);
        // Full catalog in the reconciler: plan core plus workspace digits
        // and shifted symbols, selection-scoped holder math, and the draft
        // bound into the Force preview.
        for (const token of [
            "shortcutProjectCatalog",
            "shortcutCatalogId",
            "shortcutKnownConflictIds",
            "presetCompatibleDisabledIds",
            "enabledRequiredKeys",
            "conflictingKeysFor",
            "remainderAfterClearFor",
            "collectRowDisplays",
            "applySelected",
            "previewForceApplySelected",
            "applyForcedSelected",
            "disabledIds",
            "workspace-select",
            "workspace-move",
        ]) {
            assert.match(reconcilerHeader, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        }
        assert.match(reconciler, /enabledRequiredKeys/);
        assert.match(reconciler, /collectRowDisplays/);
        assert.match(reconcilerHeader, /SHORTCUT_META_SHIFT_1 = 301989937/);
        assert.match(reconcilerHeader, /SHORTCUT_META_EXCLAM = 268435489/);
        // Staged draft and presets in the module; only explicit confirmed
        // Apply and Force write, and the draft cancels pending previews.
        for (const token of [
            "m_shortcutDisabledDraft",
            "shortcutDisabledIds",
            "requestShortcutPresetAuthentic",
            "requestShortcutPresetCompatible",
            "onShortcutDraftChanged",
            "refreshShortcutConflictList",
            "buildConflictRowText",
        ]) {
            assert.match(unified, new RegExp(token));
            assert.match(unifiedHeader, new RegExp(token));
        }
        assert.match(unified, /checkKeyedForeignOccupancyDetailedFor/);
        assert.match(unified, /collectRowDisplays/);
        assert.match(unifiedUi, /Authentic \(keep all\)/);
        assert.match(unifiedUi, /Compatible \(disable conflicting\)/);
        // Selection scenarios run in hosted native CI.
        assert.ok(cmake.includes("native-effect-shortcut-selection"));
        assert.ok(cmake.includes("native-effect-kcm-shortcut-selection"));
    });

    it("keeps the native shortcut catalog in parity with the TS shortcut catalogs", () => {
        const plan = planShortcutCatalog("cosmic");
        const workspace = workspaceShortcutCatalog();
        const tsByAction = new Map<string, string>();
        for (const row of plan) {
            tsByAction.set(row.action, row.sequence);
        }
        for (const row of workspace) {
            tsByAction.set(row.action, row.sequence);
        }
        // Item 2 adds 36 workspace rows (8 relative follow, 20 absolute
        // stay with symbol aliases, 8 relative stay) to the 76 legacy rows
        // (37 plan rows including toggle-orientation plus 39 item-1).
        assert.equal(tsByAction.size, 112);
        const nativeByAction = new Map<string, string>();
        const nativeOrder: string[] = [];
        const entryPattern =
            /QStringLiteral\("(plasma-auto-tiler-[^"]+)"\),\s*(?:SHORTCUT_[A-Z0-9_]+|0),\s*QStringLiteral\("([^"]*)"\)/g;
        for (const match of reconciler.matchAll(entryPattern)) {
            const action = match[1];
            const display = match[2];
            if (action === undefined || display === undefined) {
                assert.fail("native catalog entry must declare action and display");
            }
            if (!nativeByAction.has(action)) {
                nativeByAction.set(action, display);
                nativeOrder.push(action);
            }
        }
        // Item 2 parity: all 112 bindings now, including the 28 unbound
        // stay rows with empty default sequences.
        assert.equal(nativeByAction.size, 112);
        for (const [action, sequence] of nativeByAction) {
            assert.equal(tsByAction.get(action), sequence);
        }
        const tsOrder = [...plan.map((row) => row.action), ...workspace.map((row) => row.action)];
        assert.deepEqual(new Set(nativeOrder), new Set(tsOrder));
        assert.equal(nativeOrder.length, tsOrder.length);
        // Item 2 order: the 36 new rows follow the 76 legacy rows in exact
        // TS catalog order.
        assert.deepEqual(nativeOrder.slice(76), workspace.slice(-36).map((row) => row.action));
        for (const row of workspace) {
            if (row.sequence === "") {
                assert.equal(nativeByAction.get(row.action), "");
            }
        }
        // Spot-check the 8 bound follow chords and the unbound stay defaults.
        assert.equal(nativeByAction.get("plasma-auto-tiler-toggle-orientation"), "Meta+O");
        for (const [action, sequence] of [
            ["plasma-auto-tiler-send-prev-h", "Meta+Ctrl+Shift+H"],
            ["plasma-auto-tiler-send-prev-k", "Meta+Ctrl+Shift+K"],
            ["plasma-auto-tiler-send-prev-left-arrow", "Meta+Ctrl+Shift+Left"],
            ["plasma-auto-tiler-send-prev-up-arrow", "Meta+Ctrl+Shift+Up"],
            ["plasma-auto-tiler-send-next-j", "Meta+Ctrl+Shift+J"],
            ["plasma-auto-tiler-send-next-l", "Meta+Ctrl+Shift+L"],
            ["plasma-auto-tiler-send-next-down-arrow", "Meta+Ctrl+Shift+Down"],
            ["plasma-auto-tiler-send-next-right-arrow", "Meta+Ctrl+Shift+Right"],
        ] as const) {
            assert.equal(nativeByAction.get(action), sequence);
        }
        // New stock conflicts for the send-arrow follow rows.
        for (const token of [
            "Window One Desktop to the Left",
            "Window One Desktop Up",
            "Window One Desktop Down",
            "Window One Desktop to the Right",
            "SHORTCUT_META_CTRL_SHIFT_LEFT = 385875986",
            "SHORTCUT_META_CTRL_SHIFT_UP = 385875987",
            "SHORTCUT_META_CTRL_SHIFT_DOWN = 385875989",
            "SHORTCUT_META_CTRL_SHIFT_RIGHT = 385875988",
        ]) {
            assert.match(reconcilerHeader, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        }
        // UI rows use readable chords and distinguish own from foreign holders.
        assert.match(unified, /keysDisplayNames/);
        assert.match(unified, /own \[/);
        assert.match(unified, /foreign \[/);
        assert.match(reconcilerHeader, /keysDisplayNames/);
        assert.match(reconcilerHeader, /foreignDefaultIdsForKey/);
        assert.match(reconcilerHeader, /disabledIdsValid/);
        assert.match(reconcilerHeader, /livePresent/);
    });
});
