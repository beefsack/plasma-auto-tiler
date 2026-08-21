import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    DESKTOP,
    OUTPUT,
    window,
} from "./controller-fixtures";
import {
    configureSwitchCleanupScenario,
    countEvent,
    modeCleanupSetup,
    ownCleanupDesktops,
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

});
