import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

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

interface FakeSignal {
    readonly handlers: Array<() => void>;
    readonly signal: { connect: (handler: () => void) => void; disconnect: (handler: () => void) => void };
}

function fakeSignal(): FakeSignal {
    const handlers: Array<() => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: () => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: () => void): void => {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
        },
    };
}

function fakeWorkspace(): Record<string, unknown> {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const makeWin = (id: string, x: number): Record<string, unknown> => {
        const geo = fakeSignal();
        const full = fakeSignal();
        const max = fakeSignal();
        const desktopsChanged = fakeSignal();
        const win: Record<string, unknown> = {
            normalWindow: true,
            internalId: id,
            resourceClass: "test-app",
            output,
            desktops: [desktop],
            frameGeometry: { x, y: 0, width: 600, height: 800 },
            frameGeometryChanged: geo.signal,
            fullScreenChanged: full.signal,
            fullScreen: false,
            maximizedChanged: max.signal,
            maximizeMode: 0,
            desktopsChanged: desktopsChanged.signal,
            onAllDesktops: false,
        };
        win["setMaximize"] = (): void => {};
        return win;
    };
    const winA = makeWin("win-a", 0);
    const winB = makeWin("win-b", 600);
    return {
        activeWindow: winA,
        windowList: (): unknown[] => [winA, winB],
        screens: [output],
        desktops: [desktop],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowAdded: added.signal,
        windowRemoved: removed.signal,
        windowActivated: activated.signal,
        screensChanged: screensChanged.signal,
        currentDesktopChanged: desktopChanged.signal,
    };
}

interface ReloadMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string }>;
}

function domainOf(payload: string): { gap: unknown; outer_gap: unknown } {
    const parsed = JSON.parse(payload) as { domain?: { gap?: unknown; outer_gap?: unknown } };
    return { gap: parsed.domain?.gap, outer_gap: parsed.domain?.outer_gap };
}

describe("interim tiler reload contract", () => {
    it("keeps the production entry bound to the plan adapter", () => {
        assert.match(productionEntry, /startPlanAdapterEntry/);
        assert.match(productionEntry, /owner: "kwin-plan-adapter"/);
    });

    it("wires deliberate reload through Options configChanged with gap re-read and resync", () => {
        assert.match(entry, /Deliberate tiler reload gap configuration/);
        assert.match(entry, /options.*configChanged|configChanged.*options/);
        assert.match(entry, /readDomainGaps\(\{/);
        assert.match(entry, /requestResync\(\)/);
        assert.match(entry, /plasma-auto-tiler:plan:config-reloaded/);
        assert.match(entry, /readShortcutProfile\(overrides\.readProfileFn\)/);
        assert.match(entry, /readWorkspaceModeValue\(overrides\.readWorkspaceModeFn\)/);
        // No script/plugin lifecycle or shortcut re-registration on the reload path.
        assert.doesNotMatch(entry, /loadScript/);
        assert.doesNotMatch(entry, /unloadScript/);
        assert.doesNotMatch(entry, /registerShortcutFn\(action/);
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
        const reconfigureBody = functionBody(module, "bool ActiveBorderConfigModule::requestScriptReconfigure()");
        assert.match(reconfigureBody, /\.send\(/);
        assert.doesNotMatch(reconfigureBody, /\.call\(/);
    });

    it("refuses a no-pending reload without sending and gates the button on reload-required", () => {
        const reloadBody = functionBody(module, "void ActiveBorderConfigModule::requestTilerReload()");
        assert.match(reloadBody, /!m_tilerReloadRequired/);
        assert.match(module, /setEnabled\(m_tilerReloadRequired\)/);
        const saveBody = functionBody(module, "void ActiveBorderConfigModule::save()");
        assert.doesNotMatch(saveBody, /requestScriptReconfigure\(\)/);
    });

    it("marks gap reload-required and non-gap restart-required without auto-send", () => {
        assert.match(module, /m_tilerReloadRequired = true/);
        assert.match(module, /m_tilerRestartRequired = true/);
        assert.match(module, /gapChanged/);
        assert.match(module, /startupSettingChanged/);
        assert.match(module, /Reload applies gaps only/);
        assert.match(module, /Session restart required/);
        assert.match(module, /startup gap values/);
        assert.match(module, /requestEffectReconfigure\(\)/);
        assert.match(module, /reconfigureEffect/);
        const saveBody = functionBody(module, "void ActiveBorderConfigModule::save()");
        assert.match(saveBody, /m_tilerReloadRequired = true/);
        assert.match(saveBody, /m_tilerRestartRequired = true/);
        assert.doesNotMatch(saveBody, /requestScriptReconfigure\(\)/);
        assert.match(gaps, /re-resolve/);
    });

    it("reports sent-but-unconfirmed and failed states without an applied claim and keeps restart residual", () => {
        assert.match(module, /Reload request sent\. Application unconfirmed/);
        assert.match(module, /Gap application unconfirmed/);
        assert.match(module, /Reload request failed\. Running tiler still uses startup values/);
        assert.match(module, /restart the session to guarantee pickup/);
        assert.match(module, /session restart remains required for other settings/i);
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

    it("exposes gap reload UI with restart residual without touching the live border explanation", () => {
        assert.match(ui, /name="tilerReloadStatusLabel"/);
        assert.match(ui, /name="tilerReloadButton"/);
        assert.match(ui, /Reload Tiler/);
        assert.match(ui, /No pending tiler reload in this dialog\./);
        assert.match(ui, /Session restart is the guaranteed pickup mechanism\./);
        assert.match(ui, /never claims the running tiler applied the settings/);
        assert.match(ui, /This never changes shortcuts\./);
        assert.match(ui, /Gap settings are saved to kwinrc\./);
        assert.match(ui, /Saving gaps marks a reload as required/);
        assert.match(ui, /other script settings require a session restart/i);
        assert.match(ui, /Border changes apply immediately through the KWin effect reconfigure\./);
        assert.match(ui, /Gap settings can reload/);
    });
});

describe("deliberate tiler reload behavior", () => {
    it("applies an altered gap setting to the reconfigured controller on configChanged", () => {
        let innerGap = 8;
        let outerGap = 8;
        const optionsChanged = fakeSignal();
        const mocks: ReloadMocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [] };
        const handle = startPlanAdapterEntry({
            workspace: fakeWorkspace(),
            options: { configChanged: optionsChanged.signal },
            callDbus: (_service, _path, _iface, method, payload, callback): void => {
                if (method === "NameHasOwner") {
                    callback(true);
                    return;
                }
                if (method === "GetNameOwner") {
                    callback(":1.7");
                    return;
                }
                if (method === "StartServiceByName") {
                    callback(1);
                    return;
                }
                mocks.dbusCalls.push({ method, payload });
                mocks.callbacks.push(callback);
            },
            scheduleOnce: (_delayMs, callback): (() => void) => {
                const timer = { callback, cancelled: false };
                mocks.timers.push(timer);
                return (): void => {
                    timer.cancelled = true;
                };
            },
            log: (message): void => {
                mocks.logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence): boolean => {
                mocks.shortcuts.push({ action, sequence });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): string => "per-output-local",
            readInnerGapFn: (): number => innerGap,
            readOuterGapFn: (): number => outerGap,
        });
        assert.ok(handle !== null);
        const shortcutCount = mocks.shortcuts.length;
        assert.ok(shortcutCount > 0);

        handle?.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.dbusCalls[0]?.method, "DescribePlan");
        assert.deepEqual(domainOf(mocks.dbusCalls[0]?.payload as string), { gap: 8, outer_gap: 8 });
        const firstCorrelation = (JSON.parse(mocks.dbusCalls[0]?.payload as string) as { correlation_id: string })
            .correlation_id;
        mocks.callbacks[0]?.(
            JSON.stringify({ v: 1, correlation_id: firstCorrelation, outcome: "planned", desired_geometry: [] }),
        );

        const timersBeforeReload = mocks.timers.length;
        innerGap = 12;
        outerGap = 14;
        for (const fire of [...optionsChanged.handlers]) {
            fire();
        }
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:config-reloaded innerGap=12 outerGap=14"),
        );
        // requestResync is debounce-coalesced with the startup resync while its
        // timer is still pending in this harness, so timer growth is not
        // asserted here; the payload below is the behavioral proof.
        void timersBeforeReload;
        assert.equal(mocks.shortcuts.length, shortcutCount);

        handle?.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual(domainOf(mocks.dbusCalls[1]?.payload as string), { gap: 12, outer_gap: 14 });
        assert.equal(mocks.shortcuts.length, shortcutCount);
        handle?.stop();
    });

    it("ignores an unchanged configChanged without resync or shortcut work", () => {
        let innerGap = 8;
        let outerGap = 8;
        const optionsChanged = fakeSignal();
        const mocks: ReloadMocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [] };
        const handle = startPlanAdapterEntry({
            workspace: fakeWorkspace(),
            options: { configChanged: optionsChanged.signal },
            callDbus: (_service, _path, _iface, method, payload, callback): void => {
                if (method === "NameHasOwner") {
                    callback(true);
                    return;
                }
                if (method === "GetNameOwner") {
                    callback(":1.7");
                    return;
                }
                if (method === "StartServiceByName") {
                    callback(1);
                    return;
                }
                mocks.dbusCalls.push({ method, payload });
                mocks.callbacks.push(callback);
            },
            scheduleOnce: (_delayMs, callback): (() => void) => {
                const timer = { callback, cancelled: false };
                mocks.timers.push(timer);
                return (): void => {
                    timer.cancelled = true;
                };
            },
            log: (message): void => {
                mocks.logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence): boolean => {
                mocks.shortcuts.push({ action, sequence });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): string => "per-output-local",
            readInnerGapFn: (): number => innerGap,
            readOuterGapFn: (): number => outerGap,
        });
        assert.ok(handle !== null);
        const timersAtStart = mocks.timers.length;
        const shortcutCount = mocks.shortcuts.length;
        for (const fire of [...optionsChanged.handlers]) {
            fire();
        }
        assert.ok(!mocks.logs.some((line) => line.includes("plasma-auto-tiler:plan:config-reloaded")));
        assert.equal(mocks.timers.length, timersAtStart);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.shortcuts.length, shortcutCount);
        void innerGap;
        void outerGap;
        handle?.stop();
    });

    it("starts without an options signal surface and keeps ordinary reads stable", () => {
        const mocks: ReloadMocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [] };
        const handle = startPlanAdapterEntry({
            workspace: fakeWorkspace(),
            options: {},
            callDbus: (_service, _path, _iface, method, payload, callback): void => {
                if (method === "NameHasOwner") {
                    callback(true);
                    return;
                }
                if (method === "GetNameOwner") {
                    callback(":1.7");
                    return;
                }
                if (method === "StartServiceByName") {
                    callback(1);
                    return;
                }
                mocks.dbusCalls.push({ method, payload });
                mocks.callbacks.push(callback);
            },
            scheduleOnce: (_delayMs, callback): (() => void) => {
                const timer = { callback, cancelled: false };
                mocks.timers.push(timer);
                return (): void => {
                    timer.cancelled = true;
                };
            },
            log: (message): void => {
                mocks.logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence): boolean => {
                mocks.shortcuts.push({ action, sequence });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): string => "per-output-local",
            readInnerGapFn: (): number => 8,
            readOuterGapFn: (): number => 8,
        });
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(domainOf(mocks.dbusCalls[0]?.payload as string), { gap: 8, outer_gap: 8 });
        handle?.stop();
    });
});
