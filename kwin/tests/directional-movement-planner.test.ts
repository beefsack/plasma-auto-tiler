import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    planCosmicDirectionalMove,
    type CosmicDirectionalMoveRequest,
    type CosmicGroup,
    type CosmicLeaf,
    type CosmicMoveOperation,
    type CosmicMoveOutcome,
    type CosmicNode,
    type CosmicOutputTopology,
} from "../src/directional-movement-planner";

function leaf(id: string): CosmicLeaf {
    return { kind: "leaf", id };
}

function group(id: string, axis: "horizontal" | "vertical", ...children: readonly CosmicNode[]): CosmicGroup {
    return { kind: "group", id, axis, children };
}

function output(
    id: string,
    tree: CosmicNode | null,
    adjacent: Partial<Record<"left" | "right" | "up" | "down", string>> = {},
    workspaceId = "workspace-1",
): CosmicOutputTopology {
    return { id, workspaceId, tree, adjacent };
}

function request(tree: CosmicNode, focusedLeafId: string, direction: "left" | "right" | "up" | "down"): CosmicDirectionalMoveRequest {
    return {
        outputs: [output("source", tree)],
        sourceOutputId: "source",
        focusedLeafId,
        direction,
    };
}

function expectPlanned(result: CosmicMoveOutcome): CosmicMoveOperation {
    assert.equal(result.kind, "planned");
    if (result.kind !== "planned") {
        throw new Error("expected a movement plan");
    }
    return result.operation;
}

describe("COSMIC structural planner: approved P1-P5, F1-F3, G1-G2, M1-M4, U1-U2, S1-S23 references", () => {
    it("plans R1 perpendicular wrapping without geometry (S1-07, S2-03, S3-02)", () => {
        const operation = expectPlanned(planCosmicDirectionalMove(request(group("root", "horizontal", leaf("A"), leaf("B")), "B", "down")));

        assert.deepEqual(operation, {
            sourceOutputId: "source",
            focusedLeafId: "B",
            direction: "down",
            kind: "wrap-perpendicular",
            rule: "R1",
            containerId: "root",
            axis: "vertical",
        });
    });

    it("swaps a two-child leaf neighbour (S1-02, S2-01, S3-01, M1)", () => {
        const operation = expectPlanned(planCosmicDirectionalMove(request(group("root", "horizontal", leaf("A"), leaf("B")), "A", "right")));

        assert.equal(operation.kind, "swap-neighbor");
        assert.equal(operation.rule, "R2a");
        assert.equal(operation.neighborId, "B");
    });

    it("flat-inserts at the midpoint for an even perpendicular target group (S1-08, S3-13, U2)", () => {
        const tree = group("root", "vertical", group("target", "horizontal", leaf("A"), leaf("B"), leaf("C"), leaf("D")), leaf("W"));
        const operation = expectPlanned(planCosmicDirectionalMove(request(tree, "W", "up")));

        assert.equal(operation.kind, "insert-into-group");
        assert.equal(operation.rule, "R2b");
        assert.equal(operation.targetGroupId, "target");
        assert.equal(operation.insertionIndex, 2);
        assert.equal(operation.insertion, "midpoint");
    });

    it("splits the midpoint child for an odd perpendicular target group with W on the near side (S7-02, S9-02, S12-02, S19-02, U1)", () => {
        const tree = group("root", "vertical", group("target", "horizontal", leaf("A"), leaf("B"), leaf("C")), leaf("W"));
        const operation = expectPlanned(planCosmicDirectionalMove(request(tree, "W", "up")));

        assert.equal(operation.kind, "split-group-child");
        assert.equal(operation.rule, "R2b");
        assert.equal(operation.targetGroupId, "target");
        assert.equal(operation.targetChildId, "B");
        assert.equal(operation.targetChildIndex, 1);
        assert.equal(operation.focusedSide, "first");
        assert.equal(operation.axis, "vertical");
    });

    it("inserts at the near edge for a parallel target group (S1-17, S3-08)", () => {
        const tree = group("root", "horizontal", leaf("W"), group("target", "horizontal", leaf("A"), leaf("B")));
        const operation = expectPlanned(planCosmicDirectionalMove(request(tree, "W", "right")));

        assert.equal(operation.kind, "insert-into-group");
        assert.equal(operation.rule, "R2b");
        assert.equal(operation.insertion, "near-edge");
        assert.equal(operation.insertionIndex, 0);
    });

    it("wraps the focused leaf and neighbour in an N-ary parent (S1-01, S4-01, S14-01, S18-01, M2, U1)", () => {
        const tree = group("root", "horizontal", leaf("A"), leaf("W"), leaf("S"), leaf("D"));
        const operation = expectPlanned(planCosmicDirectionalMove(request(tree, "W", "right")));

        assert.equal(operation.kind, "wrap-neighbor");
        assert.equal(operation.rule, "R2c");
        assert.equal(operation.neighborId, "S");
        assert.equal(operation.focusedBeforeNeighbor, true);
        assert.equal(operation.axis, "horizontal");
    });

    it("escapes to a same-axis parent at the immediate directional insertion index (S1-03, S1-06, S3-11, S23-02)", () => {
        const tree = group("root", "horizontal", leaf("A"), group("inner", "horizontal", leaf("W"), leaf("B")), leaf("D"));
        const operation = expectPlanned(planCosmicDirectionalMove(request(tree, "B", "right")));

        assert.equal(operation.kind, "escape-parent");
        assert.equal(operation.rule, "R3");
        assert.equal(operation.containerId, "inner");
        assert.equal(operation.parentId, "root");
        assert.equal(operation.containerChildIndex, 1);
        assert.equal(operation.parentInsertionIndex, 2);
        assert.equal(operation.continuation, "none");
    });

    it("requests the sole perpendicular-parent R1 continuation (S2-02, S3-04, S16-02, G1)", () => {
        const tree = group("root", "horizontal", group("inner", "vertical", leaf("W"), leaf("B")), leaf("D"));
        const operation = expectPlanned(planCosmicDirectionalMove(request(tree, "W", "up")));

        assert.equal(operation.kind, "escape-parent");
        assert.equal(operation.rule, "R3");
        assert.equal(operation.parentInsertionIndex, null);
        assert.equal(operation.continuation, "R1");
    });

    it("plans occupied and empty adjacent-output transfers only after local boundary exhaustion (S20, S22, S23, P1-P5, F1-F3)", () => {
        const sourceTree = group("source-root", "horizontal", leaf("W"), leaf("B"));
        const occupiedRequest: CosmicDirectionalMoveRequest = {
            outputs: [
                output("left", leaf("X"), { right: "source" }),
                output("source", sourceTree, { left: "left" }),
            ],
            sourceOutputId: "source",
            focusedLeafId: "W",
            direction: "left",
        };
        const occupied = expectPlanned(planCosmicDirectionalMove(occupiedRequest));
        assert.equal(occupied.kind, "cross-output");
        assert.equal(occupied.rule, "R4");
        assert.equal(occupied.targetOutputId, "left");
        assert.equal(occupied.sourceRootChildIndex, 0);
        assert.equal(occupied.target, "occupied");

        const emptyRequest: CosmicDirectionalMoveRequest = {
            ...occupiedRequest,
            outputs: [output("left", null, { right: "source" }), output("source", sourceTree, { left: "left" })],
        };
        const empty = expectPlanned(planCosmicDirectionalMove(emptyRequest));
        assert.equal(empty.kind, "cross-output");
        assert.equal(empty.target, "empty");
    });

    it("does not cross a missing or different-workspace output (S5, S6, S17, S21, M3)", () => {
        const tree = group("root", "horizontal", leaf("W"), leaf("B"));
        const missing = planCosmicDirectionalMove({ ...request(tree, "W", "left"), outputs: [output("source", tree)] });
        assert.deepEqual(missing, { kind: "noop", reason: "no-adjacent-output" });

        const differentWorkspace = planCosmicDirectionalMove({
            outputs: [output("target", leaf("X"), { right: "source" }, "workspace-2"), output("source", tree, { left: "target" })],
            sourceOutputId: "source",
            focusedLeafId: "W",
            direction: "left",
        });
        assert.deepEqual(differentWorkspace, { kind: "noop", reason: "no-adjacent-output" });
    });
});

describe("COSMIC structural planner fail-closed topology validation", () => {
    it("rejects duplicate identities, one-child groups, and missing focused leaves", () => {
        const duplicate = group("root", "horizontal", leaf("A"), leaf("A"));
        const oneChild = { kind: "group", id: "root", axis: "horizontal", children: [leaf("A")] } as unknown as CosmicNode;

        assert.equal(planCosmicDirectionalMove(request(duplicate, "A", "right")).kind, "rejected");
        assert.equal(planCosmicDirectionalMove(request(oneChild, "A", "right")).kind, "rejected");
        assert.equal(planCosmicDirectionalMove(request(group("root", "horizontal", leaf("A"), leaf("B")), "missing", "right")).kind, "rejected");
    });

    it("rejects cycles and unknown output adjacency without reading native split results", () => {
        const cyclic = { kind: "group", id: "root", axis: "horizontal", children: [] as CosmicNode[] } as CosmicGroup & { children: CosmicNode[] };
        cyclic.children.push(cyclic);
        assert.equal(planCosmicDirectionalMove(request(cyclic, "missing", "right")).kind, "rejected");

        const malformed = planCosmicDirectionalMove({
            outputs: [output("source", group("root", "horizontal", leaf("A"), leaf("B")), { right: "unknown" })],
            sourceOutputId: "source",
            focusedLeafId: "A",
            direction: "right",
        });
        assert.equal(malformed.kind, "rejected");
    });

    it("rejects shared semantic nodes and malformed output sets", () => {
        const shared = leaf("shared");
        const sharedTree = group("root", "horizontal", shared, shared);
        const sharedResult = planCosmicDirectionalMove(request(sharedTree, "shared", "right"));
        assert.equal(sharedResult.kind, "rejected");

        const missingSource = planCosmicDirectionalMove({
            outputs: [output("source", null)],
            sourceOutputId: "missing",
            focusedLeafId: "A",
            direction: "right",
        });
        assert.equal(missingSource.kind, "rejected");
    });
});
