import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_WORKSPACE_MODE,
    SessionOutputKeys,
    TileController,
    WORKSPACE_MODE_CONFIG_KEY,
    WORKSPACE_MODES,
    outputTuple,
    parseWorkspaceMode,
} from "../src/controller";
import {
    DESKTOP,
    Harness,
    OUTPUT,
} from "./controller-fixtures";
import { countEvent, invokeShortcut, ownTrailingEmpty, setup } from "./controller-fixture-scenarios";

describe("TileController workspace mode and per-output seams (Unit 04)", () => {
    it("parses workspaceMode: missing selects per-output-local, each valid mode parses, invalid falls back", () => {
        assert.equal(DEFAULT_WORKSPACE_MODE, "per-output-local");
        assert.deepEqual(WORKSPACE_MODES, ["per-output-local", "global-unique", "shared"]);
        for (const missing of [undefined, null, ""]) {
            const parsed = parseWorkspaceMode(missing);
            assert.equal(parsed.mode, "per-output-local");
            assert.deepEqual(parsed.diagnostics, []);
        }
        for (const mode of WORKSPACE_MODES) {
            const parsed = parseWorkspaceMode(mode);
            assert.equal(parsed.mode, mode);
            assert.deepEqual(parsed.diagnostics, []);
        }
        const fallback = parseWorkspaceMode("bogus-mode");
        assert.equal(fallback.mode, "per-output-local");
        assert.deepEqual(fallback.diagnostics, ["workspace-mode-invalid:fallback-per-output-local"]);
    });

    it("selects workspaceMode from readConfig at startup with default and diagnostic fallback", () => {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.workspaceModeSnapshot(), "global-unique");
        assert.equal(countEvent(harness.logs, "workspace-mode-invalid:fallback-per-output-local"), 0);

        const missing = new Harness();
        const missingController = new TileController(missing.environment());
        missingController.start();
        assert.equal(missingController.workspaceModeSnapshot(), "per-output-local");
        assert.equal(countEvent(missing.logs, "workspace-mode-invalid:fallback-per-output-local"), 0);

        const invalid = new Harness();
        invalid.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "not-a-mode");
        const invalidController = new TileController(invalid.environment());
        invalidController.start();
        assert.equal(invalidController.workspaceModeSnapshot(), "per-output-local");
        assert.equal(countEvent(invalid.logs, "workspace-mode-invalid:fallback-per-output-local"), 1);
    });

    it("routes navigation through setCurrentDesktopForScreen on the active window's output", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopForScreenWrites.length, 1);
        assert.equal((harness.currentDesktopForScreenWrites[0]?.desktop as { id: string }).id, "desktop-2");
        assert.equal(harness.currentDesktopForScreenWrites[0]?.output, OUTPUT);
        assert.equal(harness.currentDesktopWrites.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
    });

    it("falls back to the global current-desktop write when no active window output exists", () => {
        const { harness } = setup();
        harness.active = null;
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 1);
        assert.equal((harness.currentDesktopWrites[0] as { id: string }).id, "desktop-2");
    });

    it("preserves the output argument of currentDesktopChanged through the typed boundary", () => {
        const harness = new Harness();
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.currentDesktopChangeOutput(), null);
        harness.emitCurrentDesktopChanged(null, DESKTOP, OUTPUT);
        assert.equal(controller.currentDesktopChangeOutput(), OUTPUT);
        // A non-output argument is never adopted as the affected output.
        harness.emitCurrentDesktopChanged(null, DESKTOP, null);
        assert.equal(controller.currentDesktopChangeOutput(), OUTPUT);
    });

    it("derives the output tuple from manufacturer/model/serial/name", () => {
        assert.equal(outputTuple(OUTPUT), "KDE\u0000test\u00001\u0000screen-1");
        assert.equal(outputTuple({ ...OUTPUT }), outputTuple(OUTPUT));
        assert.notEqual(outputTuple({ ...OUTPUT, name: "other" }), outputTuple(OUTPUT));
        assert.notEqual(outputTuple({ ...OUTPUT, serialNumber: "2" }), outputTuple(OUTPUT));
    });

    it("assigns deterministic session output keys with first-seen distinct keys for same-tuple outputs", () => {
        const registry = new SessionOutputKeys();
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        registry.rebuild([e, l]);
        const keyE = registry.keyFor(e);
        const keyL = registry.keyFor(l);
        assert.notEqual(keyE, undefined);
        assert.notEqual(keyL, undefined);
        assert.notEqual(keyE, keyL);
        // Same first-seen order across a rebuild is stable.
        registry.rebuild([e, l]);
        assert.equal(registry.keyFor(e), keyE);
        assert.equal(registry.keyFor(l), keyL);
        // A surviving output keeps its key; a distinct tuple gets its own key.
        const a = { ...OUTPUT, name: "screen-a" };
        const b = { ...OUTPUT, name: "screen-b" };
        const other = new SessionOutputKeys();
        other.rebuild([a, b]);
        const keyA = other.keyFor(a);
        const keyB = other.keyFor(b);
        assert.notEqual(keyA, undefined);
        assert.notEqual(keyB, undefined);
        assert.notEqual(keyA, keyB);
        other.rebuild([a, b]);
        assert.equal(other.keyFor(a), keyA);
        assert.equal(other.keyFor(b), keyB);
        // An output tuple rename (name change) is a new physical identity per
        // spec E (matched by the ordered 4-tuple), so it gets a fresh key and
        // never reuses another output's key.
        const renamed = { ...a, name: "screen-a2" };
        other.rebuild([renamed, b]);
        assert.notEqual(other.keyFor(renamed), keyA);
        assert.notEqual(other.keyFor(renamed), keyB);
        assert.equal(other.keyFor(b), keyB);
    });

    it("resolves distinct equivalent output wrappers by tuple, never by object identity", () => {
        // KWin can expose the same physical output through distinct QJS wrappers
        // (workspace.screens, a window's `output` property, workspace.activeScreen).
        // A foreign wrapper with the same physical tuple resolves to the same
        // key as the rebuild's own object, and a colliding tuple resolves to the
        // first-seen key deterministically.
        const registry = new SessionOutputKeys();
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        registry.rebuild([e, l]);
        const keyE = registry.keyFor(e);
        const keyL = registry.keyFor(l);
        // Distinct equivalent objects (spread copies) for both outputs resolve
        // deterministically with no identity dependency. The colliding tuple
        // cannot distinguish the two physical outputs, so every foreign wrapper
        // of that tuple resolves to the first-seen key (spec E collision).
        assert.equal(registry.keyFor({ ...e }), keyE);
        assert.equal(registry.keyFor({ ...e }), keyE);
        assert.equal(registry.keyFor({ ...l }), keyE);
        assert.equal(registry.keyFor({ ...l }), keyE);
        // The rebuild's own identity objects still resolve to their distinct
        // first-seen keys.
        assert.equal(registry.keyFor(e), keyE);
        assert.equal(registry.keyFor(l), keyL);
        // Distinct equivalent objects with distinct tuples keep distinct keys.
        const a = { ...OUTPUT, name: "screen-a" };
        const b = { ...OUTPUT, name: "screen-b" };
        const registry2 = new SessionOutputKeys();
        registry2.rebuild([a, b]);
        const keyA = registry2.keyFor(a);
        const keyB = registry2.keyFor(b);
        assert.equal(registry2.keyFor({ ...a }), keyA);
        assert.equal(registry2.keyFor({ ...b }), keyB);
        // A foreign wrapper of a colliding same-tuple pair resolves to the
        // first-seen key (spec E collision is inherently ambiguous).
        const registry3 = new SessionOutputKeys();
        const e3 = { ...OUTPUT, name: "screen-a" };
        const l3 = { ...OUTPUT, name: "screen-a" };
        registry3.rebuild([e3, l3]);
        const keyE3 = registry3.keyFor(e3);
        const keyL3 = registry3.keyFor(l3);
        assert.notEqual(keyE3, undefined);
        assert.notEqual(keyL3, undefined);
        assert.notEqual(keyE3, keyL3);
        assert.equal(registry3.keyFor({ ...e3 }), keyE3);
    });

    it("resolves a stale or unknown output safely to undefined with one diagnostic per tuple", () => {
        // A wrapper whose tuple matches no current rebuild entry (a disconnected
        // output or one never seen) resolves to undefined and is reported once
        // per session tuple through the diagnostic callback.
        const reported: string[] = [];
        const registry = new SessionOutputKeys((tuple) => {
            reported.push(tuple);
        });
        const a = { ...OUTPUT, name: "screen-a" };
        const b = { ...OUTPUT, name: "screen-b" };
        registry.rebuild([a, b]);
        assert.notEqual(registry.keyFor(a), undefined);
        // A stale wrapper for a disconnected output resolves to undefined; the
        // still-connected output keeps resolving by identity.
        const stale = { ...a };
        registry.rebuild([b]);
        assert.notEqual(registry.keyFor(b), undefined);
        assert.equal(registry.keyFor(stale), undefined);
        assert.equal(registry.keyFor({ ...a }), undefined);
        // An unknown tuple (never seen) is also a safe undefined.
        assert.equal(registry.keyFor({ ...OUTPUT, name: "screen-z" }), undefined);
        assert.equal(registry.keyFor({ ...OUTPUT, name: "screen-z" }), undefined);
        // Two distinct unknown/stale tuples were reported exactly once each.
        assert.equal(reported.length, 2);
        assert.equal(reported[0], outputTuple(stale));
        assert.equal(reported[1], outputTuple({ ...OUTPUT, name: "screen-z" }));
        // Connected-output lookups never emit an unknown diagnostic.
        assert.notEqual(registry.keyFor(b), undefined);
        assert.equal(reported.length, 2);
    });

    it("exposes deterministic session output keys from the controller and keeps them across screensChanged", () => {
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        const harness = new Harness();
        harness.screensList = [e, l];
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(e);
        const keyL = controller.outputKeyFor(l);
        assert.notEqual(keyE, undefined);
        assert.notEqual(keyL, undefined);
        assert.notEqual(keyE, keyL);
        harness.screensChanged?.();
        assert.equal(controller.outputKeyFor(e), keyE);
        assert.equal(controller.outputKeyFor(l), keyL);
    });

    it("resolves distinct window/activeScreen output wrappers through the controller and reports stale ones once", () => {
        // A window's `output` property and `workspace.activeScreen` can be
        // distinct QJS wrappers of the physical outputs observed in
        // `workspace.screens`. The controller resolves them by physical tuple
        // (never object identity) and reports a stale/unknown output wrapper
        // with one diagnostic per session tuple.
        const e = { ...OUTPUT };
        const l = { ...OUTPUT };
        const harness = new Harness();
        harness.screensList = [e, l];
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(e);
        const keyL = controller.outputKeyFor(l);
        assert.notEqual(keyE, undefined);
        assert.notEqual(keyL, undefined);
        // A distinct wrapper object with the same physical tuple as a connected
        // screen resolves to that screen's deterministic first-seen key.
        const foreignE = { ...e };
        assert.equal(controller.outputKeyFor(foreignE), keyE);
        assert.equal(controller.outputKeyFor({ ...e }), keyE);
        // The rebuild's own identity objects keep their distinct first-seen
        // keys even under a same-tuple collision.
        assert.equal(controller.outputKeyFor(e), keyE);
        assert.equal(controller.outputKeyFor(l), keyL);
        // A stale wrapper (no matching connected tuple) is a safe undefined and
        // emits exactly one diagnostic for its tuple.
        const stale = { ...e, name: "screen-removed" };
        assert.equal(controller.outputKeyFor(stale), undefined);
        assert.equal(controller.outputKeyFor({ ...stale }), undefined);
        assert.equal(countEvent(harness.logs, "workspace-output-key-unavailable"), 1);
    });

    it("migrates startup state non-destructively: pre-existing desktops resolve into the session primary's list, and the trailing one is protected", () => {
        // Per-output-local reconciliation rebuilds the mapping and enforces
        // the trailing-empty invariant (Q-Domain): the pre-existing set is
        // adopted as logical entries with no owned desktop created.
        // Pre-existing desktops are never marked owned, and the
        // structurally-last one is protected as the trailing empty even
        // though it is invisible.
        const harness = new Harness();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        harness.nextDesktopNumber = 2;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), []);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
        // Repeated reconciliation leaves the set untouched (idempotent).
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), []);
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, 0);
    });

    it("desktop identity is id-based: a renamed/reordered wrapper keeps ownership", () => {
        const { harness, controller } = setup();
        // ownTrailingEmpty settles to a single owned trailing empty
        // desktop-3 (desktop-2 was created, occupied, replenished by
        // desktop-3, then removed once vacated and invisible).
        ownTrailingEmpty(harness);
        harness.removedDesktops.length = 0;
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // Make desktop-3 current so cleanup cannot remove it, isolating
        // identity tracking from removal eligibility (ownership plays no
        // role in removal, but identity is still tracked by id).
        harness.currentDesktop = { id: "desktop-3", x11DesktopNumber: 3 };
        harness.currentDesktopValue = { id: "desktop-3", x11DesktopNumber: 3 };
        // Simulate a rename/reorder: a fresh wrapper for the owned desktop
        // (same id, new number) placed at a different position. Identity is
        // the id string, so ownership is still recognized after the
        // reconciliation rebuild.
        harness.desktopsList = [
            { id: "desktop-3", x11DesktopNumber: 9 },
            { id: "desktop-1", x11DesktopNumber: 1 },
        ];
        const createsBefore = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, createsBefore);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-3"]);
    });

    it("preserves one-output logical behavior through the per-output migration", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        // Move-follow writes membership then follows on the single output.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal(harness.currentDesktopForScreenWrites.length, 1);
        assert.equal(harness.currentDesktopForScreenWrites[0]?.output, OUTPUT);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // Navigation also writes through the per-output seam on the single output.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        assert.equal(harness.currentDesktopForScreenWrites.length, 2);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-1");
    });
});
