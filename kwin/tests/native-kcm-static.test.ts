import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

const schema = read("contents/config/main.xml");
const scriptMetadata = JSON.parse(read("metadata.json")) as Record<string, unknown>;
const nativeMetadata = JSON.parse(read("native-effect/metadata.json")) as {
    KPlugin: { Id: string; EnabledByDefault: boolean };
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
    tilingAlgorithm: { type: "Enum", defaultValue: "dwindle" },
    automaticSplitTarget: { type: "Enum", defaultValue: "dwindle" },
    workspaceMode: { type: "Enum", defaultValue: "per-output-local" },
    shortcutProfile: { type: "Enum", defaultValue: "cosmic" },
    dropOutlinePreview: { type: "Bool", defaultValue: "false" },
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
    });

    it("keeps the five script keys and defaults identical between schema and native KCM", () => {
        assert.deepEqual(schemaEntries(), SCRIPT_SETTINGS);
        assert.match(kcfg, /<group name="Effect-plasma-auto-tiler-active-border">/);

        for (const [key, setting] of Object.entries(SCRIPT_SETTINGS)) {
            const defaultExpression =
                setting.defaultValue === "false"
                    ? "false"
                    : `QStringLiteral("${setting.defaultValue}")`;
            assert.match(
                module,
                new RegExp(
                    `readEntry\\(QStringLiteral\\("${key}"\\), ${defaultExpression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
                ),
            );
            assert.match(module, new RegExp(`writeEntry\\(QStringLiteral\\("${key}"\\)`));
        }

        assert.match(module, /tilingAlgorithmCombo->findData\(QStringLiteral\("dwindle"\)\)/);
        assert.match(module, /automaticSplitTargetCombo->findData\(QStringLiteral\("dwindle"\)\)/);
        assert.match(module, /workspaceModeCombo->findData\(QStringLiteral\("per-output-local"\)\)/);
        assert.match(module, /shortcutProfileCombo->findData\(QStringLiteral\("cosmic"\)\)/);
        assert.match(module, /dropOutlinePreviewCheckBox->setChecked\(false\)/);
    });

    it("reads and writes script settings only through the script config group and falls back invalid tiling to dwindle", () => {
        assert.equal((module.match(/Script-plasma-auto-tiler-kwin/g) ?? []).length, 2);
        assert.doesNotMatch(module, /Effect-plasma-auto-tiler-kwin/);
        assert.match(
            module,
            /const QString tilingAlgorithm = group\.readEntry\(QStringLiteral\("tilingAlgorithm"\), QStringLiteral\("dwindle"\)\)/,
        );
        assert.match(module, /select\(m_ui\.tilingAlgorithmCombo, tilingAlgorithm, QStringLiteral\("dwindle"\)\)/);
        assert.match(module, /const QString tilingAlgorithm = group\.readEntry\(QStringLiteral\("tilingAlgorithm"\), QStringLiteral\("dwindle"\)\)/);
        assert.match(module, /\{QStringLiteral\("tilingAlgorithm"\), tilingAlgorithm\}/);
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
        assert.match(effect, /activeBorderColor\(themeColor, fallback\)/);
        assert.match(effect, /KColorScheme::isColorSetSupported\(colorConfig, KColorScheme::Selection\)/);
        assert.match(logic, /themeColor\.isValid\(\) && themeColor\.alpha\(\) > 0/);
        assert.match(logic, /QRectF activeBorderInnerRect\(/);
        assert.match(effect, /setInnerRect\(activeBorderInnerRect\(state\.innerRect, gap\)\)/);
        assert.match(effect, /setVisible\(state\.visible\)/);
        assert.match(effect, /addRepaintFull\(\)/);
    });

    it("tracks manually managed script controls without rewriting untouched keys", () => {
        assert.match(module, /unmanagedWidgetChangeState\(/);
        assert.match(module, /unmanagedWidgetDefaultState\(/);
        assert.match(module, /const bool borderChanged = managedWidgetChangeState\(\)/);
        assert.match(module, /const QString dropOutlinePreviewRaw = group\.readEntry\(QStringLiteral\("dropOutlinePreview"\), QString\(\)\)/);
        assert.match(module, /m_loadedDropOutlinePreviewRawValid = !group\.hasKey\(QStringLiteral\("dropOutlinePreview"\)\)/);
        assert.doesNotMatch(module, /setNeedsSave\(false\)/);
        assert.match(module, /if \(!m_loadedDropOutlinePreviewRawValid \|\| current != m_loadedScriptValues\)/);
        assert.match(module, /if \(!m_loadedDropOutlinePreviewRawValid \|\| current\.value\(QStringLiteral\("dropOutlinePreview"\)\) != m_loadedScriptValues/);
        assert.match(module, /m_loadedScriptValues = \{/);
    });

    it("associates every labeled native control with its buddy", () => {
        for (const [label, control] of [
            ["label_tilingAlgorithm", "tilingAlgorithmCombo"],
            ["label_automaticSplitTarget", "automaticSplitTargetCombo"],
            ["label_workspaceMode", "workspaceModeCombo"],
            ["label_shortcutProfile", "shortcutProfileCombo"],
            ["label_BorderColor", "kcfg_BorderColor"],
            ["label_BorderWidth", "kcfg_BorderWidth"],
            ["label_BorderRadius", "kcfg_BorderRadius"],
            ["label_BorderGap", "kcfg_BorderGap"],
        ]) {
            assert.match(ui, new RegExp(`name="${label}"[\\s\\S]*?<property name="buddy">[\\s\\S]*?<cstring>${control}</cstring>`));
        }
    });

    it("explains script reload or session restart and retires the generic metadata KCM only after native discovery exists", () => {
        assert.equal(scriptMetadata["X-KDE-ConfigModule"], undefined);
        assert.doesNotMatch(read("metadata.json"), /kcm_kwin4_genericscripted/);
        assert.ok(nativeMetadata["X-KDE-ConfigModule"]);
        assert.match(ui, /Script settings do not hot-apply; reload the script or restart the session\./);
    });
});
