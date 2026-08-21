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
    countEvent,
    installDwindleSplitter,
    invokeShortcut,
    modeCleanupSetup,
    ownTrailingEmpty,
    setup,
} from "./controller-fixture-scenarios";

describe("TileController dynamic virtual desktops deferred desktop operations and trailing-empty reconciliation", () => {
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
