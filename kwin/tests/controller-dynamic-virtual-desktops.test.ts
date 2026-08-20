import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TileController } from "../src/controller";
import {
    DESKTOP,
    Harness,
    OUTPUT,
    RECT,
    type TestTile,
    tile,
    window,
} from "./controller-fixtures";
import {
    attachTileWriter,
    configureSwitchCleanupScenario,
    countEvent,
    installDwindleSplitter,
    invokeShortcut,
    modeCleanupSetup,
    ownCleanupDesktops,
    ownTrailingEmpty,
    prepareExcessOwnedEmpty,
    setup,
} from "./controller-fixture-scenarios";

describe("TileController dynamic virtual desktops", () => {
    it("requests the same cleanup pass on every dispatcher trigger, not only a completed switch (Q7 broadened trigger)", () => {
        // The removal pass now always runs when cleanupDesktops runs,
        // regardless of the trigger; there is no longer a distinct
        // "enhanced"/switch-only cleanup call.
        const { harness, controller } = setup();
        let cleanupCalls = 0;
        const inspectable = controller as unknown as {
            cleanupDesktops: () => void;
        };
        inspectable.cleanupDesktops = () => {
            cleanupCalls += 1;
        };

        harness.emitCurrentDesktopChanged(DESKTOP, DESKTOP, OUTPUT);
        assert.equal(cleanupCalls, 1);

        cleanupCalls = 0;
        harness.screensChanged?.();
        assert.equal(cleanupCalls, 1, "output/screen changes trigger cleanup");

        cleanupCalls = 0;
        harness.emitAdded(window());
        assert.equal(cleanupCalls, 1, "window changes trigger cleanup");

        cleanupCalls = 0;
        harness.emitDesktopsChanged();
        assert.equal(cleanupCalls, 1, "desktop scope changes trigger cleanup");
    });

    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`removes every empty invisible owned desktop after a switch in ${mode} mode (no reserved trailing capacity)`, () => {
            const { harness, controller } = modeCleanupSetup(mode);
            configureSwitchCleanupScenario(harness, controller);
            harness.removedDesktops.length = 0;

            harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

            if (mode === "per-output-local") {
                // per-output-local now protects the structurally-identified
                // trailing (last-positioned) empty desktop (Q-Domain):
                // desktop-middle is still removed, but desktop-trailing
                // survives as the output's reserved trailing empty.
                assert.deepEqual(
                    harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                    ["desktop-middle"],
                );
                assert.deepEqual(
                    (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                );
                assert.deepEqual(Object.values(controller.localWorkspaceSnapshot()), [
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                ]);
                return;
            }
            if (mode === "global-unique") {
                // global-unique (unit-03) now enforces the same trailing-
                // empty invariant over its single global domain: desktop-
                // middle is still removed, but desktop-trailing (the
                // structurally-last live desktop) survives as the reserved
                // global trailing empty.
                assert.deepEqual(
                    harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                    ["desktop-middle"],
                );
                assert.deepEqual(
                    (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                );
                assert.deepEqual(Object.values(controller.globalUniqueAssignmentSnapshot()), [
                    ["desktop-1", "desktop-occupied", "desktop-trailing"],
                ]);
                return;
            }
            // shared (unit-07) now enforces the same trailing-empty invariant
            // over its single global domain (the entire live desktop list):
            // desktop-middle is still removed, but desktop-trailing (the
            // structurally-last live desktop) survives as the reserved
            // global trailing empty.
            assert.deepEqual(
                harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                ["desktop-middle"],
            );
            assert.deepEqual(
                (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
                ["desktop-1", "desktop-occupied", "desktop-trailing"],
            );
            assert.deepEqual(controller.sharedWorkspaceSnapshot(), ["desktop-1", "desktop-occupied", "desktop-trailing"]);
        });
    }

    it("removes every eligible non-trailing empty invisible desktop in one per-output-local pass, protecting only the trailing one", () => {
        // enforceLocalTrailingEmpties() computes its removal set from one
        // fixed occupancy/visibility snapshot per domain and does not loop or
        // re-read state mid-pass (spec: no debounce/re-reading loop as an
        // anti-oscillation mechanism) - every eligible non-trailing empty in
        // the domain is removed together, and the structurally-last entry is
        // always protected regardless of how many other empties exist.
        const { harness, controller } = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(harness, controller, [
            "desktop-middle",
            "desktop-middle-2",
            "desktop-middle-3",
            "desktop-trailing",
        ]);
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-middle", x11DesktopNumber: 2 },
            { id: "desktop-middle-2", x11DesktopNumber: 3 },
            { id: "desktop-middle-3", x11DesktopNumber: 4 },
            { id: "desktop-occupied", x11DesktopNumber: 5 },
            { id: "desktop-trailing", x11DesktopNumber: 6 },
        ];
        const inspectable = controller as unknown as { localWorkspaces: Map<string, string[]> };
        const key = controller.outputKeyFor(OUTPUT);
        if (key !== undefined) {
            inspectable.localWorkspaces.set(key, [
                "desktop-1",
                "desktop-middle",
                "desktop-middle-2",
                "desktop-middle-3",
                "desktop-occupied",
                "desktop-trailing",
            ]);
        }

        harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

        // desktop-middle, desktop-middle-2, and desktop-middle-3 are all
        // empty and invisible in the same snapshot and are removed together;
        // desktop-trailing is the structurally-last domain entry and is
        // protected.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-middle", "desktop-middle-2", "desktop-middle-3"],
        );
        assert.deepEqual(
            (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
            ["desktop-1", "desktop-occupied", "desktop-trailing"],
        );
        // Repeated dispatches against the settled state are a pure no-op.
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    for (const mode of ["per-output-local", "global-unique"] as const) {
        it(`keeps a switch-cleanup candidate visible on another output in ${mode} mode, but still removes the other empty invisible one`, () => {
            const { harness, controller } = modeCleanupSetup(mode);
            configureSwitchCleanupScenario(harness, controller);
            const other = { ...OUTPUT, name: "screen-2" };
            harness.screensList = [OUTPUT, other];
            harness.currentDesktopForOutputOverride = (output) =>
                output === other ? { id: "desktop-middle" } : { id: "desktop-1" };

            harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

            // desktop-middle is visible on the other output and desktop-
            // trailing is the structurally-last domain entry (Q-Domain, and
            // for global-unique unit-03 the structurally-last live desktop):
            // both survive, so nothing is removed.
            assert.deepEqual(
                harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
                [],
            );
        });
    }

    it("keeps switch-cleanup candidates visible on another output, and now also protects the structurally-last trailing empty (shared)", () => {
        const { harness, controller } = modeCleanupSetup("shared");
        configureSwitchCleanupScenario(harness, controller);
        const other = { ...OUTPUT, name: "screen-2" };
        harness.screensList = [OUTPUT, other];
        harness.currentDesktopForOutputOverride = (output) =>
            output === other ? { id: "desktop-middle" } : { id: "desktop-1" };

        harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

        // desktop-middle is visible on the other output, so it is
        // ineligible; desktop-trailing is the structurally-last domain entry
        // (Q-Domain) and is now protected too, so nothing is removed.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            [],
        );
    });

    it("protects occupied and uncertain switch-cleanup snapshots (ownership plays no role)", () => {
        const occupied = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(occupied.harness, occupied.controller);
        occupied.harness.windows = [
            occupied.harness.active,
            window({ desktops: [{ id: "desktop-middle" }], tile: null }),
            window({ desktops: [{ id: "desktop-occupied" }] }),
        ];
        occupied.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        // desktop-middle is occupied by the floating window and survives;
        // desktop-trailing is the structurally-last domain entry (Q-Domain)
        // and is protected too, so nothing is removed.
        assert.deepEqual(
            occupied.harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            [],
            "floating membership occupies its desktop",
        );

        const uncertain = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(uncertain.harness, uncertain.controller);
        uncertain.harness.screensList = {};
        uncertain.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        assert.equal(uncertain.harness.removedDesktops.length, 0, "unreadable visibility stops cleanup");
    });

    it("ignores sticky-only membership during switch cleanup", () => {
        const { harness, controller } = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(harness, controller);
        harness.windows = [
            harness.active,
            window({ onAllDesktops: true, desktops: [{ id: "desktop-middle" }] }),
            window({ desktops: [{ id: "desktop-occupied" }] }),
        ];

        harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);

        // desktop-middle (sticky-only membership ignored, so it reads empty)
        // is removed; desktop-trailing is the structurally-last domain entry
        // (Q-Domain) and is protected.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-middle"],
        );
    });

    it("protects the structurally-last trailing empty, and still keeps the final global desktop after a switch", () => {
        // desktop-trailing is the structurally-last global desktop, so it is
        // now protected as the reserved trailing empty rather than removed.
        const trailing = modeCleanupSetup("shared");
        trailing.harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-trailing", x11DesktopNumber: 2 },
        ];
        trailing.harness.currentDesktop = { id: "desktop-1" };
        trailing.harness.currentDesktopValue = { id: "desktop-1" };
        trailing.harness.currentDesktopForOutputOverride = () => ({ id: "desktop-1" });
        ownCleanupDesktops(trailing.controller, ["desktop-trailing"]);
        trailing.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        assert.deepEqual(
            trailing.harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            [],
        );

        // The sole remaining global desktop is still never removed: with
        // only one entry, it is always the structurally-last (trailing)
        // position, which ensureTrailingEmptyDesktop's own trailing-position
        // exclusion always protects.
        const finalDesktop = modeCleanupSetup("shared");
        finalDesktop.harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        finalDesktop.harness.currentDesktop = { id: "desktop-1" };
        finalDesktop.harness.currentDesktopValue = { id: "desktop-1" };
        finalDesktop.harness.currentDesktopForOutputOverride = () => ({ id: "desktop-1" });
        ownCleanupDesktops(finalDesktop.controller, ["desktop-1"]);
        finalDesktop.harness.emitCurrentDesktopChanged({ id: "desktop-before" }, { id: "desktop-1" }, OUTPUT);
        assert.equal(finalDesktop.harness.removedDesktops.length, 0);
    });

    it("removes an empty invisible middle desktop on a non-switch trigger too (Q7 broadened trigger)", () => {
        // Proves removal now fires from the general cleanupDesktops()
        // dispatcher (here, desktopsChanged/window-removed), not only after a
        // completed workspace switch.
        const { harness, controller } = modeCleanupSetup("per-output-local");
        configureSwitchCleanupScenario(harness, controller);

        harness.emitDesktopsChanged();

        // desktop-middle is removed; desktop-trailing is the structurally-
        // last domain entry (Q-Domain) and is protected.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-middle"],
        );
    });

    it("keeps an owned empty visible on another output", () => {
        const { harness } = setup();
        const candidate = prepareExcessOwnedEmpty(harness);
        const secondOutput = { ...OUTPUT, name: "screen-2" };
        harness.screensList = [OUTPUT, secondOutput];
        harness.currentDesktopForOutputOverride = (output) =>
            output === secondOutput ? { id: candidate } : DESKTOP;

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
    });

    it("defers cleanup when an output current desktop is unreadable", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.currentDesktopForOutputOverride = () => null;

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        // The deferral diagnostic now fires twice: once from cleanupDesktops'
        // own top-level visibility read, and once more from the always-run
        // removal pass re-reading the same still-unreadable visibility.
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:output-visibility-unknown"), 2);
    });

    it("defers cleanup when the global current desktop is invalid", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.currentDesktopValue = null;

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:output-visibility-unknown"), 2);
    });

    it("treats floating non-sticky windows as desktop occupancy", () => {
        const { harness } = setup();
        const candidate = prepareExcessOwnedEmpty(harness);
        harness.windows = [
            harness.active,
            window({ tile: null, desktops: [{ id: candidate }] }),
        ];

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
    });

    it("excludes sticky windows from desktop occupancy", () => {
        const { harness } = setup();
        const candidate = prepareExcessOwnedEmpty(harness);
        // Add a genuine trailing empty desktop-3 after the candidate so the
        // Q-Domain trailing-empty protection does not mask the
        // sticky-exclusion behavior under test: the candidate sits mid-domain
        // and desktop-3 is the protected trailing position.
        harness.desktopsList = [
            ...(harness.desktopsList as unknown[]),
            { id: "desktop-3", x11DesktopNumber: 3 },
        ] as typeof harness.desktopsList;
        harness.windows = [
            harness.active,
            window({ onAllDesktops: true, desktops: [{ id: candidate }] }),
        ];

        harness.emitDesktopsChanged();

        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), [candidate]);
    });

    it("defers cleanup when the window list is invalid", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.windows = {};

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        // Fires twice for the same reason as the visibility-unknown case
        // above: the top-level occupancy read plus the always-run removal
        // pass's own re-read.
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:window-occupancy-unknown"), 2);
    });

    it("defers cleanup when a non-sticky window membership is invalid", () => {
        const { harness } = setup();
        prepareExcessOwnedEmpty(harness);
        harness.windows = [harness.active, window({ desktops: {} })];

        harness.emitDesktopsChanged();

        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:window-occupancy-unknown"), 2);
    });

    it("navigates to an existing 1-based index and never creates on an absent index", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // the overwrite above replaces the list wholesale, so reset the
        // stale create count to isolate this test's own assertions.
        harness.createDesktopCalls.length = 0;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopWrites.length, 1);
        assert.equal((harness.currentDesktopWrites[0] as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-navigate-completed:2"), 1);

        const writes = harness.currentDesktopWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-9");
        assert.equal(harness.currentDesktopWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-navigate-absent:9"), 1);
    });

    it("Meta+0 registers as the stable workspace-0 shortcut in every profile", () => {
        // Spec C/H.4/H.15: the Meta+0 row registers as
        // `plasma-auto-tiler-workspace-0` in every profile and drives the
        // append/focus controller handler; Meta+Shift+0 stays separately
        // registered as move-append.
        for (const key of ["cosmic", "hyprland", "bspwm"] as const) {
            const harness = new Harness();
            harness.configValues.set("shortcutProfile", key);
            new TileController(harness.environment()).start();
            const names = harness.shortcuts.map((entry) => entry.name);
            assert.equal(names.includes("plasma-auto-tiler-workspace-0"), true, key);
            assert.equal(names.includes("plasma-auto-tiler-move-workspace-append"), true, key);
            const meta0 = harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-workspace-0");
            assert.equal(meta0?.sequence, "Meta+0", key);
        }
    });

    it("Meta+Shift+0 reuses the existing trailing empty rather than creating a new one, and cleanup replenishes it once it is occupied", () => {
        const { harness, focused } = setup();
        // ownTrailingEmpty settles to a single owned trailing empty
        // desktop-3 (desktop-2 was created, occupied, replenished by
        // desktop-3, then removed once vacated and invisible - see its own
        // doc comment).
        ownTrailingEmpty(harness);
        harness.removedDesktops.length = 0;
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        const createsBefore = harness.createDesktopCalls.length;
        // Meta+Shift+0 reuses the existing trailing empty desktop-3
        // (Q-Domain) instead of creating a new one, and moves the window
        // into it. desktop-1 stays present (still the harness's per-output
        // current desktop, so it is visible and protected), and desktop-3 is
        // now occupied so its replacement desktop-4 is appended.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-1");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-3",
        ]);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
    });

    it("move to an absent index is a specific no-op with no membership write", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-5");
        assert.equal(countEvent(harness.logs, "workspace-move-absent:5"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual(focused.desktops as unknown[], [DESKTOP]);
    });

    it("moves a tiled window to an existing desktop, writing membership and following", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        const members = (focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id);
        assert.deepEqual(members, ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // The destination adoption is deferred one event-loop turn and never
        // loses the window; flush the queued yield without throwing.
        assert.equal(harness.flushNextYield(), true);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
    });

    it("move to the current desktop is a specific no-op", () => {
        const { harness } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-1");
        assert.equal(countEvent(harness.logs, "workspace-move-no-op:already-there"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
    });

    // Meta+Shift+<digit> never reaches the registered action on QWERTY-family
    // layouts (SHIFT_DIGIT_SYMBOL_ALIAS in controller.ts): KWin's compositor
    // input path strips Shift and delivers the shifted symbol instead. Each
    // move-workspace-N row has a distinct `-symbol` shortcut ID registered
    // under the delivered symbol sequence and dispatching to the identical
    // handler; these tests pin that the alias ID is independently invokable
    // and behaves exactly like the canonical ID, including the
    // `workspace-move-invoked` diagnostic the live diagnosis depends on.
    it("moves a tiled window via the shifted-symbol alias shortcut ID, same as the canonical ID", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2-symbol");
        assert.equal(countEvent(harness.logs, "workspace-move-invoked:2"), 1);
        const members = (focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id);
        assert.deepEqual(members, ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
    });

    it("move-workspace-append-symbol dispatches identically to move-workspace-append", () => {
        const { harness } = setup();
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // the overwrite above replaces the list wholesale, so reset the
        // stale create count to isolate this test's own assertion.
        harness.createDesktopCalls.length = 0;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append-symbol");
        assert.equal(countEvent(harness.logs, "workspace-move-invoked:0"), 1);
        assert.equal(harness.createDesktopCalls.length, 1);
    });

    it("collapses the tiled source leaf synchronously and adopts only on the yielded turn", () => {
        const { harness, root, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        let unmanages = 0;
        let removes = 0;
        target.unmanage = (_value) => {
            unmanages += 1;
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        // Synchronous turn: the freed source leaf is unmanaged and collapsed,
        // the window is untiled and already a member of the target desktop.
        assert.equal(unmanages, 1);
        assert.equal(removes, 1);
        assert.deepEqual(root.tiles, []);
        assert.equal(focused.tile, null);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // Destination adoption is deferred: nothing has adopted yet and the
        // move's one-shot yield is still queued.
        assert.equal(harness.yields.length, 1);
        assert.equal(countEvent(harness.logs, "workspace-move-adopt"), 0);
        // Adoption runs only on the yielded turn and defers the still-floating
        // window into the destination scope's pending reconstruction.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "workspace-move-adopted-deferred:reconstruction"), 1);
        assert.ok(harness.yields.length >= 1);
    });

    it("leaves a moved window floating on the target when destination placement fails", () => {
        const { harness, root, target, focused, controller } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        // No event-loop yield can be armed: the destination scope cannot even
        // start its reconstruction, so adoption must fail closed into a
        // retained-floating placement instead of stranding the window.
        harness.yieldResult = false;
        let unmanages = 0;
        let removes = 0;
        target.unmanage = (_value) => {
            unmanages += 1;
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(unmanages, 1);
        assert.equal(removes, 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-move-adopt-failed:retained-floating"), 1);
        assert.equal(countEvent(harness.logs, "ownership-inert:initial-yield-arm-failed"), 1);
        assert.equal(focused.tile, null);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("honors move-follow when the event-loop yield is unavailable (synchronous fallback)", () => {
        // Regression: the synchronous yieldOnce fallback ran the destination
        // adoption but omitted the follow write, so a tiled move completed
        // without switching the current desktop when yieldOnce was unavailable
        // or failed. The fallback must follow on the moved window's output.
        const { harness, controller, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        harness.yieldResult = false;
        const writesBefore = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(harness.yields.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        // The follow write reaches the moved window's output through the
        // per-output seam even though the yield could not be armed.
        const newWrites = harness.currentDesktopForScreenWrites.slice(writesBefore);
        assert.equal(newWrites.length, 1);
        assert.equal((newWrites[0]?.desktop as { id: string }).id, "desktop-2");
        assert.equal(newWrites[0]?.output, focused.output);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(controller.isEnabled, true);
    });

    it("defers cleanup while a cross-workspace move is unsettled and retries after it settles", () => {
        const { harness, root, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(harness.yields.length, 1);
        // Cleanup triggered while the move is still pending defers it.
        harness.emitDesktopsChanged();
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:move-unsettled"), 1);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:reconstruction-pending"), 0);
        assert.equal(harness.removedDesktops.length, 0);
        // After the move settles, cleanup is no longer deferred by it; the only
        // remaining deferral is the destination scope's pending reconstruction.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:move-unsettled"), 1);
        assert.equal(countEvent(harness.logs, "workspace-cleanup-deferred:reconstruction-pending"), 1);
    });

    it("moves a floating window across workspaces without mutating the tile tree", () => {
        const { harness, root, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        let unmanages = 0;
        let removes = 0;
        let splits = 0;
        target.unmanage = (_value) => {
            unmanages += 1;
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            removes += 1;
            return true;
        };
        target.split = () => {
            splits += 1;
            return [];
        };
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-completed"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-floated"), 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        // The tile tree is untouched: only the float's own single unmanage ran.
        assert.equal(focused.tile, null);
        assert.equal(unmanages, 1);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(harness.yields.length, 0);
    });

    it("refuses to move a sticky window with no membership write or navigation", () => {
        const { harness, target, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
    });

    it("refuses to move a fullscreen window with no membership write or navigation", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        focused.fullScreen = true;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
    });

    it("reports an append create failure without navigating or owning", () => {
        const { harness } = setup();
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the create-failure
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        const ownedBeforeShortcut = countEvent(harness.logs, "workspace-created-owned");
        harness.createDesktopThrows = new Error("create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(countEvent(harness.logs, "workspace-created-owned"), ownedBeforeShortcut);
    });

    it("reports a failed membership write on a tiled move without navigating or arming", () => {
        const { harness, focused } = setup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        Object.defineProperty(focused, "desktops", {
            configurable: true,
            get: () => [DESKTOP],
            set: () => {
                throw new Error("desktops-write-failed");
            },
        });
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-failed:desktops-write"), 1);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("keeps navigation nonfatal when the desktops surface is missing", () => {
        const { harness, controller } = setup();
        harness.desktopsThrows = new Error("kwin-workspace-surface-missing:desktops");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(
            countEvent(harness.logs, "workspace-desktops-unavailable:kwin-workspace-surface-missing:desktops"),
            1,
        );
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps cleanup nonfatal when removeDesktop throws mid-cleanup", () => {
        const { harness, controller } = setup();
        // desktop-3 is the structurally-last domain entry (Q-Domain trailing
        // empty, protected); desktop-2 is a removable non-trailing empty
        // whose throwing removal this test exercises.
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
        ];
        harness.removeDesktopThrows = new Error("remove-failed");
        harness.emitDesktopsChanged();
        assert.equal(countEvent(harness.logs, "workspace-cleanup-remove-failed:remove-failed"), 1);
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("defers desktop mutation during a live drag and performs it after drag completion", () => {
        const { harness, root, target, focused } = setup();
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the deferred-create
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);
        // Shift+0 while the drag is live defers the whole move: the window does
        // not move before its required target exists.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:move"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        // Drag completion drains the request: the trailing empty is created and
        // the window moves into it.
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        // The move's destination adoption settles on its yield, running
        // cleanup: desktop-1 stays present (still the harness's per-output
        // current desktop, so it is visible and protected regardless of
        // occupancy), and desktop-2 (the trailing position) is now occupied,
        // so cleanup appends its replacement trailing empty desktop-3
        // (Q-Domain reuse-and-replenish).
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("defers desktop mutation while a reconstruction is pending and performs it after it settles", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window();
        const second = window();
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        // start() runs cleanupDesktops before this reconstruction is armed
        // (the sole desktop is occupied by first/second, so the fix appends
        // its own replacement trailing empty during that pass); restore the
        // pristine single-desktop precondition this test needs before
        // exercising the reconstruction-pending deferral itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
        // Shift+0 while the reconstruction is pending defers the whole move.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-create-deferred:move"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual((first.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        // Settle the reconstruction; the final pending drop retries cleanup and
        // drains the deferred requests.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.ok(countEvent(harness.logs, "ownership-taken") >= 1);
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((first.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        void controller;
    });

    it("defers Meta+0 creation during a live drag and completes after drag finish", () => {
        // Meta+0 shares the existing settle queue: a required trailing-empty
        // creation during a live drag is queued and completed after drag
        // finish, never acting mid-drag (spec F bounded drain).
        const { harness, focused } = setup();
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the deferred-create
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-deferred"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
    });

    it("defers a repeated Meta+0 during a live drag and reuses the existing trailing empty after drag finish", () => {
        // Meta+0 reuses the active output's existing trailing empty (Q-Zero)
        // rather than creating a new one, even when the invocation was
        // deferred by a live drag: the whole invocation is queued and never
        // navigates away from the drag or mutates the desktop list mid-drag.
        const { harness, focused } = setup();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        const creates = harness.createDesktopCalls.length;
        const completedBefore = countEvent(harness.logs, "workspace-zero-completed");
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-deferred"), 1);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-1");
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), completedBefore + 1);
    });

    it("defers Meta+0 creation while a reconstruction is pending and completes after it settles", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window();
        const second = window();
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        // start() runs cleanupDesktops before this reconstruction is armed
        // (the sole desktop is occupied by first/second, so the fix appends
        // its own replacement trailing empty during that pass); restore the
        // pristine single-desktop precondition this test needs before
        // exercising the reconstruction-pending deferral itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        harness.nextDesktopNumber = 1;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-deferred"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.ok(countEvent(harness.logs, "ownership-taken") >= 1);
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
        void controller;
    });

    it("Meta+0 creation or set-current failure is non-destructive and reason-logged", () => {
        // A createDesktop throw aborts before any write: no desktop is owned,
        // no current changes, and the existing desktop set is retained. The
        // sole desktop is occupied (matching setup()'s fixture), so the fix
        // means start() itself already attempts, and fails, its own
        // replacement-trailing-empty append; createDesktopThrows must be set
        // before start() (a bare Harness, not setup()) so that first attempt
        // is the one that fails, and the shortcut's own attempt afterward is
        // measured as a delta against that baseline.
        const createHarness = new Harness();
        const createRoot = tile(RECT, true);
        const createTarget = tile();
        const createFocused = window({ tile: createTarget });
        createTarget.windows = [createFocused];
        createRoot.tiles = [createTarget];
        createHarness.root = createRoot;
        createHarness.active = createFocused;
        createHarness.windows = [createFocused];
        createHarness.createDesktopThrows = new Error("create-failed");
        const createController = new TileController(createHarness.environment());
        createController.start();
        const failuresBeforeShortcut = countEvent(createHarness.logs, "workspace-append-create-failed:create-failed");
        invokeShortcut(createHarness, "plasma-auto-tiler-workspace-0");
        assert.equal(
            countEvent(createHarness.logs, "workspace-append-create-failed:create-failed"),
            failuresBeforeShortcut + 1,
        );
        assert.equal(createHarness.createDesktopCalls.length, 0);
        assert.equal(createHarness.currentDesktopWrites.length, 0);
        assert.deepEqual(createController.ownedDesktopIdSnapshot(), []);
        assert.equal(createController.isEnabled, true);
        // A set-current throw after a successful create still owns the created
        // desktop and leaves every other desktop untouched (non-destructive).
        const set = setup();
        set.harness.setCurrentDesktopThrows = new Error("set-failed");
        invokeShortcut(set.harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(set.harness.logs, "workspace-navigate-failed:set-failed"), 1);
        assert.deepEqual(set.controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        assert.equal(set.harness.createDesktopCalls.length, 1);
        assert.equal(set.controller.isEnabled, true);
    });

    it("Meta+0 fails safely when the active output has no key and never mutates", () => {
        // A stale/unknown output wrapper resolves to no key (spec E); Meta+0
        // reports the missing key and never creates or writes.
        const { harness } = setup();
        harness.active = window({ output: { ...OUTPUT, name: "screen-unknown" } });
        const writes = harness.currentDesktopForScreenWrites.length;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-absent:output-key"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    it("Meta+0 and Meta+Shift+0 reuse the same existing trailing empty instead of creating separate ones", () => {
        // Under the trailing-empty reuse model both Meta+0 and Meta+Shift+0
        // resolve the same structurally-identified trailing empty
        // (Q-Domain): Meta+0 creates it first, then Shift+0 reuses it rather
        // than creating a second one. Once the window lands there, the next
        // cleanup dispatch appends a replacement trailing empty and removes
        // the now-empty, invisible source desktop.
        const { harness, root, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        harness.currentDesktop = DESKTOP;
        harness.currentDesktopValue = DESKTOP;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        // desktop-1 stays present (still the harness's per-output current
        // desktop, so it is visible and protected regardless of occupancy);
        // desktop-2 is now occupied so its replacement desktop-3 is appended
        // as the new trailing empty.
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("Shift+0 creates the first trailing empty, moves into it, and cleanup replenishes the vacated trailing empty once it settles", () => {
        const { harness, root, target, focused } = setup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        target.remove = () => {
            root.tiles = [];
            return true;
        };
        // Shift+0 creates a brand-new desktop (no existing trailing empty
        // yet) and moves the tiled window into it; membership is written
        // synchronously and the destination adoption is yielded.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
        ]);
        assert.equal(harness.yields.length, 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-2",
        ]);
        assert.equal(harness.flushNextYield(), true);
        // Once the move settles, desktop-1 stays present (still the
        // harness's per-output current desktop, so it is visible and
        // protected), and the now-occupied trailing desktop-2 is replenished
        // with a fresh trailing empty desktop-3.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual(harness.removedDesktops.map((desktop) => (desktop as { id: string }).id), []);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-2",
            "desktop-3",
        ]);
    });

    it("an occupancy event on the trailing empty appends its replacement (COSMIC-style reuse)", () => {
        const { harness } = setup();
        // ownTrailingEmpty settles to a single owned trailing empty
        // desktop-3 (desktop-2 was created, occupied, replenished by
        // desktop-3, then removed once vacated and invisible).
        ownTrailingEmpty(harness);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // A window arrives on the owned trailing empty desktop-3 by any
        // means (here, an external window-added event, not through Meta+0 or
        // Meta+Shift+0): it is now occupied, so the next cleanup dispatch
        // appends exactly one replacement trailing empty desktop-4.
        // desktop-1 stays present (the harness's per-output current
        // desktop), so it is never removed.
        const trailing = { id: "desktop-3", x11DesktopNumber: 3 };
        const incoming = window({ desktops: [trailing] });
        harness.windows = [...(harness.windows as unknown[]), incoming];
        harness.emitAdded(incoming);
        assert.equal(harness.createDesktopCalls.length, 3);
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        assert.equal(harness.createDesktopCalls.length, 3);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
    });

    it("reconciliation is idempotent under repeated triggers", () => {
        const { harness } = setup();
        ownTrailingEmpty(harness);
        assert.equal(harness.createDesktopCalls.length, 2);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // The owned trailing empty desktop-3 is protected (Q-Domain):
        // repeated cleanup dispatches against this unchanged state are a pure
        // no-op, no net creates or removes (spec anti-oscillation guarantee).
        const creates0 = harness.createDesktopCalls.length;
        const removals0 = harness.removedDesktops.length;
        for (let index = 0; index < 4; index += 1) {
            harness.emitDesktopsChanged();
        }
        assert.equal(harness.createDesktopCalls.length, creates0);
        assert.equal(harness.removedDesktops.length, removals0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
        ]);
        // Meta+Shift+0 now reuses the existing trailing empty desktop-3
        // rather than creating a new one; the window is still floating (from
        // ownTrailingEmpty's float-toggle), so the move's cleanup pass runs
        // synchronously. desktop-1 stays present (still the harness's
        // per-output current desktop, so it is visible and protected), and
        // the now-occupied trailing desktop-3 is replenished with desktop-4.
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, creates0 + 1);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        for (let index = 0; index < 4; index += 1) {
            harness.emitDesktopsChanged();
        }
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
    });

    it("a desktop creation failure is non-destructive and reason-logged", () => {
        const { harness, controller } = setup();
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // restore the pristine single-desktop precondition this test needs
        // (no reusable trailing empty) before exercising the create-failure
        // path itself.
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.createDesktopCalls.length = 0;
        // Meta+Shift+0 always creates; a create failure never mutates any
        // desktop membership or list state.
        harness.createDesktopThrows = new Error("create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
        ]);
        assert.equal(controller.isEnabled, true);
    });

    it("cleanup never deletes a current or visible desktop, but does remove a non-trailing empty invisible one", () => {
        const { harness, focused } = setup();
        const origin = focused.tile as unknown as TestTile | null;
        if (origin !== null) {
            origin.unmanage = (_value: unknown) => {
                focused.tile = null;
                origin.windows = [];
                return true;
            };
        }
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
        ];
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends its own replacement trailing empty during start();
        // the overwrite above replaces the list wholesale, so reset the
        // stale create count to isolate this test's own assertion.
        harness.createDesktopCalls.length = 0;
        // The harness generates monotonic ids from here so the first create is
        // desktop-4, never colliding with the pre-existing desktops.
        harness.nextDesktopNumber = 3;
        // Shift+0 reuses the pre-existing trailing empty desktop-3 (no
        // create): it is the last-positioned desktop in the output's local
        // domain and is currently empty.
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, 1);
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-3",
        ]);
        // desktop-1 stays present (still the harness's per-output current
        // desktop, so it is visible and protected regardless of occupancy);
        // desktop-2 is empty, invisible, and has no positional protection, so
        // it is removed; desktop-3 is now occupied so its replacement
        // desktop-4 is appended as the new trailing empty.
        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-2"],
        );
        assert.deepEqual((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id), [
            "desktop-1",
            "desktop-3",
            "desktop-4",
        ]);
        // Repeated dispatches against the settled state are a pure no-op:
        // desktop-1 (visible) and desktop-4 (trailing) both stay protected.
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`stays stable (no oscillation) under interleaved, mixed dispatcher trigger types around a real occupation, in ${mode} mode`, () => {
            const { harness, controller } = modeCleanupSetup(mode);
            const domainSnapshot = (): readonly string[] => {
                if (mode === "per-output-local") {
                    return Object.values(controller.localWorkspaceSnapshot())[0] ?? [];
                }
                if (mode === "global-unique") {
                    return Object.values(controller.globalUniqueAssignmentSnapshot())[0] ?? [];
                }
                return controller.sharedWorkspaceSnapshot();
            };
            // start()'s own fix already appended the sole occupied desktop's
            // replacement trailing empty (desktop-2); this is the
            // precondition every step below must not disturb without cause.
            assert.equal(harness.createDesktopCalls.length, 1);

            // A burst of at least 4 different dispatcher trigger types,
            // fired back-to-back with nothing else changed, must be a pure
            // no-op after every single step (not only before/after the
            // burst as a whole): no caching across dispatches means each
            // trigger independently recomputes and finds nothing eligible.
            const assertNoChurn = (label: string, fire: () => void): void => {
                const createsBefore = harness.createDesktopCalls.length;
                const removalsBefore = harness.removedDesktops.length;
                fire();
                assert.equal(harness.createDesktopCalls.length, createsBefore, `${label}: unexpected create`);
                assert.equal(harness.removedDesktops.length, removalsBefore, `${label}: unexpected remove`);
            };
            assertNoChurn("screensChanged", () => harness.screensChanged?.());
            assertNoChurn("desktopsChanged", () => harness.emitDesktopsChanged());
            assertNoChurn("currentDesktopChanged", () =>
                harness.emitCurrentDesktopChanged(DESKTOP, DESKTOP, OUTPUT),
            );
            assertNoChurn("windowAdded", () => harness.emitAdded(window()));
            assertNoChurn("desktopsChanged (repeat)", () => harness.emitDesktopsChanged());
            assert.deepEqual(domainSnapshot(), ["desktop-1", "desktop-2"]);

            // Genuinely occupy the current trailing empty (desktop-2), then
            // immediately fire a different, unrelated trigger type before
            // any deliberate settle step. Exactly one new desktop must be
            // appended overall: the occupation event itself performs the
            // structural re-read and append synchronously (no debounce), so
            // the very next unrelated trigger must find nothing further to
            // do.
            const trailingBeforeOccupation = harness.createDesktopCalls.length;
            const trailing = { id: "desktop-2", x11DesktopNumber: 2 };
            const incoming = window({ desktops: [trailing] });
            harness.windows = [...(harness.windows as unknown[]), incoming];
            harness.emitAdded(incoming);
            harness.screensChanged?.();
            assert.equal(harness.createDesktopCalls.length, trailingBeforeOccupation + 1);
            assert.equal(harness.removedDesktops.length, 0);
            assert.deepEqual(domainSnapshot(), ["desktop-1", "desktop-2", "desktop-3"]);

            // A further burst of at least 3 more mixed-type triggers,
            // post-settle, must produce zero further net creates or
            // removes: full idempotency under arbitrary trigger mixing, not
            // only repetition of the same trigger.
            assertNoChurn("currentDesktopChanged (post-settle)", () =>
                harness.emitCurrentDesktopChanged(DESKTOP, DESKTOP, OUTPUT),
            );
            assertNoChurn("windowAdded (post-settle)", () => harness.emitAdded(window()));
            assertNoChurn("screensChanged (post-settle)", () => harness.screensChanged?.());
            assert.deepEqual(domainSnapshot(), ["desktop-1", "desktop-2", "desktop-3"]);
        });
    }
});
