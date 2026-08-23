import type { TileCapability, WindowCapability } from "./boundary";
import type { OperationLeaf } from "./controller-topology";
import type { CurrentScope, SelectedOverlay } from "./controller-reflow-observers";

const MAX_YIELD_REARM_PER_PHASE = 2;

export interface ManagedScope {
    readonly scope: CurrentScope;
    readonly inert: boolean;
}

export type RebuildPhase = "awaiting-collapse" | "awaiting-split";

export interface PendingRebuild {
    readonly scope: CurrentScope;
    phase: RebuildPhase;
    rearmCount: number;
    dragFinalSnapshot?: boolean;
}

export interface LayoutEnvironment {
    readonly yieldOnce: (callback: () => void) => boolean;
}

export interface LayoutScopeCapabilities {
    readonly scopeForWindow: (window: unknown) => CurrentScope | null;
    readonly topologyForScope: (scope: CurrentScope) => readonly OperationLeaf[] | null;
}

export interface LayoutReflowCapabilities {
    readonly afterAddition: (window: WindowCapability, scope: CurrentScope) => {
        readonly kind: "no-selection" | "no-capacity" | "no-op" | "completed" | "rejected" | "partial";
    };
    readonly readSelectedOverlay: (scope: CurrentScope) => SelectedOverlay | null;
}

export interface LayoutPlacementCapabilities {
    readonly placeAutomatically: (window: WindowCapability, scope: CurrentScope) => { readonly kind: string };
    readonly dwindleInsert: (window: WindowCapability, scope: CurrentScope) => void;
}

export interface LayoutStateCapabilities {
    readonly isFloating: (window: WindowCapability) => boolean;
    readonly scopeHasFloating: (scope: CurrentScope) => boolean;
    readonly scopeHasFullscreen: (scope: CurrentScope) => boolean;
    readonly scopeHasMaximized: (scope: CurrentScope) => boolean;
}

export interface LayoutOwnershipCapabilities {
    readonly managedRecord: (scope: CurrentScope) => ManagedScope | null;
    readonly setManaged: (scope: CurrentScope) => void;
    readonly markInert: (scope: CurrentScope, reason: string) => void;
    readonly pendingForScope: (scope: CurrentScope) => PendingRebuild | undefined;
    readonly setPendingRebuild: (scope: CurrentScope, pending: PendingRebuild) => void;
    readonly dropPendingRebuild: (scope: CurrentScope, pending: PendingRebuild) => void;
    readonly hasPendingRebuilds: () => boolean;
}

export interface LayoutStructuralCapabilities {
    readonly flush: () => void;
    readonly ownedPopulation: (scope: CurrentScope) => readonly WindowCapability[];
    readonly presetMatches: (scope: CurrentScope, population: readonly WindowCapability[]) => boolean;
    readonly collapseOwnedScope: (scope: CurrentScope) => boolean;
    readonly rebuildPreset: (scope: CurrentScope, population: readonly WindowCapability[]) => boolean;
    readonly presetEnsureInvariant: (scope: CurrentScope) => void;
    readonly dwindleRemove: (window: WindowCapability, scope: CurrentScope) => void;
    readonly settleRemovalCollapse: (
        window: WindowCapability,
        scope: CurrentScope,
        leafTile: TileCapability,
        afterDragSnapshot: boolean,
        onDragSettled: ((topology: readonly OperationLeaf[], collapsed: boolean) => readonly OperationLeaf[]) | undefined,
    ) => void;
}

export interface LayoutDragCapabilities {
    readonly isLive: () => boolean;
    readonly markOwedInvariant: (scope: CurrentScope) => void;
    readonly dragSnapshotFinal: (topology: readonly OperationLeaf[]) => void;
}

export interface LayoutCallbacks {
    readonly diagnostic: (event: string) => void;
    readonly onceDiagnostic: (event: string) => void;
    readonly onSettled: () => void;
    readonly onDeferredRemovalSettled: () => void;
}

export interface LayoutDomainCapabilities {
    readonly environment: LayoutEnvironment;
    readonly scope: LayoutScopeCapabilities;
    readonly reflow: LayoutReflowCapabilities;
    readonly placement: LayoutPlacementCapabilities;
    readonly state: LayoutStateCapabilities;
    readonly ownership: LayoutOwnershipCapabilities;
    readonly structural: LayoutStructuralCapabilities;
    readonly drag: LayoutDragCapabilities;
    readonly callbacks: LayoutCallbacks;
}

export interface LayoutDomain {
    readonly markInert: (scope: CurrentScope, reason: string) => void;
    readonly hasPendingRebuilds: () => boolean;
    readonly hasPendingRebuild: (scope: CurrentScope) => boolean;
    readonly markPendingDragFinalSnapshot: (scope: CurrentScope) => void;
    readonly ensureManaged: (scope: CurrentScope) => void;
    readonly startReconstruction: (scope: CurrentScope) => void;
    readonly isOwned: (scope: CurrentScope) => boolean;
    readonly isInert: (scope: CurrentScope) => boolean;
    readonly placeEligibleAdded: (window: WindowCapability, scope: CurrentScope) => void;
    readonly dwindleMaybeRemove: (window: WindowCapability) => void;
    readonly deferRemovalCollapse: (
        window: WindowCapability,
        scope: CurrentScope,
        leafTile: TileCapability,
        afterDragSnapshot?: boolean,
        onDragSettled?: (topology: readonly OperationLeaf[], collapsed: boolean) => readonly OperationLeaf[],
    ) => void;
}

export function createLayoutDomain(capabilities: LayoutDomainCapabilities): LayoutDomain {
    const { environment, scope, reflow, placement, state, ownership, structural, drag, callbacks } = capabilities;
    const { diagnostic, onceDiagnostic, onSettled, onDeferredRemovalSettled } = callbacks;

    const managedRecord = (current: CurrentScope): ManagedScope | null =>
        ownership.managedRecord(current);

    const isOwned = (current: CurrentScope): boolean => {
        const record = managedRecord(current);
        return record !== null && !record.inert;
    };

    const isInert = (current: CurrentScope): boolean => managedRecord(current)?.inert === true;

    const setManaged = (current: CurrentScope): void => {
        ownership.setManaged(current);
    };

    const markInert = (current: CurrentScope, reason: string): void => {
        ownership.markInert(current, reason);
    };

    const dropPendingRebuild = (current: CurrentScope, pending: PendingRebuild): void => {
        if (ownership.pendingForScope(current) !== pending) {
            return;
        }
        ownership.dropPendingRebuild(current, pending);
        if (pending.dragFinalSnapshot) {
            const topology = scope.topologyForScope(current);
            if (topology !== null) {
                drag.dragSnapshotFinal(topology);
            }
        }
        if (!ownership.hasPendingRebuilds()) {
            onSettled();
        }
    };

    const settleScopeRebuild = (current: CurrentScope, pending: PendingRebuild): void => {
        if (isInert(current) || !isOwned(current)) {
            dropPendingRebuild(current, pending);
            return;
        }
        if (state.scopeHasFullscreen(current)) {
            dropPendingRebuild(current, pending);
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (state.scopeHasMaximized(current)) {
            dropPendingRebuild(current, pending);
            diagnostic("maximize:ignored reconstruction while maximized");
            return;
        }
        if (drag.isLive()) {
            drag.markOwedInvariant(current);
            dropPendingRebuild(current, pending);
            return;
        }
        if (reflow.readSelectedOverlay(current) !== null) {
            dropPendingRebuild(current, pending);
            return;
        }
        const population = structural.ownedPopulation(current);
        if (population.length === 0 || structural.presetMatches(current, population)) {
            dropPendingRebuild(current, pending);
            return;
        }
        if (pending.phase === "awaiting-collapse") {
            if (!structural.collapseOwnedScope(current)) {
                markInert(current, "collapse-failed");
                dropPendingRebuild(current, pending);
                return;
            }
            pending.phase = "awaiting-split";
            pending.rearmCount = 0;
            diagnostic("ownership-collapsed");
            if (!armRebuildYield(current, pending)) {
                markInert(current, "split-yield-arm-failed");
                dropPendingRebuild(current, pending);
            }
            return;
        }
        if (structural.rebuildPreset(current, population)) {
            diagnostic("ownership-taken");
        } else {
            markInert(current, "rebuild-failed");
        }
        dropPendingRebuild(current, pending);
    };

    const armRebuildYield = (current: CurrentScope, pending: PendingRebuild): boolean => {
        const armedFor = pending.phase;
        let armed = false;
        try {
            armed = environment.yieldOnce(() => {
                try {
                    if (ownership.pendingForScope(current) !== pending || pending.phase !== armedFor) {
                        return;
                    }
                    settleScopeRebuild(current, pending);
                } finally {
                    structural.flush();
                }
            });
        } catch (error) {
            void error;
            return false;
        }
        return armed;
    };

    const startReconstruction = (current: CurrentScope): void => {
        if (state.scopeHasFullscreen(current)) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (state.scopeHasMaximized(current)) {
            diagnostic("maximize:ignored reconstruction while maximized");
            return;
        }
        if (drag.isLive()) {
            drag.markOwedInvariant(current);
            return;
        }
        const existing = ownership.pendingForScope(current);
        if (existing !== undefined) {
            existing.rearmCount += 1;
            if (existing.rearmCount > MAX_YIELD_REARM_PER_PHASE || !armRebuildYield(current, existing)) {
                markInert(current, existing.rearmCount > MAX_YIELD_REARM_PER_PHASE ? "rearm-budget-exhausted" : "rearm-yield-arm-failed");
                dropPendingRebuild(current, existing);
            }
            return;
        }
        const pending: PendingRebuild = { scope: current, phase: "awaiting-collapse", rearmCount: 0 };
        ownership.setPendingRebuild(current, pending);
        if (!armRebuildYield(current, pending)) {
            markInert(current, "initial-yield-arm-failed");
            dropPendingRebuild(current, pending);
            return;
        }
        diagnostic("ownership-pending");
    };

    const ensureManaged = (current: CurrentScope): void => {
        if (isOwned(current) || isInert(current) || reflow.readSelectedOverlay(current) !== null) {
            return;
        }
        const population = structural.ownedPopulation(current);
        if (population.length === 0) {
            return;
        }
        setManaged(current);
        if (state.scopeHasFloating(current) || structural.presetMatches(current, population)) {
            diagnostic("ownership-taken");
            return;
        }
        startReconstruction(current);
    };

    const refillOrPlaceAutomatically = (window: WindowCapability, current: CurrentScope): void => {
        const outcome = reflow.afterAddition(window, current);
        if (outcome.kind === "no-selection" || outcome.kind === "no-capacity") {
            if (window.tile !== null) {
                return;
            }
            const result = placement.placeAutomatically(window, current);
            if (result.kind !== "managed") {
                diagnostic(`window-added-noop:${result.kind}`);
            }
        }
    };

    const placeEligibleAdded = (window: WindowCapability, current: CurrentScope): void => {
        if (state.isFloating(window)) {
            return;
        }
        if (state.scopeHasFullscreen(current)) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (!isOwned(current) && !isInert(current)) {
            ensureManaged(current);
        }
        if (!isOwned(current)) {
            refillOrPlaceAutomatically(window, current);
            return;
        }
        const outcome = reflow.afterAddition(window, current);
        if (outcome.kind === "no-capacity") {
            placement.placeAutomatically(window, current);
            return;
        }
        if (outcome.kind === "no-selection" && window.tile === null) {
            const result = placement.placeAutomatically(window, current);
            if (result.kind === "managed") {
                return;
            }
            placement.dwindleInsert(window, current);
            structural.presetEnsureInvariant(current);
        }
    };

    const dwindleMaybeRemove = (window: WindowCapability): void => {
        const current = scope.scopeForWindow(window);
        if (current === null) {
            return;
        }
        if (isInert(current)) {
            onceDiagnostic("ownership-inert-ignored:removal");
            return;
        }
        if (!isOwned(current)) {
            return;
        }
        if (drag.isLive()) {
            drag.markOwedInvariant(current);
            return;
        }
        structural.dwindleRemove(window, current);
    };

    const deferRemovalCollapse = (
        window: WindowCapability,
        current: CurrentScope,
        leafTile: TileCapability,
        afterDragSnapshot = false,
        onDragSettled?: (topology: readonly OperationLeaf[], collapsed: boolean) => readonly OperationLeaf[],
    ): void => {
        let armed = false;
        try {
            armed = environment.yieldOnce(() => {
                try {
                    structural.settleRemovalCollapse(window, current, leafTile, afterDragSnapshot, onDragSettled);
                    onDeferredRemovalSettled();
                } finally {
                    structural.flush();
                }
            });
        } catch (error) {
            void error;
        }
        if (!armed) {
            markInert(current, "removal-yield-arm-failed");
            return;
        }
        diagnostic("ownership-remove-deferred");
    };

    return {
        markInert,
        hasPendingRebuilds: ownership.hasPendingRebuilds,
        hasPendingRebuild: (current) => ownership.pendingForScope(current) !== undefined,
        markPendingDragFinalSnapshot: (current) => {
            const pending = ownership.pendingForScope(current);
            if (pending !== undefined) {
                pending.dragFinalSnapshot = true;
            }
        },
        ensureManaged,
        startReconstruction,
        isOwned,
        isInert,
        placeEligibleAdded,
        dwindleMaybeRemove,
        deferRemovalCollapse,
    };
}
