import {
    assignWindowToTile,
    decodeSequential,
    isTile,
    isWindow,
    MAX_SEQUENTIAL_LENGTH,
    sameScope,
    type OutputCapability,
    type StructuralMutationReporter,
    type TileCapability,
    type VirtualDesktopCapability,
    type WindowCapability,
} from "./boundary";
import type { PresetKind } from "./preset-catalog";
import type { Scope } from "./logic";

const DESKTOP_SCOPE_REEVALUATION_DELAY_MS = 50;

export interface CurrentScope {
    readonly scope: Scope;
    readonly output: OutputCapability;
    readonly desktop: VirtualDesktopCapability;
}

export interface SelectedOverlay {
    readonly scope: CurrentScope;
    readonly preset: PresetKind;
    readonly root: TileCapability;
    readonly leaves: readonly TileCapability[];
}

export type ReflowOutcome =
    | { readonly kind: "no-selection" }
    | { readonly kind: "no-op" }
    | { readonly kind: "no-capacity" }
    | { readonly kind: "completed"; readonly writes: number }
    | { readonly kind: "rejected"; readonly reason: string }
    | { readonly kind: "partial"; readonly reason: string; readonly writes: number };

export interface ReflowObserverCapabilities {
    readonly rootTile: (output: OutputCapability, desktop: VirtualDesktopCapability) => unknown;
    readonly scopeForWindow: (window: unknown) => CurrentScope | null;
    readonly windowInScope: (window: unknown, scope: CurrentScope) => window is WindowCapability;
    readonly decodeTileTree: (root: TileCapability) => readonly TileCapability[] | null;
    readonly collectPresetLeaves: (root: TileCapability) => readonly TileCapability[] | null;
    readonly scopeHasFullscreen: (scope: CurrentScope) => boolean;
    readonly reflowTouchesMaximized: (scope: CurrentScope, overlay: SelectedOverlay) => boolean;
    readonly mutation: StructuralMutationReporter;
    readonly diagnostic: (event: string) => void;
    readonly onceDiagnostic: (event: string) => void;
    readonly desktopScopeCheck: (window: WindowCapability, scope: CurrentScope) => string;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => () => void;
    readonly runGuarded: (operation: () => void) => void;
    readonly onEligibleDeferred: (window: WindowCapability, scope: CurrentScope) => void;
}

export interface ReflowObservers {
    readonly recordSelectedOverlay: (
        scope: CurrentScope,
        preset: PresetKind,
        root: TileCapability,
        leaves: readonly TileCapability[],
    ) => void;
    readonly readSelectedOverlay: (scope: CurrentScope) => SelectedOverlay | null;
    readonly runReflow: (scope: CurrentScope, candidate?: WindowCapability) => ReflowOutcome;
    readonly afterRemoval: (window: WindowCapability) => void;
    readonly afterDetach: (scope: CurrentScope, origin: TileCapability) => void;
    readonly afterAddition: (window: WindowCapability, scope: CurrentScope) => ReflowOutcome;
    readonly deferDesktopScopeReevaluation: (window: WindowCapability, scope: CurrentScope) => void;
    readonly cancelDeferredEligibility: (window: WindowCapability) => void;
}

interface ReflowWrite {
    readonly window: WindowCapability;
    readonly source: TileCapability | null;
    readonly target: TileCapability;
}

export function createReflowObservers(capabilities: ReflowObserverCapabilities): ReflowObservers {
    const selectedOverlays = new Map<OutputCapability, Map<string, SelectedOverlay>>();
    const removedOccupants = new Set<WindowCapability>();
    const deferredEligibility = new Map<WindowCapability, () => void>();
    const {
        rootTile,
        scopeForWindow,
        windowInScope,
        decodeTileTree,
        collectPresetLeaves,
        scopeHasFullscreen,
        reflowTouchesMaximized,
        mutation,
        diagnostic,
        onceDiagnostic,
        desktopScopeCheck,
        scheduleOnce,
        runGuarded,
        onEligibleDeferred,
    } = capabilities;

    const recordSelectedOverlay = (
        scope: CurrentScope,
        preset: PresetKind,
        root: TileCapability,
        leaves: readonly TileCapability[],
    ): void => {
        let byDesktop = selectedOverlays.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, SelectedOverlay>();
            selectedOverlays.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, { scope, preset, root, leaves });
    };

    const selectedOverlayValid = (overlay: SelectedOverlay): boolean => {
        const root = rootTile(overlay.scope.output, overlay.scope.desktop);
        if (!isTile(root)) {
            return false;
        }
        const tiles = decodeTileTree(root);
        if (tiles === null || !tiles.some((tile) => tile === overlay.root)) {
            return false;
        }
        const realized = collectPresetLeaves(overlay.root);
        if (realized === null || realized.length !== overlay.leaves.length) {
            return false;
        }
        for (let index = 0; index < realized.length; index += 1) {
            if (realized[index] !== overlay.leaves[index]) {
                return false;
            }
        }
        return true;
    };

    const readSelectedOverlay = (scope: CurrentScope): SelectedOverlay | null => {
        const byDesktop = selectedOverlays.get(scope.output);
        const overlay = byDesktop?.get(scope.desktop.id);
        if (overlay === undefined) {
            return null;
        }
        if (!selectedOverlayValid(overlay)) {
            byDesktop?.delete(scope.desktop.id);
            diagnostic("selected-overlay-invalidated");
            return null;
        }
        return overlay;
    };

    const reflowTargetIsAvailable = (target: TileCapability): boolean => {
        const windows = decodeSequential(target.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return false;
        }
        for (const occupant of windows.value) {
            if (!removedOccupants.has(occupant) && occupant.tile === target) {
                return false;
            }
        }
        return true;
    };

    const reflowAssignmentRevalidates = (
        scope: CurrentScope,
        window: WindowCapability,
        source: TileCapability | null,
        target: TileCapability,
    ): boolean => {
        if (!windowInScope(window, scope) || window.tile !== source) {
            return false;
        }
        const overlay = readSelectedOverlay(scope);
        return overlay !== null && overlay.leaves.includes(target) && reflowTargetIsAvailable(target);
    };

    const reflowSelectedOverlay = (scope: CurrentScope, candidate?: WindowCapability): ReflowOutcome => {
        const overlay = readSelectedOverlay(scope);
        if (overlay === null) {
            return { kind: "no-selection" };
        }
        if (reflowTouchesMaximized(scope, overlay)) {
            diagnostic("maximize:ignored reflow while maximized");
            return { kind: "no-op" };
        }
        if (overlay.leaves.length === 0) {
            return { kind: "rejected", reason: "topology-decode" };
        }
        const occupants: WindowCapability[] = [];
        const seen = new Set<WindowCapability>();
        for (const leaf of overlay.leaves) {
            const windows = decodeSequential(leaf.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok) {
                return { kind: "rejected", reason: "topology-decode" };
            }
            for (const window of windows.value) {
                if (seen.has(window)) {
                    return { kind: "rejected", reason: "occupancy-validity" };
                }
                if (window.tile !== leaf || removedOccupants.has(window)) {
                    continue;
                }
                if (!windowInScope(window, scope)) {
                    return { kind: "rejected", reason: "occupancy-validity" };
                }
                seen.add(window);
                occupants.push(window);
            }
        }
        if (candidate !== undefined) {
            if (
                !windowInScope(candidate, scope) ||
                candidate.tile !== null ||
                seen.has(candidate) ||
                removedOccupants.has(candidate)
            ) {
                return { kind: "rejected", reason: "candidate-eligibility" };
            }
            if (occupants.length >= overlay.leaves.length) {
                return { kind: "no-capacity" };
            }
            occupants.push(candidate);
        }
        if (occupants.length > overlay.leaves.length) {
            return { kind: "rejected", reason: "capacity" };
        }
        const plan: ReflowWrite[] = [];
        for (let index = 0; index < occupants.length; index += 1) {
            const occupant = occupants[index];
            const target = overlay.leaves[index];
            if (occupant === undefined || target === undefined) {
                return { kind: "rejected", reason: "capacity" };
            }
            if (occupant.tile === target) {
                continue;
            }
            const source = occupant.tile;
            if (source !== null && !isTile(source)) {
                return { kind: "rejected", reason: "source-validity" };
            }
            plan.push({ window: occupant, source, target });
        }
        if (plan.length === 0) {
            return { kind: "no-op" };
        }
        let writes = 0;
        for (const entry of plan) {
            if (!reflowAssignmentRevalidates(scope, entry.window, entry.source, entry.target)) {
                return writes === 0
                    ? { kind: "rejected", reason: "assignment-stale" }
                    : { kind: "partial", reason: "assignment-stale", writes };
            }
            let assigned = false;
            try {
                assigned = assignWindowToTile(entry.window, entry.target, mutation);
            } catch (error) {
                void error;
                return writes === 0
                    ? { kind: "rejected", reason: "assignment-failed" }
                    : { kind: "partial", reason: "assignment-failed", writes };
            }
            if (!assigned) {
                return writes === 0
                    ? { kind: "rejected", reason: "assignment-failed" }
                    : { kind: "partial", reason: "assignment-failed", writes };
            }
            writes += 1;
        }
        return { kind: "completed", writes };
    };

    const runReflow = (scope: CurrentScope, candidate?: WindowCapability): ReflowOutcome => {
        if (scopeHasFullscreen(scope)) {
            diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return { kind: "no-op" };
        }
        const outcome = reflowSelectedOverlay(scope, candidate);
        switch (outcome.kind) {
            case "no-op":
                diagnostic("reflow-noop");
                break;
            case "no-capacity":
                diagnostic("reflow-no-capacity");
                break;
            case "completed":
                diagnostic("reflow-completed");
                break;
            case "rejected":
                diagnostic(`reflow-rejected:${outcome.reason}`);
                break;
            case "partial":
                diagnostic(`reflow-partial:${outcome.reason}`);
                break;
            case "no-selection":
                break;
        }
        return outcome;
    };

    const noteRemovedOccupant = (window: WindowCapability): void => {
        if (removedOccupants.size >= MAX_SEQUENTIAL_LENGTH) {
            const stale = removedOccupants.values().next().value;
            if (stale !== undefined) {
                removedOccupants.delete(stale);
            }
        }
        removedOccupants.add(window);
    };

    const reflowSelectedScopesContaining = (window: WindowCapability): void => {
        for (const byDesktop of selectedOverlays.values()) {
            for (const overlay of byDesktop.values()) {
                const current = readSelectedOverlay(overlay.scope);
                if (current === null) {
                    continue;
                }
                for (const leaf of current.leaves) {
                    const windows = decodeSequential(leaf.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
                    if (windows.ok && windows.value.includes(window)) {
                        runReflow(current.scope);
                        break;
                    }
                }
            }
        }
    };

    const afterRemoval = (window: WindowCapability): void => {
        noteRemovedOccupant(window);
        const scope = scopeForWindow(window);
        if (scope === null) {
            reflowSelectedScopesContaining(window);
            return;
        }
        if (selectedOverlays.get(scope.output)?.get(scope.desktop.id) === undefined) {
            return;
        }
        runReflow(scope);
    };

    const afterDetach = (scope: CurrentScope, origin: TileCapability): void => {
        const overlay = readSelectedOverlay(scope);
        if (overlay !== null && overlay.leaves.includes(origin)) {
            runReflow(scope);
        }
    };

    const deferDesktopScopeReevaluation = (window: WindowCapability, scope: CurrentScope): void => {
        if (deferredEligibility.size >= MAX_SEQUENTIAL_LENGTH || deferredEligibility.has(window)) {
            return;
        }
        onceDiagnostic(`window-added-deferred:${desktopScopeCheck(window, scope)}`);
        const cancel = scheduleOnce(DESKTOP_SCOPE_REEVALUATION_DELAY_MS, () => {
            if (deferredEligibility.get(window) !== cancel) {
                return;
            }
            deferredEligibility.delete(window);
            runGuarded(() => {
                const freshScope = scopeForWindow(window);
                if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
                    onceDiagnostic("window-added-rejected-deferred:scope-changed");
                    return;
                }
                onceDiagnostic(`window-added-reevaluated:${desktopScopeCheck(window, freshScope)}`);
                if (!windowInScope(window, freshScope)) {
                    onceDiagnostic("window-added-rejected-deferred:desktop-scope-mismatch");
                    return;
                }
                onceDiagnostic("window-added-eligible-deferred");
                onEligibleDeferred(window, freshScope);
            });
        });
        deferredEligibility.set(window, cancel);
    };

    const cancelDeferredEligibility = (window: WindowCapability): void => {
        const cancel = deferredEligibility.get(window);
        if (cancel === undefined) {
            return;
        }
        deferredEligibility.delete(window);
        cancel();
    };

    return {
        recordSelectedOverlay,
        readSelectedOverlay,
        runReflow,
        afterRemoval,
        afterDetach,
        afterAddition: (window, scope) => runReflow(scope, window),
        deferDesktopScopeReevaluation,
        cancelDeferredEligibility,
    };
}
