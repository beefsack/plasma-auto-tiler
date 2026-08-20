import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    h,
    leaf,
    move,
    moveAcrossOutputs,
    v,
    type Direction,
    type MultiOutputState,
    type RuleId,
    type TreeNode,
} from "./move-conformance-model";

type Transition = {
    readonly id: string;
    readonly focusedLeafName: string;
    readonly direction: Direction;
    readonly expected: TreeNode;
};

type Sequence = {
    readonly start: TreeNode;
    readonly transitions: readonly Transition[];
};

type AuthoredVector = {
    readonly id: string;
    readonly start: string;
    readonly focusedLeafName: string;
    readonly direction: Direction;
    readonly expected: string;
};

type AuthoredSequence = {
    readonly id: string;
    readonly vectors: readonly AuthoredVector[];
};

const T1 = leaf("T1");
const T2 = leaf("T2");
const T3 = leaf("T3");
const T4 = leaf("T4");

const sequence1: Sequence = {
    start: h(T2, T1, T3),
    transitions: [
        { id: "S1-01", focusedLeafName: "T2", direction: "right", expected: h(h(T2, T1), T3) },
        { id: "S1-02", focusedLeafName: "T2", direction: "right", expected: h(h(T1, T2), T3) },
        { id: "S1-03", focusedLeafName: "T2", direction: "right", expected: h(T1, T2, T3) },
        { id: "S1-04", focusedLeafName: "T2", direction: "right", expected: h(T1, h(T2, T3)) },
        { id: "S1-05", focusedLeafName: "T2", direction: "right", expected: h(T1, h(T3, T2)) },
        { id: "S1-06", focusedLeafName: "T2", direction: "right", expected: h(T1, T3, T2) },
        { id: "S1-07", focusedLeafName: "T2", direction: "down", expected: v(h(T1, T3), T2) },
        { id: "S1-08", focusedLeafName: "T2", direction: "up", expected: h(T1, T2, T3) },
        { id: "S1-09", focusedLeafName: "T2", direction: "right", expected: h(T1, h(T2, T3)) },
        { id: "S1-10", focusedLeafName: "T2", direction: "down", expected: h(T1, v(T3, T2)) },
        { id: "S1-11", focusedLeafName: "T2", direction: "up", expected: h(T1, v(T2, T3)) },
        { id: "S1-12", focusedLeafName: "T2", direction: "down", expected: h(T1, v(T3, T2)) },
        { id: "S1-13", focusedLeafName: "T2", direction: "right", expected: h(T1, h(T3, T2)) },
        { id: "S1-14", focusedLeafName: "T2", direction: "right", expected: h(T1, T3, T2) },
        { id: "S1-15", focusedLeafName: "T2", direction: "down", expected: v(h(T1, T3), T2) },
        { id: "S1-16", focusedLeafName: "T2", direction: "right", expected: h(h(T1, T3), T2) },
        // Corrected from "right" per the annotated corpus (docs section 11).
        { id: "S1-17", focusedLeafName: "T2", direction: "left", expected: h(T1, T3, T2) },
        { id: "S1-18", focusedLeafName: "T2", direction: "left", expected: h(T1, h(T3, T2)) },
        { id: "S1-19", focusedLeafName: "T2", direction: "left", expected: h(T1, h(T2, T3)) },
        { id: "S1-20", focusedLeafName: "T2", direction: "left", expected: h(T1, T2, T3) },
        { id: "S1-21", focusedLeafName: "T2", direction: "left", expected: h(h(T1, T2), T3) },
    ],
};

const sequence2: Sequence = {
    start: h(v(T1, T2), T3),
    transitions: [
        { id: "S2-01", focusedLeafName: "T2", direction: "up", expected: h(v(T2, T1), T3) },
        { id: "S2-02", focusedLeafName: "T2", direction: "up", expected: v(T2, h(T1, T3)) },
        { id: "S2-03", focusedLeafName: "T2", direction: "right", expected: h(h(T1, T3), T2) },
        { id: "S2-04", focusedLeafName: "T2", direction: "down", expected: v(h(T1, T3), T2) },
        { id: "S2-05", focusedLeafName: "T2", direction: "left", expected: h(T2, h(T1, T3)) },
    ],
};

const sequence3: Sequence = {
    start: v(h(T2, T4), h(T1, T3)),
    transitions: [
        { id: "S3-01", focusedLeafName: "T4", direction: "left", expected: v(h(T4, T2), h(T1, T3)) },
        { id: "S3-02", focusedLeafName: "T4", direction: "down", expected: v(v(T2, T4), h(T1, T3)) },
        { id: "S3-03", focusedLeafName: "T4", direction: "left", expected: v(h(T4, T2), h(T1, T3)) },
        { id: "S3-04", focusedLeafName: "T4", direction: "left", expected: h(T4, v(T2, h(T1, T3))) },
        // Corrected: T4 restored per docs section 11, confirmed by S3-06.
        {
            id: "S3-05",
            focusedLeafName: "T4",
            direction: "down",
            expected: v(v(T2, h(T1, T3)), T4),
        },
        { id: "S3-06", focusedLeafName: "T4", direction: "right", expected: h(v(T2, h(T1, T3)), T4) },
        { id: "S3-07", focusedLeafName: "T4", direction: "up", expected: v(T4, v(T2, h(T1, T3))) },
        { id: "S3-08", focusedLeafName: "T4", direction: "down", expected: v(T4, T2, h(T1, T3)) },
        { id: "S3-09", focusedLeafName: "T4", direction: "down", expected: v(v(T4, T2), h(T1, T3)) },
        { id: "S3-10", focusedLeafName: "T4", direction: "down", expected: v(v(T2, T4), h(T1, T3)) },
        { id: "S3-11", focusedLeafName: "T4", direction: "down", expected: v(T2, T4, h(T1, T3)) },
        { id: "S3-12", focusedLeafName: "T4", direction: "down", expected: v(T2, v(T4, h(T1, T3))) },
        { id: "S3-13", focusedLeafName: "T4", direction: "down", expected: v(T2, h(T1, T4, T3)) },
        { id: "S3-14", focusedLeafName: "T4", direction: "down", expected: v(T2, v(h(T1, T3), T4)) },
    ],
};

const authoredSequences: readonly AuthoredSequence[] = [
    {
        id: "S4",
        vectors: [
            { id: "S4-01", start: "H[A,B,C]", focusedLeafName: "A", direction: "right", expected: "H[H[A,B],C]" },
            { id: "S4-02", start: "H[H[A,B],C]", focusedLeafName: "A", direction: "right", expected: "H[H[B,A],C]" },
            { id: "S4-03", start: "H[H[B,A],C]", focusedLeafName: "A", direction: "right", expected: "H[B,A,C]" },
        ],
    },
    {
        id: "S5",
        vectors: [
            { id: "S5-01", start: "H[A,B]", focusedLeafName: "A", direction: "left", expected: "H[A,B]" },
        ],
    },
    {
        id: "S6",
        vectors: [
            { id: "S6-01", start: "H[A,B]", focusedLeafName: "B", direction: "down", expected: "V[A,B]" },
            { id: "S6-02", start: "V[A,B]", focusedLeafName: "B", direction: "up", expected: "V[B,A]" },
            { id: "S6-03", start: "V[B,A]", focusedLeafName: "B", direction: "up", expected: "V[B,A]" },
        ],
    },
    {
        id: "S7",
        vectors: [
            { id: "S7-01", start: "H[A,B,C,D]", focusedLeafName: "D", direction: "down", expected: "V[H[A,B,C],D]" },
            { id: "S7-02", start: "V[H[A,B,C],D]", focusedLeafName: "D", direction: "up", expected: "H[A,V[B,D],C]" },
        ],
    },
    {
        id: "S8",
        vectors: [
            { id: "S8-01", start: "H[A,B,C,D,E]", focusedLeafName: "E", direction: "down", expected: "V[H[A,B,C,D],E]" },
            { id: "S8-02", start: "V[H[A,B,C,D],E]", focusedLeafName: "E", direction: "up", expected: "H[A,B,E,C,D]" },
        ],
    },
    {
        id: "S9",
        vectors: [
            { id: "S9-01", start: "H[A,B,H[C,D],E]", focusedLeafName: "E", direction: "down", expected: "V[H[A,B,H[C,D]],E]" },
            { id: "S9-02", start: "V[H[A,B,H[C,D]],E]", focusedLeafName: "E", direction: "up", expected: "H[A,V[B,E],H[C,D]]" },
        ],
    },
    {
        id: "S10",
        vectors: [
            { id: "S10-01", start: "H[V[A,C],V[B,D]]", focusedLeafName: "A", direction: "down", expected: "H[V[C,A],V[B,D]]" },
        ],
    },
    {
        id: "S11",
        vectors: [
            { id: "S11-01", start: "V[H[A,B],H[C,D]]", focusedLeafName: "A", direction: "down", expected: "V[V[B,A],H[C,D]]" },
        ],
    },
    {
        id: "S12",
        vectors: [
            { id: "S12-01", start: "H[A,B,C,D,E,F]", focusedLeafName: "F", direction: "down", expected: "V[H[A,B,C,D,E],F]" },
            { id: "S12-02", start: "V[H[A,B,C,D,E],F]", focusedLeafName: "F", direction: "up", expected: "H[A,B,V[C,F],D,E]" },
        ],
    },
    {
        id: "S13",
        vectors: [
            { id: "S13-01", start: "H[A,B,C]", focusedLeafName: "C", direction: "down", expected: "V[H[A,B],C]" },
            { id: "S13-02", start: "V[H[A,B],C]", focusedLeafName: "C", direction: "up", expected: "H[A,C,B]" },
        ],
    },
    {
        id: "S14",
        vectors: [
            { id: "S14-01", start: "H[A,B,C,D]", focusedLeafName: "A", direction: "right", expected: "H[H[A,B],C,D]" },
            { id: "S14-02", start: "H[H[A,B],C,D]", focusedLeafName: "B", direction: "right", expected: "H[A,B,C,D]" },
            { id: "S14-03", start: "H[A,B,C,D]", focusedLeafName: "A", direction: "left", expected: "H[A,B,C,D]" },
        ],
    },
    {
        id: "S15",
        vectors: [
            { id: "S15-01", start: "H[A,B,C,D]", focusedLeafName: "A", direction: "right", expected: "H[H[A,B],C,D]" },
            { id: "S15-02", start: "H[H[A,B],C,D]", focusedLeafName: "C", direction: "right", expected: "H[H[A,B],H[C,D]]" },
            { id: "S15-03", start: "H[H[A,B],H[C,D]]", focusedLeafName: "B", direction: "right", expected: "H[A,B,H[C,D]]" },
        ],
    },
    {
        id: "S16",
        vectors: [
            { id: "S16-01", start: "H[A,B,C]", focusedLeafName: "C", direction: "down", expected: "V[H[A,B],C]" },
            { id: "S16-02", start: "V[H[A,B],C]", focusedLeafName: "B", direction: "right", expected: "H[V[A,C],B]" },
        ],
    },
    {
        id: "S17",
        vectors: [
            { id: "S17-01", start: "A", focusedLeafName: "A", direction: "left", expected: "A" },
            { id: "S17-02", start: "A", focusedLeafName: "A", direction: "right", expected: "A" },
            { id: "S17-03", start: "A", focusedLeafName: "A", direction: "up", expected: "A" },
            { id: "S17-04", start: "A", focusedLeafName: "A", direction: "down", expected: "A" },
        ],
    },
    {
        id: "S18",
        vectors: [
            { id: "S18-01", start: "H[A,B,C,D]", focusedLeafName: "B", direction: "right", expected: "H[A,H[B,C],D]" },
            { id: "S18-02", start: "H[A,H[B,C],D]", focusedLeafName: "A", direction: "right", expected: "H[H[A,H[B,C]],D]" },
        ],
    },
    {
        id: "S19",
        vectors: [
            { id: "S19-01", start: "H[A,B,C,D]", focusedLeafName: "D", direction: "up", expected: "V[D,H[A,B,C]]" },
            { id: "S19-02", start: "V[D,H[A,B,C]]", focusedLeafName: "D", direction: "down", expected: "H[A,V[D,B],C]" },
        ],
    },
    {
        id: "S20",
        vectors: [
            { id: "S20-01", start: "L=X, R=H[A,B]", focusedLeafName: "A", direction: "left", expected: "L=H[X,A], R=B" },
        ],
    },
    {
        id: "S21",
        vectors: [
            { id: "S21-01", start: "L=X, R=V[A,B]", focusedLeafName: "A", direction: "left", expected: "L=X, R=H[A,B]" },
        ],
    },
    {
        id: "S22",
        vectors: [
            { id: "S22-01", start: "L=empty, R=H[A,B]", focusedLeafName: "A", direction: "left", expected: "L=A, R=B" },
        ],
    },
    {
        id: "S23",
        vectors: [
            { id: "S23-01", start: "L=X, R=H[A,B,C]", focusedLeafName: "A", direction: "right", expected: "L=X, R=H[H[A,B],C]" },
            { id: "S23-02", start: "L=X, R=H[H[A,B],C]", focusedLeafName: "A", direction: "left", expected: "L=X, R=H[A,B,C]" },
            { id: "S23-03", start: "L=X, R=H[A,B,C]", focusedLeafName: "A", direction: "left", expected: "L=H[X,A], R=H[B,C]" },
        ],
    },
];

const sequences: readonly Sequence[] = [sequence1, sequence2, sequence3];

function render(node: TreeNode): string {
    if (node.kind === "leaf") {
        return node.name;
    }
    return `${node.axis}[${node.children.map(render).join(",")}]`;
}

function parseTree(input: string): TreeNode {
    let index = 0;

    function parseNode(): TreeNode {
        const axis = input[index];
        if ((axis === "H" || axis === "V") && input[index + 1] === "[") {
            index += 2;
            const children: TreeNode[] = [];
            while (input[index] !== "]") {
                children.push(parseNode());
                if (input[index] === ",") {
                    index += 1;
                }
            }
            index += 1;
            return axis === "H" ? h(...children) : v(...children);
        }

        const start = index;
        while (input[index] !== "," && input[index] !== "]" && index < input.length) {
            index += 1;
        }
        return leaf(input.slice(start, index));
    }

    const result = parseNode();
    assert.equal(index, input.length, `unparsed tree suffix in ${input}`);
    return result;
}

type TraceRow = {
    readonly id: string;
    readonly rule: RuleId;
    readonly resultTree: string;
};

describe("move conformance corpus (S1-S3: 40 transitions)", () => {
    const trace: TraceRow[] = [];

    for (const sequence of sequences) {
        let current = sequence.start;
        for (const transition of sequence.transitions) {
            it(`${transition.id}: ${transition.focusedLeafName} ${transition.direction}`, () => {
                const result = move(current, transition.focusedLeafName, transition.direction);
                assert.deepEqual(
                    result.tree,
                    transition.expected,
                    `${transition.id}: expected ${render(transition.expected)}, got ${render(result.tree)}`,
                );
                trace.push({ id: transition.id, rule: result.rule, resultTree: render(result.tree) });
                current = result.tree;
            });
        }
    }

    it("builds the rule-firing trace for all corpus transitions", () => {
        // S1-01..S1-21, S2-01..S2-05, and S3-01..S3-14 total 40 rows.
        const totalTransitions = sequences.reduce((sum, seq) => sum + seq.transitions.length, 0);
        assert.equal(totalTransitions, 40);
        assert.equal(trace.length, 40, "trace must contain every corpus transition");

        const lines = [
            "# Move conformance rule-firing trace",
            "",
            "Generated by `kwin/tests/move-conformance.test.ts` while replaying the",
            "S1-S3 corpus against `kwin/tests/move-conformance-model.ts`. S1-S3",
            "total 40 transitions (21 in S1, 5 in S2, 14 in S3).",
            "",
            "| ID | Rule fired | Resulting tree |",
            "| --- | --- | --- |",
            ...trace.map((row) => `| ${row.id} | ${row.rule} | \`${row.resultTree}\` |`),
            "",
        ];

        // The committed trace consumed by docs/cosmic-move-conformance.md
        // lives at docs/changes/archive/2026-08-20-cosmic-evidence-mining/
        // research/move-conformance-trace.md as a frozen artifact from
        // when it was authored - this test intentionally does not rewrite
        // it on every run (a test run must never silently mutate archived,
        // committed documentation). Re-running this test only re-proves the
        // trace is still reproducible; a local, gitignored copy is written
        // under dist/ for inspection.
        const outDir = join(process.cwd(), "dist");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "move-conformance-trace.md"), lines.join("\n"), "utf8");
    });

    it("keeps every authored S4-S23 sequence chained", () => {
        for (const sequence of authoredSequences) {
            for (let index = 1; index < sequence.vectors.length; index++) {
                const previous = sequence.vectors[index - 1];
                const vector = sequence.vectors[index];
                if (previous === undefined || vector === undefined) {
                    throw new Error(`${sequence.id}: missing authored vector`);
                }
                assert.deepEqual(vector.start, previous.expected, `${vector.id}: start must equal prior expected`);
            }
        }
    });
});

describe("authored single-output COSMIC vectors", () => {
    for (const sequence of authoredSequences.slice(0, 16)) {
        for (const vector of sequence.vectors) {
            it(`${vector.id}: ${vector.focusedLeafName} ${vector.direction}`, () => {
                const result = move(parseTree(vector.start), vector.focusedLeafName, vector.direction);
                assert.deepEqual(
                    result.tree,
                    parseTree(vector.expected),
                    `${vector.id}: expected ${vector.expected}, got ${render(result.tree)}`,
                );
            });
        }
    }
});

function outputState(
    left: TreeNode | undefined,
    right: TreeNode | undefined,
    workspace = "one",
): MultiOutputState {
    return {
        outputs: [
            { id: "L", workspace, tree: left, adjacent: { right: "R" } },
            { id: "R", workspace, tree: right, adjacent: { left: "L" } },
        ],
    };
}

function outputTree(state: MultiOutputState, id: string): TreeNode | undefined {
    const output = state.outputs.find((candidate) => candidate.id === id);
    if (output === undefined) {
        throw new Error(`missing output ${id}`);
    }
    return output.tree;
}

describe("authored multi-output COSMIC vectors", () => {
    const vectors = authoredSequences.slice(16).flatMap((sequence) => sequence.vectors);

    it("S20-01: crosses left into an occupied single-leaf target", () => {
        const vector = vectors[0];
        if (vector === undefined) {
            throw new Error("missing S20-01");
        }
        const result = moveAcrossOutputs(outputState(leaf("X"), h(leaf("A"), leaf("B"))), "R", vector.focusedLeafName, vector.direction);
        assert.equal(result.rule, "4-cross-output");
        assert.deepEqual(outputTree(result.state, "L"), h(leaf("X"), leaf("A")));
        assert.deepEqual(outputTree(result.state, "R"), leaf("B"));
    });

    it("S21-01: applies R1 before considering a crossing", () => {
        const vector = vectors[1];
        if (vector === undefined) {
            throw new Error("missing S21-01");
        }
        const result = moveAcrossOutputs(outputState(leaf("X"), v(leaf("A"), leaf("B"))), "R", vector.focusedLeafName, vector.direction);
        assert.equal(result.rule, "1");
        assert.deepEqual(outputTree(result.state, "L"), leaf("X"));
        assert.deepEqual(outputTree(result.state, "R"), h(leaf("A"), leaf("B")));
    });

    it("S22-01: moves to an empty adjacent target", () => {
        const vector = vectors[2];
        if (vector === undefined) {
            throw new Error("missing S22-01");
        }
        const result = moveAcrossOutputs(outputState(undefined, h(leaf("A"), leaf("B"))), "R", vector.focusedLeafName, vector.direction);
        assert.equal(result.rule, "4-cross-output");
        assert.deepEqual(outputTree(result.state, "L"), leaf("A"));
        assert.deepEqual(outputTree(result.state, "R"), leaf("B"));
    });

    it("S23-01: keeps an eligible local R2b move on its source output", () => {
        const vector = vectors[3];
        if (vector === undefined) {
            throw new Error("missing S23-01");
        }
        const result = moveAcrossOutputs(outputState(leaf("X"), h(leaf("A"), leaf("B"), leaf("C"))), "R", vector.focusedLeafName, vector.direction);
        assert.equal(result.rule, "2b");
        assert.deepEqual(outputTree(result.state, "L"), leaf("X"));
        assert.deepEqual(outputTree(result.state, "R"), h(h(leaf("A"), leaf("B")), leaf("C")));
    });

    it("S23-02: keeps an eligible ancestor rule on its source output", () => {
        const vector = vectors[4];
        if (vector === undefined) {
            throw new Error("missing S23-02");
        }
        const result = moveAcrossOutputs(outputState(leaf("X"), h(h(leaf("A"), leaf("B")), leaf("C"))), "R", vector.focusedLeafName, vector.direction);
        assert.equal(result.rule, "3-flatten");
        assert.deepEqual(outputTree(result.state, "L"), leaf("X"));
        assert.deepEqual(outputTree(result.state, "R"), h(leaf("A"), leaf("B"), leaf("C")));
    });

    it("S23-03: wraps an occupied multi-window target without changing its shape", () => {
        const vector = vectors[5];
        if (vector === undefined) {
            throw new Error("missing S23-03");
        }
        const target = v(leaf("X1"), leaf("X2"));
        const result = moveAcrossOutputs(outputState(target, h(leaf("A"), leaf("B"), leaf("C"))), "R", vector.focusedLeafName, vector.direction);
        assert.equal(result.rule, "4-cross-output");
        assert.deepEqual(outputTree(result.state, "L"), h(target, leaf("A")));
        assert.deepEqual(outputTree(result.state, "R"), h(leaf("B"), leaf("C")));
    });

    it("wraps occupied targets on the correct side for every direction", () => {
        const cases: readonly {
            readonly direction: Direction;
            readonly source: TreeNode;
            readonly expectedSource: TreeNode;
            readonly expectedTarget: TreeNode;
        }[] = [
            { direction: "left", source: h(leaf("A"), leaf("B")), expectedSource: leaf("B"), expectedTarget: h(leaf("X"), leaf("A")) },
            { direction: "right", source: h(leaf("B"), leaf("A")), expectedSource: leaf("B"), expectedTarget: h(leaf("A"), leaf("X")) },
            { direction: "up", source: v(leaf("A"), leaf("B")), expectedSource: leaf("B"), expectedTarget: v(leaf("X"), leaf("A")) },
            { direction: "down", source: v(leaf("B"), leaf("A")), expectedSource: leaf("B"), expectedTarget: v(leaf("A"), leaf("X")) },
        ];
        for (const testCase of cases) {
            const state: MultiOutputState = {
                outputs: [
                    { id: "source", workspace: "one", tree: testCase.source, adjacent: { [testCase.direction]: "target" } },
                    { id: "target", workspace: "one", tree: leaf("X"), adjacent: {} },
                ],
            };
            const result = moveAcrossOutputs(state, "source", "A", testCase.direction);
            assert.equal(result.rule, "4-cross-output", testCase.direction);
            assert.deepEqual(outputTree(result.state, "source"), testCase.expectedSource, testCase.direction);
            assert.deepEqual(outputTree(result.state, "target"), testCase.expectedTarget, testCase.direction);
        }
    });

    it("retains the local no-op when no adjacent output exists", () => {
        const state: MultiOutputState = {
            outputs: [{ id: "R", workspace: "one", tree: h(leaf("A"), leaf("B")), adjacent: {} }],
        };
        const result = moveAcrossOutputs(state, "R", "A", "left");
        assert.equal(result.rule, "4-noop");
        assert.deepEqual(result.state, state);
    });

    it("never crosses to an adjacent output on another workspace", () => {
        const state = outputState(leaf("X"), h(leaf("A"), leaf("B")));
        const otherWorkspace: MultiOutputState = {
            outputs: state.outputs.map((output) => (output.id === "L" ? { ...output, workspace: "two" } : output)),
        };
        const result = moveAcrossOutputs(otherWorkspace, "R", "A", "left");
        assert.equal(result.rule, "4-noop");
        assert.deepEqual(result.state, otherWorkspace);
    });
});
