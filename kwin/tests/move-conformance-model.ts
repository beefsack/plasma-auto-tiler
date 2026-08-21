// Pure reference model for the tree-movement rule corpus in
// docs/reference-wm-comparison.md section 11. This is a verification /
// research artifact only - it is intentionally self-contained and does NOT
// import from or couple to src/controller.ts or src/logic.ts. It has no
// bearing on shipped tiling behaviour.

export type Axis = "H" | "V";

export type Direction = "left" | "right" | "up" | "down";

export type Leaf = {
    readonly kind: "leaf";
    readonly name: string;
};

export type Split = {
    readonly kind: "split";
    readonly axis: Axis;
    readonly children: readonly TreeNode[];
};

export type TreeNode = Leaf | Split;

export type RuleId = "1" | "2a-leaf" | "2a-container" | "2b" | "3-flatten" | "3+1" | "4-noop";

export type MoveResult = {
    readonly tree: TreeNode;
    readonly rule: RuleId;
};

export type OutputTree = {
    readonly id: string;
    readonly workspace: string;
    readonly tree: TreeNode | undefined;
    readonly adjacent: Readonly<Partial<Record<Direction, string>>>;
};

export type MultiOutputState = {
    readonly outputs: readonly OutputTree[];
};

export type MultiOutputMoveResult = {
    readonly state: MultiOutputState;
    readonly rule: RuleId | "4-cross-output";
};

export function leaf(name: string): Leaf {
    return { kind: "leaf", name };
}

export function h(...children: readonly TreeNode[]): Split {
    return { kind: "split", axis: "H", children };
}

export function v(...children: readonly TreeNode[]): Split {
    return { kind: "split", axis: "V", children };
}

function axisOf(direction: Direction): Axis {
    return direction === "left" || direction === "right" ? "H" : "V";
}

// +1 for the directions that walk toward higher child indices (right/down),
// -1 for the directions that walk toward lower child indices (left/up).
function stepFor(direction: Direction): 1 | -1 {
    return direction === "right" || direction === "down" ? 1 : -1;
}

// true when W's list position comes before the other element's - i.e. W is
// the "near" element (closer to the start of C's children) and the other
// is the "far" one. This is a plain list-order comparison, independent of
// travel direction: every corpus case (both left/up and right/down) that
// exercises 2a-container or 2b confirms the ordering depends only on
// existing index order within C, not on which way D points.
function isNearSide(wIndex: number, otherIndex: number): boolean {
    return wIndex < otherIndex;
}

function makeWrap(direction: Direction, w: TreeNode, other: TreeNode): Split {
    const axis = axisOf(direction);
    const children: readonly TreeNode[] =
        direction === "left" || direction === "up" ? [w, other] : [other, w];
    return { kind: "split", axis, children };
}

// Removes the child at `index` from `split`. If exactly one child remains,
// the split collapses and that remaining child is returned directly in
// place of the split - a single-child split must never persist in the tree.
function removeAt(split: Split, index: number): TreeNode {
    const remaining = split.children.filter((_child, i) => i !== index);
    if (remaining.length === 1) {
        const only = remaining[0];
        if (only === undefined) {
            throw new Error("removeAt: collapse produced no child");
        }
        return only;
    }
    return { kind: "split", axis: split.axis, children: remaining };
}

type Ancestor = {
    readonly split: Split;
    readonly childIndex: number;
};

function findPath(tree: TreeNode, leafName: string): readonly Ancestor[] | undefined {
    if (tree.kind === "leaf") {
        return tree.name === leafName ? [] : undefined;
    }
    for (let i = 0; i < tree.children.length; i++) {
        const child = tree.children[i];
        if (child === undefined) {
            continue;
        }
        if (child.kind === "leaf") {
            if (child.name === leafName) {
                return [{ split: tree, childIndex: i }];
            }
            continue;
        }
        const sub = findPath(child, leafName);
        if (sub !== undefined) {
            return [{ split: tree, childIndex: i }, ...sub];
        }
    }
    return undefined;
}

// Rebuilds the tree, replacing the node found at `ancestors[level]`'s slot
// with `replacement`. If `level` is 0, `replacement` becomes the new root.
function replaceAtLevel(
    ancestors: readonly Ancestor[],
    level: number,
    replacement: TreeNode,
): TreeNode {
    let node: TreeNode = replacement;
    for (let i = level - 1; i >= 0; i--) {
        const ancestor = ancestors[i];
        if (ancestor === undefined) {
            throw new Error("replaceAtLevel: missing ancestor");
        }
        const children = ancestor.split.children.map((child, idx) =>
            idx === ancestor.childIndex ? node : child,
        );
        node = { kind: "split", axis: ancestor.split.axis, children };
    }
    return node;
}

/**
 * Moves the leaf named `focusedLeafName` one step in `direction`, per the
 * rule model documented in the change's work-unit brief (rules 1, 2a, 2b,
 * 3). Returns the resulting tree and the rule/branch that fired.
 *
 * Rule 2a-container interpretation note: when W's neighbour S is a
 * container and C has exactly two children, W is inserted into S at the
 * edge nearest W's original position - i.e. the start of S's children if W
 * was on the "near" (lower-index-in-travel-direction) side of S, or the
 * end of S's children if W was on the "far" side. This matches every
 * transition in the 41-row corpus that exercises rule 2a-container.
 */
export function move(tree: TreeNode, focusedLeafName: string, direction: Direction): MoveResult {
    const path = findPath(tree, focusedLeafName);
    if (path === undefined) {
        throw new Error(`move: leaf "${focusedLeafName}" not found in tree`);
    }
    if (path.length === 0) {
        return { tree, rule: "4-noop" };
    }

    const w: Leaf = leaf(focusedLeafName);
    const dAxis = axisOf(direction);

    let level = path.length - 1;
    for (;;) {
        const ancestor = path[level];
        if (ancestor === undefined) {
            throw new Error("move: missing ancestor at current level");
        }
        const c = ancestor.split;
        const idx = ancestor.childIndex;

        if (c.axis !== dAxis) {
            // Rule 1: C is perpendicular to D.
            const remainder = removeAt(c, idx);
            const wrapped = makeWrap(direction, w, remainder);
            const newTree = replaceAtLevel(path, level, wrapped);
            const rule: RuleId = level === path.length - 1 ? "1" : "3+1";
            return { tree: newTree, rule };
        }

        // C is parallel to D.
        const neighbourIndex = idx + stepFor(direction);
        const s = c.children[neighbourIndex];
        if (s !== undefined) {
            if (c.children.length === 2) {
                if (s.kind === "leaf") {
                    // Rule 2a-leaf: swap W and S.
                    const children = c.children.map((child, i) =>
                        i === idx ? s : i === neighbourIndex ? w : child,
                    );
                    const newC: Split = { kind: "split", axis: c.axis, children };
                    const newTree = replaceAtLevel(path, level, newC);
                    return { tree: newTree, rule: "2a-leaf" };
                }
                // Rule 2a-container: descend into S, insert at the slot
                // nearest W's original position.
                //
                // When S shares C's axis, "nearest" is unambiguous: W is
                // inserted at the start or end of S's own children list,
                // whichever edge sits adjacent to W's original side of S
                // (this is the only interpretation consistent with the
                // corpus; see docs/reference-wm-comparison.md section 11).
                //
                // When S's axis differs from C's (W approaches S along an
                // axis S's children are not arranged on), there is no
                // "near" edge along S's own ordering, since W's approach
                // spans all of S's children equally - the corpus cases
                // exercising this (S1-08 and S3-13) insert W at S's midpoint.
                const newSChildren =
                    s.axis === c.axis
                        ? isNearSide(idx, neighbourIndex)
                            ? [w, ...s.children]
                            : [...s.children, w]
                        : (() => {
                              const middleIndex = Math.floor(s.children.length / 2);
                              if (s.children.length % 2 === 0) {
                                  return [
                                      ...s.children.slice(0, middleIndex),
                                      w,
                                      ...s.children.slice(middleIndex),
                                  ];
                              }
                              const middle = s.children[middleIndex];
                              if (middle === undefined) {
                                  throw new Error("move: missing midpoint child while descending");
                              }
                              const pair: Split = {
                                  kind: "split",
                                  axis: dAxis,
                                  children: stepFor(direction) === -1 ? [middle, w] : [w, middle],
                              };
                              return [
                                  ...s.children.slice(0, middleIndex),
                                  pair,
                                  ...s.children.slice(middleIndex + 1),
                              ];
                          })();
                const newS: Split = { kind: "split", axis: s.axis, children: newSChildren };
                const newTree = replaceAtLevel(path, level, newS);
                return { tree: newTree, rule: "2a-container" };
            }
            // Rule 2b: wrap W and S together, W on the near side.
            const nearFirst = isNearSide(idx, neighbourIndex);
            const pair: Split = {
                kind: "split",
                axis: c.axis,
                children: nearFirst ? [w, s] : [s, w],
            };
            const lowIndex = Math.min(idx, neighbourIndex);
            const highIndex = Math.max(idx, neighbourIndex);
            const newChildren = c.children
                .map((child, i) => (i === lowIndex ? pair : child))
                .filter((_child, i) => i !== highIndex);
            const newC: Split = { kind: "split", axis: c.axis, children: newChildren };
            const newTree = replaceAtLevel(path, level, newC);
            return { tree: newTree, rule: "2b" };
        }

        // Rule 3: W sits at C's edge in direction D. Ascend to C's parent.
        if (level === 0) {
            return { tree, rule: "4-noop" };
        }
        const parentAncestor = path[level - 1];
        if (parentAncestor === undefined) {
            throw new Error("move: missing parent ancestor while ascending");
        }
        const parent = parentAncestor.split;
        if (parent.axis === c.axis) {
            // Same axis as C: flatten C's children directly into parent's
            // slot in place of C. Terminal - the corpus never requires a
            // second ascend after a flatten.
            const parentChildren: TreeNode[] = [];
            for (let i = 0; i < parent.children.length; i++) {
                if (i === parentAncestor.childIndex) {
                    parentChildren.push(...c.children);
                } else {
                    const child = parent.children[i];
                    if (child === undefined) {
                        throw new Error("move: missing parent child while flattening");
                    }
                    parentChildren.push(child);
                }
            }
            const newParent: Split = { kind: "split", axis: parent.axis, children: parentChildren };
            const newTree = replaceAtLevel(path, level - 1, newParent);
            return { tree: newTree, rule: "3-flatten" };
        }

        // Perpendicular parent: re-apply from rule 1 at the parent level.
        const remainderAtCSlot = removeAt(c, idx);
        const modifiedParentChildren = parent.children.map((child, i) =>
            i === parentAncestor.childIndex ? remainderAtCSlot : child,
        );
        const modifiedParent: Split = {
            kind: "split",
            axis: parent.axis,
            children: modifiedParentChildren,
        };
        const wrapped = makeWrap(direction, w, modifiedParent);
        const newTree = replaceAtLevel(path, level - 1, wrapped);
        return { tree: newTree, rule: "3+1" };
    }
}

function rootEdgeLeafIndex(tree: TreeNode, leafName: string, direction: Direction): number | undefined {
    if (tree.kind === "leaf") {
        return undefined;
    }
    const index = tree.children.findIndex((child) => child.kind === "leaf" && child.name === leafName);
    if (index === -1 || index !== (stepFor(direction) === -1 ? 0 : tree.children.length - 1)) {
        return undefined;
    }
    return index;
}

function replaceOutputTree(
    state: MultiOutputState,
    outputId: string,
    tree: TreeNode | undefined,
): MultiOutputState {
    return {
        outputs: state.outputs.map((output) => (output.id === outputId ? { ...output, tree } : output)),
    };
}

/**
 * Applies a directional tree move within one output before considering the
 * explicitly adjacent output on the same workspace. Cross-output movement is
 * only eligible after the single-tree model has no applicable rule.
 */
export function moveAcrossOutputs(
    state: MultiOutputState,
    sourceOutputId: string,
    focusedLeafName: string,
    direction: Direction,
): MultiOutputMoveResult {
    const source = state.outputs.find((output) => output.id === sourceOutputId);
    if (source === undefined) {
        throw new Error(`moveAcrossOutputs: output "${sourceOutputId}" not found`);
    }
    if (source.tree === undefined) {
        return { state, rule: "4-noop" };
    }

    const local = move(source.tree, focusedLeafName, direction);
    if (local.rule !== "4-noop") {
        return { state: replaceOutputTree(state, source.id, local.tree), rule: local.rule };
    }
    if (source.tree.kind === "leaf") {
        return { state, rule: "4-noop" };
    }

    const sourceLeafIndex = rootEdgeLeafIndex(source.tree, focusedLeafName, direction);
    const targetId = source.adjacent[direction];
    const target = targetId === undefined ? undefined : state.outputs.find((output) => output.id === targetId);
    if (sourceLeafIndex === undefined || target === undefined || target.workspace !== source.workspace) {
        return { state, rule: "4-noop" };
    }

    const moved = leaf(focusedLeafName);
    const targetTree =
        target.tree === undefined
            ? moved
            : {
                  kind: "split" as const,
                  axis: axisOf(direction),
                  children:
                      direction === "left" || direction === "up" ? [target.tree, moved] : [moved, target.tree],
              };
    const sourceTree = removeAt(source.tree, sourceLeafIndex);
    return {
        state: {
            outputs: state.outputs.map((output) => {
                if (output.id === source.id) {
                    return { ...output, tree: sourceTree };
                }
                if (output.id === target.id) {
                    return { ...output, tree: targetTree };
                }
                return output;
            }),
        },
        rule: "4-cross-output",
    };
}
