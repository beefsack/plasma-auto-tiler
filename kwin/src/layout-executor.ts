import { type Orientation } from "./layout-blueprint";
import { type BlueprintInstructions, type BlueprintPath } from "./layout-instructions";

export interface BlueprintSplitSeam<Tile extends object> {
    readonly split: (tile: Tile, orientation: Orientation) => unknown;
    // Receives the split TARGET (the parent tile) after split() has been
    // called on it, not split()'s return value: the native return shape is
    // unproven and must stay unused. See custom-tile-split.ts for the
    // concrete decode. Decodes an ordered array of whatever length the
    // target reports; it does not itself assume 2. Callers with their own
    // arity contract (see executeBlueprintInstructions below) enforce that
    // separately.
    readonly decodeChildren: (tile: Tile) => readonly Tile[] | null;
}

export type BlueprintExecutionFailure = {
    readonly ok: false;
    readonly code: "blueprint-execution-failed";
    readonly completedSplits: number;
    readonly mutationPossible: boolean;
};

export type BlueprintExecutionResult<Tile extends object> =
    | {
          readonly ok: true;
          readonly leaves: readonly Tile[];
          readonly completedSplits: number;
      }
    | BlueprintExecutionFailure;

interface ValidSplitInstruction {
    readonly targetKey: string;
    readonly leftKey: string;
    readonly rightKey: string;
    readonly orientation: Orientation;
}

interface ValidPlan {
    readonly splits: readonly ValidSplitInstruction[];
    readonly leafKeys: readonly string[];
}

function failed(completedSplits: number, mutationPossible: boolean): BlueprintExecutionFailure {
    return {
        ok: false,
        code: "blueprint-execution-failed",
        completedSplits,
        mutationPossible,
    };
}

function pathKey(path: BlueprintPath): string | null {
    if (!Array.isArray(path) || path.length === 0 || path[0] !== "root") {
        return null;
    }
    for (const segment of path) {
        if (segment !== "root" && segment !== "left" && segment !== "right") {
            return null;
        }
    }
    for (let index = 1; index < path.length; index += 1) {
        if (path[index] === "root") {
            return null;
        }
    }
    return path.join("/");
}

function isChildPath(parent: BlueprintPath, child: BlueprintPath, side: "left" | "right"): boolean {
    if (child.length !== parent.length + 1 || child[child.length - 1] !== side) {
        return false;
    }
    for (let index = 0; index < parent.length; index += 1) {
        if (child[index] !== parent[index]) {
            return false;
        }
    }
    return true;
}

// Snapshot and validate the entire topology before the first potentially
// mutating seam call, so malformed compiler output cannot cause a partial plan.
function validatePlan(instructions: BlueprintInstructions): ValidPlan | null {
    if (!Array.isArray(instructions.splits) || !Array.isArray(instructions.leafPaths)) {
        return null;
    }
    const available = new Set<string>(["root"]);
    const splits: ValidSplitInstruction[] = [];
    for (const instruction of instructions.splits) {
        const targetKey = pathKey(instruction.targetPath);
        const leftKey = pathKey(instruction.leftPath);
        const rightKey = pathKey(instruction.rightPath);
        if (
            targetKey === null ||
            leftKey === null ||
            rightKey === null ||
            (instruction.orientation !== "vertical" && instruction.orientation !== "horizontal") ||
            !isChildPath(instruction.targetPath, instruction.leftPath, "left") ||
            !isChildPath(instruction.targetPath, instruction.rightPath, "right") ||
            !available.delete(targetKey) ||
            available.has(leftKey) ||
            available.has(rightKey)
        ) {
            return null;
        }
        available.add(leftKey);
        available.add(rightKey);
        splits.push({ targetKey, leftKey, rightKey, orientation: instruction.orientation });
    }

    if (instructions.leafPaths.length !== available.size) {
        return null;
    }
    const leafKeys: string[] = [];
    for (let ordinal = 0; ordinal < instructions.leafPaths.length; ordinal += 1) {
        const leaf = instructions.leafPaths[ordinal];
        if (leaf === undefined || leaf.ordinal !== ordinal) {
            return null;
        }
        const key = pathKey(leaf.path);
        if (key === null || !available.delete(key)) {
            return null;
        }
        leafKeys.push(key);
    }
    return available.size === 0 ? { splits, leafKeys } : null;
}

export function executeBlueprintInstructions<Tile extends object>(
    instructions: BlueprintInstructions,
    root: Tile,
    seam: BlueprintSplitSeam<Tile>,
): BlueprintExecutionResult<Tile> {
    let completedSplits = 0;
    let mutationPossible = false;
    try {
        const plan = validatePlan(instructions);
        if (plan === null || typeof root !== "object" || root === null) {
            return failed(completedSplits, mutationPossible);
        }

        const leaves = new Map<string, Tile>([["root", root]]);
        const tilePaths = new Map<Tile, string>([[root, "root"]]);
        for (const instruction of plan.splits) {
            const target = leaves.get(instruction.targetKey);
            if (
                target === undefined ||
                tilePaths.get(target) !== instruction.targetKey ||
                leaves.has(instruction.leftKey) ||
                leaves.has(instruction.rightKey)
            ) {
                return failed(completedSplits, mutationPossible);
            }

            mutationPossible = true;
            // split()'s return value is native-shape-unproven and
            // intentionally unused here (see
            // docs/changes/archive/2026-08-23-nary-split-support/research/native-binding-evidence.md:169-172).
            // Re-decode the split target's own children afterward instead,
            // matching the established re-decode-after-mutation precedent
            // (kwin/src/boundary.ts:431-433, kwin/src/controller.ts:2715).
            seam.split(target, instruction.orientation);
            const children = seam.decodeChildren(target);
            // Every compiled blueprint split instruction has exactly a
            // leftPath and rightPath (see layout-instructions.ts's
            // SplitInstruction): this is the blueprint executor's OWN
            // structural contract (blueprints are always binary trees of
            // splits), not a claim about native split()'s cardinality. A
            // target that decodes to any length other than 2 fails
            // deterministically here.
            if (children === null || children.length !== 2) {
                return failed(completedSplits, mutationPossible);
            }
            const left = children[0];
            const right = children[1];
            if (
                left === undefined ||
                right === undefined ||
                left === right ||
                left === target ||
                right === target ||
                tilePaths.has(left) ||
                tilePaths.has(right)
            ) {
                return failed(completedSplits, mutationPossible);
            }

            leaves.delete(instruction.targetKey);
            leaves.set(instruction.leftKey, left);
            leaves.set(instruction.rightKey, right);
            tilePaths.set(left, instruction.leftKey);
            tilePaths.set(right, instruction.rightKey);
            completedSplits += 1;
        }

        const realized: Tile[] = [];
        for (const key of plan.leafKeys) {
            const tile = leaves.get(key);
            if (tile === undefined) {
                return failed(completedSplits, mutationPossible);
            }
            realized.push(tile);
        }
        if (realized.length !== leaves.size) {
            return failed(completedSplits, mutationPossible);
        }
        return { ok: true, leaves: Object.freeze(realized), completedSplits };
    } catch (error) {
        void error;
        return failed(completedSplits, mutationPossible);
    }
}
