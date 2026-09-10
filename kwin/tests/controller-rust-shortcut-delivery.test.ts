import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Harness } from "./controller-fixtures";
import { countEvent } from "./controller-fixture-scenarios";
import { PROFILE_CATALOGS, REGISTERED_PROFILE_ACTION_IDS, type ProfileKey } from "../src/controller-config";
import { COMMAND_SHORTCUT_ACTION_IDS, TileController } from "../src/controller";

// Catalog truth for the command set: every selected profile's existing
// focus/move/keyboard-resize rows that are also registered profile actions.
// No key choice is defined here; sequences come from the catalog.
function expectedCommandRows(profileKey: ProfileKey): ReadonlyArray<{ name: string; sequence: string }> {
    const profile = PROFILE_CATALOGS[profileKey];
    return profile.rows
        .filter(
            (row) =>
                row.classification !== "deferred" &&
                row.classification !== "component-requirement" &&
                COMMAND_SHORTCUT_ACTION_IDS.has(row.actionId) &&
                REGISTERED_PROFILE_ACTION_IDS.has(row.actionId),
        )
        .map((row) => ({ name: row.shortcutId, sequence: row.sequence }));
}

function assertCatalogRegistration(harness: Harness, profileKey: ProfileKey): void {
    const expected = expectedCommandRows(profileKey);
    assert.ok(expected.length > 0, `${profileKey}: expected non-empty command set`);
    const names = harness.shortcuts.map((entry) => entry.name);
    assert.equal(new Set(names).size, names.length, `${profileKey}: duplicate registration`);
    assert.equal(names.length, expected.length, `${profileKey}: registration count`);
    const sequences = new Map(harness.shortcuts.map((entry) => [entry.name, entry.sequence] as const));
    for (const row of expected) {
        assert.equal(sequences.get(row.name), row.sequence, row.name);
    }
    for (const row of PROFILE_CATALOGS[profileKey].rows) {
        if (row.classification === "deferred" || row.classification === "component-requirement") {
            assert.equal(names.includes(row.shortcutId), false, row.shortcutId);
        }
    }
    assert.equal(names.includes("plasma-auto-tiler-float-toggle"), false);
    assert.equal(names.includes("plasma-auto-tiler-workspace-0"), false);
    assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), false);
}

function shortcutMap(harness: Harness): Map<string, string> {
    return new Map(harness.shortcuts.map((entry) => [entry.name, entry.sequence] as const));
}

function handlerFor(harness: Harness, name: string): () => void {
    const found = harness.shortcuts.find((entry) => entry.name === name);
    assert.ok(found !== undefined, `missing shortcut handler: ${name}`);
    return found.handler;
}

function fakeDispatcher(routed: Array<readonly unknown[]>): {
    requestMove: (direction: unknown) => void;
    focusOrResize: (direction: unknown) => void;
    requestResize: (direction: unknown, mode: unknown) => void;
    enterOrExitRustResizeMode: (mode: unknown) => void;
    isRustActive: () => boolean;
} {
    return {
        requestMove: (direction: unknown): void => {
            routed.push(["move", direction]);
        },
        focusOrResize: (direction: unknown): void => {
            routed.push(["focusOrResize", direction]);
        },
        requestResize: (direction: unknown, mode: unknown): void => {
            routed.push(["resize", direction, mode]);
        },
        enterOrExitRustResizeMode: (mode: unknown): void => {
            routed.push(["resizeMode", mode]);
        },
        isRustActive: (): boolean => true,
    };
}

describe("rust shortcut delivery registration", () => {
    it("defaults to legacy with command shortcuts registered once", () => {
        const harness = new Harness();
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "legacy");
        assert.equal(controller.isRustAuthorityActive(), false);
        assertCatalogRegistration(harness, "cosmic");
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
    });

    it("registers every existing focus/move/resize shortcut exactly once in rust mode", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "rust-development");
        assertCatalogRegistration(harness, "cosmic");
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
    });

    it("registers each selected profile's existing command rows from catalog truth", () => {
        for (const profileKey of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            if (profileKey !== "cosmic") {
                harness.configValues.set("shortcutProfile", profileKey);
            }
            new TileController(harness.environment()).start();
            assertCatalogRegistration(harness, profileKey);
        }
        // Profile-specific resize availability is catalog truth: cosmic has
        // resize-mode rows and no expand/contract rows; bspwm has
        // expand/contract rows and no resize-mode rows.
        const cosmicNames = expectedCommandRows("cosmic").map((row) => row.name);
        assert.ok(cosmicNames.includes("plasma-auto-tiler-resize-mode-outwards"));
        assert.equal(
            cosmicNames.includes("plasma-auto-tiler-resize-expand-left"),
            false,
        );
        const bspwmNames = expectedCommandRows("bspwm").map((row) => row.name);
        assert.ok(bspwmNames.includes("plasma-auto-tiler-resize-expand-left"));
        assert.ok(bspwmNames.includes("plasma-auto-tiler-resize-contract-right"));
        assert.equal(
            bspwmNames.includes("plasma-auto-tiler-resize-mode-outwards"),
            false,
        );
    });

    it("routes physical callbacks through the mode-gated command dispatcher", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        const routed: Array<readonly unknown[]> = [];
        const fake = fakeDispatcher(routed);
        (controller as unknown as { engineAuthority: unknown }).engineAuthority = fake;
        const readsBefore = harness.rootReads;
        const writesBefore = harness.activeWrites.length;
        handlerFor(harness, "plasma-auto-tiler-focus-right")();
        handlerFor(harness, "plasma-auto-tiler-move-left")();
        handlerFor(harness, "plasma-auto-tiler-move-left-arrow")();
        handlerFor(harness, "plasma-auto-tiler-resize-mode-outwards")();
        const bspwm = new Harness();
        bspwm.configValues.set("shortcutProfile", "bspwm");
        bspwm.configValues.set("engineAuthorityMode", "rust-development");
        const bspwmController = new TileController(bspwm.environment());
        bspwmController.start();
        (bspwmController as unknown as { engineAuthority: unknown }).engineAuthority = fake;
        handlerFor(bspwm, "plasma-auto-tiler-resize-expand-left")();
        handlerFor(bspwm, "plasma-auto-tiler-resize-contract-up")();
        assert.deepEqual(routed, [
            ["focusOrResize", "right"],
            ["move", "left"],
            ["move", "left"],
            ["resizeMode", "outwards"],
            ["resize", "left", "outwards"],
            ["resize", "up", "inwards"],
        ]);
        assert.equal(harness.rootReads, readsBefore);
        assert.equal(harness.activeWrites.length, writesBefore);
    });

    it("has no legacy topology or pointer attach in rust mode", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "rust-development");
        assert.equal(harness.added, undefined);
        assert.equal(harness.removed, undefined);
        assert.equal(harness.screensChanged, undefined);
        assert.equal(harness.desktopChanged, undefined);
        assert.equal(harness.desktopsChanged, undefined);
        assert.equal(harness.addedConnects, 0);
        assert.equal(harness.removedConnects, 0);
        assert.equal(harness.screensConnects, 0);
        assert.equal(harness.desktopConnects, 0);
        assert.equal(harness.desktopsConnects, 0);
        assert.equal(harness.interactiveWatches.length, 0);
        assert.equal(harness.rootReads, 0);
        assert.ok(harness.logs.every((line) => !line.includes("drag-attach-summary")));
        assert.ok(
            harness.logs.every((line) => line !== "plasma-auto-tiler:startup-handlers-ready"),
            "rust mode must not emit the legacy readiness marker",
        );
        assert.ok(
            harness.logs.some((line) => line === "plasma-auto-tiler:startup-handlers-ready:rust-development"),
            "rust mode must emit the distinct rust readiness marker",
        );
        assert.ok(harness.shortcuts.length > 0);
    });

    it("keeps repeated reconfigure idempotent with single registration and single legacy attach", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        const first = harness.shortcuts.map((entry) => entry.name);
        const registeredBefore = countEvent(harness.logs, "shortcut-registered");
        controller.start();
        controller.start();
        const names = harness.shortcuts.map((entry) => entry.name);
        assert.deepEqual(names, first);
        assert.equal(new Set(names).size, names.length);
        assert.equal(countEvent(harness.logs, "shortcut-registered"), registeredBefore);
        assert.equal(controller.engineAuthorityModeSnapshot(), "rust-development");

        const legacy = new Harness();
        const legacyController = new TileController(legacy.environment());
        legacyController.start();
        const legacyFirst = legacy.shortcuts.map((entry) => entry.name);
        legacyController.start();
        legacyController.start();
        assert.deepEqual(
            legacy.shortcuts.map((entry) => entry.name),
            legacyFirst,
        );
        assert.equal(legacy.addedConnects, 1);
        assert.equal(legacy.removedConnects, 1);
        assert.equal(legacy.screensConnects, 1);
        assert.equal(legacy.desktopConnects, 1);
        assert.equal(legacy.desktopsConnects, 1);
        assert.equal(legacy.addedDisconnects, 0);
        // Pointer attachExisting skips already-watched windows, so the watch
        // count stays stable across repeated legacy start().
        const watchesAfterFirst = legacy.interactiveWatches.length;
        legacyController.start();
        assert.equal(legacy.interactiveWatches.length, watchesAfterFirst);
    });

    it("swaps only authority on legacy/rust apply switching with exact attach/disconnect", () => {
        const harness = new Harness();
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "legacy");
        const legacyNames = harness.shortcuts.map((entry) => entry.name);
        assert.ok(legacyNames.length > 0);
        assert.equal(harness.addedConnects, 1);
        const legacyWatches = harness.interactiveWatches.length;
        harness.configValues.set("engineAuthorityMode", "rust-development");
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "rust-development");
        const rustNames = harness.shortcuts.map((entry) => entry.name);
        assert.deepEqual(rustNames, legacyNames);
        // Rust entry detaches the legacy workspace signals and every pointer
        // watch so no legacy topology/pointer authority remains active.
        assert.equal(harness.added, undefined);
        assert.equal(harness.removed, undefined);
        assert.equal(harness.screensChanged, undefined);
        assert.equal(harness.desktopChanged, undefined);
        assert.equal(harness.desktopsChanged, undefined);
        assert.equal(harness.addedDisconnects, 1);
        assert.equal(harness.removedDisconnects, 1);
        assert.equal(harness.screensDisconnects, 1);
        assert.equal(harness.desktopDisconnects, 1);
        assert.equal(harness.desktopsDisconnects, 1);
        assert.equal(harness.interactiveWatches.length, 0);
        void legacyWatches;
        const routed: Array<readonly unknown[]> = [];
        const fake = fakeDispatcher(routed);
        (controller as unknown as { engineAuthority: unknown }).engineAuthority = fake;
        const readsBefore = harness.rootReads;
        handlerFor(harness, "plasma-auto-tiler-focus-left")();
        assert.deepEqual(routed, [["focusOrResize", "left"]]);
        assert.equal(harness.rootReads, readsBefore);
        harness.configValues.set("engineAuthorityMode", "legacy");
        controller.start();
        assert.equal(controller.engineAuthorityModeSnapshot(), "legacy");
        assert.deepEqual(
            harness.shortcuts.map((entry) => entry.name),
            legacyNames,
        );
        // Rust->Legacy re-attaches exactly one connection per signal.
        assert.equal(harness.addedConnects, 2);
        assert.equal(harness.removedConnects, 2);
        assert.equal(harness.screensConnects, 2);
        assert.equal(harness.desktopConnects, 2);
        assert.equal(harness.desktopsConnects, 2);
        assert.notEqual(harness.added, undefined);
    });

    it("fails closed on rust loss with the accelerator still captured and no legacy fallback", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isRustAuthorityActive(), false);
        const namesBefore = harness.shortcuts.map((entry) => entry.name);
        assert.ok(namesBefore.length > 0);
        const readsBefore = harness.rootReads;
        const writesBefore = harness.activeWrites.length;
        const watchesBefore = harness.interactiveWatches.length;
        handlerFor(harness, "plasma-auto-tiler-focus-right")();
        handlerFor(harness, "plasma-auto-tiler-move-right")();
        handlerFor(harness, "plasma-auto-tiler-resize-mode-outwards")();
        assert.equal(harness.rootReads, readsBefore);
        assert.equal(harness.activeWrites.length, writesBefore);
        assert.equal(harness.interactiveWatches.length, watchesBefore);
        assert.equal(controller.isEnabled, true);
        assert.deepEqual(
            harness.shortcuts.map((entry) => entry.name),
            namesBefore,
        );
        assert.ok(harness.logs.some((line) => line.includes("engine-authority-rust-refused")));
        (controller as unknown as { engineAuthority: unknown }).engineAuthority = null;
        const refusedBefore = harness.logs.filter((line) => line.includes("engine-authority-rust-refused")).length;
        handlerFor(harness, "plasma-auto-tiler-focus-left")();
        handlerFor(harness, "plasma-auto-tiler-move-left")();
        handlerFor(harness, "plasma-auto-tiler-resize-mode-outwards")();
        handlerFor(harness, "plasma-auto-tiler-resize-mode-inwards")();
        assert.equal(harness.rootReads, readsBefore);
        assert.equal(harness.activeWrites.length, writesBefore);
        assert.equal(controller.isEnabled, true);
        const refusedAfter = harness.logs.filter((line) => line.includes("engine-authority-rust-refused")).length;
        assert.ok(refusedAfter > refusedBefore, "missing dispatcher must emit the fixed refusal diagnostic");
    });

    it("emits the fixed refusal diagnostic for a missing dispatcher with capture retained", () => {
        const harness = new Harness();
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const controller = new TileController(harness.environment());
        controller.start();
        (controller as unknown as { engineAuthority: unknown }).engineAuthority = null;
        const namesBefore = harness.shortcuts.map((entry) => entry.name);
        assert.ok(namesBefore.length > 0);
        const readsBefore = harness.rootReads;
        const writesBefore = harness.activeWrites.length;
        controller.focusOrResize("left");
        controller.moveActiveWindow("right");
        controller.resizeActiveWindow("up", "outwards");
        controller.enterOrExitResizeMode("outwards");
        assert.equal(harness.rootReads, readsBefore);
        assert.equal(harness.activeWrites.length, writesBefore);
        assert.equal(harness.interactiveWatches.length, 0);
        assert.equal(controller.isEnabled, true);
        assert.deepEqual(
            harness.shortcuts.map((entry) => entry.name),
            namesBefore,
        );
        const refused = harness.logs.filter((line) => line.includes("engine-authority-rust-refused"));
        assert.equal(refused.length, 4);
    });

    it("preserves default aliases with no binding changes", () => {
        const harness = new Harness();
        new TileController(harness.environment()).start();
        const sequences = shortcutMap(harness);
        assert.equal(sequences.get("plasma-auto-tiler-focus-right"), "Meta+L");
        assert.equal(sequences.get("plasma-auto-tiler-focus-right-arrow"), "Meta+Right");
        assert.equal(sequences.get("plasma-auto-tiler-move-right"), "Meta+Shift+L");
        assert.equal(sequences.get("plasma-auto-tiler-move-right-arrow"), "Meta+Shift+Right");
        assert.equal(sequences.get("plasma-auto-tiler-resize-mode-outwards"), "Meta+R");
        assert.equal(sequences.get("plasma-auto-tiler-resize-mode-inwards"), "Meta+Shift+R");
        const bspwm = new Harness();
        bspwm.configValues.set("shortcutProfile", "bspwm");
        new TileController(bspwm.environment()).start();
        const bspwmSequences = shortcutMap(bspwm);
        assert.equal(bspwmSequences.get("plasma-auto-tiler-resize-expand-left"), "Meta+Alt+H");
        assert.equal(bspwmSequences.get("plasma-auto-tiler-resize-contract-right"), "Meta+Alt+Shift+L");
    });

    it("fails only the unavailable action closed and retries it on a later Apply", () => {
        const harness = new Harness();
        // Fail the second registration only; the rest must still capture.
        const probe = new Harness();
        new TileController(probe.environment()).start();
        const second = probe.shortcuts[1]?.name;
        assert.ok(second !== undefined);
        harness.shortcutResults.push(true, false);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
        assert.ok(harness.logs.some((line) => line.includes(`shortcut-register-failed:${second}`)));
        assert.ok(harness.logs.some((line) => line.includes("shortcut-registered")));
        const names = harness.shortcuts.map((entry) => entry.name);
        assert.equal(names.includes(second), false);
        assert.equal(new Set(names).size, names.length);
        // Retry on a later Apply registers exactly the missing action.
        controller.start();
        const retried = harness.shortcuts.map((entry) => entry.name);
        assert.ok(retried.includes(second as string));
        assert.equal(new Set(retried).size, retried.length);
        assertCatalogRegistration(harness, "cosmic");
        assert.equal(controller.isEnabled, true);
    });

    it("retries a throwing registration on a later Apply without disabling", () => {
        const harness = new Harness();
        harness.shortcutResults.push(new Error("register-threw"));
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
        assert.ok(harness.logs.some((line) => line.includes("shortcut-register-failed:")));
        const before = harness.shortcuts.length;
        assert.ok(before > 0);
        controller.start();
        assert.ok(harness.shortcuts.length > before);
        assertCatalogRegistration(harness, "cosmic");
        assert.equal(controller.isEnabled, true);
    });
});

describe("command shortcut package route", () => {
    it("wires registerShortcut from the packaged entry through the mode-gated dispatcher", () => {
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.ok(entry.includes("registerShortcut"));
        const controller = readFileSync("src/controller.ts", "utf8");
        assert.ok(controller.includes("registerCommandShortcuts"));
        assert.ok(controller.includes("COMMAND_SHORTCUT_ACTION_IDS"));
        assert.ok(controller.includes("registerShortcut"));
        for (const action of [
            "focus-left",
            "move-right-arrow",
            "resize-mode-outwards",
            "resize-expand-left",
            "resize-contract-right",
        ]) {
            assert.ok(controller.includes(`"${action}"`), action);
        }
        for (const route of ["focusOrResize", "requestMove", "requestResize", "enterOrExitRustResizeMode"]) {
            assert.ok(controller.includes(route), route);
        }
        const manifest = readFileSync("package.json", "utf8");
        assert.match(manifest, /esbuild src\/entry\.ts --bundle/);
        // Behavioral supplement to the static route: the registered handler
        // dispatches through the current authority instead of merely existing.
        const harness = new Harness();
        harness.configValues.set("shortcutProfile", "bspwm");
        harness.configValues.set("engineAuthorityMode", "rust-development");
        const routedController = new TileController(harness.environment());
        routedController.start();
        const routed: Array<readonly unknown[]> = [];
        (routedController as unknown as { engineAuthority: unknown }).engineAuthority = fakeDispatcher(routed);
        handlerFor(harness, "plasma-auto-tiler-resize-contract-right")();
        assert.deepEqual(routed, [["resize", "right", "inwards"]]);
    });
});
