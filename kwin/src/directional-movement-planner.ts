import type { Direction } from "./logic";

export type CosmicAxis = "horizontal" | "vertical";

export interface CosmicLeaf {
    readonly kind: "leaf";
    readonly id: string;
}

export interface CosmicGroup {
    readonly kind: "group";
    readonly id: string;
    readonly axis: CosmicAxis;
    readonly children: readonly CosmicNode[];
}

export type CosmicNode = CosmicLeaf | CosmicGroup;

export interface CosmicOutputTopology {
    readonly id: string;
    readonly workspaceId: string;
    readonly tree: CosmicNode | null;
    readonly adjacent: Readonly<Partial<Record<Direction, string>>>;
}

export interface CosmicDirectionalMoveRequest {
    readonly outputs: readonly CosmicOutputTopology[];
    readonly sourceOutputId: string;
    readonly focusedLeafId: string;
    readonly direction: Direction;
}

export type CosmicMoveRule = "R1" | "R2a" | "R2b" | "R2c" | "R3" | "R4";

interface OperationBase {
    readonly sourceOutputId: string;
    readonly focusedLeafId: string;
    readonly direction: Direction;
}

export type CosmicMoveOperation =
    | (OperationBase & {
          readonly kind: "wrap-perpendicular";
          readonly rule: "R1";
          readonly containerId: string;
          readonly axis: CosmicAxis;
      })
    | (OperationBase & {
          readonly kind: "swap-neighbor";
          readonly rule: "R2a";
          readonly containerId: string;
          readonly neighborId: string;
      })
    | (OperationBase & {
          readonly kind: "insert-into-group";
          readonly rule: "R2b";
          readonly containerId: string;
          readonly targetGroupId: string;
          readonly insertionIndex: number;
          readonly insertion: "midpoint" | "near-edge";
      })
    | (OperationBase & {
          readonly kind: "split-group-child";
          readonly rule: "R2b";
          readonly containerId: string;
          readonly targetGroupId: string;
          readonly targetChildId: string;
          readonly targetChildIndex: number;
          readonly focusedSide: "first" | "second";
          readonly axis: CosmicAxis;
      })
    | (OperationBase & {
          readonly kind: "wrap-neighbor";
          readonly rule: "R2c";
          readonly containerId: string;
          readonly neighborId: string;
          readonly focusedBeforeNeighbor: boolean;
          readonly axis: CosmicAxis;
      })
    | (OperationBase & {
          readonly kind: "escape-parent";
          readonly rule: "R3";
          readonly containerId: string;
          readonly parentId: string;
          readonly containerChildIndex: number;
          readonly parentInsertionIndex: number | null;
          readonly continuation: "none" | "R1";
      })
    | (OperationBase & {
          readonly kind: "cross-output";
          readonly rule: "R4";
          readonly targetOutputId: string;
          readonly sourceRootChildIndex: number;
          readonly target: "empty" | "occupied";
      });

export interface CosmicMovePlan {
    readonly kind: "planned";
    readonly rule: CosmicMoveRule;
    readonly operation: CosmicMoveOperation;
}

export type CosmicNoopReason = "boundary" | "no-adjacent-output" | "single-root-leaf";

export interface CosmicMoveNoop {
    readonly kind: "noop";
    readonly reason: CosmicNoopReason;
}

export type CosmicRejectionKind =
    | "malformed-topology"
    | "unsupported-topology"
    | "focused-leaf-not-found";

export interface CosmicMoveRejection {
    readonly kind: "rejected";
    readonly reason: {
        readonly kind: CosmicRejectionKind;
        readonly message: string;
    };
}

export type CosmicMoveOutcome = CosmicMovePlan | CosmicMoveNoop | CosmicMoveRejection;

interface PathEntry {
    readonly group: CosmicGroup;
    readonly childIndex: number;
}

interface ValidatedOutputSet {
    readonly source: CosmicOutputTopology;
    readonly byId: ReadonlyMap<string, CosmicOutputTopology>;
}

function rejected(kind: CosmicRejectionKind, message: string): CosmicMoveRejection {
    return { kind: "rejected", reason: { kind, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isDirection(value: unknown): value is Direction {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function isAxis(value: unknown): value is CosmicAxis {
    return value === "horizontal" || value === "vertical";
}

function axisFor(direction: Direction): CosmicAxis {
    return direction === "left" || direction === "right" ? "horizontal" : "vertical";
}

function stepFor(direction: Direction): 1 | -1 {
    return direction === "right" || direction === "down" ? 1 : -1;
}

function findPath(node: CosmicNode, focusedLeafId: string): readonly PathEntry[] | undefined {
    if (node.kind === "leaf") {
        return node.id === focusedLeafId ? [] : undefined;
    }
    for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child === undefined) {
            return undefined;
        }
        const nested = findPath(child, focusedLeafId);
        if (nested !== undefined) {
            return [{ group: node, childIndex: index }, ...nested];
        }
    }
    return undefined;
}

function validateNode(node: unknown, ids: Set<string>, seen: Set<object>): boolean {
    if (!isRecord(node) || seen.has(node)) {
        return false;
    }
    seen.add(node);
    if (typeof node.id !== "string" || node.id.length === 0 || ids.has(node.id)) {
        return false;
    }
    ids.add(node.id);
    if (node.kind === "leaf") {
        return true;
    }
    if (node.kind !== "group" || !isAxis(node.axis) || !isArray(node.children) || node.children.length < 2) {
        return false;
    }
    for (const child of node.children) {
        if (!validateNode(child, ids, seen)) {
            return false;
        }
    }
    return true;
}

function validateOutputs(request: CosmicDirectionalMoveRequest): ValidatedOutputSet | CosmicMoveRejection {
    if (
        !isRecord(request) ||
        !isDirection(request.direction) ||
        typeof request.sourceOutputId !== "string" ||
        request.sourceOutputId.length === 0 ||
        typeof request.focusedLeafId !== "string" ||
        request.focusedLeafId.length === 0
    ) {
        return rejected("malformed-topology", "directional movement request is malformed");
    }
    if (!isArray(request.outputs) || request.outputs.length === 0) {
        return rejected("malformed-topology", "at least one output topology is required");
    }
    const byId = new Map<string, CosmicOutputTopology>();
    const seenNodes = new Set<object>();
    for (const output of request.outputs) {
        if (!isRecord(output) || typeof output.id !== "string" || output.id.length === 0 || byId.has(output.id)) {
            return rejected("malformed-topology", "output identities must be non-empty and unique");
        }
        if (typeof output.workspaceId !== "string" || output.workspaceId.length === 0 || !isRecord(output.adjacent)) {
            return rejected("malformed-topology", "output scope and adjacency must be present");
        }
        if (output.tree !== null && !validateNode(output.tree, new Set<string>(), seenNodes)) {
            return rejected("malformed-topology", "output tree is malformed or contains unsupported sharing");
        }
        byId.set(output.id, output);
    }
    const source = byId.get(request.sourceOutputId);
    if (source === undefined) {
        return rejected("malformed-topology", "source output is not present");
    }
    for (const output of request.outputs) {
        for (const direction of ["left", "right", "up", "down"] as const) {
            const targetId = output.adjacent[direction];
            if (targetId !== undefined && (typeof targetId !== "string" || targetId === output.id || !byId.has(targetId))) {
                return rejected("malformed-topology", "output adjacency references an unknown or self output");
            }
        }
    }
    return { source, byId };
}

function operationBase(request: CosmicDirectionalMoveRequest): OperationBase {
    return {
        sourceOutputId: request.sourceOutputId,
        focusedLeafId: request.focusedLeafId,
        direction: request.direction,
    };
}

function planLocalMove(
    request: CosmicDirectionalMoveRequest,
    source: CosmicOutputTopology,
    path: readonly PathEntry[],
): CosmicMovePlan | CosmicMoveNoop {
    if (path.length === 0) {
        return { kind: "noop", reason: "single-root-leaf" };
    }
    const directionAxis = axisFor(request.direction);
    const step = stepFor(request.direction);
    const base = operationBase(request);
    for (let level = path.length - 1; level >= 0; level -= 1) {
        const ancestor = path[level];
        if (ancestor === undefined) {
            return { kind: "noop", reason: "boundary" };
        }
        const group = ancestor.group;
        const index = ancestor.childIndex;
        if (group.axis !== directionAxis) {
            return {
                kind: "planned",
                rule: "R1",
                operation: {
                    ...base,
                    kind: "wrap-perpendicular",
                    rule: "R1",
                    containerId: group.id,
                    axis: directionAxis,
                },
            };
        }
        const neighborIndex = index + step;
        const neighbor = group.children[neighborIndex];
        if (neighbor !== undefined) {
            if (group.children.length === 2) {
                if (neighbor.kind === "leaf") {
                    return {
                        kind: "planned",
                        rule: "R2a",
                        operation: {
                            ...base,
                            kind: "swap-neighbor",
                            rule: "R2a",
                            containerId: group.id,
                            neighborId: neighbor.id,
                        },
                    };
                }
                if (neighbor.axis === group.axis) {
                    const insertionIndex = index < neighborIndex ? 0 : neighbor.children.length;
                    return {
                        kind: "planned",
                        rule: "R2b",
                        operation: {
                            ...base,
                            kind: "insert-into-group",
                            rule: "R2b",
                            containerId: group.id,
                            targetGroupId: neighbor.id,
                            insertionIndex,
                            insertion: "near-edge",
                        },
                    };
                }
                const targetChildIndex = Math.floor(neighbor.children.length / 2);
                if (neighbor.children.length % 2 === 0) {
                    return {
                        kind: "planned",
                        rule: "R2b",
                        operation: {
                            ...base,
                            kind: "insert-into-group",
                            rule: "R2b",
                            containerId: group.id,
                            targetGroupId: neighbor.id,
                            insertionIndex: targetChildIndex,
                            insertion: "midpoint",
                        },
                    };
                }
                const targetChild = neighbor.children[targetChildIndex];
                if (targetChild === undefined) {
                    return { kind: "noop", reason: "boundary" };
                }
                return {
                    kind: "planned",
                    rule: "R2b",
                    operation: {
                        ...base,
                        kind: "split-group-child",
                        rule: "R2b",
                        containerId: group.id,
                        targetGroupId: neighbor.id,
                        targetChildId: targetChild.id,
                        targetChildIndex,
                        focusedSide: step === -1 ? "first" : "second",
                        axis: directionAxis,
                    },
                };
            }
            return {
                kind: "planned",
                rule: "R2c",
                operation: {
                    ...base,
                    kind: "wrap-neighbor",
                    rule: "R2c",
                    containerId: group.id,
                    neighborId: neighbor.id,
                    focusedBeforeNeighbor: index < neighborIndex,
                    axis: group.axis,
                },
            };
        }
        if (level === 0) {
            const targetId = source.adjacent[request.direction];
            if (targetId === undefined) {
                return { kind: "noop", reason: "no-adjacent-output" };
            }
            return { kind: "noop", reason: "boundary" };
        }
        const parent = path[level - 1];
        if (parent === undefined) {
            return { kind: "noop", reason: "boundary" };
        }
        const parentInsertionIndex = parent.childIndex + (step === 1 ? 1 : 0);
        return {
            kind: "planned",
            rule: "R3",
            operation: {
                ...base,
                kind: "escape-parent",
                rule: "R3",
                containerId: group.id,
                parentId: parent.group.id,
                containerChildIndex: parent.childIndex,
                parentInsertionIndex: parent.group.axis === group.axis ? parentInsertionIndex : null,
                continuation: parent.group.axis === group.axis ? "none" : "R1",
            },
        };
    }
    return { kind: "noop", reason: "boundary" };
}

export function planCosmicDirectionalMove(request: CosmicDirectionalMoveRequest): CosmicMoveOutcome {
    const validated = validateOutputs(request);
    if ("kind" in validated) {
        return validated;
    }
    const { source, byId } = validated;
    if (source.tree === null) {
        return { kind: "noop", reason: "boundary" };
    }
    const path = findPath(source.tree, request.focusedLeafId);
    if (path === undefined) {
        return rejected("focused-leaf-not-found", "focused leaf is not present in the source topology");
    }
    const local = planLocalMove(request, source, path);
    if (local.kind === "planned" || local.reason !== "boundary") {
        return local;
    }
    if (path.length !== 1 || source.tree.kind !== "group") {
        return local;
    }
    const targetId = source.adjacent[request.direction];
    if (targetId === undefined) {
        return { kind: "noop", reason: "no-adjacent-output" };
    }
    const target = byId.get(targetId);
    if (target === undefined || target.workspaceId !== source.workspaceId) {
        return { kind: "noop", reason: "no-adjacent-output" };
    }
    const sourceIndex = path[0]?.childIndex;
    if (sourceIndex === undefined) {
        return { kind: "noop", reason: "boundary" };
    }
    return {
        kind: "planned",
        rule: "R4",
        operation: {
            ...operationBase(request),
            kind: "cross-output",
            rule: "R4",
            targetOutputId: target.id,
            sourceRootChildIndex: sourceIndex,
            target: target.tree === null ? "empty" : "occupied",
        },
    };
}
