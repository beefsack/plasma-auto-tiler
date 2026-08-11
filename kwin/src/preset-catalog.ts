// Pure immutable topology preset catalog for the Custom Tile vertical slice.
// A preset describes topology only: the compiled split/leaf instructions for a
// requested leaf count. No KWin or Qt types are referenced and nothing is
// executed. Project "horizontal" maps to KWin Horizontal and "vertical" to
// KWin Vertical per the pinned declaration and existing split seam.
import { buildBlueprintByDepth, buildDwindleBlueprint, type OrientationAtDepth } from "./layout-blueprint";
import {
    compileBlueprintInstructions,
    type BlueprintInstructions,
} from "./layout-instructions";
import { type Rejection, type Result } from "./logic";

// Closed preset catalog: only these kinds are accepted at runtime.
export type PresetKind = "columns" | "rows" | "balanced-grid" | "dwindle";

export const PRESET_KINDS: readonly PresetKind[] = Object.freeze([
    "columns",
    "rows",
    "balanced-grid",
    "dwindle",
]);

function reject(
    kind: Rejection["kind"],
    message: string,
): { readonly ok: false; readonly reason: Rejection } {
    return { ok: false, reason: { kind, message } };
}

function isPresetKind(value: unknown): value is PresetKind {
    return PRESET_KINDS.some((kind) => kind === value);
}

// columns: horizontal at every branch. rows: vertical at every branch.
// balanced-grid: horizontal root alternating orientation at each depth.
// dwindle: a non-balanced alternating chain compiled through its own builder.
type PresetOrientationKind = Exclude<PresetKind, "dwindle">;

function presetOrientation(kind: PresetOrientationKind): OrientationAtDepth {
    switch (kind) {
        case "columns":
            return () => "horizontal";
        case "rows":
            return () => "vertical";
        case "balanced-grid":
            return (depth) => (depth % 2 === 0 ? "horizontal" : "vertical");
    }
}

// Freeze every array and object reachable from a value. Each compiled result
// is a fresh acyclic graph, so freezing only hardens this call's own output.
function freezeDeep(value: object): void {
    Object.freeze(value);
    for (const child of Object.values(value)) {
        if (typeof child === "object" && child !== null) {
            freezeDeep(child);
        }
    }
}

// Compile the requested preset topology for a positive safe-integer leaf count.
// Returns fresh deep-frozen immutable instructions with count - 1 pre-order
// splits and a complete ordinal leaf mapping; repeated calls return deep-equal
// results with no shared aliases.
export function buildPreset(kind: PresetKind, count: number): Result<BlueprintInstructions> {
    if (!isPresetKind(kind)) {
        return reject(
            "invalid-preset-kind",
            "preset kind must be columns, rows, balanced-grid, or dwindle",
        );
    }
    if (!Number.isSafeInteger(count) || count <= 0) {
        return reject("invalid-leaf-count", "leaf count must be a positive safe integer");
    }
    const blueprint =
        kind === "dwindle"
            ? buildDwindleBlueprint(count)
            : buildBlueprintByDepth(count, presetOrientation(kind));
    if (!blueprint.ok) {
        return blueprint;
    }
    const instructions = compileBlueprintInstructions(blueprint.value);
    if (!instructions.ok) {
        return instructions;
    }
    freezeDeep(instructions.value);
    return Object.freeze({ ok: true, value: instructions.value });
}
