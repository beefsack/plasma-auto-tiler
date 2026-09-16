import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

const module = read("native-effect/activeborderconfig_module.cpp");
const header = read("native-effect/activeborderconfig_module.h");
const ui = read("native-effect/activeborderconfig.ui");
const entry = read("src/plan-adapter-entry.ts");
const gaps = read("src/domain-gap.ts");
const productionEntry = read("src/entry.ts");

function functionBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} must exist`);
    const open = source.indexOf("{", start);
    assert.notEqual(open, -1, `${signature} must open a body`);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === "{") {
            depth += 1;
        } else if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(open, index + 1);
            }
        }
    }
    assert.fail(`${signature} must close its body`);
}

describe("interim tiler reload contract", () => {
    it("keeps the production entry bound to the plan adapter", () => {
        assert.match(productionEntry, /startPlanAdapterEntry/);
        assert.match(productionEntry, /owner: "kwin-plan-adapter"/);
    });

    it("keeps controller configuration startup-bound with no live pickup", () => {
        assert.match(entry, /Startup-bound validated gap configuration: resolved once/);
        assert.match(entry, /No reload, reseed, or in-flight mutation/);
        assert.match(gaps, /No config-change handling, hot reload,/);
        assert.match(gaps, /entries resolve once at startup/);
        assert.match(entry, /readDomainGaps\(\{/);
        assert.match(entry, /readShortcutProfile\(overrides\.readProfileFn\)/);
        assert.match(entry, /readWorkspaceModeValue\(overrides\.readWorkspaceModeFn\)/);
        assert.doesNotMatch(entry, /configChanged/);
        assert.doesNotMatch(entry, /configurationChanged/);
        assert.doesNotMatch(entry, /reloadConfig/);
        assert.doesNotMatch(entry, /rereadConfig/);
    });

    it("types the deliberate reload as one KWin reconfigure send without claiming application", () => {
        assert.match(module, /QStringLiteral\("org\.kde\.KWin"\)/);
        assert.match(module, /QStringLiteral\("\/KWin"\)/);
        assert.match(module, /QStringLiteral\("org\.kde\.KWin"\)/);
        assert.match(module, /QStringLiteral\("reconfigure"\)/);
        assert.match(module, /Q_NOREPLY/);
        assert.match(module, /never proves the/);
        assert.match(module, /never claims the running tiler applied/);
        assert.match(header, /requestTilerReload/);
        assert.match(header, /isTilerReloadRequired/);
        assert.match(header, /tilerReloadStatusText/);
        assert.doesNotMatch(module, /m_scriptReconfigurePending/);
    });

    it("marks reload-required only on saved tiling changes and keeps border hot-apply live", () => {
        assert.match(module, /m_tilerReloadRequired = true/);
        assert.match(module, /Reload required: the running tiler still uses startup values/);
        assert.match(module, /requestEffectReconfigure\(\)/);
        assert.match(module, /reconfigureEffect/);
        const saveBody = functionBody(module, "void ActiveBorderConfigModule::save()");
        assert.match(saveBody, /m_tilerReloadRequired = true/);
        assert.match(saveBody, /Reload required: the running tiler still uses startup values/);
        assert.doesNotMatch(saveBody, /requestScriptReconfigure\(\)/);
    });

    it("reports sent-but-unconfirmed and failed states without an applied claim", () => {
        assert.match(module, /Reload request sent\. Application unconfirmed/);
        assert.match(module, /Reload request failed\. Running tiler still uses startup values/);
        assert.match(module, /restart the session to guarantee pickup/);
        const reloadBody = functionBody(module, "void ActiveBorderConfigModule::requestTilerReload()");
        const reloadStrings = reloadBody
            .split("\n")
            .filter((line) => line.includes("QStringLiteral"));
        assert.ok(reloadStrings.length >= 2);
        for (const line of reloadStrings) {
            assert.doesNotMatch(line, /applied/i);
        }
        const statusLines = module
            .split("\n")
            .filter((line) => line.includes("m_tilerReloadStatus ="));
        assert.ok(statusLines.length >= 3);
        for (const line of statusLines) {
            assert.doesNotMatch(line, /applied/i);
        }
    });

    it("keeps shortcut mutation out of ordinary save and deliberate reload", () => {
        const saveBody = functionBody(module, "void ActiveBorderConfigModule::save()");
        const reloadBody = functionBody(module, "void ActiveBorderConfigModule::requestTilerReload()");
        for (const forbidden of [
            /ShortcutReconciler/,
            /KGlobalAccel/,
            /setShortcutKeys/,
            /globalShortcut/i,
        ]) {
            assert.doesNotMatch(saveBody, forbidden);
            assert.doesNotMatch(reloadBody, forbidden);
        }
        assert.match(module, /confirmShortcutAction/);
        assert.match(module, /runShortcutApply/);
        assert.match(module, /runShortcutRevert/);
    });

    it("exposes reload-required UI without touching the live border explanation", () => {
        assert.match(ui, /name="tilerReloadStatusLabel"/);
        assert.match(ui, /name="tilerReloadButton"/);
        assert.match(ui, /Reload Tiler/);
        assert.match(ui, /No pending tiler reload in this dialog\./);
        assert.match(ui, /never claims the running tiler applied the settings/);
        assert.match(ui, /This never changes shortcuts\./);
        assert.match(ui, /Other script settings require a script reload or session restart\./);
        assert.match(ui, /Border changes apply immediately through the KWin effect reconfigure\./);
    });
});
