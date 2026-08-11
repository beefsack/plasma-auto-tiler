// Pure immutable binary split topology for the Custom Tile vertical slice.
// A blueprint describes structure only: a balanced binary tree of a positive
// number of leaves, each carrying a deterministic traversal ordinal. No KWin
// or Qt types are referenced, no geometry or ratio is expressed, and no
// execution instruction is emitted. Inputs and outputs are never mutated.
import { type Rejection, type Result } from "./logic";

// Caller-selected split orientation, propagated to every interior node.
export type Orientation = "vertical" | "horizontal";

// Immutable binary topology. A leaf is a unit of the requested count; a branch
// divides its total leaf count into floor/ceil halves with the caller-selected
// orientation. The union is exhaustive across the two node shapes.
export interface BlueprintBranch {
    readonly kind: "branch";
    readonly orientation: Orientation;
    readonly left: Blueprint;
    readonly right: Blueprint;
}

export interface BlueprintLeaf {
    readonly kind: "leaf";
    readonly ordinal: number;
}

export type Blueprint = BlueprintBranch | BlueprintLeaf;

function reject(
    kind: Rejection["kind"],
    message: string,
): { readonly ok: false; readonly reason: Rejection } {
    return { ok: false, reason: { kind, message } };
}

// Deterministic balanced generator. Every interior node divides its count into
// floor(left)/ceil(right) halves and carries the caller-selected orientation.
// Repeated calls with equivalent inputs return structurally equal blueprints.
export function buildBlueprint(count: number, orientation: Orientation): Result<Blueprint> {
    if (!Number.isInteger(count) || count <= 0) {
        return reject(
            "invalid-leaf-count",
            "leaf count must be a positive integer",
        );
    }
    return { ok: true, value: buildNode(count, orientation, 0) };
}

function buildNode(count: number, orientation: Orientation, startOrdinal: number): Blueprint {
    if (count === 1) {
        return { kind: "leaf", ordinal: startOrdinal };
    }
    const leftCount = Math.floor(count / 2);
    const rightCount = count - leftCount;
    const left = buildNode(leftCount, orientation, startOrdinal);
    const right = buildNode(rightCount, orientation, startOrdinal + leftCount);
    return { kind: "branch", orientation, left, right };
}
