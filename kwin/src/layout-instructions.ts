import { type Blueprint, type Orientation } from "./layout-blueprint";
import { type Rejection, type Result } from "./logic";

export type BlueprintPathSegment = "root" | "left" | "right";
export type BlueprintPath = readonly BlueprintPathSegment[];

export interface SplitInstruction {
    readonly targetPath: BlueprintPath;
    readonly orientation: Orientation;
    readonly leftPath: BlueprintPath;
    readonly rightPath: BlueprintPath;
}

export interface BlueprintLeafPath {
    readonly ordinal: number;
    readonly path: BlueprintPath;
}

export interface BlueprintInstructions {
    readonly splits: readonly SplitInstruction[];
    readonly leafPaths: readonly BlueprintLeafPath[];
}

function reject(message: string): { readonly ok: false; readonly reason: Rejection } {
    return { ok: false, reason: { kind: "invalid-blueprint", message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

// Compile recursively in pre-order, so each target has already been created by
// its parent split (or is the initial root leaf).
export function compileBlueprintInstructions(blueprint: Blueprint): Result<BlueprintInstructions> {
    const splits: SplitInstruction[] = [];
    const leafPaths: BlueprintLeafPath[] = [];
    const visited = new Set<object>();

    const failure = compileNode(blueprint, ["root"], splits, leafPaths, visited);
    if (failure !== null) {
        return reject(failure);
    }

    leafPaths.sort((a, b) => a.ordinal - b.ordinal);
    for (let ordinal = 0; ordinal < leafPaths.length; ordinal += 1) {
        if (leafPaths[ordinal]?.ordinal !== ordinal) {
            return reject("leaf ordinals must be unique and contiguous from zero");
        }
    }

    return { ok: true, value: { splits, leafPaths } };
}

function compileNode(
    node: unknown,
    path: BlueprintPath,
    splits: SplitInstruction[],
    leafPaths: BlueprintLeafPath[],
    visited: Set<object>,
): string | null {
    if (!isRecord(node) || visited.has(node)) {
        return "blueprint must be an acyclic binary tree";
    }
    visited.add(node);

    if (node.kind === "leaf") {
        if (!Number.isInteger(node.ordinal) || typeof node.ordinal !== "number" || node.ordinal < 0) {
            return "leaf ordinal must be a non-negative integer";
        }
        leafPaths.push({ ordinal: node.ordinal, path: [...path] });
        return null;
    }

    if (node.kind !== "branch" || (node.orientation !== "vertical" && node.orientation !== "horizontal")) {
        return "blueprint node must be a leaf or an oriented branch";
    }

    const leftPath: BlueprintPath = [...path, "left"];
    const rightPath: BlueprintPath = [...path, "right"];
    splits.push({
        targetPath: [...path],
        orientation: node.orientation,
        leftPath: [...leftPath],
        rightPath: [...rightPath],
    });
    const leftFailure = compileNode(node.left, leftPath, splits, leafPaths, visited);
    if (leftFailure !== null) {
        return leftFailure;
    }
    return compileNode(node.right, rightPath, splits, leafPaths, visited);
}
