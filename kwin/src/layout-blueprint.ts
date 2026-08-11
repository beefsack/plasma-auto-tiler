// Pure immutable binary split topology for the Custom Tile vertical slice.
// A blueprint describes structure only: an immutable binary tree of a positive
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

// A branch's orientation resolved from its depth in the tree. The root branch
// sits at depth zero and each child branch one depth deeper.
export type OrientationAtDepth = (depth: number) => Orientation;

// Deterministic balanced generator with a constant caller-selected
// orientation. Every interior node divides its count into floor(left)/
// ceil(right) halves and carries the same orientation. Repeated calls with
// equivalent inputs return structurally equal blueprints.
export function buildBlueprint(count: number, orientation: Orientation): Result<Blueprint> {
    return buildBlueprintByDepth(count, () => orientation);
}

// Deterministic balanced generator with a depth-resolved orientation, for
// presets that alternate orientation at each level. The split shape and
// validation match buildBlueprint; only the branch orientation varies by depth.
export function buildBlueprintByDepth(
    count: number,
    orientationAtDepth: OrientationAtDepth,
): Result<Blueprint> {
    if (!Number.isInteger(count) || count <= 0) {
        return reject(
            "invalid-leaf-count",
            "leaf count must be a positive integer",
        );
    }
    return { ok: true, value: buildNode(count, orientationAtDepth, 0, 0) };
}

function buildNode(
    count: number,
    orientationAtDepth: OrientationAtDepth,
    startOrdinal: number,
    depth: number,
): Blueprint {
    if (count === 1) {
        return { kind: "leaf", ordinal: startOrdinal };
    }
    const leftCount = Math.floor(count / 2);
    const rightCount = count - leftCount;
    const orientation = orientationAtDepth(depth);
    const left = buildNode(leftCount, orientationAtDepth, startOrdinal, depth + 1);
    const right = buildNode(rightCount, orientationAtDepth, startOrdinal + leftCount, depth + 1);
    return { kind: "branch", orientation, left, right };
}

// Deterministic dwindle chain generator: a recursive chain where each branch's
// left child is the next ordinal leaf and the right child recurses the
// remaining count. Orientations alternate from a horizontal root at depth
// zero. Repeated calls with equivalent inputs return structurally equal
// blueprints.
export function buildDwindleBlueprint(count: number): Result<Blueprint> {
    if (!Number.isInteger(count) || count <= 0) {
        return reject(
            "invalid-leaf-count",
            "leaf count must be a positive integer",
        );
    }
    return { ok: true, value: buildDwindleNode(count, 0, 0) };
}

function buildDwindleNode(count: number, startOrdinal: number, depth: number): Blueprint {
    if (count === 1) {
        return { kind: "leaf", ordinal: startOrdinal };
    }
    const orientation: Orientation = depth % 2 === 0 ? "horizontal" : "vertical";
    const left: Blueprint = { kind: "leaf", ordinal: startOrdinal };
    const right = buildDwindleNode(count - 1, startOrdinal + 1, depth + 1);
    return { kind: "branch", orientation, left, right };
}
