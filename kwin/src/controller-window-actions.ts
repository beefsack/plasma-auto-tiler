import {
    assignWindowToTile,
    decodeSequential,
    detachWindowFromTile,
    isCustomTile,
    isRect,
    isWindow,
    manageTile,
    unmanageTile,
    setWindowOnAllDesktops,
    writeWindowFrameGeometry,
    MAX_SEQUENTIAL_LENGTH,
    type RectCapability,
    type StructuralMutationReporter,
    type TileCapability,
    type WindowCapability,
} from "./boundary";
import { type Scope } from "./logic";
import type { OperationLeaf } from "./controller-topology";

const WORK_AREA_CLIENT_AREA_OPTION = 5;
const FLOAT_WORK_AREA_FRACTION = 0.6;

export interface WindowActionScope {
    readonly scope: Scope;
    readonly output: import("./boundary").OutputCapability;
    readonly desktop: import("./boundary").VirtualDesktopCapability;
}

export interface WindowActionScopeResolution {
    readonly scopeForWindow: (window: unknown) => WindowActionScope | null;
    readonly topologyForScope: (
        scope: WindowActionScope,
        onRejected?: (reason: "root-lookup" | "topology-decode") => void,
    ) => readonly OperationLeaf[] | null;
}

export interface WindowTopologyHelpers {
    readonly operationLeafForTile: (topology: readonly OperationLeaf[], tile: TileCapability) => OperationLeaf | null;
    readonly windowInScope: (window: unknown, scope: WindowActionScope) => window is WindowCapability;
    readonly windowIndex: (windows: readonly WindowCapability[], target: WindowCapability) => number;
}

export interface WindowActionEnvironment {
    readonly activeWindow: () => unknown;
    readonly windowList: () => unknown;
    readonly clientArea: (
        option: number,
        output: import("./boundary").OutputCapability,
        desktop: import("./boundary").VirtualDesktopCapability,
    ) => unknown;
}

export interface WindowActionFloatingState {
    readonly isFloating: (window: WindowCapability) => boolean;
    readonly markFloating: (window: WindowCapability, scope: Scope) => void;
    readonly clearFloating: (window: WindowCapability) => void;
    readonly isSticky: (window: WindowCapability) => boolean;
    readonly markSticky: (window: WindowCapability) => void;
    readonly clearSticky: (window: WindowCapability) => void;
    readonly isDetached: (window: WindowCapability) => boolean;
    readonly markDetached: (window: WindowCapability) => void;
    readonly clearDetached: (window: WindowCapability) => void;
}

export interface WindowActionGeometryState {
    readonly remembered: (window: WindowCapability) => RectCapability | undefined;
    readonly remember: (window: WindowCapability, geometry: RectCapability) => void;
}

export interface WindowActionCallbacks {
    readonly afterDetach: (scope: WindowActionScope, origin: TileCapability) => void;
    readonly isMaximized: (window: WindowCapability) => boolean;
    readonly decodedBoundary: (kind: "workspace-window-list") => void;
}

export interface WindowActionDiagnostics {
    readonly diagnostic: (event: string) => void;
}

export interface WindowActionCapabilities {
    readonly environment: WindowActionEnvironment;
    readonly scope: WindowActionScopeResolution;
    readonly topologyHelpers: WindowTopologyHelpers;
    readonly floating: WindowActionFloatingState;
    readonly geometry: WindowActionGeometryState;
    readonly mutation: StructuralMutationReporter;
    readonly callbacks: WindowActionCallbacks;
    readonly diagnostics: WindowActionDiagnostics;
}

export interface WindowActions {
    readonly detachActiveWindow: () => void;
    readonly attachActiveWindow: () => void;
    readonly floatActiveWindow: () => void;
    readonly stickyActiveWindow: () => void;
    readonly fillScope: () => void;
    readonly writeFloatGeometry: (window: WindowCapability, scope: WindowActionScope) => boolean;
}

export function createWindowActions(capabilities: WindowActionCapabilities): WindowActions {
    const { environment, scope, topologyHelpers, floating, geometry, mutation, callbacks, diagnostics } = capabilities;
    const { operationLeafForTile, windowInScope, windowIndex } = topologyHelpers;
    const { diagnostic } = diagnostics;

    const detachActiveWindow = (): void => {
        diagnostic("detach-invoked");
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("detach-rejected:no-active-window");
            return;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("detach-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("detach-rejected:active-window-eligibility");
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => diagnostic(`detach-rejected:${reason}`));
        if (topology === null) {
            return;
        }
        if (active.tile === null) {
            diagnostic("detach-rejected:no-tile");
            return;
        }
        if (!isCustomTile(active.tile)) {
            diagnostic("detach-rejected:active-tile-association");
            return;
        }
        if (active.tile.isLayout) {
            diagnostic("detach-rejected:layout-tile");
            return;
        }
        const origin = operationLeafForTile(topology, active.tile);
        if (origin === null || windowIndex(origin.windows, active) < 0) {
            diagnostic("detach-rejected:occupancy-validity");
            return;
        }
        const originTile = active.tile;
        if (!detachRevalidates(currentScope, active, originTile)) {
            diagnostic("detach-rejected:assignment-stale");
            return;
        }
        let detached = false;
        try {
            detached = detachWindowFromTile(active);
        } catch (error) {
            void error;
            diagnostic("detach-rejected:assignment-failed");
            return;
        }
        if (!detached) {
            diagnostic("detach-rejected:assignment-failed");
            return;
        }
        if (active.tile !== null) {
            diagnostic("detach-failed:postcondition");
            return;
        }
        diagnostic("detach-completed");
        floating.markDetached(active);
        callbacks.afterDetach(currentScope, originTile);
    };

    const attachActiveWindow = (): void => {
        diagnostic("attach-invoked");
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("attach-rejected:no-active-window");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("attach-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("attach-rejected:active-window-eligibility");
            return;
        }
        if (active.tile !== null) {
            diagnostic("attach-rejected:already-assigned");
            return;
        }
        if (floating.isFloating(active)) {
            tileFloatingActive(currentScope, active);
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => diagnostic(`attach-rejected:${reason}`));
        if (topology === null) {
            return;
        }
        const target = firstEmptyLeaf(topology);
        if (target === null) {
            diagnostic("attach-rejected:no-available-tile");
            return;
        }
        if (!attachRevalidates(currentScope, active, target)) {
            diagnostic("attach-rejected:assignment-stale");
            return;
        }
        let assigned = false;
        try {
            assigned = assignWindowToTile(active, target.decoded.tile, mutation);
        } catch (error) {
            void error;
            diagnostic("attach-rejected:assignment-failed");
            return;
        }
        if (!assigned) {
            diagnostic("attach-rejected:assignment-failed");
            return;
        }
        if (active.tile !== target.decoded.tile) {
            diagnostic("attach-failed:postcondition");
            return;
        }
        diagnostic("attach-completed");
        floating.clearDetached(active);
    };

    const floatActiveWindow = (): void => {
        diagnostic("float-invoked");
        const guard = activeActionGuard("float");
        if (guard === null) {
            return;
        }
        if (callbacks.isMaximized(guard.active)) {
            diagnostic("float-rejected:maximized");
            return;
        }
        if (guard.active.tile !== null) {
            if (!isCustomTile(guard.active.tile) || guard.active.tile.isLayout) {
                diagnostic("float-rejected:active-tile-association");
                return;
            }
            floatTiledActive(guard.scope, guard.active);
            return;
        }
        tileFloatingActive(guard.scope, guard.active);
    };

    const stickyActiveWindow = (): void => {
        diagnostic("sticky-invoked");
        const guard = activeActionGuard("sticky");
        if (guard === null) {
            return;
        }
        const { active, scope: currentScope } = guard;
        if (floating.isSticky(active)) {
            if (!clearSticky(active)) {
                diagnostic("sticky-failed:on-all-desktops-write");
                return;
            }
            diagnostic("sticky-disabled");
            return;
        }
        if (callbacks.isMaximized(active)) {
            diagnostic("sticky-rejected:maximized");
            return;
        }
        if (!floating.isFloating(active)) {
            if (active.tile !== null) {
                if (!isCustomTile(active.tile) || active.tile.isLayout) {
                    diagnostic("sticky-rejected:active-tile-association");
                    return;
                }
                floatTiledActive(currentScope, active);
                if (!floating.isFloating(active)) {
                    return;
                }
            } else {
                if (!writeFloatGeometry(active, currentScope)) {
                    diagnostic("sticky-rejected:float-geometry-failed");
                    return;
                }
                floating.markFloating(active, currentScope.scope);
                diagnostic("float-completed");
            }
        }
        if (!pinSticky(active)) {
            diagnostic("sticky-failed:on-all-desktops-write");
            return;
        }
        diagnostic("sticky-enabled");
    };

    const fillScope = (): void => {
        diagnostic("fill-invoked");
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("fill-rejected:no-active-window");
            return;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("fill-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("fill-rejected:active-window-eligibility");
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => diagnostic(`fill-rejected:${reason}`));
        if (topology === null) {
            return;
        }
        const leaves = emptyAuthoredLeaves(topology);
        if (leaves.length === 0) {
            diagnostic("fill-inert:no-leaves");
            return;
        }
        const candidates = fillCandidates(currentScope, active);
        if (candidates === null) {
            diagnostic("fill-rejected:window-list-decode");
            return;
        }
        if (candidates.length === 0) {
            diagnostic("fill-inert:no-candidates");
            return;
        }
        const count = Math.min(leaves.length, candidates.length);
        const plan: Array<{ readonly window: WindowCapability; readonly target: TileCapability }> = [];
        for (let index = 0; index < count; index += 1) {
            const candidate = candidates[index];
            const leaf = leaves[index];
            if (candidate === undefined || leaf === undefined) {
                diagnostic("fill-rejected:preflight");
                return;
            }
            plan.push({ window: candidate, target: leaf.decoded.tile });
        }
        let writes = 0;
        for (const entry of plan) {
            if (!fillAssignmentRevalidates(currentScope, active, entry.window, entry.target)) {
                diagnostic(writes === 0 ? "fill-rejected:assignment-stale" : "fill-partial:assignment-stale");
                return;
            }
            let assigned = false;
            try {
                assigned = assignWindowToTile(entry.window, entry.target, mutation);
            } catch (error) {
                void error;
                diagnostic(writes === 0 ? "fill-rejected:assignment-failed" : "fill-partial:assignment-failed");
                return;
            }
            if (!assigned) {
                diagnostic(writes === 0 ? "fill-rejected:assignment-failed" : "fill-partial:assignment-failed");
                return;
            }
            if (!isWindow(entry.window) || entry.window.tile !== entry.target) {
                diagnostic(writes === 0 ? "fill-failed:postcondition" : "fill-partial:postcondition");
                return;
            }
            writes += 1;
        }
        diagnostic("fill-completed");
    };

    const writeFloatGeometry = (window: WindowCapability, currentScope: WindowActionScope): boolean => {
        const workArea = workAreaForScope(currentScope);
        if (workArea === null) {
            return false;
        }
        const remembered = geometry.remembered(window);
        const next = remembered === undefined ? centeredFloatGeometry(workArea) : boundFloatGeometry(remembered, workArea);
        const written = writeWindowFrameGeometry(window, next);
        geometry.remember(window, next);
        return written;
    };

    function activeActionGuard(action: string): { readonly active: WindowCapability; readonly scope: WindowActionScope } | null {
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic(`${action}-rejected:no-active-window`);
            return null;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return null;
        }
        if (!isWindow(active)) {
            diagnostic(`${action}-rejected:not-a-window`);
            return null;
        }
        if (!active.normalWindow) {
            diagnostic(`${action}-rejected:not-normal-window`);
            return null;
        }
        if (!active.managed) {
            diagnostic(`${action}-rejected:not-managed`);
            return null;
        }
        if (!active.resizeable) {
            diagnostic(`${action}-rejected:not-resizeable`);
            return null;
        }
        if (active.appletPopup) {
            diagnostic(`${action}-rejected:applet-popup`);
            return null;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic(`${action}-rejected:desktop-output-scope`);
            return null;
        }
        return { active, scope: currentScope };
    }

    function floatTiledActive(currentScope: WindowActionScope, active: WindowCapability): void {
        const originTile = active.tile;
        if (originTile === null || !isCustomTile(originTile) || originTile.isLayout) {
            diagnostic("float-rejected:active-tile-association");
            return;
        }
        if (!floatRevalidates(currentScope, active, originTile)) {
            diagnostic("float-rejected:assignment-stale");
            return;
        }
        let unmanaged = false;
        try {
            unmanaged = unmanageTile(originTile, active);
        } catch (error) {
            void error;
            diagnostic("float-rejected:assignment-failed");
            return;
        }
        if (!unmanaged) {
            diagnostic("float-rejected:assignment-failed");
            return;
        }
        if (active.tile !== null) {
            diagnostic("float-failed:postcondition");
            return;
        }
        floating.markFloating(active, currentScope.scope);
        if (!writeFloatGeometry(active, currentScope)) {
            diagnostic("float-geometry-failed");
        }
        diagnostic("float-completed");
    }

    function tileFloatingActive(currentScope: WindowActionScope, active: WindowCapability): void {
        const topology = scope.topologyForScope(currentScope, (reason) => diagnostic(`tile-failed:${reason}`));
        if (topology === null) {
            return;
        }
        const target = firstEmptyLeaf(topology);
        if (target === null) {
            diagnostic("tile-failed:no-available-leaf");
            return;
        }
        if (!tileFloatRevalidates(currentScope, active, target)) {
            diagnostic("tile-failed:assignment-stale");
            return;
        }
        let clearedSticky = false;
        if (floating.isSticky(active)) {
            if (!clearSticky(active)) {
                diagnostic("tile-failed:sticky-clear-failed");
                return;
            }
            clearedSticky = true;
        }
        let managed = false;
        try {
            managed = manageTile(target.decoded.tile, active, mutation);
        } catch (error) {
            void error;
        }
        if (!managed) {
            if (clearedSticky && !pinSticky(active)) {
                diagnostic("tile-failed:sticky-restore-failed");
            }
            diagnostic("tile-failed:assignment-failed");
            return;
        }
        if (clearedSticky) {
            diagnostic("sticky-disabled");
        }
        rememberCurrentFloatGeometry(active);
        floating.clearFloating(active);
        floating.clearDetached(active);
        diagnostic("tile-completed");
    }

    function clearSticky(window: WindowCapability): boolean {
        let cleared = false;
        try {
            cleared = setWindowOnAllDesktops(window, false);
        } catch (error) {
            void error;
        }
        if (!cleared) {
            return false;
        }
        floating.clearSticky(window);
        return true;
    }

    function pinSticky(window: WindowCapability): boolean {
        let pinned = false;
        try {
            pinned = setWindowOnAllDesktops(window, true);
        } catch (error) {
            void error;
        }
        if (!pinned) {
            return false;
        }
        floating.markSticky(window);
        return true;
    }

    function rememberCurrentFloatGeometry(window: WindowCapability): void {
        try {
            const current = window.frameGeometry;
            if (isRect(current) && current.width > 0 && current.height > 0) {
                geometry.remember(window, current);
            }
        } catch (error) {
            void error;
        }
    }

    function detachRevalidates(currentScope: WindowActionScope, active: WindowCapability, originTile: TileCapability): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, currentScope.scope) || !windowInScope(active, freshScope)) {
            return false;
        }
        if (active.tile !== originTile || !isCustomTile(active.tile) || active.tile.isLayout) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshOrigin = operationLeafForTile(topology, originTile);
        return freshOrigin !== null && windowIndex(freshOrigin.windows, active) >= 0;
    }

    function attachRevalidates(currentScope: WindowActionScope, active: WindowCapability, target: OperationLeaf): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, currentScope.scope) || !windowInScope(active, freshScope)) {
            return false;
        }
        if (active.tile !== null) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        return freshTarget !== null && !freshTarget.leaf.isLayout && isCustomTile(freshTarget.decoded.tile) && freshTarget.windows.length === 0;
    }

    function floatRevalidates(currentScope: WindowActionScope, active: WindowCapability, originTile: TileCapability): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, currentScope.scope)) {
            return false;
        }
        if (active.tile !== originTile || !isCustomTile(active.tile) || active.tile.isLayout) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshOrigin = operationLeafForTile(topology, originTile);
        return freshOrigin !== null && windowIndex(freshOrigin.windows, active) >= 0;
    }

    function tileFloatRevalidates(currentScope: WindowActionScope, active: WindowCapability, target: OperationLeaf): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, currentScope.scope) || active.tile !== null) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        return freshTarget !== null && !freshTarget.leaf.isLayout && isCustomTile(freshTarget.decoded.tile) && freshTarget.windows.length === 0;
    }

    function fillAssignmentRevalidates(currentScope: WindowActionScope, active: WindowCapability, candidate: WindowCapability, target: TileCapability): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, currentScope.scope) || !windowInScope(active, freshScope) || !windowInScope(candidate, freshScope) || candidate.tile !== null) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target);
        return freshTarget !== null && !freshTarget.leaf.isLayout && isCustomTile(freshTarget.decoded.tile) && freshTarget.windows.length === 0;
    }

    function firstEmptyLeaf(topology: readonly OperationLeaf[]): OperationLeaf | null {
        for (const entry of topology) {
            if (entry.leaf.isLayout || !isCustomTile(entry.decoded.tile) || entry.windows.length !== 0) {
                continue;
            }
            return entry;
        }
        return null;
    }

    function emptyAuthoredLeaves(topology: readonly OperationLeaf[]): readonly OperationLeaf[] {
        return topology.filter((entry) => !entry.leaf.isLayout && isCustomTile(entry.decoded.tile) && entry.windows.length === 0);
    }

    function fillCandidates(currentScope: WindowActionScope, active: WindowCapability): readonly WindowCapability[] | null {
        const windows = decodeSequential(environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return null;
        }
        callbacks.decodedBoundary("workspace-window-list");
        const candidates = windows.value.filter((window) => windowInScope(window, currentScope) && window.tile === null && !floating.isFloating(window));
        const ordered = [...candidates];
        const anchorIndex = ordered.indexOf(active);
        if (anchorIndex >= 0) {
            const anchor = ordered[anchorIndex];
            if (anchor !== undefined) {
                ordered.splice(anchorIndex, 1);
                ordered.unshift(anchor);
            }
        }
        return Object.freeze(ordered);
    }

    function workAreaForScope(currentScope: WindowActionScope): RectCapability | null {
        let value: unknown;
        try {
            value = environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, currentScope.output, currentScope.desktop);
        } catch (error) {
            void error;
            return null;
        }
        return isRect(value) && value.width > 0 && value.height > 0 ? value : null;
    }

    function centeredFloatGeometry(workArea: RectCapability): RectCapability {
        const width = Math.floor(workArea.width * FLOAT_WORK_AREA_FRACTION);
        const height = Math.floor(workArea.height * FLOAT_WORK_AREA_FRACTION);
        return {
            x: Math.floor(workArea.x + (workArea.width - width) / 2),
            y: Math.floor(workArea.y + (workArea.height - height) / 2),
            width,
            height,
        };
    }

    function boundFloatGeometry(value: RectCapability, workArea: RectCapability): RectCapability {
        const width = Math.min(value.width, workArea.width);
        const height = Math.min(value.height, workArea.height);
        return {
            x: Math.min(Math.max(value.x, workArea.x), workArea.x + workArea.width - width),
            y: Math.min(Math.max(value.y, workArea.y), workArea.y + workArea.height - height),
            width,
            height,
        };
    }

    function sameScope(left: Scope, right: Scope): boolean {
        return left.output === right.output && left.desktopId === right.desktopId;
    }

    return {
        detachActiveWindow,
        attachActiveWindow,
        floatActiveWindow,
        stickyActiveWindow,
        fillScope,
        writeFloatGeometry,
    };
}
