import {
    decodeSequential,
    isCustomTile,
    isNativelyMaximized,
    isRect,
    isVirtualDesktop,
    isWindow,
    MAX_SEQUENTIAL_LENGTH,
    type CustomTileCapability,
    type WindowCapability,
} from "./boundary";
import { customTileSplitSeam } from "./custom-tile-split";
import {
    planCosmicDirectionalMove,
    type CosmicDirectionalMoveRequest,
    type CosmicMoveOperation,
    type CosmicMoveOutcome,
    type CosmicOutputTopology,
} from "./directional-movement-planner";
import type { Direction } from "./logic";

export interface DirectionalRuntimeOutput {
    readonly id: string;
    readonly workspaceId: string;
    readonly nativeOutput: object;
    readonly root: unknown;
    readonly adjacent: Readonly<Partial<Record<Direction, string>>>;
}

export interface DirectionalRuntimeEnvironment {
    readonly outputs: () => readonly DirectionalRuntimeOutput[];
    readonly activeWindow: () => unknown;
    readonly setActiveWindow: (window: WindowCapability) => void;
    readonly mutate: (operation: CosmicMoveOperation, context: DirectionalMutationContext) => boolean | void;
    readonly rollback?: (snapshot: DirectionalTopologySnapshot) => boolean;
    readonly recover?: (snapshot: DirectionalTopologySnapshot) => boolean;
    readonly minimumSizeSatisfied?: (
        operation: CosmicMoveOperation,
        topology: DirectionalDecodedTopology,
    ) => boolean;
    readonly validatePostcondition: (
        operation: CosmicMoveOperation,
        before: DirectionalTopologySnapshot,
        after: DirectionalDecodedTopology,
    ) => boolean;
    readonly disable?: (reason: string) => void;
}

export interface DirectionalDecodedOutput extends CosmicOutputTopology {
    readonly nativeOutput: object;
    readonly nativeRoot: CustomTileCapability | null;
}

export interface DirectionalDecodedTopology {
    readonly outputs: readonly DirectionalDecodedOutput[];
    readonly tilesById: ReadonlyMap<string, CustomTileCapability>;
    readonly windows: readonly WindowCapability[];
}

export interface DirectionalTopologySnapshot {
    readonly topology: DirectionalDecodedTopology;
    readonly activeWindow: WindowCapability;
    readonly activeTile: CustomTileCapability;
    readonly native: readonly NativeOutputSnapshot[];
}

export interface DirectionalMutationContext {
    readonly before: DirectionalTopologySnapshot;
    readonly topology: DirectionalDecodedTopology;
    readonly sourceOutput: DirectionalDecodedOutput;
    readonly focusedTile: CustomTileCapability;
    readonly tilesById: ReadonlyMap<string, CustomTileCapability>;
    readonly split: typeof customTileSplitSeam.split;
}

export type DirectionalRuntimeResult =
    | { readonly kind: "moved"; readonly plan: CosmicMoveOutcome }
    | { readonly kind: "noop"; readonly plan: CosmicMoveOutcome }
    | { readonly kind: "rejected"; readonly reason: DirectionalRuntimeRejection }
    | { readonly kind: "failed"; readonly reason: DirectionalRuntimeFailure };

export type DirectionalRuntimeRejection =
    | "no-active-window"
    | "malformed-topology"
    | "workspace-mismatch"
    | "native-maximized"
    | "duplicate-active-occupancy"
    | "stale-topology"
    | "minimum-size-failure";

export type DirectionalRuntimeFailure = "mutation-failed" | "postcondition-failed" | "recovery-failed" | "disabled";

interface NativeTileSnapshot {
    readonly tile: CustomTileCapability;
    readonly children: readonly CustomTileCapability[];
    readonly windows: readonly WindowCapability[];
    readonly windowLinks: readonly Readonly<{
        readonly window: WindowCapability;
        readonly tile: object | null;
        readonly output: object | null;
        readonly desktops: readonly object[];
    }>[];
    readonly isLayout: boolean;
    readonly layoutDirection: number;
    readonly parent: object | null;
    readonly relativeGeometry: RectSnapshot;
    readonly absoluteGeometry: RectSnapshot;
}

interface RectSnapshot {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface NativeOutputSnapshot {
    readonly id: string;
    readonly root: CustomTileCapability | null;
    readonly tiles: readonly NativeTileSnapshot[];
}

interface DecodeState {
    readonly outputs: DirectionalDecodedOutput[];
    readonly tilesById: Map<string, CustomTileCapability>;
    readonly windows: WindowCapability[];
    readonly native: NativeOutputSnapshot[];
    readonly seenTiles: Set<object>;
    readonly currentTiles: NativeTileSnapshot[];
}

interface DecodeSuccess {
    readonly ok: true;
    readonly value: DirectionalDecodedTopology;
    readonly native: readonly NativeOutputSnapshot[];
}

interface DecodeFailure {
    readonly ok: false;
    readonly reason: DirectionalRuntimeRejection;
}

type DecodeResult = DecodeSuccess | DecodeFailure;

function safelyDecodeOutputs(outputs: readonly DirectionalRuntimeOutput[]): DecodeResult {
    try {
        return decodeOutputs(outputs);
    } catch (error) {
        void error;
        return { ok: false, reason: "malformed-topology" };
    }
}

function failed(reason: DirectionalRuntimeFailure): DirectionalRuntimeResult {
    return { kind: "failed", reason };
}

function rectSnapshot(rect: unknown): RectSnapshot | null {
    if (!isRect(rect)) {
        return null;
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function nativeTileSnapshot(
    tile: CustomTileCapability,
    children: readonly CustomTileCapability[],
    windows: readonly WindowCapability[],
): NativeTileSnapshot | null {
    const relativeGeometry = rectSnapshot(tile.relativeGeometry);
    const absoluteGeometry = rectSnapshot(tile.absoluteGeometry);
    if (relativeGeometry === null || absoluteGeometry === null || typeof tile.isLayout !== "boolean" || typeof tile.layoutDirection !== "number") {
        return null;
    }
    const windowLinks = windows.map((window) => {
        const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
        if (!desktops.ok) {
            return null;
        }
        return { window, tile: window.tile, output: window.output, desktops: Object.freeze([...desktops.value]) };
    });
    if (windowLinks.some((link) => link === null)) {
        return null;
    }
    return {
        tile,
        children: Object.freeze([...children]),
        windows: Object.freeze([...windows]),
        windowLinks: Object.freeze(windowLinks as readonly Readonly<{
            readonly window: WindowCapability;
            readonly tile: object | null;
            readonly output: object | null;
            readonly desktops: readonly object[];
        }>[]),
        isLayout: tile.isLayout,
        layoutDirection: tile.layoutDirection,
        parent: tile.parent,
        relativeGeometry,
        absoluteGeometry,
    };
}

function decodeNativeChildren(tile: CustomTileCapability): readonly CustomTileCapability[] | null {
    const decoded = decodeSequential(tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
    if (!decoded.ok) {
        return null;
    }
    if (decoded.value.length === 0) {
        return [];
    }
    return customTileSplitSeam.decodeChildren(tile);
}

function decodeOutputs(outputs: readonly DirectionalRuntimeOutput[]): DecodeResult {
    if (!Array.isArray(outputs) || outputs.length === 0) {
        return { ok: false, reason: "malformed-topology" };
    }
    const ids = new Set<string>();
    const state: DecodeState = {
        outputs: [],
        tilesById: new Map(),
        windows: [],
        native: [],
        seenTiles: new Set(),
        currentTiles: [],
    };
    for (const output of outputs) {
        if (
            typeof output.id !== "string" ||
            output.id.length === 0 ||
            ids.has(output.id) ||
            typeof output.workspaceId !== "string" ||
            output.workspaceId.length === 0 ||
            typeof output.nativeOutput !== "object" ||
            output.nativeOutput === null ||
            typeof output.adjacent !== "object" ||
            output.adjacent === null
        ) {
            return { ok: false, reason: "malformed-topology" };
        }
        ids.add(output.id);
        for (const direction of ["left", "right", "up", "down"] as const) {
            const target = output.adjacent[direction];
            if (target !== undefined && (typeof target !== "string" || target === output.id)) {
                return { ok: false, reason: "malformed-topology" };
            }
        }
    }
    for (const output of outputs) {
        const root = output.root === null ? null : isCustomTile(output.root) ? output.root : undefined;
        if (root === undefined) {
            return { ok: false, reason: "malformed-topology" };
        }
        const path = `${output.id}:root`;
        state.currentTiles.length = 0;
        let tree: CosmicOutputTopology["tree"];
        if (root === null) {
            tree = null;
        } else if (root.isLayout && decodeNativeChildren(root)?.length === 0) {
            const windows = decodeSequential(root.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok || windows.value.length !== 0 || state.seenTiles.has(root)) {
                return { ok: false, reason: "malformed-topology" };
            }
            state.seenTiles.add(root);
            const snapshot = nativeTileSnapshot(root, [], []);
            if (snapshot === null) {
                return { ok: false, reason: "malformed-topology" };
            }
            state.currentTiles.push(snapshot);
            state.tilesById.set(path, root);
            tree = null;
        } else {
            const decoded = decodeNode(root, path, state);
            if (decoded === null) {
                return { ok: false, reason: "malformed-topology" };
            }
            tree = decoded;
        }
        state.outputs.push({
            id: output.id,
            workspaceId: output.workspaceId,
            tree,
            adjacent: output.adjacent,
            nativeOutput: output.nativeOutput,
            nativeRoot: root,
        });
        if (root !== null && state.currentTiles.length === 0) {
            return { ok: false, reason: "malformed-topology" };
        }
        state.native.push({ id: output.id, root, tiles: Object.freeze([...state.currentTiles]) });
    }
    for (const output of outputs) {
        for (const direction of ["left", "right", "up", "down"] as const) {
            const target = output.adjacent[direction];
            if (target !== undefined && !ids.has(target)) {
                return { ok: false, reason: "malformed-topology" };
            }
        }
    }
    return {
        ok: true,
        value: {
            outputs: Object.freeze(state.outputs),
            tilesById: state.tilesById,
            windows: Object.freeze(state.windows),
        },
        native: Object.freeze(state.native),
    };
}

function decodeNode(
    tile: CustomTileCapability,
    id: string,
    state: DecodeState,
): DirectionalDecodedOutput["tree"] {
    if (state.seenTiles.has(tile)) {
        return null;
    }
    state.seenTiles.add(tile);
    const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
    if (!windows.ok || windows.value.length > 0 && tile.isLayout) {
        return null;
    }
    for (const window of windows.value) {
        state.windows.push(window);
    }
    let children: readonly CustomTileCapability[];
    if (tile.isLayout) {
        const decodedChildren = decodeNativeChildren(tile);
        if (decodedChildren === null || decodedChildren.length === 0) {
            return null;
        }
        children = decodedChildren;
    } else {
        const decodedChildren = decodeSequential(tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
        if (!decodedChildren.ok || decodedChildren.value.length !== 0) {
            return null;
        }
        children = [];
    }
    const nativeChildren = tile.isLayout ? Object.freeze([...children]) : [];
    const snapshot = nativeTileSnapshot(tile, nativeChildren, windows.value);
    if (snapshot === null) {
        return null;
    }
    state.currentTiles.push(snapshot);
    state.tilesById.set(id, tile);
    if (tile.isLayout) {
        const childNodes = [];
        for (let index = 0; index < children.length; index += 1) {
            const child = children[index];
            if (child === undefined) {
                return null;
            }
            const childNode = decodeNode(child, `${id}/${index}`, state);
            if (childNode === null) {
                return null;
            }
            childNodes.push(childNode);
        }
        if (childNodes.length < 2) {
            return null;
        }
        return {
            kind: "group",
            id,
            axis: tile.layoutDirection === 1 ? "horizontal" : "vertical",
            children: Object.freeze(childNodes),
        };
    }
    return { kind: "leaf", id };
}

function hasWorkspace(window: WindowCapability, workspaceId: string): boolean {
    const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
    return desktops.ok && desktops.value.some((desktop) => desktop.id === workspaceId);
}

function activeAssignment(
    topology: DirectionalDecodedTopology,
    active: WindowCapability,
): { readonly output: DirectionalDecodedOutput; readonly tile: CustomTileCapability; readonly count: number } | null {
    let found: { readonly output: DirectionalDecodedOutput; readonly tile: CustomTileCapability } | null = null;
    let count = 0;
    for (const output of topology.outputs) {
        for (const [id, tile] of topology.tilesById) {
            if (!id.startsWith(`${output.id}:`)) {
                continue;
            }
            const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok) {
                return null;
            }
            for (const window of windows.value) {
                if (window === active) {
                    count += 1;
                    found = { output, tile };
                }
            }
        }
    }
    return found === null ? null : { ...found, count };
}

function validOccupancy(
    outputs: readonly DirectionalRuntimeOutput[],
    topology: DirectionalDecodedTopology,
    active: WindowCapability,
): DirectionalRuntimeRejection | null {
    const byNativeOutput = new Map<object, DirectionalRuntimeOutput>();
    for (const output of outputs) {
        byNativeOutput.set(output.nativeOutput, output);
    }
    for (const decoded of topology.outputs) {
        const input = byNativeOutput.get(decoded.nativeOutput);
        if (input === undefined) {
            return "malformed-topology";
        }
    }
    const seen = new Set<object>();
    for (const [id, tile] of topology.tilesById) {
        const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        const output = outputs.find((entry) => id.startsWith(`${entry.id}:`));
        if (output === undefined || !windows.ok || windows.value.some((window) => window.tile !== tile)) {
            return "stale-topology";
        }
        for (const window of windows.value) {
            if (isNativelyMaximized(window)) {
                return "native-maximized";
            }
            if (window.output !== output.nativeOutput || !hasWorkspace(window, output.workspaceId)) {
                return "workspace-mismatch";
            }
        }
    }
    for (const window of topology.windows) {
        if (!window.normalWindow || !window.managed || !window.resizeable || window.appletPopup || window.fullScreen === true || window.onAllDesktops === true) {
            return "stale-topology";
        }
        if (seen.has(window)) {
            return window === active ? "duplicate-active-occupancy" : "stale-topology";
        }
        seen.add(window);
    }
    return null;
}

function plannerPostcondition(
    operation: CosmicMoveOperation,
    before: DirectionalTopologySnapshot,
    after: DirectionalDecodedTopology,
    active: WindowCapability,
): boolean {
    const assignment = activeAssignment(after, active);
    if (assignment === null || assignment.count !== 1 || assignment.tile === before.activeTile) {
        return false;
    }
    if (operation.kind === "swap-neighbor") {
        return assignment.tile === before.topology.tilesById.get(operation.neighborId);
    }
    if (operation.kind === "cross-output") {
        return assignment.output.id === operation.targetOutputId;
    }
    return true;
}

function sameRect(a: RectSnapshot, b: RectSnapshot): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function snapshotMatches(a: DirectionalTopologySnapshot, native: readonly NativeOutputSnapshot[]): boolean {
    if (a.native.length !== native.length) {
        return false;
    }
    for (let outputIndex = 0; outputIndex < a.native.length; outputIndex += 1) {
        const before = a.native[outputIndex];
        const after = native[outputIndex];
        if (before === undefined || after === undefined || before.id !== after.id || before.root !== after.root || before.tiles.length !== after.tiles.length) {
            return false;
        }
        for (let tileIndex = 0; tileIndex < before.tiles.length; tileIndex += 1) {
            const oldTile = before.tiles[tileIndex];
            const newTile = after.tiles[tileIndex];
            if (
                oldTile === undefined ||
                newTile === undefined ||
                oldTile.tile !== newTile.tile ||
                oldTile.isLayout !== newTile.isLayout ||
                oldTile.layoutDirection !== newTile.layoutDirection ||
                oldTile.parent !== newTile.parent ||
                !sameRect(oldTile.relativeGeometry, newTile.relativeGeometry) ||
                !sameRect(oldTile.absoluteGeometry, newTile.absoluteGeometry) ||
                oldTile.children.length !== newTile.children.length ||
                oldTile.windows.length !== newTile.windows.length ||
                oldTile.windowLinks.length !== newTile.windowLinks.length ||
                oldTile.children.some((child, index) => child !== newTile.children[index]) ||
                oldTile.windows.some((window, index) => window !== newTile.windows[index]) ||
                oldTile.windowLinks.some(
                    (assignment, index) =>
                        assignment.window !== newTile.windowLinks[index]?.window ||
                        assignment.tile !== newTile.windowLinks[index]?.tile ||
                        assignment.output !== newTile.windowLinks[index]?.output ||
                        assignment.desktops.length !== newTile.windowLinks[index]?.desktops.length ||
                        assignment.desktops.some((desktop, desktopIndex) => desktop !== newTile.windowLinks[index]?.desktops[desktopIndex]),
                )
            ) {
                return false;
            }
        }
    }
    return true;
}

export function createDirectionalMovementRuntime(environment: DirectionalRuntimeEnvironment): {
    readonly move: (direction: Direction) => DirectionalRuntimeResult;
    readonly isEnabled: () => boolean;
} {
    let enabled = true;

    const disable = (reason: string): void => {
        enabled = false;
        try {
            environment.disable?.(reason);
        } catch (error) {
            void error;
        }
    };

    const restore = (snapshot: DirectionalTopologySnapshot): boolean => {
        let restored = false;
        try {
            restored = environment.rollback?.(snapshot) === true;
        } catch (error) {
            void error;
        }
        let decoded: DecodeResult;
        try {
            decoded = safelyDecodeOutputs(environment.outputs());
        } catch (error) {
            void error;
            return false;
        }
        if (restored && decoded.ok && snapshotMatches(snapshot, decoded.native)) {
            return true;
        }
        try {
            restored = environment.recover?.(snapshot) === true;
        } catch (error) {
            void error;
            restored = false;
        }
        try {
            decoded = safelyDecodeOutputs(environment.outputs());
        } catch (error) {
            void error;
            return false;
        }
        return restored && decoded.ok && snapshotMatches(snapshot, decoded.native);
    };

    const move = (direction: Direction): DirectionalRuntimeResult => {
        if (!enabled) {
            return failed("disabled");
        }
        let activeValue: unknown;
        try {
            activeValue = environment.activeWindow();
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "no-active-window" };
        }
        if (!isWindow(activeValue)) {
            return { kind: "rejected", reason: "no-active-window" };
        }
        try {
            if (isNativelyMaximized(activeValue)) {
                return { kind: "rejected", reason: "native-maximized" };
            }
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "stale-topology" };
        }
        let inputs: readonly DirectionalRuntimeOutput[];
        try {
            inputs = environment.outputs();
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "malformed-topology" };
        }
        const decoded = safelyDecodeOutputs(inputs);
        if (!decoded.ok) {
            return { kind: "rejected", reason: decoded.reason };
        }
        let occupancyFailure: DirectionalRuntimeRejection | null;
        try {
            occupancyFailure = validOccupancy(inputs, decoded.value, activeValue);
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "stale-topology" };
        }
        if (occupancyFailure !== null) {
            return { kind: "rejected", reason: occupancyFailure };
        }
        let matchingOutputs: readonly DirectionalDecodedOutput[];
        try {
            matchingOutputs = decoded.value.outputs.filter(
                (output) => output.nativeOutput === activeValue.output && hasWorkspace(activeValue, output.workspaceId),
            );
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "workspace-mismatch" };
        }
        if (matchingOutputs.length !== 1) {
            return { kind: "rejected", reason: "workspace-mismatch" };
        }
        const sourceOutput = matchingOutputs[0];
        if (sourceOutput === undefined) {
            return { kind: "rejected", reason: "workspace-mismatch" };
        }
        let active: ReturnType<typeof activeAssignment>;
        try {
            active = activeAssignment(decoded.value, activeValue);
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "stale-topology" };
        }
        if (active === null || active.count !== 1 || active.output.id !== sourceOutput.id || active.tile !== activeValue.tile) {
            return {
                kind: "rejected",
                reason: active !== null && active.count !== 1 ? "duplicate-active-occupancy" : "stale-topology",
            };
        }
        const request: CosmicDirectionalMoveRequest = {
            outputs: decoded.value.outputs,
            sourceOutputId: sourceOutput.id,
            focusedLeafId: [...decoded.value.tilesById.entries()].find((entry) => entry[1] === active.tile)?.[0] ?? "",
            direction,
        };
        if (request.focusedLeafId.length === 0) {
            return { kind: "rejected", reason: "stale-topology" };
        }
        const plan = planCosmicDirectionalMove(request);
        if (plan.kind === "rejected") {
            return { kind: "rejected", reason: "malformed-topology" };
        }
        if (plan.kind !== "planned") {
            return { kind: "noop", plan };
        }
        if (environment.minimumSizeSatisfied !== undefined) {
            try {
                if (!environment.minimumSizeSatisfied(plan.operation, decoded.value)) {
                    return { kind: "rejected", reason: "minimum-size-failure" };
                }
            } catch (error) {
                void error;
                return { kind: "rejected", reason: "minimum-size-failure" };
            }
        }
        let validatePostcondition: DirectionalRuntimeEnvironment["validatePostcondition"];
        try {
            validatePostcondition = environment.validatePostcondition;
        } catch (error) {
            void error;
            return { kind: "rejected", reason: "malformed-topology" };
        }
        if (typeof validatePostcondition !== "function") {
            return { kind: "rejected", reason: "malformed-topology" };
        }
        const snapshot: DirectionalTopologySnapshot = {
            topology: decoded.value,
            activeWindow: activeValue,
            activeTile: active.tile,
            native: decoded.native,
        };
        const context: DirectionalMutationContext = {
            before: snapshot,
            topology: decoded.value,
            sourceOutput,
            focusedTile: active.tile,
            tilesById: decoded.value.tilesById,
            split: customTileSplitSeam.split,
        };
        let mutationSucceeded = false;
        try {
            mutationSucceeded = environment.mutate(plan.operation, context) !== false;
        } catch (error) {
            void error;
        }
        if (!mutationSucceeded) {
            if (!restore(snapshot)) {
                disable("directional-movement-recovery-failed");
                return failed("recovery-failed");
            }
            return failed("mutation-failed");
        }
        let afterInputs: readonly DirectionalRuntimeOutput[];
        let after: DecodeResult;
        try {
            afterInputs = environment.outputs();
            after = safelyDecodeOutputs(afterInputs);
        } catch (error) {
            void error;
            afterInputs = [];
            after = { ok: false, reason: "malformed-topology" };
        }
        let customPostcondition = false;
        if (after.ok) {
            try {
                customPostcondition = validatePostcondition(plan.operation, snapshot, after.value);
            } catch (error) {
                void error;
                customPostcondition = false;
            }
        }
        let plannedPostcondition = false;
        if (after.ok) {
            try {
                plannedPostcondition = plannerPostcondition(plan.operation, snapshot, after.value, activeValue);
            } catch (error) {
                void error;
                plannedPostcondition = false;
            }
        }
        const postcondition =
            after.ok &&
            (() => {
                try {
                    return validOccupancy(afterInputs, after.value, activeValue) === null;
                } catch (error) {
                    void error;
                    return false;
                }
            })() &&
            plannedPostcondition &&
            customPostcondition;
        if (!postcondition) {
            if (!restore(snapshot)) {
                disable("directional-movement-recovery-failed");
                return failed("recovery-failed");
            }
            return failed("postcondition-failed");
        }
        try {
            environment.setActiveWindow(activeValue);
        } catch (error) {
            void error;
            if (!restore(snapshot)) {
                disable("directional-movement-recovery-failed");
                return failed("recovery-failed");
            }
            return failed("postcondition-failed");
        }
        return { kind: "moved", plan };
    };

    return { move, isEnabled: () => enabled };
}
