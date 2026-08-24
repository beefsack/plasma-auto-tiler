import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    createDirectionalMovementRuntime,
    type DirectionalRuntimeOutput,
} from "../src/directional-movement-runtime";
import type { CustomTileCapability, OutputCapability, WindowCapability } from "../src/boundary";

type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };
type MutableTile = Mutable<CustomTileCapability> & { isLayout: boolean; tiles: MutableTile[]; windows: WindowCapability[] };
type MutableWindow = Mutable<WindowCapability> & { tile: object | null; desktops: unknown; maximizeMode?: number };

function outputObject(): OutputCapability {
    return {
        geometry: { x: 0, y: 0, width: 1000, height: 800 },
        name: "output",
        manufacturer: "test",
        model: "test",
        serialNumber: "test",
    };
}

function tile(isLayout: boolean, x: number, y: number, width = 500, height = 800): MutableTile {
    const value = {
        relativeGeometry: { x, y, width, height },
        absoluteGeometry: { x, y, width, height },
        parent: null,
        tiles: [] as MutableTile[],
        windows: [] as WindowCapability[],
        isLayout,
        canBeRemoved: true,
        manage: () => true,
        unmanage: () => true,
        layoutDirection: isLayout ? 1 : 0,
        split: () => undefined,
    } as unknown as MutableTile;
    return value;
}

function windowFor(output: OutputCapability, tileValue: MutableTile, id: string): MutableWindow {
    return {
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        desktops: [{ id: "desktop-1" }],
        output,
        tile: tileValue,
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
        move: true,
        resize: true,
        caption: id,
    };
}

function output(
    id: string,
    nativeOutput: object,
    root: MutableTile | null,
    adjacent: Partial<Record<"left" | "right" | "up" | "down", string>> = {},
): DirectionalRuntimeOutput {
    return { id, workspaceId: "desktop-1", nativeOutput, root, adjacent };
}

function harness(
    sourceRoot: MutableTile | null,
    active: WindowCapability | null,
    extra: Partial<Parameters<typeof createDirectionalMovementRuntime>[0]> = {},
) {
    const nativeOutput = (active?.output as object | null) ?? outputObject();
    let mutationCount = 0;
    let focusCount = 0;
    const environment = {
        outputs: () => [output("source", nativeOutput, sourceRoot)],
        activeWindow: () => active,
        setActiveWindow: () => {
            focusCount += 1;
        },
        mutate: () => {
            mutationCount += 1;
        },
        validatePostcondition: () => true,
        ...extra,
    };
    return { runtime: createDirectionalMovementRuntime(environment), nativeOutput, get mutationCount() { return mutationCount; }, get focusCount() { return focusCount; } };
}

function plannedRoot(activeFirst = true): { root: MutableTile; active: MutableWindow; other: MutableWindow } {
    const root = tile(true, 0, 0);
    const first = tile(false, 0, 0);
    const second = tile(false, 500, 0);
    root.tiles.push(first, second);
    const nativeOutput = outputObject();
    const active = windowFor(nativeOutput, first, "active");
    const other = windowFor(nativeOutput, second, "other");
    if (activeFirst) {
        first.windows.push(active);
    } else {
        second.windows.push(active);
    }
    second.windows.push(other);
    active.tile = first;
    other.tile = second;
    return { root, active, other };
}

describe("directional movement runtime transaction", () => {
    it("rejects every preflight failure without invoking mutation", () => {
        const cases: Array<{ name: string; setup: () => ReturnType<typeof harness>; reason: string }> = [];
        cases.push({
            name: "active-maximized",
            setup: () => {
                const model = plannedRoot();
                model.active.maximizeMode = 3;
                return harness(model.root, model.active);
            },
            reason: "native-maximized",
        });
        cases.push({
            name: "target-maximized",
            setup: () => {
                const model = plannedRoot();
                model.other.maximizeMode = 3;
                return harness(model.root, model.active);
            },
            reason: "native-maximized",
        });
        cases.push({
            name: "duplicate",
            setup: () => {
                const model = plannedRoot();
                const first = model.root.tiles[0];
                if (first === undefined) throw new Error("missing first tile");
                first.windows.push(model.active);
                return harness(model.root, model.active);
            },
            reason: "duplicate-active-occupancy",
        });
        cases.push({
            name: "malformed",
            setup: () => {
                const root = tile(true, 0, 0);
                const child = tile(false, 0, 0);
                root.tiles = [child];
                const active = windowFor(outputObject(), child, "active");
                child.windows = [active];
                return harness(root, active);
            },
            reason: "malformed-topology",
        });
        cases.push({
            name: "non-layout-children",
            setup: () => {
                const model = plannedRoot();
                const first = model.root.tiles[0];
                if (first === undefined) throw new Error("missing first tile");
                first.tiles = [tile(false, 0, 0)];
                return harness(model.root, model.active);
            },
            reason: "malformed-topology",
        });
        cases.push({
            name: "stale",
            setup: () => {
                const model = plannedRoot();
                const target = model.root.tiles[1];
                if (target === undefined) throw new Error("missing target tile");
                model.active.tile = target;
                return harness(model.root, model.active);
            },
            reason: "stale-topology",
        });
        cases.push({
            name: "workspace",
            setup: () => {
                const model = plannedRoot();
                if (model.active.output === null) throw new Error("missing output");
                const foreign = windowFor(model.active.output, model.root.tiles[0] as MutableTile, "foreign");
                foreign.desktops = [{ id: "desktop-2" }];
                model.root.tiles[0]?.windows.splice(0, 1, foreign);
                return harness(model.root, foreign);
            },
            reason: "workspace-mismatch",
        });
        cases.push({
            name: "minimum-size",
            setup: () => {
                const model = plannedRoot();
                return harness(model.root, model.active, { minimumSizeSatisfied: () => false });
            },
            reason: "minimum-size-failure",
        });
        for (const entry of cases) {
            const current = entry.setup();
            const result = current.runtime.move("right");
            assert.deepEqual(result, { kind: "rejected", reason: entry.reason }, entry.name);
            assert.equal(current.mutationCount, 0, entry.name);
            assert.equal(current.focusCount, 0, entry.name);
        }
    });

    it("treats an empty native root as an empty R4 target", () => {
        const source = plannedRoot();
        const sourceOutput = source.active.output as object;
        const targetOutput = outputObject();
        const empty = tile(true, 0, 0);
        const environment = {
            outputs: () => [
                output("target", targetOutput, empty, { right: "source" }),
                output("source", sourceOutput, source.root, { left: "target" }),
            ],
            activeWindow: () => source.active,
            setActiveWindow: () => undefined,
            mutate: () => {
                const sourceLeaf = source.root.tiles[0];
                if (sourceLeaf === undefined) throw new Error("missing source leaf");
                sourceLeaf.windows = sourceLeaf.windows.filter((window) => window !== source.active);
                empty.isLayout = false;
                empty.layoutDirection = 0;
                empty.windows = [source.active];
                source.active.tile = empty;
                source.active.output = targetOutput;
            },
            validatePostcondition: () => true,
        };
        const runtime = createDirectionalMovementRuntime(environment);
        const result = runtime.move("left");
        assert.equal(result.kind, "moved", JSON.stringify(result));
        if (result.kind === "moved" && result.plan.kind === "planned") {
            assert.equal(result.plan.operation.kind, "cross-output");
            assert.equal(result.plan.operation.target, "empty");
        }
    });

    it("fails closed when the planner postcondition capability is absent", () => {
        const model = plannedRoot();
        const current = harness(model.root, model.active, { validatePostcondition: undefined } as unknown as Partial<Parameters<typeof createDirectionalMovementRuntime>[0]>);
        const result = current.runtime.move("right");
        assert.deepEqual(result, { kind: "rejected", reason: "malformed-topology" });
        assert.equal(current.mutationCount, 0);
    });

    it("rolls back occupied swaps and disables when recovery cannot be verified", () => {
        const model = plannedRoot();
        const source = model.root.tiles[0];
        const target = model.root.tiles[1];
        if (source === undefined || target === undefined) throw new Error("missing swap tiles");
        const current = harness(model.root, model.active, {
            mutate: () => {
                model.active.tile = target;
                target.windows.push(model.active);
                return false;
            },
            rollback: () => false,
            recover: () => false,
            disable: () => undefined,
        });
        const result = current.runtime.move("right");
        assert.deepEqual(result, { kind: "failed", reason: "recovery-failed" });
        assert.equal(current.runtime.isEnabled(), false);
        assert.equal(current.mutationCount, 0);
    });

    it("rolls back a structural mutation when the re-decoded postcondition fails", () => {
        const model = plannedRoot();
        const focused = model.root.tiles[0];
        if (focused === undefined) throw new Error("missing focused tile");
        let rollbackCount = 0;
        const current = harness(model.root, model.active, {
            mutate: () => {
                const first = tile(false, 0, 0, 500, 400);
                const second = tile(false, 0, 400, 500, 400);
                focused.isLayout = true;
                focused.layoutDirection = 2;
                focused.tiles = [first, second];
                focused.windows = [];
                model.active.tile = second;
                second.windows = [model.active, model.other];
            },
            validatePostcondition: () => false,
            rollback: () => {
                rollbackCount += 1;
                focused.isLayout = false;
                focused.layoutDirection = 0;
                focused.tiles = [];
                focused.windows = [model.active];
                model.active.tile = focused;
                return true;
            },
        });
        const result = current.runtime.move("down");
        assert.deepEqual(result, { kind: "failed", reason: "postcondition-failed" });
        assert.equal(rollbackCount, 1);
        assert.equal(current.runtime.isEnabled(), true);
        assert.equal(current.focusCount, 0);
    });

    it("validates re-decoded postconditions and focuses only after success", () => {
        const model = plannedRoot();
        const source = model.root.tiles[0];
        const target = model.root.tiles[1];
        if (source === undefined || target === undefined) throw new Error("missing swap tiles");
        const current = harness(model.root, model.active, {
            mutate: () => {
                source.windows = source.windows.filter((window) => window !== model.active);
                target.windows.push(model.active);
                model.active.tile = target;
            },
            validatePostcondition: () => true,
        });
        const result = current.runtime.move("right");
        assert.equal(result.kind, "moved", JSON.stringify(result));
        assert.equal(current.focusCount, 1);
    });

    it("rejects a result that changes the active tile but violates the planned neighbour", () => {
        const model = plannedRoot();
        const source = model.root.tiles[0];
        if (source === undefined) throw new Error("missing source tile");
        const wrong = tile(false, 1000, 0);
        let rollbackCount = 0;
        const current = harness(model.root, model.active, {
            mutate: () => {
                source.windows = [];
                model.root.tiles.push(wrong);
                wrong.windows = [model.active];
                model.active.tile = wrong;
            },
            rollback: () => {
                rollbackCount += 1;
                model.root.tiles = model.root.tiles.filter((candidate) => candidate !== wrong);
                source.windows = [model.active];
                model.active.tile = source;
                return true;
            },
            validatePostcondition: () => true,
        });
        const result = current.runtime.move("right");
        assert.deepEqual(result, { kind: "failed", reason: "postcondition-failed" });
        assert.equal(rollbackCount, 1);
        assert.equal(current.focusCount, 0);
    });

    it("requires complete metadata and assignment-link recovery", () => {
        const model = plannedRoot();
        const source = model.root.tiles[0];
        const target = model.root.tiles[1];
        if (source === undefined || target === undefined) throw new Error("missing recovery tiles");
        const current = harness(model.root, model.active, {
            mutate: () => {
                source.windows = [];
                target.windows.push(model.active);
                model.active.tile = target;
                source.layoutDirection = 2;
                source.relativeGeometry = { x: 99, y: 99, width: 1, height: 1 };
                return false;
            },
            rollback: () => {
                source.windows = [model.active];
                target.windows = [model.other];
                model.active.tile = source;
                return true;
            },
        });
        const result = current.runtime.move("right");
        assert.deepEqual(result, { kind: "failed", reason: "recovery-failed" });
        assert.equal(current.runtime.isEnabled(), false);
    });

    it("verifies active output and workspace after mutation", () => {
        const model = plannedRoot();
        const source = model.root.tiles[0];
        const target = model.root.tiles[1];
        if (source === undefined || target === undefined) throw new Error("missing scope tiles");
        if (model.active.output === null) throw new Error("missing active output");
        const originalOutput = model.active.output;
        const foreignOutput = outputObject();
        let rollbackCount = 0;
        const current = harness(model.root, model.active, {
            mutate: () => {
                source.windows = [];
                target.windows.push(model.active);
                model.active.tile = target;
                model.active.output = foreignOutput;
            },
            rollback: () => {
                rollbackCount += 1;
                source.windows = [model.active];
                target.windows = [model.other];
                model.active.tile = source;
                model.active.output = originalOutput;
                return true;
            },
        });
        const result = current.runtime.move("right");
        assert.deepEqual(result, { kind: "failed", reason: "postcondition-failed" });
        assert.equal(rollbackCount, 1);
    });

    it("recovers after a capability getter fails during post-mutation decode", () => {
        const model = plannedRoot();
        const source = model.root.tiles[0];
        const target = model.root.tiles[1];
        if (source === undefined || target === undefined || model.active.output === null) throw new Error("missing getter fixtures");
        const originalOutput = model.active.output;
        let throwGetter = false;
        Object.defineProperty(model.active, "output", {
            configurable: true,
            get: () => {
                if (throwGetter) throw new Error("output getter failed");
                return originalOutput;
            },
        });
        let rollbackCount = 0;
        const current = harness(model.root, model.active, {
            mutate: () => {
                source.windows = [];
                target.windows.push(model.active);
                model.active.tile = target;
                throwGetter = true;
            },
            rollback: () => {
                rollbackCount += 1;
                throwGetter = false;
                source.windows = [model.active];
                target.windows = [model.other];
                model.active.tile = source;
                return true;
            },
        });
        const result = current.runtime.move("right");
        assert.deepEqual(result, { kind: "failed", reason: "postcondition-failed" });
        assert.equal(rollbackCount, 1);
        assert.equal(current.runtime.isEnabled(), true);
    });

    it("uses the adapter split seam without inspecting its opaque return value", () => {
        const model = plannedRoot();
        const focused = model.root.tiles[0];
        if (focused === undefined) throw new Error("missing focused tile");
        let splitCalls = 0;
        focused.split = () => {
            splitCalls += 1;
            const first = tile(false, 0, 0, 500, 400);
            const second = tile(false, 0, 400, 500, 400);
            focused.isLayout = true;
            focused.layoutDirection = 2;
            focused.tiles = [first, second];
            focused.windows = [];
            model.active.tile = second;
            second.windows = [model.active];
            return { opaque: true };
        };
        const current = harness(model.root, model.active, {
            mutate: (_operation, context) => {
                context.split(focused, "vertical");
            },
        });
        const result = current.runtime.move("down");
        assert.equal(result.kind, "moved");
        assert.equal(splitCalls, 1);
    });
});
