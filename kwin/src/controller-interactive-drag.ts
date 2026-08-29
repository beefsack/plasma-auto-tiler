import {
    MAX_SEQUENTIAL_LENGTH,
    decodeSequential,
    isCustomTile,
    isPoint,
    isRect,
    isTile,
    isWindow,
    manageTile,
    splitCustomTile,
    type CustomTileCapability,
    type OutputCapability,
    type RectCapability,
    type StructuralMutationReporter,
    type TileCapability,
    type WindowCapability,
} from "./boundary";
import type { GeometryDropBail } from "./controller-geometry";
import type { OperationLeaf } from "./controller-topology";
import type {
    Direction,
    EqualSplit,
    GeometryDropPlan,
    GeometryDropRequest,
    Point,
    Rect,
    SplitAxis,
    WindowRef,
    Result,
} from "./logic";
import type { CurrentScope } from "./controller-reflow-observers";

const WORK_AREA_CLIENT_AREA_OPTION = 5;
const MINIMUM_TILE_FRACTION = 0.15;

export interface ActiveDrag {
    readonly scope: CurrentScope;
    readonly window: WindowCapability;
    readonly originTile: CustomTileCapability;
    readonly originGeometry: RectCapability;
    armedDeferredRemoval: boolean;
}

type InteractiveKind = "move" | "resize" | "unknown";

interface InteractiveWatch {
    readonly disconnect: () => void;
    kind: InteractiveKind;
}

const DIAGNOSTIC_UNAVAILABLE = "unavailable" as const;

interface DragDiagnosticTransaction {
    readonly transactionId: number;
    readonly draggedWindow: WindowCapability;
    draggedClientId: string;
    readonly outputId: unknown;
    readonly workArea: unknown;
    readonly occupiedClients: Array<{ readonly clientId: string; readonly window: WindowCapability }>;
    readonly ordering: string[];
    resolvedTargetLeafId: string;
}

export type GeometryDropResolution =
    | {
          readonly kind: "resolved";
          readonly target: OperationLeaf;
          readonly center: Point;
          readonly pointSource: "cursor" | "frame-center";
          readonly empty: boolean;
      }
    | { readonly kind: "center-unresolved" }
    | { readonly kind: "no-target-leaf"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" }
    | { readonly kind: "target-is-origin"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" }
    | { readonly kind: "leaf-not-in-topology"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" };

export interface ReflowLeaves {
    readonly dragged: WindowCapability;
    readonly occupant: WindowCapability;
}

interface InteractiveDragGeometryHelpers {
    readonly dragGeometryBail: (target: GeometryDropBail) => string;
    readonly positiveGeometry: (geometry: RectCapability) => boolean;
    readonly sameGeometry: (a: RectCapability, b: RectCapability) => boolean;
    readonly splitDirection: (direction: Direction) => number;
}

interface InteractiveDragTopologyHelpers {
    readonly operationLeafForTile: (topology: readonly OperationLeaf[], tile: TileCapability) => OperationLeaf | null;
    readonly windowIndex: (windows: readonly WindowCapability[], target: WindowCapability) => number;
}

interface InteractiveDragPlanningHelpers {
    readonly equalAlongAxis: (a: Rect, b: Rect, axis: SplitAxis) => boolean;
    readonly pickDropLeaf: (leaves: readonly OperationLeaf["leaf"][], point: Point) => OperationLeaf["leaf"] | null;
    readonly planEqualSplit: (parent: Rect, a: Rect, b: Rect, axis: SplitAxis) => EqualSplit | null;
    readonly planGeometryDrop: (request: GeometryDropRequest) => Result<GeometryDropPlan>;
    readonly rectCenter: (rect: Rect) => Point | null;
}

interface InteractiveDragTileHelpers {
    readonly decodeChildren: (tile: CustomTileCapability) => readonly CustomTileCapability[] | null;
    readonly setRelativeGeometry: (tile: TileCapability, geometry: RectCapability) => boolean;
}

export interface InteractiveDragCapabilities {
    readonly geometryHelpers: InteractiveDragGeometryHelpers;
    readonly topologyHelpers: InteractiveDragTopologyHelpers;
    readonly planningHelpers: InteractiveDragPlanningHelpers;
    readonly tileHelpers: InteractiveDragTileHelpers;
    readonly snapshotCaption: (value: unknown) => string;
    readonly windowList: () => unknown;
    readonly cursorPos: () => unknown;
    readonly clientArea: (option: number, output: OutputCapability, desktop: CurrentScope["desktop"]) => unknown;
    readonly watchInteractiveWindow: (
        window: WindowCapability,
        started: () => void,
        finished: () => void,
        stepped: (geometry: RectCapability) => void,
        moveResizedChanged: () => void,
        invalidated: () => void,
    ) => { readonly disconnect: () => void; readonly ok: number; readonly failed: number };
    readonly showOutline: (x: number, y: number, width: number, height: number) => void;
    readonly hideOutline: () => void;
    readonly scopeForWindow: (window: unknown) => CurrentScope | null;
    readonly topologyForScope: (
        scope: CurrentScope,
        onRejected?: (reason: "root-lookup" | "topology-decode") => void,
    ) => readonly OperationLeaf[] | null;
    readonly windowInScope: (window: WindowCapability, scope: CurrentScope) => boolean;
    readonly isFloating: (window: WindowCapability) => boolean;
    readonly isInert: (scope: CurrentScope) => boolean;
    readonly isMaximized: (window: WindowCapability) => boolean;
    readonly dropOutlinePreview: () => boolean;
    readonly mutation: StructuralMutationReporter;
    readonly decodedBoundary: (kind: "split-result" | "workspace-window-list") => void;
    readonly diagnostic: (event: string) => void;
    readonly onceDiagnostic: (event: string) => void;
    readonly runGuarded: (operation: () => void) => void;
    readonly disable: (reason: string) => void;
    readonly deferRemovalCollapse: (
        window: WindowCapability,
        scope: CurrentScope,
        leafTile: TileCapability,
        afterDragSnapshot: boolean,
        onDragSettled: ((topology: readonly OperationLeaf[], collapsed: boolean) => readonly OperationLeaf[]) | undefined,
    ) => void;
    readonly ensureInvariant: (scope: CurrentScope) => void;
    readonly afterFinished: () => void;
    readonly onExistingWindow: (window: WindowCapability) => void;
}

export interface InteractiveDragController {
    readonly current: () => ActiveDrag | undefined;
    readonly hasActive: () => boolean;
    readonly isLive: () => boolean;
    readonly clear: () => void;
    readonly showDropOutline: (geometry: RectCapability) => void;
    readonly hideDropOutline: () => void;
    readonly markOwedInvariant: (scope: CurrentScope) => void;
    readonly settleOwedInvariants: () => void;
    readonly attachExisting: (emitSummary: boolean) => void;
    readonly attach: (window: unknown) => { readonly attempted: number; readonly ok: number; readonly failed: number } | null;
    readonly detach: (window: WindowCapability) => void;
    readonly handleInvalidated: (window: WindowCapability) => void;
    readonly handleStarted: (window: WindowCapability) => void;
    readonly handleFinished: (window: WindowCapability) => void;
    readonly handleStepped: (window: WindowCapability, geometry: RectCapability) => void;
    readonly handleMoveResizedChanged: () => void;
    readonly dragSnapshotFinal: (topology: readonly OperationLeaf[]) => void;
    readonly afterDeferredRemoval: (
        topology: readonly OperationLeaf[],
        collapsed: boolean,
        reflowLeaves: ReflowLeaves | undefined,
        scope: CurrentScope,
        transaction?: DragDiagnosticTransaction,
    ) => readonly OperationLeaf[];
    readonly isOutlineShown: () => boolean;
}

export function createInteractiveDragController(
    capabilities: InteractiveDragCapabilities,
): InteractiveDragController {
    const dragState: { current: ActiveDrag | undefined } = { current: undefined };
    const interactiveWindows = new Map<WindowCapability, InteractiveWatch>();
    const resizeObservations = new Set<WindowCapability>();
    const owedInvariantScopes = new Map<OutputCapability, Map<string, CurrentScope>>();
    let shownDropOutline: RectCapability | null = null;
    let nextDiagnosticTransactionId = 1;

    const diagnostic = capabilities.diagnostic;
    const { dragGeometryBail, positiveGeometry, sameGeometry, splitDirection } = capabilities.geometryHelpers;
    const { operationLeafForTile, windowIndex } = capabilities.topologyHelpers;
    const { equalAlongAxis, pickDropLeaf, planEqualSplit, planGeometryDrop, rectCenter } = capabilities.planningHelpers;
    const { decodeChildren, setRelativeGeometry } = capabilities.tileHelpers;
    const { snapshotCaption } = capabilities;

    const showDropOutline = (geometry: RectCapability): void => {
        if (shownDropOutline !== null && sameGeometry(shownDropOutline, geometry)) {
            return;
        }
        capabilities.showOutline(geometry.x, geometry.y, geometry.width, geometry.height);
        shownDropOutline = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
    };

    const hideDropOutline = (): void => {
        if (shownDropOutline === null) {
            return;
        }
        capabilities.hideOutline();
        shownDropOutline = null;
    };

    const trackedDragLive = (): boolean => {
        const drag = dragState.current;
        return drag !== undefined && (drag.window.move || drag.window.resize);
    };

    const clear = (): void => {
        hideDropOutline();
        dragState.current = undefined;
    };

    const markOwedInvariant = (scope: CurrentScope): void => {
        let byDesktop = owedInvariantScopes.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, CurrentScope>();
            owedInvariantScopes.set(scope.output, byDesktop);
        }
        if (!byDesktop.has(scope.desktop.id)) {
            byDesktop.set(scope.desktop.id, scope);
            diagnostic("ownership-invariant-deferred:drag-live");
        }
    };

    const settleOwedInvariants = (): void => {
        if (trackedDragLive() || owedInvariantScopes.size === 0) {
            return;
        }
        const owed: CurrentScope[] = [];
        for (const byDesktop of owedInvariantScopes.values()) {
            for (const scope of byDesktop.values()) {
                owed.push(scope);
            }
        }
        owedInvariantScopes.clear();
        for (const scope of owed) {
            capabilities.ensureInvariant(scope);
        }
    };

    const readCursorPoint = (): Point | null => {
        let value: unknown;
        try {
            value = capabilities.cursorPos();
        } catch (error) {
            void error;
            capabilities.onceDiagnostic("drag-point-fallback:cursor-read-threw");
            return null;
        }
        if (!isPoint(value)) {
            capabilities.onceDiagnostic("drag-point-fallback:cursor-not-a-point");
            return null;
        }
        return { x: value.x, y: value.y };
    };

    const topologyLeavesData = (topology: readonly OperationLeaf[]): unknown =>
        topology.map((entry) => ({
            id: entry.leaf.id,
            geometry: {
                x: entry.leaf.geometry.x,
                y: entry.leaf.geometry.y,
                width: entry.leaf.geometry.width,
                height: entry.leaf.geometry.height,
            },
            occupants: entry.refs.map((ref, index) => ({
                id: ref.id,
                caption: snapshotCaption(entry.windows[index]?.caption),
            })),
        }));

    const dragSnapshot = (stage: "before" | "target" | "after" | "final", produce: () => unknown): void => {
        let data: unknown;
        try {
            data = produce();
        } catch (error) {
            void error;
            diagnostic(`drag-snapshot-failed:${stage}:observe`);
            return;
        }
        let payload: string;
        try {
            payload = JSON.stringify(data);
        } catch (error) {
            void error;
            diagnostic(`drag-snapshot-failed:${stage}:serialize`);
            return;
        }
        diagnostic(`${stage === "target" ? "drag-target" : `drag-snapshot-${stage}`}:${payload}`);
    };

    const dragSnapshotBefore = (
        drag: ActiveDrag,
        topology: readonly OperationLeaf[] | null,
        topologyStatus: string | null,
        center: Point | null,
        pointSource: "cursor" | "frame-center" | null = null,
    ): void => {
        dragSnapshot("before", () => {
            const geometry = drag.window.frameGeometry;
            const payload: Record<string, unknown> = {
                geometry: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
                center: center === null ? null : { x: center.x, y: center.y },
                leaves: topology === null ? null : topologyLeavesData(topology),
            };
            if (pointSource !== null) {
                payload.pointSource = pointSource;
            }
            if (topology === null) {
                payload.topology = topologyStatus;
            }
            return payload;
        });
    };

    const dragTargetResolution = (target: GeometryDropResolution): void => {
        dragSnapshot("target", () => {
            if (target.kind === "resolved") {
                return {
                    kind: "resolved",
                    leaf: target.target.leaf.id,
                    center: { x: target.center.x, y: target.center.y },
                    pointSource: target.pointSource,
                    occupancy: target.empty ? "empty" : "occupied",
                };
            }
            if (target.kind === "center-unresolved") {
                return { kind: "center-unresolved" };
            }
            return { kind: target.kind, center: { x: target.center.x, y: target.center.y }, pointSource: target.pointSource };
        });
    };

    const dragSnapshotAfter = (topology: readonly OperationLeaf[]): void => {
        dragSnapshot("after", () => ({ leaves: topologyLeavesData(topology) }));
    };

    const dragSnapshotFinal = (topology: readonly OperationLeaf[]): void => {
        dragSnapshot("final", () => ({ leaves: topologyLeavesData(topology) }));
    };

    const diagnosticGeometry = (value: unknown): unknown => {
        if (!isRect(value)) {
            return DIAGNOSTIC_UNAVAILABLE;
        }
        return { x: value.x, y: value.y, width: value.width, height: value.height };
    };

    const diagnosticFrameGeometry = (window: WindowCapability): unknown => {
        try {
            return diagnosticGeometry(window.frameGeometry);
        } catch (error) {
            void error;
            return DIAGNOSTIC_UNAVAILABLE;
        }
    };

    const diagnosticOutputId = (value: unknown): unknown => value ?? DIAGNOSTIC_UNAVAILABLE;

    const diagnosticWorkArea = (scope: CurrentScope): unknown => {
        try {
            return diagnosticGeometry(capabilities.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop));
        } catch (error) {
            void error;
            return DIAGNOSTIC_UNAVAILABLE;
        }
    };

    const addDiagnosticOccupiedClients = (
        transaction: DragDiagnosticTransaction,
        topology: readonly OperationLeaf[],
    ): void => {
        for (const entry of topology) {
            for (let index = 0; index < entry.windows.length; index += 1) {
                const window = entry.windows[index];
                if (window === undefined || transaction.occupiedClients.some((client) => client.window === window)) {
                    continue;
                }
                transaction.occupiedClients.push({
                    clientId: entry.refs[index]?.id ?? DIAGNOSTIC_UNAVAILABLE,
                    window,
                });
            }
        }
    };

    const createDiagnosticTransaction = (
        drag: ActiveDrag,
        scope: CurrentScope,
        draggedClientId: string,
        target: OperationLeaf,
    ): DragDiagnosticTransaction => {
        const transaction: DragDiagnosticTransaction = {
            transactionId: nextDiagnosticTransactionId,
            draggedWindow: drag.window,
            draggedClientId,
            outputId: diagnosticOutputId(scope.scope.output),
            workArea: diagnosticWorkArea(scope),
            occupiedClients: [],
            ordering: [],
            resolvedTargetLeafId: target.leaf.id,
        };
        nextDiagnosticTransactionId += 1;
        return transaction;
    };

    const emitDiagnosticTransaction = (
        transaction: DragDiagnosticTransaction,
        topology: readonly OperationLeaf[],
    ): void => {
        addDiagnosticOccupiedClients(transaction, topology);
        const finalEntry = topology.find((entry) => windowIndex(entry.windows, transaction.draggedWindow) >= 0);
        const finalIndex = finalEntry === undefined ? -1 : windowIndex(finalEntry.windows, transaction.draggedWindow);
        if (finalEntry !== undefined && finalEntry.refs[finalIndex] !== undefined) {
            transaction.draggedClientId = finalEntry.refs[finalIndex].id;
        }
        const payload = {
            transactionId: transaction.transactionId,
            stage: "controller-settled",
            draggedClientId: transaction.draggedClientId,
            resolvedTargetLeafId: transaction.resolvedTargetLeafId,
            outputId: transaction.outputId,
            workArea: transaction.workArea,
            finalLeafId: finalEntry?.leaf.id ?? DIAGNOSTIC_UNAVAILABLE,
            finalLeafRectangle: finalEntry === undefined ? DIAGNOSTIC_UNAVAILABLE : diagnosticGeometry(finalEntry.leaf.geometry),
            finalOccupantId: finalEntry === undefined
                ? DIAGNOSTIC_UNAVAILABLE
                : finalEntry.refs[finalIndex]?.id ?? DIAGNOSTIC_UNAVAILABLE,
            finalLeaves: topology.map((entry) => ({
                leafId: entry.leaf.id,
                rectangle: diagnosticGeometry(entry.leaf.geometry),
                occupancy: entry.windows.length === 0 ? "empty" : "occupied",
                occupantIds: entry.windows.map((_, index) => entry.refs[index]?.id ?? DIAGNOSTIC_UNAVAILABLE),
            })),
            occupiedClients: transaction.occupiedClients.map((client) => ({
                clientId: client.clientId,
                clientGeometry: DIAGNOSTIC_UNAVAILABLE,
                frameGeometry: diagnosticFrameGeometry(client.window),
            })),
            postSettle: {
                status: DIAGNOSTIC_UNAVAILABLE,
                reason: "no-supported-client-geometry-event-after-controller-settled",
            },
            ordering: transaction.ordering,
        };
        let serialized: string;
        try {
            serialized = JSON.stringify(payload);
        } catch (error) {
            void error;
            diagnostic("drag-diagnostic-failed:serialize");
            return;
        }
        diagnostic(`drag-diagnostic:${serialized}`);
    };

    const restoreOrigin = (drag: ActiveDrag): boolean => {
        const scope = capabilities.scopeForWindow(drag.window);
        if (
            scope === null ||
            scope.scope.desktopId !== drag.scope.scope.desktopId ||
            scope.scope.output !== drag.scope.scope.output ||
            !capabilities.windowInScope(drag.window, scope) ||
            !isCustomTile(drag.originTile) ||
            drag.window.tile === drag.originTile
        ) {
            return false;
        }
        const topology = capabilities.topologyForScope(scope);
        if (topology === null || operationLeafForTile(topology, drag.originTile) === null) {
            return false;
        }
        if (!manageTile(drag.originTile, drag.window, capabilities.mutation)) {
            return false;
        }
        diagnostic("drag-origin-restored");
        return true;
    };

    const bailDrag = (reason: string, drag: ActiveDrag): void => {
        diagnostic(reason);
        restoreOrigin(drag);
    };

    const splitAxisWouldViolateMinimum = (scope: CurrentScope, geometry: RectCapability, axis: SplitAxis): boolean => {
        const leafExtent = axis === "x" ? geometry.width : geometry.height;
        const workArea = capabilities.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
        if (!isRect(workArea)) {
            return false;
        }
        const workExtent = axis === "x" ? workArea.width : workArea.height;
        return workExtent > 0 && leafExtent / 2 < MINIMUM_TILE_FRACTION * workExtent;
    };

    const splitWouldViolateMinimum = (scope: CurrentScope, target: OperationLeaf, direction: Direction): boolean =>
        splitAxisWouldViolateMinimum(
            scope,
            target.leaf.geometry,
            direction === "left" || direction === "right" ? "x" : "y",
        );

    const splitDropTargetSameAxis = (
        target: CustomTileCapability,
        parent: CustomTileCapability,
        drag: ActiveDrag,
        direction: Direction,
    ): boolean => {
        const before = decodeChildren(parent);
        if (before === null || !before.includes(target)) {
            capabilities.disable("drag-split-result-invalid");
            return false;
        }
        splitCustomTile(target, splitDirection(direction), capabilities.mutation);
        const after = decodeChildren(parent);
        if (after === null || after.length !== before.length + 1 || !after.includes(target)) {
            capabilities.disable("drag-split-result-invalid");
            return false;
        }
        capabilities.decodedBoundary("split-result");
        const added = after.filter((candidate) => !before.includes(candidate));
        const newTile = added[0];
        if (added.length !== 1 || newTile === undefined || !manageTile(newTile, drag.window, capabilities.mutation)) {
            capabilities.disable(added.length !== 1 || newTile === undefined ? "drag-split-result-invalid" : "drag-manage-failed");
            return false;
        }
        return true;
    };

    const splitDropTarget = (
        target: OperationLeaf,
        occupant: WindowCapability,
        drag: ActiveDrag,
        direction: Direction,
    ): boolean => {
        if (!isCustomTile(target.decoded.tile)) {
            capabilities.disable("drag-split-result-invalid");
            return false;
        }
        const parent = target.decoded.tile.parent;
        const axisDirection = splitDirection(direction);
        const sameAxis =
            parent !== null && isTile(parent) && isCustomTile(parent) && parent.isLayout && parent.layoutDirection === axisDirection;
        if (sameAxis) {
            return splitDropTargetSameAxis(target.decoded.tile, parent, drag, direction);
        }
        splitCustomTile(target.decoded.tile, axisDirection, capabilities.mutation);
        const children = decodeChildren(target.decoded.tile);
        if (children !== null && children.length === 2) {
            capabilities.decodedBoundary("split-result");
        }
        const first = children?.[0];
        const second = children?.[1];
        if (children === null || children.length !== 2 || first === undefined || second === undefined) {
            capabilities.disable("drag-split-result-invalid");
            return false;
        }
        const selected = direction === "left" || direction === "up" ? first : second;
        const opposite = selected === first ? second : first;
        const occupantManaged = manageTile(opposite, occupant, capabilities.mutation);
        const draggedManaged = occupantManaged && manageTile(selected, drag.window, capabilities.mutation);
        if (!occupantManaged || !draggedManaged) {
            capabilities.disable("drag-manage-failed");
            return false;
        }
        return true;
    };

    const nativeDropTarget = (drag: ActiveDrag, scope: CurrentScope, topology: readonly OperationLeaf[]): OperationLeaf | null => {
        if (drag.window.tile === drag.originTile || !isCustomTile(drag.window.tile) || drag.window.tile.isLayout) {
            return null;
        }
        const target = operationLeafForTile(topology, drag.window.tile);
        if (target === null || target.leaf.isLayout || !isCustomTile(target.decoded.tile)) {
            return null;
        }
        if (windowIndex(target.windows, drag.window) < 0 || target.windows.length !== 2) {
            return null;
        }
        if (topology.filter((entry) => windowIndex(entry.windows, drag.window) >= 0).length !== 1) {
            return null;
        }
        const occupant = target.windows.find((window) => window !== drag.window);
        return occupant !== undefined && capabilities.windowInScope(occupant, scope) ? target : null;
    };

    const geometryDropTarget = (
        topology: readonly OperationLeaf[],
        origin: OperationLeaf,
        center: Point | null,
        pointSource: "cursor" | "frame-center",
    ): GeometryDropResolution => {
        if (center === null) {
            return { kind: "center-unresolved" };
        }
        const leaf = pickDropLeaf(topology.map((entry) => entry.leaf), center);
        if (leaf === null) {
            return { kind: "no-target-leaf", center, pointSource };
        }
        if (leaf.id === origin.leaf.id) {
            return { kind: "target-is-origin", center, pointSource };
        }
        for (const entry of topology) {
            if (entry.leaf === leaf) {
                return { kind: "resolved", target: entry, center, pointSource, empty: entry.windows.length === 0 };
            }
        }
        return { kind: "leaf-not-in-topology", center, pointSource };
    };

    const applyEmptyDrop = (
        drag: ActiveDrag,
        scope: CurrentScope,
        target: OperationLeaf,
        transaction: DragDiagnosticTransaction,
    ): void => {
        let managed = false;
        try {
            managed = manageTile(target.decoded.tile, drag.window, capabilities.mutation);
        } catch (error) {
            void error;
        }
        if (!managed) {
            bailDrag("drag-bail:empty-placement-failed", drag);
            return;
        }
        diagnostic("drag-empty-placement");
        drag.armedDeferredRemoval = true;
        capabilities.deferRemovalCollapse(
            drag.window,
            scope,
            drag.originTile,
            true,
            (topology, collapsed) => afterDeferredRemoval(topology, collapsed, undefined, scope, transaction),
        );
    };

    const applyDropSplit = (
        drag: ActiveDrag,
        scope: CurrentScope,
        target: OperationLeaf,
        direction: Direction,
        transaction: DragDiagnosticTransaction,
    ): void => {
        const occupant = target.windows.find((window) => window !== drag.window);
        if (occupant === undefined || !capabilities.windowInScope(occupant, scope)) {
            bailDrag("drag-bail:target-occupant-invalid", drag);
            return;
        }
        if (splitWouldViolateMinimum(scope, target, direction)) {
            bailDrag("drag-refused:undersized-split", drag);
            return;
        }
        if (!splitDropTarget(target, occupant, drag, direction)) {
            return;
        }
        diagnostic("drag-overlap-split-completed");
        drag.armedDeferredRemoval = true;
        capabilities.deferRemovalCollapse(
            drag.window,
            scope,
            drag.originTile,
            true,
            (topology, collapsed) => afterDeferredRemoval(topology, collapsed, { dragged: drag.window, occupant }, scope, transaction),
        );
    };

    const recoverGeometryDrop = (
        drag: ActiveDrag,
        scope: CurrentScope,
        topology: readonly OperationLeaf[],
        origin: OperationLeaf,
        center: Point | null,
        pointSource: "cursor" | "frame-center",
    ): void => {
        const native = nativeDropTarget(drag, scope, topology);
        const target = geometryDropTarget(topology, origin, center, pointSource);
        dragTargetResolution(target);
        if (target.kind !== "resolved") {
            bailDrag(dragGeometryBail(target), drag);
            return;
        }
        if (native !== null && native.leaf !== target.target.leaf) {
            bailDrag("drag-bail:geometry-native-mismatch", drag);
            return;
        }
        if (native !== null) {
            diagnostic("drag-native-overlap");
        }
        const draggedIndex = windowIndex(target.target.windows, drag.window);
        let draggedRef: WindowRef;
        if (draggedIndex >= 0) {
            const ref = target.target.refs[draggedIndex];
            if (ref === undefined) {
                bailDrag("drag-bail:geometry-plan-rejected:ref-unresolved", drag);
                return;
            }
            draggedRef = ref;
        } else {
            draggedRef = { id: "window-dragged", normal: drag.window.normalWindow, managed: drag.window.managed };
        }
        const plan = planGeometryDrop({
            scope: scope.scope,
            originLeaf: origin.leaf,
            targetLeaf: target.target.leaf,
            draggedWindow: draggedRef,
            pointer: target.center,
            record: {
                scope: scope.scope,
                originLeafId: origin.leaf.id,
                windowId: draggedRef.id,
                geometry: drag.originGeometry,
            },
        });
        if (!plan.ok) {
            bailDrag(`drag-bail:geometry-plan-rejected:${plan.reason.kind}`, drag);
            return;
        }
        if (plan.value.kind === "geometry-drop-empty") {
            diagnostic("drag-empty-target");
            const transaction = createDiagnosticTransaction(drag, scope, draggedRef.id, target.target);
            applyEmptyDrop(drag, scope, target.target, transaction);
            return;
        }
        diagnostic("drag-geometry-target");
        const transaction = createDiagnosticTransaction(drag, scope, draggedRef.id, target.target);
        applyDropSplit(drag, scope, target.target, plan.value.direction, transaction);
    };

    const completeDrag = (drag: ActiveDrag): void => {
        diagnostic("drag-finished");
        if (drag.window.fullScreen === true) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        const scope = capabilities.scopeForWindow(drag.window);
        if (scope === null) {
            dragSnapshotBefore(drag, null, "scope-unavailable", null);
            bailDrag("drag-bail:scope-unavailable", drag);
            return;
        }
        if (scope.scope.output !== drag.scope.scope.output || scope.scope.desktopId !== drag.scope.scope.desktopId) {
            dragSnapshotBefore(drag, null, "scope-changed", null);
            bailDrag("drag-bail:scope-changed", drag);
            return;
        }
        if (!capabilities.windowInScope(drag.window, scope)) {
            dragSnapshotBefore(drag, null, "window-out-of-scope", null);
            bailDrag("drag-bail:window-out-of-scope", drag);
            return;
        }
        if (!isCustomTile(drag.originTile)) {
            dragSnapshotBefore(drag, null, "origin-tile-not-custom", null);
            bailDrag("drag-bail:origin-tile-not-custom", drag);
            return;
        }
        if (drag.window.tile === drag.originTile && sameGeometry(drag.window.frameGeometry, drag.originGeometry)) {
            dragSnapshotBefore(drag, null, "unchanged", null);
            diagnostic("drag-unchanged");
            return;
        }
        let topologyRejection: "root-lookup" | "topology-decode" | null = null;
        const topology = capabilities.topologyForScope(scope, (reason) => {
            topologyRejection = reason;
        });
        if (topology === null) {
            dragSnapshotBefore(drag, null, topologyRejection ?? "unknown", null);
            bailDrag(`drag-bail:topology-unavailable:${topologyRejection ?? "unknown"}`, drag);
            return;
        }
        if (!positiveGeometry(drag.window.frameGeometry)) {
            dragSnapshotBefore(drag, topology, null, null);
            bailDrag("drag-bail:geometry-invalid", drag);
            return;
        }
        const cursorPoint = readCursorPoint();
        const frameCenter = rectCenter(drag.window.frameGeometry);
        const center = cursorPoint ?? frameCenter;
        const pointSource: "cursor" | "frame-center" = cursorPoint !== null ? "cursor" : "frame-center";
        dragSnapshotBefore(drag, topology, null, center, pointSource);
        const origin = operationLeafForTile(topology, drag.originTile);
        if (origin === null) {
            bailDrag("drag-bail:origin-unresolved", drag);
            return;
        }
        if (origin.leaf.isLayout) {
            bailDrag("drag-bail:origin-is-layout", drag);
            return;
        }
        recoverGeometryDrop(drag, scope, topology, origin, center, pointSource);
    };

    const handleInvalidated = (window: WindowCapability): void => {
        capabilities.runGuarded(() => {
            if (resizeObservations.delete(window)) {
                diagnostic("resize-observer-invalidated");
                detach(window);
                return;
            }
            if (dragState.current?.window === window) {
                diagnostic("drag-bail:window-invalidated");
                clear();
            }
            if (capabilities.isMaximized(window)) {
                diagnostic("maximize:ignored lifecycle while maximized");
                return;
            }
            detach(window);
            settleOwedInvariants();
        });
    };

    const handleStarted = (window: WindowCapability): void => {
        diagnostic("drag-started");
        capabilities.runGuarded(() => {
            if (window.fullScreen === true) {
                diagnostic("fullscreen:ignored lifecycle while fullscreen");
                return;
            }
            if (capabilities.isMaximized(window)) {
                diagnostic("maximize:ignored lifecycle while maximized");
                return;
            }
            if (window.resize && window.tile !== null && isCustomTile(window.tile)) {
                resizeObservations.add(window);
                diagnostic("resize-observer-started");
                return;
            }
            const watch = interactiveWindows.get(window);
            if (watch !== undefined) {
                watch.kind = window.resize ? "resize" : window.move ? "move" : "unknown";
            }
            if (dragState.current !== undefined) {
                if (trackedDragLive()) {
                    diagnostic("drag-origin-capture-failed:already-active");
                    return;
                }
                clear();
                settleOwedInvariants();
            }
            if (window.resize) {
                diagnostic("drag-origin-capture-failed:resize");
                return;
            }
            if (!window.move) {
                diagnostic("drag-origin-capture-failed:not-move");
                return;
            }
            if (capabilities.isFloating(window)) {
                diagnostic("drag-origin-capture-failed:floating");
                return;
            }
            const scope = capabilities.scopeForWindow(window);
            if (scope === null || !capabilities.windowInScope(window, scope)) {
                diagnostic("drag-origin-capture-failed:scope");
                return;
            }
            if (window.tile === null || !isCustomTile(window.tile)) {
                diagnostic("drag-origin-capture-failed:tile-association");
                return;
            }
            if (capabilities.isInert(scope)) {
                diagnostic("drag-origin-capture-failed:scope-inert");
                return;
            }
            const topology = capabilities.topologyForScope(scope);
            if (topology === null) {
                diagnostic("drag-origin-capture-failed:topology");
                return;
            }
            if (!positiveGeometry(window.frameGeometry)) {
                diagnostic("drag-origin-capture-failed:geometry-invalid");
                return;
            }
            const origin = operationLeafForTile(topology, window.tile);
            if (origin === null || origin.leaf.isLayout || windowIndex(origin.windows, window) < 0) {
                diagnostic("drag-origin-capture-failed:origin-occupancy");
                return;
            }
            dragState.current = {
                scope,
                window,
                originTile: window.tile,
                originGeometry: {
                    x: window.frameGeometry.x,
                    y: window.frameGeometry.y,
                    width: window.frameGeometry.width,
                    height: window.frameGeometry.height,
                },
                armedDeferredRemoval: false,
            };
            diagnostic("drag-origin-captured");
        });
    };

    const handleFinished = (window: WindowCapability): void => {
        capabilities.runGuarded(() => {
            if (resizeObservations.delete(window)) {
                diagnostic("resize-observer-finished");
                return;
            }
            if (window.fullScreen === true) {
                diagnostic("fullscreen:ignored lifecycle while fullscreen");
                hideDropOutline();
                return;
            }
            if (capabilities.isMaximized(window)) {
                diagnostic("maximize:ignored lifecycle while maximized");
                hideDropOutline();
                return;
            }
            const watch = interactiveWindows.get(window);
            const wasResize = watch?.kind === "resize";
            if (watch !== undefined) {
                watch.kind = "unknown";
            }
            const drag = dragState.current;
            if (drag === undefined) {
                diagnostic(wasResize ? "drag-bail:no-tracked-drag:resize" : "drag-bail:no-tracked-drag");
                return;
            }
            if (drag.window !== window) {
                diagnostic("drag-bail:window-mismatch");
                return;
            }
            try {
                completeDrag(drag);
            } finally {
                clear();
            }
            if (!drag.armedDeferredRemoval) {
                settleOwedInvariants();
            }
            capabilities.afterFinished();
        });
    };

    const handleStepped = (window: WindowCapability, geometry: RectCapability): void => {
        capabilities.runGuarded(() => {
            if (resizeObservations.has(window) || interactiveWindows.get(window)?.kind === "resize") {
                return;
            }
            if (!capabilities.dropOutlinePreview()) {
                return;
            }
            const drag = dragState.current;
            if (drag === undefined) {
                return;
            }
            const scope = capabilities.scopeForWindow(drag.window);
            if (
                scope === null ||
                scope.scope.output !== drag.scope.scope.output ||
                scope.scope.desktopId !== drag.scope.scope.desktopId ||
                !capabilities.windowInScope(drag.window, scope)
            ) {
                hideDropOutline();
                return;
            }
            const topology = capabilities.topologyForScope(scope);
            if (topology === null) {
                hideDropOutline();
                return;
            }
            const origin = operationLeafForTile(topology, drag.originTile);
            if (origin === null || origin.leaf.isLayout) {
                hideDropOutline();
                return;
            }
            const originIndex = windowIndex(origin.windows, drag.window);
            const draggedRef = origin.refs[originIndex];
            if (originIndex < 0 || draggedRef === undefined) {
                hideDropOutline();
                return;
            }
            const cursorPoint = readCursorPoint();
            const center = cursorPoint ?? (isRect(geometry) && positiveGeometry(geometry) ? rectCenter(geometry) : null);
            const pointSource: "cursor" | "frame-center" = cursorPoint !== null ? "cursor" : "frame-center";
            const target = geometryDropTarget(topology, origin, center, pointSource);
            if (target.kind !== "resolved") {
                hideDropOutline();
                return;
            }
            const plan = planGeometryDrop({
                scope: scope.scope,
                originLeaf: origin.leaf,
                targetLeaf: target.target.leaf,
                draggedWindow: draggedRef,
                pointer: target.center,
                record: {
                    scope: drag.scope.scope,
                    originLeafId: origin.leaf.id,
                    windowId: draggedRef.id,
                    geometry: drag.originGeometry,
                },
            });
            if (!plan.ok || (plan.value.kind === "geometry-drop" && splitWouldViolateMinimum(scope, target.target, plan.value.direction))) {
                hideDropOutline();
                return;
            }
            showDropOutline(target.target.leaf.geometry);
        });
    };

    const attach = (
        window: unknown,
    ): { readonly attempted: number; readonly ok: number; readonly failed: number } | null => {
        if (interactiveWindows.size >= MAX_SEQUENTIAL_LENGTH) {
            diagnostic("drag-attach-skipped:max-windows");
            return null;
        }
        if (!isWindow(window)) {
            diagnostic("drag-attach-skipped:not-window");
            return null;
        }
        if (interactiveWindows.has(window)) {
            diagnostic("drag-attach-skipped:duplicate");
            return null;
        }
        const scope = capabilities.scopeForWindow(window);
        if (scope === null) {
            diagnostic("drag-attach-skipped:no-scope");
            return null;
        }
        if (!capabilities.windowInScope(window, scope)) {
            diagnostic("drag-attach-skipped:out-of-scope");
            return null;
        }
        const watched = capabilities.watchInteractiveWindow(
            window,
            () => handleStarted(window),
            () => handleFinished(window),
            (geometry) => handleStepped(window, geometry),
            () => handleMoveResizedChanged(),
            () => handleInvalidated(window),
        );
        interactiveWindows.set(window, { disconnect: watched.disconnect, kind: "unknown" });
        return { attempted: watched.ok + watched.failed, ok: watched.ok, failed: watched.failed };
    };

    const detach = (window: WindowCapability): void => {
        const watch = interactiveWindows.get(window);
        if (watch === undefined) {
            return;
        }
        if (resizeObservations.delete(window)) {
            diagnostic("resize-observer-invalidated");
        }
        interactiveWindows.delete(window);
        watch.disconnect();
    };

    const attachExisting = (emitSummary: boolean): void => {
        const decoded = decodeSequential(capabilities.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!decoded.ok) {
            diagnostic("drag-attach-skipped:window-list-decode-failed");
            return;
        }
        capabilities.decodedBoundary("workspace-window-list");
        let attempted = 0;
        let ok = 0;
        let failed = 0;
        for (const window of decoded.value) {
            capabilities.onExistingWindow(window);
            const result = attach(window);
            if (result !== null) {
                attempted += result.attempted;
                ok += result.ok;
                failed += result.failed;
            }
        }
        if (emitSummary) {
            diagnostic(`drag-attach-summary:${attempted}:${ok}:${failed}`);
        }
    };

    const handleMoveResizedChanged = (): void => {
        diagnostic("drag-move-resized-changed");
        capabilities.runGuarded(() => settleOwedInvariants());
    };

    const normalizeReflowLeaves = (
        scope: CurrentScope,
        reflowLeaves: ReflowLeaves | undefined,
        topology: readonly OperationLeaf[],
    ): readonly OperationLeaf[] => {
        if (reflowLeaves === undefined) {
            return topology;
        }
        const draggedLeaf = isTile(reflowLeaves.dragged.tile)
            ? operationLeafForTile(topology, reflowLeaves.dragged.tile)
            : null;
        const occupantLeaf = isTile(reflowLeaves.occupant.tile)
            ? operationLeafForTile(topology, reflowLeaves.occupant.tile)
            : null;
        if (
            draggedLeaf === null ||
            occupantLeaf === null ||
            draggedLeaf.decoded.tile === occupantLeaf.decoded.tile ||
            draggedLeaf.leaf.isLayout ||
            occupantLeaf.leaf.isLayout
        ) {
            diagnostic("drag-reflow-normalize-skipped:leaf-resolution");
            return topology;
        }
        const parent = draggedLeaf.decoded.tile.parent;
        if (parent === null || !isTile(parent) || !isCustomTile(parent) || !parent.isLayout) {
            diagnostic("drag-reflow-normalize-skipped:no-layout-parent");
            return topology;
        }
        if (occupantLeaf.decoded.tile.parent !== parent) {
            diagnostic("drag-reflow-normalize-skipped:not-siblings");
            return topology;
        }
        const axis: SplitAxis | null = parent.layoutDirection === 1 ? "x" : parent.layoutDirection === 2 ? "y" : null;
        if (axis === null) {
            diagnostic("drag-reflow-normalize-skipped:floating-parent");
            return topology;
        }
        const plan = planEqualSplit(
            parent.relativeGeometry,
            draggedLeaf.decoded.tile.relativeGeometry,
            occupantLeaf.decoded.tile.relativeGeometry,
            axis,
        );
        if (plan === null) {
            diagnostic("drag-reflow-normalize-skipped:geometry-incompatible");
            return topology;
        }
        const draggedNear = axis === "x" ? draggedLeaf.decoded.tile.relativeGeometry.x : draggedLeaf.decoded.tile.relativeGeometry.y;
        const occupantNear = axis === "x" ? occupantLeaf.decoded.tile.relativeGeometry.x : occupantLeaf.decoded.tile.relativeGeometry.y;
        const firstTile = draggedNear <= occupantNear ? draggedLeaf.decoded.tile : occupantLeaf.decoded.tile;
        if (!setRelativeGeometry(firstTile, plan.first)) {
            diagnostic("drag-reflow-normalize-failed:write");
            return topology;
        }
        const fresh = capabilities.topologyForScope(scope);
        if (fresh === null) {
            diagnostic("drag-reflow-normalize-failed:post-decode");
            return topology;
        }
        const freshDragged = isTile(reflowLeaves.dragged.tile)
            ? operationLeafForTile(fresh, reflowLeaves.dragged.tile)
            : null;
        const freshOccupant = isTile(reflowLeaves.occupant.tile)
            ? operationLeafForTile(fresh, reflowLeaves.occupant.tile)
            : null;
        if (
            freshDragged === null ||
            freshOccupant === null ||
            !equalAlongAxis(freshDragged.decoded.tile.relativeGeometry, freshOccupant.decoded.tile.relativeGeometry, axis)
        ) {
            diagnostic("drag-reflow-normalize-failed:mismatch");
            return fresh;
        }
        diagnostic("drag-reflow-normalized");
        return fresh;
    };

    const afterDeferredRemoval = (
        topology: readonly OperationLeaf[],
        collapsed: boolean,
        reflowLeaves: ReflowLeaves | undefined,
        scope: CurrentScope,
        transaction?: DragDiagnosticTransaction,
    ): readonly OperationLeaf[] => {
        if (transaction !== undefined) {
            transaction.ordering.push("origin-removal");
            if (collapsed) {
                transaction.ordering.push("collapse");
                transaction.ordering.push(reflowLeaves === undefined ? "normalization-unavailable" : "normalization");
            } else {
                transaction.ordering.push("collapse-unavailable");
                transaction.ordering.push("normalization-unavailable");
            }
        }
        const after = collapsed ? normalizeReflowLeaves(scope, reflowLeaves, topology) : topology;
        dragSnapshotAfter(after);
        if (transaction !== undefined) {
            transaction.ordering.push("after-snapshot");
            emitDiagnosticTransaction(transaction, after);
        }
        return after;
    };

    return {
        current: () => dragState.current,
        hasActive: () => dragState.current !== undefined,
        isLive: trackedDragLive,
        clear,
        showDropOutline,
        hideDropOutline,
        markOwedInvariant,
        settleOwedInvariants,
        attachExisting,
        attach,
        detach,
        handleInvalidated,
        handleStarted,
        handleFinished,
        handleStepped,
        handleMoveResizedChanged,
        dragSnapshotFinal,
        afterDeferredRemoval,
        isOutlineShown: () => shownDropOutline !== null,
    };
}
