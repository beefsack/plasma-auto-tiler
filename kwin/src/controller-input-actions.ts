import {
    decodeSequential,
    assignWindowToTile,
    isCustomTile,
    isNativelyMaximized,
    isRect,
    isTile,
    isWindow,
    MAX_SEQUENTIAL_LENGTH,
    manageTile,
    setTileRelativeGeometry,
    splitCustomTile,
    type CustomTileCapability,
    type RectCapability,
    type StructuralMutationReporter,
    type TileCapability,
    type WindowCapability,
} from "./boundary";
import { customTileSplitSeam } from "./custom-tile-split";
import {
    findNeighborLeaf,
    planKeyboardInsertion,
    RELATIVE_GEOMETRY_EPSILON,
    type Direction,
    type Scope,
    type SplitAxis,
} from "./logic";
import type { OperationLeaf, TargetOccupant } from "./controller-topology";

const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;
const MINIMUM_TILE_FRACTION = 0.15;
const RESIZE_STEP_FRACTION = 0.05;
const WORK_AREA_CLIENT_AREA_OPTION = 5;

type TopologyRejection = "root-lookup" | "topology-decode";

export interface InputScope {
    readonly scope: Scope;
    readonly output: import("./boundary").OutputCapability;
    readonly desktop: import("./boundary").VirtualDesktopCapability;
}

export interface InputScopeResolution {
    readonly scopeForWindow: (window: unknown) => InputScope | null;
    readonly topologyForScope: (
        scope: InputScope,
        onRejected?: (reason: TopologyRejection) => void,
    ) => readonly OperationLeaf[] | null;
}

export interface InputTopologyHelpers {
    readonly operationLeafForTile: (topology: readonly OperationLeaf[], tile: TileCapability) => OperationLeaf | null;
    readonly targetOccupantForActive: (target: OperationLeaf, active: WindowCapability) => TargetOccupant | null;
    readonly windowInScope: (window: unknown, scope: InputScope) => window is WindowCapability;
    readonly windowIndex: (windows: readonly WindowCapability[], target: WindowCapability) => number;
}

export interface InputGeometryHelpers {
    readonly parentHasSameSplitAxis: (tile: CustomTileCapability, axis: SplitAxis) => boolean;
    readonly splitDirection: (direction: Direction) => number;
}

export interface InputEnvironment {
    readonly activeWindow: () => unknown;
    readonly setActiveWindow: (window: WindowCapability) => void;
    readonly clientArea: (
        option: number,
        output: import("./boundary").OutputCapability,
        desktop: import("./boundary").VirtualDesktopCapability,
    ) => unknown;
    readonly onPendingTargetChanged: (window: WindowCapability, handler: () => void) => () => void;
}

export interface InputPending {
    readonly current: () => PendingKeyboard | undefined;
    readonly replace: (pending: PendingKeyboard) => void;
    readonly clear: () => void;
}

export interface InputFloatingState {
    readonly markFloating: (window: WindowCapability, scope: Scope) => void;
}

export interface InputDiagnostics {
    readonly diagnostic: (event: string) => void;
    readonly disable: (reason: string) => void;
    readonly decodedBoundary: (kind: "split-result") => void;
}

export interface InputActionCapabilities {
    readonly environment: InputEnvironment;
    readonly scope: InputScopeResolution;
    readonly topologyHelpers: InputTopologyHelpers;
    readonly geometryHelpers: InputGeometryHelpers;
    readonly pending: InputPending;
    readonly floating: InputFloatingState;
    readonly mutation: StructuralMutationReporter;
    readonly diagnostics: InputDiagnostics;
}

export interface PendingKeyboard {
    readonly scope: InputScope;
    readonly sourceWindow: WindowCapability;
    readonly targetWindow: WindowCapability;
    readonly targetTile: TileCapability;
    readonly direction: Direction;
    readonly disconnect: () => void;
}

export interface InputActions {
    readonly armKeyboardInsertion: (direction: Direction) => void;
    readonly completeKeyboardInsertion: (window: unknown, pending: PendingKeyboard) => void;
    readonly focusNeighbor: (direction: Direction) => void;
    readonly moveActiveWindow: (direction: Direction) => void;
    readonly focusOrResize: (direction: Direction) => void;
    readonly enterOrExitResizeMode: (mode: "outwards" | "inwards") => void;
    readonly resizeModeSnapshot: () => { readonly active: boolean; readonly direction: "outwards" | "inwards" };
    readonly resizeActiveWindow: (direction: Direction, mode: "outwards" | "inwards") => void;
}

export function createInputActions(capabilities: InputActionCapabilities): InputActions {
    const { environment, scope, topologyHelpers, geometryHelpers, pending, floating, mutation, diagnostics } = capabilities;
    const { operationLeafForTile, targetOccupantForActive, windowInScope, windowIndex } = topologyHelpers;
    const { parentHasSameSplitAxis, splitDirection } = geometryHelpers;
    const { diagnostic, disable } = diagnostics;
    let resizeModeActive = false;
    let resizeModeDirection: "outwards" | "inwards" = "outwards";

    const resizeModeSnapshot = (): { readonly active: boolean; readonly direction: "outwards" | "inwards" } => ({
        active: resizeModeActive,
        direction: resizeModeDirection,
    });

    const armKeyboardInsertion = (direction: Direction): void => {
        diagnostic("keyboard-invoked");
        const hadPending = pending.current() !== undefined;
        pending.clear();
        if (hadPending) {
            diagnostic("keyboard-pending-replaced");
        }
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("keyboard-rejected:no-active-window");
            return;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("keyboard-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("keyboard-rejected:active-window-eligibility");
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => {
            diagnostic(`keyboard-rejected:${reason}`);
        });
        if (topology === null || active.tile === null || !isTile(active.tile)) {
            if (topology !== null) {
                diagnostic("keyboard-rejected:active-tile-association");
            }
            return;
        }
        const target = operationLeafForTile(topology, active.tile);
        if (target === null || target.leaf.isLayout) {
            diagnostic("keyboard-rejected:target-occupancy-validity");
            return;
        }
        for (const occupant of target.windows) {
            if (!windowInScope(occupant, currentScope)) {
                diagnostic("keyboard-rejected:target-occupancy-validity");
                return;
            }
        }
        const targetOccupant = targetOccupantForActive(target, active);
        if (targetOccupant === null) {
            diagnostic("keyboard-rejected:target-occupancy-validity");
            return;
        }
        const disconnect = environment.onPendingTargetChanged(targetOccupant.window, () => pending.clear());
        pending.replace({
            scope: currentScope,
            sourceWindow: active,
            targetWindow: targetOccupant.window,
            targetTile: active.tile,
            direction,
            disconnect,
        });
        if (!targetOccupant.usesActiveWrapper) {
            diagnostic("keyboard-armed:target-occupant-wrapper");
        }
        diagnostic("keyboard-armed");
    };

    const completeKeyboardInsertion = (window: unknown, record: PendingKeyboard): void => {
        const active = environment.activeWindow();
        const activeScope = scope.scopeForWindow(active);
        const windowScope = scope.scopeForWindow(window);
        if (
            activeScope === null ||
            windowScope === null ||
            !sameScope(activeScope.scope, record.scope.scope) ||
            !sameScope(windowScope.scope, record.scope.scope) ||
            !windowInScope(active, activeScope) ||
            !windowInScope(window, windowScope) ||
            !windowInScope(record.targetWindow, windowScope) ||
            active.tile !== record.targetTile
        ) {
            return;
        }
        if (window.fullScreen === true || active.fullScreen === true || record.targetWindow.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        const topology = scope.topologyForScope(windowScope);
        if (topology === null) {
            return;
        }
        const target = operationLeafForTile(topology, record.targetTile);
        if (target === null || target.leaf.isLayout || !isCustomTile(target.decoded.tile)) {
            return;
        }
        const targetIndex = windowIndex(target.windows, record.targetWindow);
        if (targetIndex < 0) {
            return;
        }
        for (const occupant of target.windows) {
            if (!windowInScope(occupant, windowScope)) {
                return;
            }
        }
        const focused = target.refs[targetIndex];
        if (focused === undefined) {
            return;
        }
        const plan = planKeyboardInsertion({
            scope: windowScope.scope,
            direction: record.direction,
            focusedLeaf: target.leaf,
            focusedWindow: focused,
            incoming: { id: "incoming", normal: window.normalWindow, managed: window.managed },
            record: { scope: windowScope.scope, leafId: target.leaf.id, windowId: focused.id },
        });
        if (!plan.ok) {
            return;
        }
        const requestedAxis: SplitAxis = record.direction === "left" || record.direction === "right" ? "x" : "y";
        if (parentHasSameSplitAxis(target.decoded.tile, requestedAxis)) {
            floating.markFloating(window, windowScope.scope);
            diagnostic("keyboard-rejected:same-axis-parent");
            return;
        }
        splitCustomTile(target.decoded.tile, splitDirection(record.direction), mutation);
        const decoded = decodeSequential(target.decoded.tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
        if (!decoded.ok) {
            disable("keyboard-split-result-invalid");
            return;
        }
        diagnostics.decodedBoundary("split-result");
        const children = customTileSplitSeam.decodeChildren(target.decoded.tile);
        const first = children?.[0];
        const second = children?.[1];
        if (children === null || children.length !== 2 || first === undefined || second === undefined) {
            disable("keyboard-split-child-selection-failed");
            return;
        }
        const occupantChild = record.direction === "left" || record.direction === "up" ? second : first;
        const incomingChild = occupantChild === first ? second : first;
        if (!manageTile(occupantChild, record.targetWindow, mutation)) {
            diagnostic("keyboard-failed:first-assignment");
            return;
        }
        if (!manageTile(incomingChild, window, mutation)) {
            diagnostic("keyboard-failed:second-assignment");
            return;
        }
        diagnostic("keyboard-completed");
    };

    const focusNeighbor = (direction: Direction): void => {
        diagnostic("focus-invoked");
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("focus-rejected:no-active-window");
            return;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("focus-rejected:fullscreen");
            return;
        }
        if (isWindow(active) && active.onAllDesktops === true) {
            diagnostic("focus-rejected:sticky");
            return;
        }
        if (isWindow(active) && isNativelyMaximized(active)) {
            diagnostic("focus-rejected:maximized");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("focus-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("focus-rejected:active-window-eligibility");
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => {
            diagnostic(`focus-rejected:${reason}`);
        });
        if (topology === null || active.tile === null || !isTile(active.tile)) {
            if (topology !== null) {
                diagnostic("focus-rejected:active-tile-association");
            }
            return;
        }
        const focused = operationLeafForTile(topology, active.tile);
        if (
            focused === null ||
            focused.leaf.isLayout ||
            focused.windows.length === 0 ||
            windowIndex(focused.windows, active) < 0
        ) {
            diagnostic("focus-rejected:focused-occupancy-validity");
            return;
        }
        for (const occupant of focused.windows) {
            if (!windowInScope(occupant, currentScope)) {
                diagnostic("focus-rejected:focused-occupancy-validity");
                return;
            }
        }
        const candidates = topology
            .filter(
                (entry) =>
                    !entry.leaf.isLayout &&
                    entry.windows.length > 0 &&
                    entry.windows.every((occupant) => windowInScope(occupant, currentScope)),
            )
            .map((entry) => entry.leaf);
        const neighborLeaf = findNeighborLeaf(candidates, focused.leaf, direction);
        if (neighborLeaf === null) {
            diagnostic("focus-rejected:no-neighbor");
            return;
        }
        const target = topology.find((entry) => entry.leaf === neighborLeaf);
        if (target === undefined || target.leaf.isLayout || target.windows.length === 0) {
            diagnostic("focus-rejected:target-occupancy-validity");
            return;
        }
        for (const occupant of target.windows) {
            if (!windowInScope(occupant, currentScope)) {
                diagnostic("focus-rejected:target-occupancy-validity");
                return;
            }
        }
        const targetWindow = target.windows[0];
        if (targetWindow === undefined) {
            diagnostic("focus-rejected:target-occupancy-validity");
            return;
        }
        environment.setActiveWindow(targetWindow);
    };

    const moveActiveWindow = (direction: Direction): void => {
        diagnostic("move-invoked");
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("move-rejected:no-active-window");
            return;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (isWindow(active) && active.onAllDesktops === true) {
            diagnostic("move-rejected:sticky");
            return;
        }
        if (isWindow(active) && isNativelyMaximized(active)) {
            diagnostic("move-rejected:maximized");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("move-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("move-rejected:active-window-eligibility");
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => {
            diagnostic(`move-rejected:${reason}`);
        });
        if (topology === null || active.tile === null || !isTile(active.tile)) {
            if (topology !== null) {
                diagnostic("move-rejected:active-tile-association");
            }
            return;
        }
        const source = operationLeafForTile(topology, active.tile);
        if (
            source === null ||
            source.leaf.isLayout ||
            source.windows.length !== 1 ||
            windowIndex(source.windows, active) < 0 ||
            topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1
        ) {
            diagnostic("move-rejected:source-occupancy-validity");
            return;
        }
        for (const occupant of source.windows) {
            if (!windowInScope(occupant, currentScope)) {
                diagnostic("move-rejected:source-occupancy-validity");
                return;
            }
        }
        const candidates = topology
            .filter((entry) => !entry.leaf.isLayout && entry.leaf !== source.leaf)
            .map((entry) => entry.leaf);
        const targetLeaf = findNeighborLeaf(candidates, source.leaf, direction);
        if (targetLeaf === null) {
            diagnostic("move-rejected:no-target");
            return;
        }
        const target = topology.find((entry) => entry.leaf === targetLeaf);
        if (target === undefined || target.leaf.isLayout) {
            diagnostic("move-rejected:target-occupancy-validity");
            return;
        }
        if (target.windows.length === 0) {
            if (!moveAssignmentRevalidates(currentScope, active, source, target, direction)) {
                diagnostic("move-rejected:assignment-stale");
                return;
            }
            let assigned = false;
            try {
                assigned = manageTile(target.decoded.tile, active, mutation);
            } catch (error) {
                void error;
            }
            if (!assigned) {
                diagnostic("move-rejected:assignment-failed");
                return;
            }
            diagnostic("move-completed");
            return;
        }
        swapToOccupiedTarget(currentScope, active, source, target, direction);
    };

    const resizeActiveWindow = (direction: Direction, mode: "outwards" | "inwards"): void => {
        diagnostic("resize-invoked");
        const active = environment.activeWindow();
        if (active === null) {
            diagnostic("resize-rejected:no-active-window");
            return;
        }
        if (isWindow(active) && active.fullScreen === true) {
            diagnostic("resize-rejected:fullscreen");
            return;
        }
        if (isWindow(active) && active.onAllDesktops === true) {
            diagnostic("resize-rejected:sticky");
            return;
        }
        if (isWindow(active) && isNativelyMaximized(active)) {
            diagnostic("resize-rejected:maximized");
            return;
        }
        const currentScope = scope.scopeForWindow(active);
        if (currentScope === null) {
            diagnostic("resize-rejected:desktop-output-scope");
            return;
        }
        if (!windowInScope(active, currentScope)) {
            diagnostic("resize-rejected:active-window-eligibility");
            return;
        }
        const topology = scope.topologyForScope(currentScope, (reason) => {
            diagnostic(`resize-rejected:${reason}`);
        });
        if (topology === null || active.tile === null || !isTile(active.tile)) {
            if (topology !== null) {
                diagnostic("resize-rejected:active-tile-association");
            }
            return;
        }
        const focused = operationLeafForTile(topology, active.tile);
        if (
            focused === null ||
            focused.leaf.isLayout ||
            focused.windows.length === 0 ||
            windowIndex(focused.windows, active) < 0
        ) {
            diagnostic("resize-rejected:focused-occupancy-validity");
            return;
        }
        const axis: SplitAxis = direction === "left" || direction === "right" ? "x" : "y";
        const expected = axis === "x" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
        const target = resolveResizeSplit(active.tile, expected, direction, mode);
        if (target === null) {
            diagnostic("resize-rejected:no-parent");
            return;
        }
        const parentGeometry = target.split.relativeGeometry;
        const parentExtent = axis === "x" ? parentGeometry.width : parentGeometry.height;
        const focusedGeometry = target.focused.relativeGeometry;
        const focusedExtent = axis === "x" ? focusedGeometry.width : focusedGeometry.height;
        const neighborGeometry = target.neighbor.relativeGeometry;
        const neighborExtent = axis === "x" ? neighborGeometry.width : neighborGeometry.height;
        if (!(parentExtent > 0) || !(focusedExtent > 0) || !(neighborExtent > 0)) {
            diagnostic("resize-rejected:no-parent");
            return;
        }
        const delta = RESIZE_STEP_FRACTION * parentExtent;
        const focusedProposed = mode === "outwards" ? focusedExtent + delta : focusedExtent - delta;
        const pairExtent = focusedExtent + neighborExtent;
        const neighborProposed = pairExtent - focusedProposed;
        if (focusedProposed <= 0 || neighborProposed <= 0) {
            diagnostic("resize-rejected:no-parent");
            return;
        }
        if (resizeWouldViolateMinimum(currentScope, target.split, focusedProposed, neighborProposed, axis)) {
            diagnostic("resize-rejected:at-floor");
            return;
        }
        const positionShift = target.neighborIndex > target.focusedIndex ? 0 : mode === "outwards" ? -delta : delta;
        const focusedTarget: RectCapability =
            axis === "x"
                ? { x: focusedGeometry.x + positionShift, y: focusedGeometry.y, width: focusedProposed, height: focusedGeometry.height }
                : { x: focusedGeometry.x, y: focusedGeometry.y + positionShift, width: focusedGeometry.width, height: focusedProposed };
        if (!setTileRelativeGeometry(target.focused, focusedTarget)) {
            diagnostic("resize-rejected:write-failed");
            return;
        }
        const fresh = scope.topologyForScope(currentScope);
        if (fresh === null) {
            diagnostic("resize-rejected:post-decode");
            return;
        }
        const freshActive = operationLeafForTile(fresh, active.tile);
        if (freshActive === null || freshActive.leaf.isLayout || windowIndex(freshActive.windows, active) < 0) {
            diagnostic("resize-rejected:postcondition");
            return;
        }
        const freshOrdered = customTileSplitSeam.decodeChildren(target.split);
        if (freshOrdered === null || freshOrdered.length !== target.ordered.length) {
            diagnostic("resize-rejected:postcondition");
            return;
        }
        for (let index = 0; index < target.ordered.length; index += 1) {
            if (freshOrdered[index] !== target.ordered[index]) {
                diagnostic("resize-rejected:postcondition");
                return;
            }
        }
        const freshFocusedGeometry = target.focused.relativeGeometry;
        const freshNeighborGeometry = target.neighbor.relativeGeometry;
        const freshFocusedExtent = axis === "x" ? freshFocusedGeometry.width : freshFocusedGeometry.height;
        const freshNeighborExtent = axis === "x" ? freshNeighborGeometry.width : freshNeighborGeometry.height;
        if (
            Math.abs(freshFocusedExtent - focusedProposed) > RELATIVE_GEOMETRY_EPSILON ||
            Math.abs(freshNeighborExtent - neighborProposed) > RELATIVE_GEOMETRY_EPSILON
        ) {
            diagnostic("resize-rejected:postcondition");
            return;
        }
        diagnostic("resize-completed");
    };

    const focusOrResize = (direction: Direction): void => {
        if (resizeModeActive) {
            resizeActiveWindow(direction, resizeModeDirection);
        } else {
            focusNeighbor(direction);
        }
    };

    const enterOrExitResizeMode = (mode: "outwards" | "inwards"): void => {
        if (resizeModeActive && resizeModeDirection === mode) {
            resizeModeActive = false;
            diagnostic("resize-mode-exited");
            return;
        }
        const entering = !resizeModeActive;
        resizeModeDirection = mode;
        resizeModeActive = true;
        diagnostic(entering ? `resize-mode-entered:${mode}` : `resize-mode-switched:${mode}`);
    };

    function resolveResizeSplit(
        focusedTile: TileCapability,
        expectedLayoutDirection: number,
        direction: Direction,
        mode: "outwards" | "inwards",
    ): {
        readonly split: import("./boundary").CustomTileCapability;
        readonly ordered: readonly import("./boundary").CustomTileCapability[];
        readonly focusedIndex: number;
        readonly neighborIndex: number;
        readonly focused: import("./boundary").CustomTileCapability;
        readonly neighbor: import("./boundary").CustomTileCapability;
    } | null {
        const dirSign = direction === "right" || direction === "down" ? 1 : -1;
        let node: object | null = focusedTile;
        while (node !== null) {
            const parent: object | null = (node as TileCapability).parent;
            if (parent === null) {
                return null;
            }
            if (isCustomTile(parent) && parent.isLayout && parent.layoutDirection === expectedLayoutDirection) {
                const ordered = customTileSplitSeam.decodeChildren(parent);
                if (ordered !== null) {
                    const focusedIndex = ordered.indexOf(node as import("./boundary").CustomTileCapability);
                    if (focusedIndex >= 0) {
                        const neighborIndex = mode === "outwards" ? focusedIndex + dirSign : focusedIndex - dirSign;
                        const focused = ordered[focusedIndex];
                        const neighbor = ordered[neighborIndex];
                        if (neighborIndex >= 0 && neighborIndex < ordered.length && focused !== undefined && neighbor !== undefined) {
                            return { split: parent, ordered, focusedIndex, neighborIndex, focused, neighbor };
                        }
                    }
                }
            }
            if (!isTile(node)) {
                return null;
            }
            node = parent;
        }
        return null;
    }

    function resizeWouldViolateMinimum(
        currentScope: InputScope,
        split: import("./boundary").CustomTileCapability,
        firstProposed: number,
        secondProposed: number,
        axis: SplitAxis,
    ): boolean {
        const workArea = environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, currentScope.output, currentScope.desktop);
        if (!isRect(workArea)) {
            return false;
        }
        const workExtent = axis === "x" ? workArea.width : workArea.height;
        if (!(workExtent > 0)) {
            return false;
        }
        const absoluteExtent = axis === "x" ? split.absoluteGeometry.width : split.absoluteGeometry.height;
        const relativeExtent = axis === "x" ? split.relativeGeometry.width : split.relativeGeometry.height;
        if (!(absoluteExtent > 0) || !(relativeExtent > 0)) {
            return false;
        }
        const scale = absoluteExtent / relativeExtent;
        const floor = MINIMUM_TILE_FRACTION * workExtent;
        return firstProposed * scale < floor || secondProposed * scale < floor;
    }

    function moveAssignmentRevalidates(
        currentScope: InputScope,
        active: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
        direction: Direction,
    ): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, currentScope.scope) ||
            !windowInScope(active, freshScope)
        ) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null || active.tile === null || !isTile(active.tile)) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, active.tile);
        if (
            freshSource === null ||
            freshSource.decoded.tile !== source.decoded.tile ||
            freshSource.leaf.isLayout ||
            freshSource.windows.length !== 1 ||
            windowIndex(freshSource.windows, active) < 0 ||
            topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1
        ) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        if (freshTarget === null || freshTarget.leaf.isLayout || freshTarget.windows.length !== 0) {
            return false;
        }
        const freshCandidates = topology
            .filter((entry) => !entry.leaf.isLayout && entry.windows.length === 0)
            .map((entry) => entry.leaf);
        return findNeighborLeaf(freshCandidates, freshSource.leaf, direction) === freshTarget.leaf;
    }

    function swapToOccupiedTarget(
        currentScope: InputScope,
        active: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
        direction: Direction,
    ): void {
        diagnostic("move-swap-invoked");
        if (active.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (target.leaf.isLayout || target.windows.length !== 1) {
            diagnostic("move-rejected:swap-occupancy-validity");
            return;
        }
        const occupant = target.windows[0];
        if (occupant === undefined || !windowInScope(occupant, currentScope)) {
            diagnostic("move-rejected:swap-occupant-ineligible");
            return;
        }
        if (occupant.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (!swapRevalidates(currentScope, active, occupant, source, target, direction, "before-first")) {
            diagnostic("move-swap-rejected:stale");
            return;
        }
        let firstAssigned = false;
        try {
            firstAssigned = assignWindowToTile(active, target.decoded.tile, mutation);
        } catch (error) {
            void error;
        }
        if (!firstAssigned) {
            diagnostic("move-swap-failed:first-write");
            return;
        }
        if (!swapRevalidates(currentScope, active, occupant, source, target, direction, "before-second")) {
            swapSecondWriteFailed(currentScope, active, source);
            return;
        }
        let secondAssigned = false;
        try {
            secondAssigned = assignWindowToTile(occupant, source.decoded.tile, mutation);
        } catch (error) {
            void error;
        }
        if (!secondAssigned) {
            swapSecondWriteFailed(currentScope, active, source);
            return;
        }
        if (!swapDecodesFinal(currentScope, active, occupant, source, target)) {
            swapSecondWriteFailed(currentScope, active, source);
            return;
        }
        diagnostic("move-swap-completed");
    }

    function swapRevalidates(
        currentScope: InputScope,
        active: WindowCapability,
        occupant: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
        direction: Direction,
        phase: "before-first" | "before-second",
    ): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, currentScope.scope) ||
            !windowInScope(active, freshScope) ||
            !windowInScope(occupant, freshScope)
        ) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (
            topology === null ||
            active.tile === null ||
            !isTile(active.tile) ||
            occupant.tile === null ||
            !isTile(occupant.tile) ||
            occupant.tile !== target.decoded.tile
        ) {
            return false;
        }
        const expectedActiveTile = phase === "before-first" ? source.decoded.tile : target.decoded.tile;
        if (active.tile !== expectedActiveTile) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, source.decoded.tile);
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        if (freshSource === null || freshTarget === null || freshSource.leaf.isLayout || freshTarget.leaf.isLayout) {
            return false;
        }
        if (phase === "before-first") {
            if (freshSource.windows.length !== 1 || windowIndex(freshSource.windows, active) < 0) {
                return false;
            }
            if (freshTarget.windows.length !== 1 || windowIndex(freshTarget.windows, occupant) < 0) {
                return false;
            }
        } else if (
            freshSource.windows.length !== 0 ||
            freshTarget.windows.length !== 2 ||
            windowIndex(freshTarget.windows, active) < 0 ||
            windowIndex(freshTarget.windows, occupant) < 0
        ) {
            return false;
        }
        if (
            active === occupant ||
            topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1 ||
            topology.filter((entry) => windowIndex(entry.windows, occupant) >= 0).length !== 1
        ) {
            return false;
        }
        if (phase === "before-first") {
            const freshCandidates = topology
                .filter((entry) => !entry.leaf.isLayout && entry.leaf !== freshSource.leaf)
                .map((entry) => entry.leaf);
            return findNeighborLeaf(freshCandidates, freshSource.leaf, direction) === freshTarget.leaf;
        }
        return true;
    }

    function swapDecodesFinal(
        currentScope: InputScope,
        active: WindowCapability,
        occupant: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
    ): boolean {
        const topology = scope.topologyForScope(currentScope);
        if (topology === null || active.tile !== target.decoded.tile || occupant.tile !== source.decoded.tile) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, source.decoded.tile);
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        if (freshSource === null || freshTarget === null || freshSource.leaf.isLayout || freshTarget.leaf.isLayout) {
            return false;
        }
        return (
            freshSource.windows.length === 1 &&
            windowIndex(freshSource.windows, occupant) >= 0 &&
            freshTarget.windows.length === 1 &&
            windowIndex(freshTarget.windows, active) >= 0
        );
    }

    function swapSecondWriteFailed(currentScope: InputScope, active: WindowCapability, source: OperationLeaf): void {
        diagnostic("move-swap-failed:second-write");
        const restored = restoreSwapFirst(currentScope, active, source);
        diagnostic(restored && active.tile === source.decoded.tile ? "move-swap-restored:verified" : "move-swap-restored:unverified");
    }

    function restoreSwapFirst(currentScope: InputScope, active: WindowCapability, source: OperationLeaf): boolean {
        if (environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = scope.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, currentScope.scope) || !windowInScope(active, freshScope)) {
            return false;
        }
        if (active.tile === null || !isTile(active.tile)) {
            return false;
        }
        const topology = scope.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, source.decoded.tile);
        const freshActive = operationLeafForTile(topology, active.tile);
        if (
            freshSource === null ||
            freshSource.leaf.isLayout ||
            freshActive === null ||
            freshActive.leaf.isLayout ||
            windowIndex(freshActive.windows, active) < 0
        ) {
            return false;
        }
        let restored = false;
        try {
            restored = assignWindowToTile(active, source.decoded.tile, mutation);
        } catch (error) {
            void error;
        }
        return restored;
    }

    function sameScope(left: Scope, right: Scope): boolean {
        return left.output === right.output && left.desktopId === right.desktopId;
    }

    return {
        armKeyboardInsertion,
        completeKeyboardInsertion,
        focusNeighbor,
        moveActiveWindow,
        focusOrResize,
        enterOrExitResizeMode,
        resizeModeSnapshot,
        resizeActiveWindow,
    };
}
