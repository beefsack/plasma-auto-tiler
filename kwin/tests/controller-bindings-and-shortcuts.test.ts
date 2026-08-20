import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Harness, window } from "./controller-fixtures";
import { countEvent, setup } from "./controller-fixture-scenarios";
import {
    PROFILE_CATALOGS,
    REGISTERED_PROFILE_ACTION_IDS,
    ShortcutOverrides,
    TileController,
    catalogValidationDiagnostics,
    resolveSequence,
    selectProfile,
    validateProfile,
    type ProfileCatalog,
    type RowClassification,
} from "../src/controller";

describe("TileController binding profile catalog", () => {
    // Pinned upstream fixtures (retrieved 2026-08-14):
    // - COSMIC: pop-os/cosmic-comp master data/keybindings.ron [C-KR]
    // - Hyprland: hyprwm/Hyprland main example/hyprland.lua (the generated
    //   default embeds exactly this example config)
    // - bspwm: baskerville/bspwm master examples/sxhkdrc (canonical example;
    //   bspwm ships no WM-enforced bindings)
    const workspacePinned = (): ReadonlyArray<readonly [string, string]> =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => [`workspace-${index}`, `Meta+${index}`] as const);
    const moveWorkspacePinned = (): ReadonlyArray<readonly [string, string]> =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => [`move-workspace-${index}`, `Meta+Shift+${index}`] as const);
    // Meta+Shift+<digit> never reaches the registered action on QWERTY-family
    // layouts (see SHIFT_DIGIT_SYMBOL_ALIAS in controller.ts); every
    // move-workspace-N row carries a compatibility-alias sibling under the
    // shifted symbol actually delivered on those layouts.
    const MOVE_WORKSPACE_SYMBOL_ALIASES: ReadonlyArray<readonly [string, string]> = [
        ["move-workspace-1-symbol", "Meta+!"],
        ["move-workspace-2-symbol", "Meta+@"],
        ["move-workspace-3-symbol", "Meta+#"],
        ["move-workspace-4-symbol", "Meta+$"],
        ["move-workspace-5-symbol", "Meta+%"],
        ["move-workspace-6-symbol", "Meta+^"],
        ["move-workspace-7-symbol", "Meta+&"],
        ["move-workspace-8-symbol", "Meta+*"],
        ["move-workspace-9-symbol", "Meta+("],
    ];
    const MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS: readonly [string, string] = ["move-workspace-0-symbol", "Meta+)"];

    const COSMIC_PINNED_EXACT: ReadonlyArray<readonly [string, string]> = [
        ["focus-left", "Meta+H"],
        ["focus-down", "Meta+J"],
        ["focus-up", "Meta+K"],
        ["focus-right", "Meta+L"],
        ["focus-left-arrow", "Meta+Left"],
        ["focus-down-arrow", "Meta+Down"],
        ["focus-up-arrow", "Meta+Up"],
        ["focus-right-arrow", "Meta+Right"],
        ["move-left", "Meta+Shift+H"],
        ["move-down", "Meta+Shift+J"],
        ["move-up", "Meta+Shift+K"],
        ["move-right", "Meta+Shift+L"],
        ["move-left-arrow", "Meta+Shift+Left"],
        ["move-down-arrow", "Meta+Shift+Down"],
        ["move-up-arrow", "Meta+Shift+Up"],
        ["move-right-arrow", "Meta+Shift+Right"],
        ["float-toggle", "Meta+G"],
        ["maximize", "Meta+M"],
        ...workspacePinned(),
        ...moveWorkspacePinned(),
        ["move-workspace-0", "Meta+Shift+0"],
        ["workspace-0", "Meta+0"],
        ["resize-mode-outwards", "Meta+R"],
        ["resize-mode-inwards", "Meta+Shift+R"],
    ];

    // Unimplemented catalog rows that must never register or resolve: they are
    // truthful component requirements, not exact/additive implemented actions.
    const COSMIC_PINNED_COMPONENT_REQUIREMENTS: ReadonlyArray<readonly [string, string]> = [
        ["previous-workspace-up", "Meta+Ctrl+Up"],
        ["previous-workspace-left", "Meta+Ctrl+Left"],
        ["previous-workspace-h", "Meta+Ctrl+H"],
        ["previous-workspace-k", "Meta+Ctrl+K"],
        ["next-workspace-down", "Meta+Ctrl+Down"],
        ["next-workspace-right", "Meta+Ctrl+Right"],
        ["next-workspace-j", "Meta+Ctrl+J"],
        ["next-workspace-l", "Meta+Ctrl+L"],
        ["fullscreen", "Meta+F11"],
        ["group-toggle", "Meta+S"],
    ];

    const HYPRLAND_PINNED_EXACT: ReadonlyArray<readonly [string, string]> = [
        ["focus-left-arrow", "Meta+Left"],
        ["focus-down-arrow", "Meta+Down"],
        ["focus-up-arrow", "Meta+Up"],
        ["focus-right-arrow", "Meta+Right"],
        ["float-toggle", "Meta+V"],
        ...workspacePinned(),
        ...moveWorkspacePinned(),
        ["move-workspace-0", "Meta+Shift+0"],
        ["workspace-0", "Meta+0"],
    ];

    const HYPRLAND_PINNED_ALIASES: ReadonlyArray<readonly [string, string]> = [
        ["focus-left", "Meta+H"],
        ["focus-down", "Meta+J"],
        ["focus-up", "Meta+K"],
        ["focus-right", "Meta+L"],
        ["move-left", "Meta+Shift+H"],
        ["move-down", "Meta+Shift+J"],
        ["move-up", "Meta+Shift+K"],
        ["move-right", "Meta+Shift+L"],
        ["move-left-arrow", "Meta+Shift+Left"],
        ["move-down-arrow", "Meta+Shift+Down"],
        ["move-up-arrow", "Meta+Shift+Up"],
        ["move-right-arrow", "Meta+Shift+Right"],
        ...MOVE_WORKSPACE_SYMBOL_ALIASES,
        MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS,
    ];

    const BSPWM_PINNED_CANONICAL: ReadonlyArray<readonly [string, string]> = [
        ["focus-left", "Meta+H"],
        ["focus-down", "Meta+J"],
        ["focus-up", "Meta+K"],
        ["focus-right", "Meta+L"],
        ["move-left", "Meta+Shift+H"],
        ["move-down", "Meta+Shift+J"],
        ["move-up", "Meta+Shift+K"],
        ["move-right", "Meta+Shift+L"],
        ...workspacePinned(),
        ...moveWorkspacePinned(),
        ["move-workspace-0", "Meta+Shift+0"],
        ["workspace-0", "Meta+0"],
        ["float-toggle", "Meta+S"],
        ["resize-expand-left", "Meta+Alt+H"],
        ["resize-expand-down", "Meta+Alt+J"],
        ["resize-expand-up", "Meta+Alt+K"],
        ["resize-expand-right", "Meta+Alt+L"],
        ["resize-contract-left", "Meta+Alt+Shift+H"],
        ["resize-contract-down", "Meta+Alt+Shift+J"],
        ["resize-contract-up", "Meta+Alt+Shift+K"],
        ["resize-contract-right", "Meta+Alt+Shift+L"],
    ];

    // bspwm's prev/next-workspace and fullscreen rows are unimplemented
    // component requirements, never registered or sequence-resolvable.
    const BSPWM_PINNED_COMPONENT_REQUIREMENTS: ReadonlyArray<readonly [string, string]> = [
        ["previous-workspace", "Meta+BracketLeft"],
        ["next-workspace", "Meta+BracketRight"],
        ["fullscreen", "Meta+F"],
    ];

    // Project-required arrow aliases for the directional families. bspwm's
    // sxhkdrc ships no arrow focus and its only arrow binding (super+{Left,..}
    // bspc node -v) is a floating-window nudge, not the tiled move/swap action,
    // so the arrow rows are project parity aliases, never canonical-example.
    const BSPWM_PINNED_ALIASES: ReadonlyArray<readonly [string, string]> = [
        ["focus-left-arrow", "Meta+Left"],
        ["focus-down-arrow", "Meta+Down"],
        ["focus-up-arrow", "Meta+Up"],
        ["focus-right-arrow", "Meta+Right"],
        ["move-left-arrow", "Meta+Shift+Left"],
        ["move-down-arrow", "Meta+Shift+Down"],
        ["move-up-arrow", "Meta+Shift+Up"],
        ["move-right-arrow", "Meta+Shift+Right"],
        ...MOVE_WORKSPACE_SYMBOL_ALIASES,
        MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS,
    ];

    function projected(
        catalog: ProfileCatalog,
        classification: RowClassification,
    ): ReadonlyArray<readonly [string, string]> {
        return catalog.rows
            .filter((row) => row.classification === classification)
            .map((row) => [row.actionId, row.sequence] as const);
    }

    it("pins the cosmic catalog exactly to its upstream fixture with Meta+0 active", () => {
        assert.deepEqual(projected(PROFILE_CATALOGS.cosmic, "exact"), COSMIC_PINNED_EXACT);
        assert.deepEqual(projected(PROFILE_CATALOGS.cosmic, "compatibility-alias"), [
            ...MOVE_WORKSPACE_SYMBOL_ALIASES,
            MOVE_WORKSPACE_ZERO_SYMBOL_ALIAS,
        ]);
        assert.deepEqual(projected(PROFILE_CATALOGS.cosmic, "deferred"), []);
        // Unimplemented rows are truthfully classified component requirements,
        // never exact rows and never resolvable.
        assert.deepEqual(
            projected(PROFILE_CATALOGS.cosmic, "component-requirement"),
            COSMIC_PINNED_COMPONENT_REQUIREMENTS,
        );
    });

    it("pins the hyprland catalog to its upstream default plus explicitly-classified parity aliases", () => {
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "exact"), HYPRLAND_PINNED_EXACT);
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "compatibility-alias"), HYPRLAND_PINNED_ALIASES);
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "deferred"), []);
        assert.deepEqual(projected(PROFILE_CATALOGS.hyprland, "component-requirement"), []);
    });

    it("pins the bspwm catalog to its canonical sxhkdrc rows plus project parity arrow aliases", () => {
        assert.deepEqual(projected(PROFILE_CATALOGS.bspwm, "canonical-example"), BSPWM_PINNED_CANONICAL);
        assert.deepEqual(projected(PROFILE_CATALOGS.bspwm, "compatibility-alias"), BSPWM_PINNED_ALIASES);
        assert.deepEqual(projected(PROFILE_CATALOGS.bspwm, "deferred"), []);
        assert.deepEqual(
            projected(PROFILE_CATALOGS.bspwm, "component-requirement"),
            BSPWM_PINNED_COMPONENT_REQUIREMENTS,
        );
    });

    it("classifies every row of every shipped profile", () => {
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            for (const row of profile.rows) {
                assert.equal(
                    ["exact", "canonical-example", "compatibility-alias", "deferred", "component-requirement"].includes(
                        row.classification,
                    ),
                    true,
                    `${profile.key}:${row.shortcutId}`,
                );
            }
        }
    });

    it("validates every shipped profile with zero in-profile duplicate sequences or ID conflicts", () => {
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            const validation = validateProfile(profile);
            assert.equal(validation.ok, true, profile.key);
            assert.deepEqual(validation.duplicateSequences, [], profile.key);
            assert.deepEqual(validation.shortcutIdConflicts, [], profile.key);
        }
    });

    it("rejects duplicate effective sequences and names both conflicting action IDs", () => {
        const conflicting = validateProfile({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows.filter((row) => row.classification !== "deferred"),
                { ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")!, shortcutId: "duplicate-row" },
            ],
        });
        assert.equal(conflicting.ok, false);
        assert.deepEqual(conflicting.duplicateSequences, [
            { sequence: "Meta+L", actionIds: ["focus-right", "focus-right"] },
        ]);
    });

    it("rejects duplicate shortcut names and reports both conflicting action IDs", () => {
        const conflicting = validateProfile({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows,
                { ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "maximize")!, shortcutId: "plasma-auto-tiler-float-toggle" },
            ],
        });
        assert.equal(conflicting.ok, false);
        assert.deepEqual(conflicting.shortcutIdConflicts, [
            { shortcutId: "plasma-auto-tiler-float-toggle", actionIds: ["float-toggle", "maximize"] },
        ]);
    });

    it("selects the cosmic catalog when the config is absent and when it is invalid, with a diagnostic only for invalid", () => {
        assert.deepEqual(selectProfile(undefined).profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile(undefined).diagnostics, []);
        assert.deepEqual(selectProfile(null).profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile("").profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile("cosmic").profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(selectProfile("hyprland").profile, PROFILE_CATALOGS.hyprland);
        assert.deepEqual(selectProfile("bspwm").profile, PROFILE_CATALOGS.bspwm);
        const invalid = selectProfile("not-a-profile");
        assert.deepEqual(invalid.profile, PROFILE_CATALOGS.cosmic);
        assert.deepEqual(invalid.diagnostics, ["profile-invalid:fallback-cosmic"]);
    });

    it("applies user override > selected baseline > profile default without touching the catalog default", () => {
        const overrides = new ShortcutOverrides();
        overrides.set("focus-right", "Meta+Alt+L");
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "focus-right", overrides), "Meta+Alt+L");
        // Switch the selected baseline; the override survives and still wins.
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "focus-right", overrides), "Meta+Alt+L");
        // Without an override the baseline wins; the catalog default is untouched.
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "focus-right"), "Meta+L");
        assert.equal(
            PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")?.sequence,
            "Meta+L",
        );
        // A baseline row wins over the cosmic profile default.
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "float-toggle"), "Meta+V");
        assert.equal(resolveSequence(PROFILE_CATALOGS.bspwm, "float-toggle"), "Meta+S");
        // An action the selected profile lacks falls back to the cosmic profile default.
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "maximize"), "Meta+M");
        // Unknown actions resolve to null.
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "no-such-action"), null);
    });

    it("never registers or resolves unimplemented component-requirement rows, in any profile", () => {
        // Truthfulness regression: fullscreen, previous/next-workspace, and
        // group rows used to be catalogued as exact/canonical-example (implying
        // implemented and additive) while registration silently skipped them.
        // They are now truthfully component requirements: never registered,
        // never sequence-resolvable, and never reported as registered.
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            const rows = profile.rows.filter((row) => row.classification === "component-requirement");
            assert.ok(rows.length > 0 || profile.key === "hyprland", profile.key);
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", profile.key);
            new TileController(harness.environment()).start();
            for (const row of rows) {
                assert.equal(
                    harness.shortcuts.some((entry) => entry.name === row.shortcutId),
                    false,
                    `${profile.key}:${row.shortcutId} must never register`,
                );
                assert.equal(
                    harness.shortcuts.some((entry) => entry.sequence === row.sequence && entry.name !== row.shortcutId),
                    false,
                    `${profile.key}:${row.actionId} sequence must not be claimed by another row`,
                );
                // The model layer cannot resolve the action to any live
                // sequence either: no baseline, no profile default.
                assert.equal(resolveSequence(profile, row.actionId), null, `${profile.key}:${row.actionId}`);
            }
        }
        // The registered-set derivation excludes every component-requirement
        // row, so no registration diagnostic or catalog claim can name them.
        for (const row of PROFILE_CATALOGS.cosmic.rows) {
            if (row.classification === "component-requirement") {
                assert.equal(REGISTERED_PROFILE_ACTION_IDS.has(row.actionId), false, row.actionId);
            }
        }
    });

    it("registers the selected profile's catalog rows, including Meta+0 under its stable ID", () => {
        const cosmic = new Harness();
        new TileController(cosmic.environment()).start();
        const cosmicSequences = new Map(cosmic.shortcuts.map((entry) => [entry.name, entry.sequence]));
        assert.equal(cosmicSequences.get("plasma-auto-tiler-focus-left"), "Meta+H");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-focus-right"), "Meta+L");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-move-left"), "Meta+Shift+H");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-workspace-0"), "Meta+0");
        assert.equal(cosmicSequences.get("plasma-auto-tiler-move-workspace-append"), "Meta+Shift+0");
        assert.equal(countEvent(cosmic.logs, "profile-invalid:fallback-cosmic"), 0);

        const hyprland = new Harness();
        hyprland.configValues.set("shortcutProfile", "hyprland");
        new TileController(hyprland.environment()).start();
        const hyprlandSequences = new Map(hyprland.shortcuts.map((entry) => [entry.name, entry.sequence]));
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-focus-right-arrow"), "Meta+Right");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-focus-right"), "Meta+L");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-float-toggle"), "Meta+V");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-workspace-0"), "Meta+0");
        assert.equal(hyprlandSequences.get("plasma-auto-tiler-move-workspace-append"), "Meta+Shift+0");

        const invalid = new Harness();
        invalid.configValues.set("shortcutProfile", "bogus");
        new TileController(invalid.environment()).start();
        const invalidSequences = new Map(invalid.shortcuts.map((entry) => [entry.name, entry.sequence]));
        assert.equal(invalidSequences.get("plasma-auto-tiler-focus-left"), "Meta+H");
        assert.equal(countEvent(invalid.logs, "profile-invalid:fallback-cosmic"), 1);
    });

    it("registers every alias under a distinct shortcut ID and Meta+0 under the stable ID in every profile", () => {
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const names = harness.shortcuts.map((entry) => entry.name);
            assert.equal(new Set(names).size, names.length, key);
            assert.equal(names.includes("plasma-auto-tiler-workspace-0"), true, key);
            assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), true, key);
        }
    });

    it("never registers profile actions without a controller implementation as false equivalents", () => {
        const componentRequirements = [
            "plasma-auto-tiler-fullscreen",
            "plasma-auto-tiler-group-toggle",
            "plasma-auto-tiler-previous-workspace-up",
            "plasma-auto-tiler-previous-workspace-left",
            "plasma-auto-tiler-previous-workspace-h",
            "plasma-auto-tiler-previous-workspace-k",
            "plasma-auto-tiler-next-workspace-down",
            "plasma-auto-tiler-next-workspace-right",
            "plasma-auto-tiler-next-workspace-j",
            "plasma-auto-tiler-next-workspace-l",
            "plasma-auto-tiler-previous-workspace",
            "plasma-auto-tiler-next-workspace",
        ];
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const names = harness.shortcuts.map((entry) => entry.name);
            for (const shortcutId of componentRequirements) {
                assert.equal(names.includes(shortcutId), false, `${key}:${shortcutId}`);
            }
        }
    });

    it("documents the script-local registration boundary without claiming Plasma-global takeover", () => {
        // Spec H.16: script-local registration is evidence of attempted
        // registration only; no v1 behavior displaces or reassigns a Plasma
        // global shortcut. The controller emits no migration diagnostic and the
        // aggregate gate only reflects registerShortcut results.
        const { harness } = setup();
        for (const entry of harness.logs) {
            assert.equal(entry.includes("displaced"), false);
            assert.equal(entry.includes("migrated"), false);
            assert.equal(entry.includes("kglobalshortcutsrc"), false);
        }
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
    });

    it("registers identical stable shortcut IDs across reload/restart, keeping user overrides model-pure", () => {
        // Plan Unit 03 acceptance 1: every catalog row re-registers under the
        // same stable shortcut ID on reload/restart, so KGlobalAccel keeps the
        // same row and a user-customized sequence is never silently
        // overwritten. The override stays a pure model seam: reload does not
        // read or mutate KGlobalAccel and never inspects a live session.
        const first = new Harness();
        new TileController(first.environment()).start();
        const firstNames = first.shortcuts.map((entry) => entry.name);
        const restart = new Harness();
        new TileController(restart.environment()).start();
        assert.deepEqual(restart.shortcuts.map((entry) => entry.name), firstNames);
        assert.ok(firstNames.includes("plasma-auto-tiler-focus-left"));
        assert.ok(firstNames.includes("plasma-auto-tiler-workspace-0"));
        assert.ok(firstNames.includes("plasma-auto-tiler-move-workspace-append"));
        // A user override set before a profile switch still wins, and the
        // catalog-owned default is never mutated.
        const overrides = new ShortcutOverrides();
        overrides.set("focus-right", "Meta+Alt+L");
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "focus-right", overrides), "Meta+Alt+L");
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "focus-right", overrides), "Meta+Alt+L");
        assert.equal(
            PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")?.sequence,
            "Meta+L",
        );
        assert.equal(
            PROFILE_CATALOGS.hyprland.rows.find((row) => row.actionId === "focus-right")?.sequence,
            "Meta+L",
        );
    });

    it("emits per-registration inability diagnostics naming the failing shortcut ID", () => {
        const harness = new Harness();
        for (let index = 0; index < 4; index += 1) {
            harness.shortcutResults.push(true);
        }
        harness.shortcutResults.push(false);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "shortcut-register-failed:plasma-auto-tiler-focus-left"), 1);
        assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
    });

    it("reports catalog collision and ID-conflict diagnostics naming both conflicting action IDs", () => {
        const sequenceCollision = catalogValidationDiagnostics({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows.filter((row) => row.classification !== "deferred"),
                {
                    ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "focus-right")!,
                    shortcutId: "duplicate-row",
                },
            ],
        });
        assert.deepEqual(sequenceCollision, ["shortcut-catalog-collision:Meta+L:focus-right:focus-right"]);
        const idConflict = catalogValidationDiagnostics({
            key: "cosmic",
            name: "COSMIC",
            rows: [
                ...PROFILE_CATALOGS.cosmic.rows,
                {
                    ...PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "maximize")!,
                    shortcutId: "plasma-auto-tiler-float-toggle",
                    sequence: "Meta+Shift+M",
                },
            ],
        });
        assert.deepEqual(idConflict, [
            "shortcut-id-conflict:plasma-auto-tiler-float-toggle:float-toggle:maximize",
        ]);
    });

    it("emits no catalog collision diagnostic for any shipped profile", () => {
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            assert.equal(
                harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:shortcut-catalog-collision")),
                false,
                key,
            );
            assert.equal(
                harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:shortcut-id-conflict")),
                false,
                key,
            );
        }
    });

    it("registers Meta+0 under the stable ID in every profile and never registers a legacy append ID", () => {
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const meta0 = harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-workspace-0");
            assert.ok(meta0, `${key}: stable Meta+0 ID must register`);
            assert.equal(meta0?.sequence, "Meta+0", key);
            assert.equal(
                harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-workspace-append"),
                false,
                key,
            );
        }
    });

    it("preserves a user override under the stable Meta+0 ID across profile switches", () => {
        // A user-customized value for `workspace-0` survives a reload and a
        // profile switch and takes precedence over the catalog-owned default,
        // exactly like every other implemented action (plan Unit 01 acceptance 4).
        const overrides = new ShortcutOverrides();
        overrides.set("workspace-0", "Meta+Alt+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "workspace-0", overrides), "Meta+Alt+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "workspace-0", overrides), "Meta+Alt+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.bspwm, "workspace-0", overrides), "Meta+Alt+0");
        // Without an override the catalog default (Meta+0) wins and is never
        // mutated by the override layer.
        assert.equal(resolveSequence(PROFILE_CATALOGS.cosmic, "workspace-0"), "Meta+0");
        assert.equal(resolveSequence(PROFILE_CATALOGS.hyprland, "workspace-0"), "Meta+0");
        assert.equal(PROFILE_CATALOGS.cosmic.rows.find((row) => row.actionId === "workspace-0")?.sequence, "Meta+0");
    });

    it("derives the registered action ID set in exact order and content", () => {
        // Pins the ES2017-safe explicit-loop derivation of the registered set
        // (Array.prototype.flatMap is ES2019 and this KWin QJSEngine rejects it).
        // Content and insertion order must match the previous flatMap build.
        const expected: string[] = [];
        for (const family of ["focus", "move"]) {
            for (const direction of ["left", "down", "up", "right"]) {
                expected.push(`${family}-${direction}`, `${family}-${direction}-arrow`);
            }
        }
        expected.push("float-toggle", "maximize", "resize-mode-outwards", "resize-mode-inwards");
        for (const kind of ["expand", "contract"]) {
            for (const direction of ["left", "down", "up", "right"]) {
                expected.push(`resize-${kind}-${direction}`);
            }
        }
        expected.push("move-workspace-0", "move-workspace-0-symbol", "workspace-0");
        for (let index = 1; index <= 9; index += 1) {
            expected.push(`workspace-${index}`, `move-workspace-${index}`, `move-workspace-${index}-symbol`);
        }
        assert.deepEqual([...REGISTERED_PROFILE_ACTION_IDS], expected);
    });

    it("declares every catalog reference source tag in the comparison document", () => {
        // The catalog rows are the single enumerated source: the leading
        // `[TAG]` of every row reference must resolve to a primary-source tag
        // parsed from the document's Primary source list, so neither side is a
        // duplicated literal list here.
        const lines = readFileSync("../docs/reference-wm-comparison.md", "utf8").split("\n");
        const sectionStart = lines.findIndex((line) => line.trim() === "## Primary source list");
        assert.notEqual(sectionStart, -1, "missing ## Primary source list section");
        const declared = new Set<string>();
        for (const line of lines.slice(sectionStart + 1)) {
            if (line.trim().startsWith("---")) {
                break;
            }
            const match = /^\|\s*\[([^\]]+)\]\s*\|/.exec(line);
            if (match !== null) {
                declared.add(match[1]!);
            }
        }
        const catalogTags = new Set<string>();
        for (const profile of Object.values(PROFILE_CATALOGS)) {
            for (const row of profile.rows) {
                const match = /^\[([^\]]+)\]/.exec(row.reference);
                if (match !== null) {
                    catalogTags.add(match[1]!);
                }
            }
        }
        assert.ok(catalogTags.size > 0, "catalog must expose reference source tags");
        for (const tag of [...catalogTags].sort()) {
            assert.ok(
                declared.has(tag),
                `catalog reference source tag not declared in docs/reference-wm-comparison.md: ${tag}`,
            );
        }
    });
});

describe("TileController shortcut registration", () => {
    it("captures the result and emits one fixed success diagnostic before readiness", () => {
        const { harness } = setup();
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 1);
        assert.ok(
            harness.logs.indexOf("plasma-auto-tiler:shortcut-registered") <
                harness.logs.indexOf("plasma-auto-tiler:startup-handlers-ready"),
        );
        for (const entry of harness.logs) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("disables once with a fixed reason and no readiness when registration fails", () => {
        const harness = new Harness();
        harness.shortcutResult = false;
        const controller = new TileController(harness.environment());
        controller.start();
        controller.start();
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
        assert.equal(countEvent(harness.logs, "startup-handlers-ready"), 0);
        assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
        for (const entry of harness.logs) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("registers exactly the catalog-driven all-or-nothing action set, including Meta+0", () => {
        const { harness } = setup();
        const expected = new Set<string>([
            ...PROFILE_CATALOGS.cosmic.rows
                .filter((row) => row.classification !== "deferred" && REGISTERED_PROFILE_ACTION_IDS.has(row.actionId))
                .map((row) => row.shortcutId),
            "plasma-auto-tiler-insert-right",
            "plasma-auto-tiler-insert-left",
            "plasma-auto-tiler-insert-up",
            "plasma-auto-tiler-insert-down",
            "plasma-auto-tiler-detach",
            "plasma-auto-tiler-attach",
            "plasma-auto-tiler-sticky-toggle",
            "plasma-auto-tiler-fill-scope",
            "plasma-auto-tiler-apply-columns",
            "plasma-auto-tiler-apply-rows",
            "plasma-auto-tiler-apply-balanced-grid",
            "plasma-auto-tiler-apply-dwindle",
        ]);
        const names = harness.shortcuts.map((entry) => entry.name).sort();
        assert.deepEqual(names, [...expected].sort());
        assert.equal(names.includes("plasma-auto-tiler-workspace-0"), true);
        assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), true);
    });

    it("disables atomically when any single new directional insertion registration fails", () => {
        // 1-based registration positions of the three added insert actions.
        for (const failIndex of [2, 3, 4]) {
            const harness = new Harness();
            for (let index = 1; index < failIndex; index += 1) {
                harness.shortcutResults.push(true);
            }
            harness.shortcutResults.push(false);
            const controller = new TileController(harness.environment());
            controller.start();
            assert.equal(controller.isEnabled, false);
            assert.equal(countEvent(harness.logs, "shortcut-registered"), 0);
            assert.equal(countEvent(harness.logs, "startup-handlers-ready"), 0);
            assert.equal(countEvent(harness.logs, "disabled:shortcut-registration-failed"), 1);
        }
    });

    it("keeps the controller enabled when the diagnostic sink throws on success", () => {
        const harness = new Harness();
        harness.throwOnLog = true;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
    });

    it("disables inertly when the diagnostic sink throws on failure", () => {
        const harness = new Harness();
        harness.throwOnLog = true;
        harness.shortcutResult = false;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, false);
    });
});

describe("TileController focus-writer seam", () => {
    it("forwards the strict guarded target through the fixture writer", () => {
        const harness = new Harness();
        const target = window();
        harness.environment().setActiveWindow(target);
        assert.equal(harness.writtenActive, target);
    });
});
