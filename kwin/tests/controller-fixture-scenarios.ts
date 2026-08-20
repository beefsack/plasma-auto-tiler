import assert from "node:assert/strict";

import {
    DROP_OUTLINE_PREVIEW_CONFIG_KEY,
    TileController,
    WORKSPACE_MODE_CONFIG_KEY,
    type CurrentScope,
} from "../src/controller";
import { type Blueprint } from "../src/layout-blueprint";
import {
    DESKTOP,
    Harness,
    OUTPUT,
    RECT,
    type TestTile,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";

export function setup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly target: TestTile;
    readonly focused: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const target = tile();
    const focused = window({ tile: target });
    target.windows = [focused];
    root.tiles = [target];
    harness.root = root;
    harness.active = focused;
    harness.windows = [focused];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, target, focused };
}

// Create one owned trailing empty through Meta+Shift+0 (creating desktop-2,
// since none exists yet) and move the focused floating window into it, then
// return the window to desktop-1 and let one more cleanup dispatch settle.
// Under the trailing-empty reuse model, landing on desktop-2 immediately
// replenishes a fresh trailing empty desktop-3 (synchronously, since the
// move is floating), and once the window returns to desktop-1, the vacated
// non-trailing desktop-2 is removed on the next dispatch, leaving desktop-3
// as the sole owned trailing empty (Q-Manual: non-trailing empties stay
// cleanup-eligible). Two desktops are created in total (desktop-2, then its
// replacement desktop-3), and one is removed (desktop-2); callers that care
// about the delta since calling this helper should reset
// harness.removedDesktops afterward.
export function ownTrailingEmpty(harness: Harness): void {
    const focused = harness.active as TestWindow;
    const origin = focused.tile as unknown as TestTile | null;
    if (origin !== null) {
        origin.unmanage = (_value: unknown) => {
            focused.tile = null;
            origin.windows = [];
            return true;
        };
    }
    invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
    invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
    focused.desktops = [DESKTOP];
    harness.currentDesktop = DESKTOP;
    harness.currentDesktopValue = DESKTOP;
    harness.emitDesktopsChanged();
}

// A plain two-desktop scenario with desktop-1 current/visible and desktop-2
// empty and invisible, the minimal candidate for cleanup-eligibility tests.
// Ownership plays no role in removal eligibility, so the candidate is not
// marked owned.
export function prepareExcessOwnedEmpty(harness: Harness): string {
    const candidate = { id: "desktop-2", x11DesktopNumber: 2 };
    harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }, candidate];
    harness.currentDesktop = { id: "desktop-1", x11DesktopNumber: 1 };
    harness.currentDesktopValue = { id: "desktop-1", x11DesktopNumber: 1 };
    harness.removedDesktops.length = 0;
    return candidate.id;
}

export function modeCleanupSetup(mode: "per-output-local" | "global-unique" | "shared"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly focused: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const target = tile();
    const focused = window({ tile: target });
    target.windows = [focused];
    root.tiles = [target];
    harness.root = root;
    harness.active = focused;
    harness.windows = [focused];
    harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, mode);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, focused };
}

export function ownCleanupDesktops(controller: TileController, ids: readonly string[]): void {
    const inspectable = controller as unknown as {
        ownedDesktopIds: Set<string>;
        localWorkspaces: Map<string, string[]>;
    };
    for (const id of ids) {
        inspectable.ownedDesktopIds.add(id);
    }
    const key = controller.outputKeyFor(OUTPUT);
    if (key !== undefined) {
        inspectable.localWorkspaces.set(key, ["desktop-1", ...ids]);
    }
}

export function configureSwitchCleanupScenario(
    harness: Harness,
    controller: TileController,
    owned = ["desktop-middle", "desktop-trailing"],
): void {
    const desktop1 = { id: "desktop-1", x11DesktopNumber: 1 };
    const middle = { id: "desktop-middle", x11DesktopNumber: 2 };
    const occupied = { id: "desktop-occupied", x11DesktopNumber: 3 };
    const trailing = { id: "desktop-trailing", x11DesktopNumber: 4 };
    harness.desktopsList = [desktop1, middle, occupied, trailing];
    harness.currentDesktop = desktop1;
    harness.currentDesktopValue = desktop1;
    harness.currentDesktopForOutputOverride = () => desktop1;
    harness.windows = [harness.active, window({ desktops: [occupied] })];
    ownCleanupDesktops(controller, owned);
    const inspectable = controller as unknown as { localWorkspaces: Map<string, string[]> };
    const key = controller.outputKeyFor(OUTPUT);
    if (key !== undefined) {
        inspectable.localWorkspaces.set(key, ["desktop-1", "desktop-middle", "desktop-occupied", "desktop-trailing"]);
    }
}

export function focusSetup(direction: "left" | "down" | "up" | "right"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly focused: TestWindow;
    readonly focusedTile: TestTile;
    readonly neighbor: TestTile;
    readonly neighborWindow: TestWindow;
} {
    const state = setup();
    const geometry =
        direction === "left"
            ? { x: -200, y: 0, width: 100, height: 100 }
            : direction === "right"
              ? { x: 200, y: 0, width: 100, height: 100 }
              : direction === "up"
                ? { x: 0, y: -200, width: 100, height: 100 }
                : { x: 0, y: 200, width: 100, height: 100 };
    const neighbor = tile(geometry);
    const neighborWindow = window({ tile: neighbor });
    neighbor.windows = [neighborWindow];
    state.root.tiles = [state.target, neighbor];
    return {
        harness: state.harness,
        controller: state.controller,
        root: state.root,
        focused: state.focused,
        focusedTile: state.target,
        neighbor,
        neighborWindow,
    };
}

export function moveSetup(direction: "left" | "down" | "up" | "right"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly focused: TestWindow;
    readonly focusedTile: TestTile;
    readonly target: TestTile;
} {
    const state = setup();
    const geometry =
        direction === "left"
            ? { x: -200, y: 0, width: 100, height: 100 }
            : direction === "right"
              ? { x: 200, y: 0, width: 100, height: 100 }
              : direction === "up"
                ? { x: 0, y: -200, width: 100, height: 100 }
                : { x: 0, y: 200, width: 100, height: 100 };
    const target = tile(geometry);
    state.root.tiles = [state.target, target];
    return {
        harness: state.harness,
        controller: state.controller,
        root: state.root,
        focused: state.focused,
        focusedTile: state.target,
        target,
    };
}

// Occupied directional target for a swap: the active window in `source` and a
// second in-scope window in `target`, both with the attach tile writer installed
// so guarded `window.tile` writes maintain the tile window lists exactly as
// setTileCompatibility does on KWin. The shared `writes` array records every
// guarded write in deterministic order.
export function swapSetup(direction: "left" | "down" | "up" | "right"): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly source: TestTile;
    readonly target: TestTile;
    readonly active: TestWindow;
    readonly occupant: TestWindow;
    readonly writes: Array<{ window: TestWindow; target: object | null }>;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const geometry =
        direction === "left"
            ? { x: -200, y: 0, width: 100, height: 100 }
            : direction === "right"
              ? { x: 200, y: 0, width: 100, height: 100 }
              : direction === "up"
                ? { x: 0, y: -200, width: 100, height: 100 }
                : { x: 0, y: 200, width: 100, height: 100 };
    const source = tile();
    const target = tile(geometry);
    const active = window({ tile: source });
    const occupant = window({ tile: target });
    source.windows = [active];
    target.windows = [occupant];
    root.tiles = [source, target];
    harness.root = root;
    harness.active = active;
    harness.windows = [active, occupant];
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(active, writes);
    attachTileWriter(occupant, writes);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, source, target, active, occupant, writes };
}

export function presetSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly source: TestTile;
    readonly active: TestWindow;
    readonly early: TestTile;
    readonly late: TestTile;
    readonly earlyWindow: TestWindow;
    readonly lateWindow: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const source = tile();
    const early = tile({ x: 200, y: 0, width: 100, height: 100 });
    const late = tile({ x: 300, y: 0, width: 100, height: 100 });
    const active = window({ tile: source });
    const earlyWindow = window({ tile: early });
    const lateWindow = window({ tile: late });
    source.windows = [active];
    early.windows = [earlyWindow];
    late.windows = [lateWindow];
    root.tiles = [early, source, late];
    harness.root = root;
    harness.active = active;
    harness.windows = [active, earlyWindow, lateWindow];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, source, active, early, late, earlyWindow, lateWindow };
}

export function configureThreeOccupantPreset(
    state: ReturnType<typeof presetSetup>,
    target: TestTile = state.source,
): {
    readonly directions: number[];
    readonly managed: unknown[];
    readonly left: TestTile;
    readonly middle: TestTile;
    readonly right: TestTile;
    readonly branch: TestTile;
} {
    const directions: number[] = [];
    const managed: unknown[] = [];
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        managed.push(value);
        const subject = value as TestWindow;
        if (subject.tile !== target && subject.tile !== null) {
            (subject.tile as TestTile).windows = [];
        }
        subject.tile = leaf;
        leaf.windows = [subject];
        return true;
    };
    const left = tile({ x: 0, y: 0, width: 33, height: 100 });
    const middle = tile({ x: 33, y: 0, width: 33, height: 100 });
    const right = tile({ x: 66, y: 0, width: 34, height: 100 });
    left.manage = manage(left);
    middle.manage = manage(middle);
    right.manage = manage(right);
    const branch = tile({ x: 33, y: 0, width: 67, height: 100 }, true);
    branch.split = (direction) => {
        directions.push(direction);
        branch.tiles = [middle, right];
        return [middle, right];
    };
    target.split = (direction) => {
        directions.push(direction);
        target.isLayout = true;
        target.windows = [];
        target.tiles = [left, branch];
        return [left, branch];
    };
    return { directions, managed, left, middle, right, branch };
}

// Floating active window with an occupied leaf, a layout branch, and an
// empty leaf beneath the exact scope root. `root.tiles` ordering is chosen so
// the decoded traversal reaches the layout branch and occupied leaf before the
// empty leaf, proving deterministic skipping.
export function attachSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly empty: TestTile;
    readonly occupied: TestTile;
    readonly layout: TestTile;
    readonly active: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const layout = tile(RECT, true);
    const occupied = tile();
    const occupiedWindow = window({ tile: occupied });
    occupied.windows = [occupiedWindow];
    const empty = tile();
    const active = window();
    // LIFO traversal reaches layout (skipped), then occupied (skipped), then
    // empty (selected), proving deterministic first-empty selection.
    root.tiles = [empty, occupied, layout];
    harness.root = root;
    harness.active = active;
    harness.windows = [occupiedWindow, active];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, empty, occupied, layout, active };
}

// Floating active and other in-scope unassigned windows plus three empty
// leaves, an occupied leaf, a layout leaf, and a generic (non-Custom) leaf
// beneath the exact scope root. `root.tiles` ordering is chosen so the decoded
// LIFO traversal reaches leaves in a deterministic order with the generic,
// layout, and occupied leaves interleaved for skipping: first, generic, layout,
// second, occupied, third.
export function fillSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly first: TestTile;
    readonly second: TestTile;
    readonly third: TestTile;
    readonly occupied: TestTile;
    readonly layout: TestTile;
    readonly generic: object;
    readonly active: TestWindow;
    readonly otherA: TestWindow;
    readonly otherB: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const first = tile();
    const second = tile();
    const third = tile();
    const occupied = tile();
    const occupiedWindow = window({ tile: occupied });
    occupied.windows = [occupiedWindow];
    const layout = tile(RECT, true);
    const generic = tile();
    const { layoutDirection: ignoredDirection, split: ignoredSplit, ...nonCustom } = generic;
    void ignoredDirection;
    void ignoredSplit;
    const active = window();
    const otherA = window();
    const otherB = window();
    root.tiles = [third, occupied, second, layout, nonCustom, first];
    harness.root = root;
    harness.active = active;
    harness.windows = [otherA, active, otherB];
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, first, second, third, occupied, layout, generic: nonCustom, active, otherA, otherB };
}

export function currentScopeFor(active: TestWindow): CurrentScope {
    const output = active.output;
    if (output === null) {
        throw new Error("test window has no output");
    }
    return {
        output,
        desktop: DESKTOP,
        scope: { output, desktopId: DESKTOP.id },
    };
}

export function invokeShortcut(harness: Harness, name: string): void {
    const shortcut = harness.shortcuts.find((entry) => entry.name === name);
    if (shortcut === undefined) {
        throw new Error(`missing registered shortcut: ${name}`);
    }
    shortcut.handler();
}

// Simulates KWin's tile window-list maintenance on a guarded `window.tile`
// write (the attach half of setTileCompatibility): the window leaves the
// previous tile's window list and joins the target's. Each write is recorded
// so tests can assert deterministic order and count.
export function attachTileWriter(subject: TestWindow, writes: Array<{ window: TestWindow; target: object | null }> = []): void {
    let current: object | null = subject.tile;
    Object.defineProperty(subject, "tile", {
        configurable: true,
        get: () => current,
        set: (next: object | null) => {
            writes.push({ window: subject, target: next });
            const previous = current;
            current = next;
            if (previous !== null && previous !== next) {
                (previous as TestTile).windows = ((previous as TestTile).windows as TestWindow[]).filter(
                    (value) => value !== subject,
                );
            }
            if (next !== null) {
                (next as TestTile).windows = [
                    ...((next as TestTile).windows as TestWindow[]).filter((value) => value !== subject),
                    subject,
                ];
            }
        },
    });
}
export function dragSetup(dropOutlinePreview = false): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly origin: TestTile;
    readonly target: TestTile;
    readonly dragged: TestWindow;
    readonly targetWindow: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const origin = tile();
    const target = tile({ x: 200, y: 0, width: 100, height: 100 });
    const dragged = window({ tile: origin });
    const targetWindow = window({ tile: target });
    origin.windows = [dragged];
    target.windows = [targetWindow];
    root.tiles = [origin, target];
    harness.root = root;
    harness.active = dragged;
    harness.windows = [dragged, targetWindow];
    harness.configValues.set(DROP_OUTLINE_PREVIEW_CONFIG_KEY, dropOutlinePreview);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, origin, target, dragged, targetWindow };
}

// Owned dwindle(3) scope realizing H[term1, V[term2, term3]], with the drop
// target term1 split-ready and the vacated origin term2 removable. The scope is
// adopted unchanged on start (ownership-taken, no yields), so a later native
// Shift drop models the accepted three-window example.
export function nativeDropSetup(dropOutlinePreview = false): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly term1: TestTile;
    readonly right: TestTile;
    readonly term2: TestTile;
    readonly term3: TestTile;
    readonly top: TestTile;
    readonly bottom: TestTile;
    readonly term1Win: TestWindow;
    readonly term2Win: TestWindow;
    readonly term3Win: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const term1 = tile({ x: 0, y: 0, width: 100, height: 100 });
    const right = tile({ x: 100, y: 0, width: 100, height: 100 }, true);
    right.layoutDirection = 2;
    const term2 = tile({ x: 100, y: 0, width: 100, height: 50 });
    const term3 = tile({ x: 100, y: 50, width: 100, height: 50 });
    const term1Win = window({ tile: term1, caption: "term1" });
    const term2Win = window({ tile: term2, caption: "term2" });
    const term3Win = window({ tile: term3, caption: "term3" });
    term1.windows = [term1Win];
    term2.windows = [term2Win];
    term3.windows = [term3Win];
    root.tiles = [term1, right];
    right.tiles = [term2, term3];
    harness.root = root;
    harness.active = term1Win;
    harness.windows = [term1Win, term2Win, term3Win];
    harness.configValues.set(DROP_OUTLINE_PREVIEW_CONFIG_KEY, dropOutlinePreview);
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(term1Win, writes);
    attachTileWriter(term2Win, writes);
    attachTileWriter(term3Win, writes);
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    const top = tile({ x: 0, y: 0, width: 100, height: 50 });
    const bottom = tile({ x: 0, y: 50, width: 100, height: 50 });
    top.manage = manage(top);
    bottom.manage = manage(bottom);
    term1.split = (direction) => {
        term1.isLayout = true;
        term1.layoutDirection = direction;
        term1.windows = [];
        term1.tiles = [top, bottom];
        return [top, bottom];
    };
    term2.manage = manage(term2);
    term2.remove = () => {
        right.tiles = (right.tiles as TestTile[]).filter((entry) => entry !== term2);
        // KWin promotes a single-child layout after a tile removal: the vacated
        // V-wrapper disappears and term3 becomes the root's direct right child,
        // realizing the whole accepted tree H[V[term1, term2], term3].
        if ((right.tiles as TestTile[]).length === 1) {
            const sole = (right.tiles as TestTile[])[0];
            if (sole !== undefined) {
                root.tiles = (root.tiles as TestTile[]).map((entry) => (entry === right ? sole : entry));
            }
        }
        return true;
    };
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, term1, right, term2, term3, top, bottom, term1Win, term2Win, term3Win };
}

export function collectLeaves(tile: TestTile): TestTile[] {
    if (!tile.isLayout) {
        return [tile];
    }
    const result: TestTile[] = [];
    for (const child of tile.tiles as TestTile[]) {
        result.push(...collectLeaves(child));
    }
    return result;
}

export function startDrag(dragged: TestWindow): void {
    dragged.move = true;
    dragged.resize = false;
    dragged.interactiveMoveResizeStarted.emit();
    dragged.move = false;
}

export function movedGeometry(): typeof RECT {
    return { x: 10, y: 10, width: 100, height: 100 };
}

export function countEvent(logs: readonly string[], event: string): number {
    return logs.filter((entry) => entry === `plasma-auto-tiler:${event}`).length;
}

// A dwindle(2) scope H[a, b] where dragging `a` onto `b` with a left-horizontal
// split leaves `a` floating (the drop manage reports success but never
// assigns), so the occupancy bijection fails on the origin collapse and queues
// a full reconstruction instead of the steady-state acceptance path.
export function reconstructDropSetup(): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly a: TestTile;
    readonly b: TestTile;
    readonly bLeft: TestTile;
    readonly bRight: TestTile;
    readonly aWin: TestWindow;
    readonly bWin: TestWindow;
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const a = tile({ x: 0, y: 0, width: 100, height: 100 });
    const b = tile({ x: 100, y: 0, width: 100, height: 100 });
    const aWin = window({ tile: a, caption: "a" });
    const bWin = window({ tile: b, caption: "b" });
    a.windows = [aWin];
    b.windows = [bWin];
    root.tiles = [a, b];
    harness.root = root;
    harness.active = aWin;
    harness.windows = [aWin, bWin];
    attachTileWriter(aWin);
    attachTileWriter(bWin);
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    // The dragged window's split child reports manage success without actually
    // assigning, so the drop completes with `aWin` still floating and its
    // reflow leaf empty. The occupancy bijection then fails on settle and the
    // invariant queues the full reconstruction this fixture exists to exercise.
    const bLeft = tile({ x: 100, y: 0, width: 50, height: 100 });
    const bRight = tile({ x: 150, y: 0, width: 50, height: 100 });
    bLeft.manage = () => true;
    bRight.manage = manage(bRight);
    b.split = (direction) => {
        b.isLayout = true;
        b.layoutDirection = direction;
        b.windows = [];
        b.tiles = [bLeft, bRight];
        return [bLeft, bRight];
    };
    a.remove = () => {
        root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
        return true;
    };
    bLeft.remove = () => {
        b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bLeft);
        return true;
    };
    bRight.remove = () => {
        b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bRight);
        return true;
    };
    b.remove = () => {
        root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== b);
        return true;
    };
    installDwindleSplitter(root);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, a, b, bLeft, bRight, aWin, bWin };
}
// Install a splitter that mirrors KWin's dwindle chain construction: each
// split turns the tile into a layout with two children whose geometry follows
// the requested orientation (1 = horizontal, 2 = vertical), and installs the
// same splitter on both children so the chain can keep growing.
export function installDwindleSplitter(tile: TestTile): void {
    tile.split = (direction) => {
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        const horizontal = direction === 1;
        const childA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const childB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        installDwindleSplitter(childA);
        installDwindleSplitter(childB);
        tile.tiles = [childA, childB];
        return [childA, childB];
    };
}
// Install a configurable splitter that models the KWin minimum-geometry
// boundary. While `state.rejecting` is true it yields a split result whose
// children carry invalid geometry (the strict `orderedChildren` check rejects
// the pair) and does not realize the split in the live tree, so a capacity
// rejection leaves the scope structurally unchanged and retryable. When
// `state.rejecting` is false it behaves exactly like `installDwindleSplitter`,
// realizing a valid dwindle chain.
export function installCapacityRejectingSplitter(tile: TestTile, state: { rejecting: boolean }): void {
    tile.split = (direction) => {
        const horizontal = direction === 1;
        const validA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const validB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        if (state.rejecting) {
            // KWin minimum geometry can yield an empty child: the first child
            // has zero width, so `orderedChildren` must reject the pair.
            return [makeTile({ x: 0, y: 0, width: 0, height: 100 }), validB];
        }
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        installDwindleSplitter(validA);
        installDwindleSplitter(validB);
        tile.tiles = [validA, validB];
        return [validA, validB];
    };
}
export function makeTile(geometry = RECT, isLayout = false): TestTile {
    return tile(geometry, isLayout);
}
// Install a splitter that returns placeholder children whose own split()
// throws, while realizing the live tree with distinct children under
// `tile.tiles`. A rebuild that retains a returned child handle and splits it
// on a later structural call fails here; the guarded rebuild re-resolves the
// root and fresh-decodes `tile.tiles` after every split, so it succeeds.
export function installStaleReturnSplitter(tile: TestTile): void {
    tile.split = (direction) => {
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        const horizontal = direction === 1;
        const liveA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const liveB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        installStaleReturnSplitter(liveA);
        installStaleReturnSplitter(liveB);
        tile.tiles = [liveA, liveB];
        const staleA = makeTile();
        const staleB = makeTile();
        staleA.split = () => {
            throw new Error("stale returned child handle split");
        };
        staleB.split = () => {
            throw new Error("stale returned child handle split");
        };
        return [staleA, staleB];
    };
}
// Structural shape check: the live tree must realize the dwindle blueprint
// exactly, with the first decoded child as the blueprint's left subtree and
// the second as its right subtree, and orientation alternating from a
// horizontal root at depth zero.
export function assertDwindleShape(tile: TestTile, blueprint: Blueprint, depth: number): void {
    if (blueprint.kind === "leaf") {
        assert.equal(tile.isLayout, false);
        return;
    }
    assert.equal(tile.isLayout, true);
    assert.equal(tile.layoutDirection, depth % 2 === 0 ? 1 : 2);
    const children = tile.tiles as TestTile[];
    assert.equal(children.length, 2);
    const left = children[0];
    const right = children[1];
    assert.ok(left !== undefined && right !== undefined);
    assertDwindleShape(left, blueprint.left, depth + 1);
    assertDwindleShape(right, blueprint.right, depth + 1);
}
// Structural shape check for any preset blueprint: the live tree must realize
// the blueprint exactly, with the first decoded child as the left subtree and
// the second as its right subtree, and each branch carrying the orientation the
// blueprint node itself declares.
export function assertPresetShape(tile: TestTile, blueprint: Blueprint): void {
    if (blueprint.kind === "leaf") {
        assert.equal(tile.isLayout, false);
        return;
    }
    assert.equal(tile.isLayout, true);
    assert.equal(tile.layoutDirection, blueprint.orientation === "horizontal" ? 1 : 2);
    const children = tile.tiles as TestTile[];
    assert.equal(children.length, 2);
    const left = children[0];
    const right = children[1];
    assert.ok(left !== undefined && right !== undefined);
    assertPresetShape(left, blueprint.left);
    assertPresetShape(right, blueprint.right);
}
