import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { h, leaf, move, v, type Direction, type RuleId, type TreeNode } from "./move-conformance-model";

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

const sequences: readonly Sequence[] = [sequence1, sequence2, sequence3];

function render(node: TreeNode): string {
    if (node.kind === "leaf") {
        return node.name;
    }
    return `${node.axis}[${node.children.map(render).join(",")}]`;
}

type TraceRow = {
    readonly id: string;
    readonly rule: RuleId;
    readonly resultTree: string;
};

describe("move conformance corpus (41 transitions)", () => {
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

    it("writes the rule-firing trace for all corpus transitions", () => {
        // Note: the corpus as literally enumerated in the work-unit brief
        // (S1-01..S1-21, S2-01..S2-05, S3-01..S3-14) totals 21 + 5 + 14 =
        // 40 transitions, not 41 as the brief's prose states. This is a
        // count discrepancy in the brief text itself, not a missing row;
        // every row given was transcribed and replayed.
        const totalTransitions = sequences.reduce((sum, seq) => sum + seq.transitions.length, 0);
        assert.equal(totalTransitions, 40);
        assert.equal(trace.length, 40, "trace must contain every corpus transition before it is written");

        const lines = [
            "# Move conformance rule-firing trace",
            "",
            "Generated by `kwin/tests/move-conformance.test.ts` while replaying the",
            "corpus against `kwin/tests/move-conformance-model.ts`. The corpus as",
            "enumerated in the work-unit brief totals 40 transitions (21 in S1, 5 in",
            "S2, 14 in S3); the brief's prose describes it as 41, which is a count",
            "discrepancy in the brief text, not a missing row.",
            "Do not hand-edit; regenerate by running `npm test` in `kwin/`.",
            "",
            "| ID | Rule fired | Resulting tree |",
            "| --- | --- | --- |",
            ...trace.map((row) => `| ${row.id} | ${row.rule} | \`${row.resultTree}\` |`),
            "",
        ];

        // npm test always runs with cwd = kwin/ (per package.json), so the
        // repo root's docs/ directory is one level up from there.
        const outDir = join(
            process.cwd(),
            "..",
            "docs",
            "changes",
            "cosmic-evidence-mining",
            "research",
        );
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "move-conformance-trace.md"), lines.join("\n"), "utf8");
    });
});
