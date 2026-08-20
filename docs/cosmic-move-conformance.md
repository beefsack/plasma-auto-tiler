# COSMIC directional-move conformance corpus

This is the machine-checkable version of the transcript behind
`docs/reference-wm-comparison.md` section 11 ("Directional window movement
with no candidate window (COSMIC)"). The transcript, the derived rule model,
and the two pending corrections all originate there; this document exists so
they can be replayed mechanically rather than trusted by inspection.

The corpus is executed by `kwin/tests/move-conformance.test.ts` against the
pure reference model in `kwin/tests/move-conformance-model.ts` (see
"Executable replay" below). Both files are verification/reference artifacts
only - self-contained, uncoupled from `kwin/src/controller.ts` and
`kwin/src/logic.ts`, and never wired into shipped tiling behaviour.

## Notation

- `H[...]` - a horizontal split; children ordered left-to-right.
- `V[...]` - a vertical split; children ordered top-to-bottom.
- Leaves are terminal window names (`T1`, `T2`, ...).
- Splits may hold 3 or more children.
- All splits are evenly spaced (ratio/geometry is out of scope for this
  corpus; only tree structure and child order are asserted).

Example: `H[T1, V[T2,T3]]` is `T1` on the left, with `T2` above `T3` on the
right.

## The rules

`C` is the split directly containing the focused window `W`; `D` is the move
direction. "Parallel" means `D` runs along `C`'s axis (left/right on a
Horizontal split, up/down on a Vertical split); "perpendicular" is the other
axis.

```
1. C is PERPENDICULAR to D
     -> extract W; wrap C in a new split on D's axis; W placed at
        the D end. C collapses if left with a single child.

2. C is PARALLEL to D and W has a neighbour S in direction D
     2a. C has exactly 2 children:
           S is a container -> descend into S, inserting at the
                               spatially nearest slot
           S is a leaf      -> swap W and S
     2b. C has 3 or more children:
           wrap W and S together in a new split of C's own
           orientation, with W on the near side

3. C is PARALLEL to D and W sits at C's edge in that direction
     -> ascend to C's parent and re-apply from rule 1

4. No ancestor can act -> UNKNOWN, never reached
```

Every move is exactly one tree edit. See `docs/reference-wm-comparison.md`
section 11 for the full observed/inferred findings, including that rule 2a's
"nearest slot" rests on a single transcript data point and rule 4 is entirely
unobserved.

## The corpus

Three sequences transcribed by the user from their own COSMIC session
recording. Each row is: focused window, direction, resulting tree. Each
result is the input to the next row.

**Count note**: the corpus totals 40 transitions (21 in S1, 5 in S2, 14 in
S3). An earlier draft of this document described it as 41; that was a count
error in the draft, not a missing or dropped row - every transition below
was transcribed and mechanically replayed.

### Sequence S1 - three terminals

| Step | Focus | Dir | Result | Rule fired |
|---|---|---|---|---|
| S1-00 | (start) | - | `H[T2,T1,T3]` | - |
| S1-01 | T2 | right | `H[H[T2,T1],T3]` | 2b |
| S1-02 | T2 | right | `H[H[T1,T2],T3]` | 2a (leaf swap) |
| S1-03 | T2 | right | `H[T1,T2,T3]` | 3 (ascend, same-axis flatten) |
| S1-04 | T2 | right | `H[T1,H[T2,T3]]` | 2b |
| S1-05 | T2 | right | `H[T1,H[T3,T2]]` | 2a (leaf swap) |
| S1-06 | T2 | right | `H[T1,T3,T2]` | 3 (ascend, same-axis flatten) |
| S1-07 | T2 | down | `V[H[T1,T3],T2]` | 1 |
| S1-08 | T2 | up | `H[T1,T2,T3]` | 2a (descend into container) |
| S1-09 | T2 | right | `H[T1,H[T2,T3]]` | 2b |
| S1-10 | T2 | down | `H[T1,V[T3,T2]]` | 1 |
| S1-11 | T2 | up | `H[T1,V[T2,T3]]` | 2a (leaf swap) |
| S1-12 | T2 | down | `H[T1,V[T3,T2]]` | 2a (leaf swap) |
| S1-13 | T2 | right | `H[T1,H[T3,T2]]` | 1 |
| S1-14 | T2 | right | `H[T1,T3,T2]` | 3 (ascend, same-axis flatten) |
| S1-15 | T2 | down | `V[H[T1,T3],T2]` | 1 |
| S1-16 | T2 | right | `H[H[T1,T3],T2]` | 1 |
| S1-17 | T2 | **left** [CORRECTED] | `H[T1,T3,T2]` | 2a (descend into container) |
| S1-18 | T2 | left | `H[T1,H[T3,T2]]` | 2b |
| S1-19 | T2 | left | `H[T1,H[T2,T3]]` | 2a (leaf swap) |
| S1-20 | T2 | left | `H[T1,T2,T3]` | 3 (ascend, same-axis flatten) |
| S1-21 | T2 | left | `H[H[T1,T2],T3]` | 2b |

### Sequence S2 - three terminals, fresh start

| Step | Focus | Dir | Result | Rule fired |
|---|---|---|---|---|
| S2-00 | (start) | - | `H[V[T1,T2],T3]` | - |
| S2-01 | T2 | up | `H[V[T2,T1],T3]` | 2a (leaf swap) |
| S2-02 | T2 | up | `V[T2,H[T1,T3]]` | 3 (ascend, perpendicular parent -> rule 1) |
| S2-03 | T2 | right | `H[H[T1,T3],T2]` | 1 |
| S2-04 | T2 | down | `V[H[T1,T3],T2]` | 1 |
| S2-05 | T2 | left | `H[T2,H[T1,T3]]` | 1 |

### Sequence S3 - four terminals

| Step | Focus | Dir | Result | Rule fired |
|---|---|---|---|---|
| S3-00 | (start) | - | `V[H[T2,T4],H[T1,T3]]` | - |
| S3-01 | T4 | left | `V[H[T4,T2],H[T1,T3]]` | 2a (leaf swap) |
| S3-02 | T4 | down | `V[V[T2,T4],H[T1,T3]]` | 1 |
| S3-03 | T4 | left | `V[H[T4,T2],H[T1,T3]]` | 1 |
| S3-04 | T4 | left | `H[T4,V[T2,H[T1,T3]]]` | 3 (ascend, perpendicular parent -> rule 1) |
| S3-05 | T4 | down [CORRECTED] | `V[V[T2,H[T1,T3]],T4]` | 1 |
| S3-06 | T4 | right | `H[V[T2,H[T1,T3]],T4]` | 1 |
| S3-07 | T4 | up | `V[T4,V[T2,H[T1,T3]]]` | 1 |
| S3-08 | T4 | down | `V[T4,T2,H[T1,T3]]` | 2a (descend into container) |
| S3-09 | T4 | down | `V[V[T4,T2],H[T1,T3]]` | 2b |
| S3-10 | T4 | down | `V[V[T2,T4],H[T1,T3]]` | 2a (leaf swap) |
| S3-11 | T4 | down | `V[T2,T4,H[T1,T3]]` | 3 (ascend, same-axis flatten) |
| S3-12 | T4 | down | `V[T2,V[T4,H[T1,T3]]]` | 2b |
| S3-13 | T4 | down | `V[T2,H[T1,T4,T3]]` | 2a (descend into container) |
| S3-14 | T4 | down | `V[T2,V[H[T1,T3],T4]]` | 1 |

Per-transition rule annotations are sourced from
`docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/move-conformance-trace.md`, the
raw output of the executable replay (see below), not hand-derived - a
second, independent hand-derivation would only repeat the error risk the
first hand-derivation already carries.

## The two corrections - awaiting user confirmation

Both are model-derived, both concern the user's own transcript, and **the
user has not yet confirmed either one**. They are recorded here as
corrections awaiting confirmation, never as settled fact.

- **S1-17.** The user annotated this step "move right (I think but it might
  have been a move left)". Under the model, a move right is unreachable from
  `H[H[T1,T3],T2]`; a move left descends into `H[T1,T3]` at its near edge and
  the root collapses, giving exactly the recorded result. Recorded as
  **left**.
- **S3-05.** The user's transcript omits `T4` entirely from the result. It
  should read `V[V[T2,H[T1,T3]],T4]`. Confirmed by S3-06, which only works
  if `T4` was in that position.

## Pending cases

Five live tests the user is running now in COSMIC directly (not from the
video or transcript) and will report next session. These are corpus entries
with **unknown expected results - placeholders, not assertions.**

- **P1** - do nested same-orientation splits exist? `H[A,B,C]` at 33/33/33,
  focus A, move right. Predicted: A stays leftmost, widths become 25/25/50.
  Then move right again (predicted swap), then again (predicted back to
  33/33/33 as `B|A|C`). **If widths never change, rule 2b needs rework -
  this is the load-bearing test.**
- **P2** - horizontal screen edge, rule 4. `H[A,B]`, focus A, move left.
  Unpredicted.
- **P3** - `H[A,B]`, focus B, move down (predicted `V[A,B]`), then B up
  (predicted swap), then B up again (unpredicted, rule 4 vertically).
- **P4** - rule 2a insertion slot with an odd child count. `V[H[A,B,C],D]`,
  focus D, move up. Lands in the top row but the gap is unknown: `A D B C`
  or `A B D C`. The only rule resting on a single data point.
- **P5** - 2x2 grid, focus top-left A, move down. Predicted A stays in the
  top half, top row becomes `V[B,A]`. If A drops into the bottom row, "local
  container wins" collapses.

## Executable replay

`kwin/tests/move-conformance-model.ts` is a pure, self-contained TypeScript
implementation of the four rules above over an N-ary tree - no KWin imports,
no dependency on `kwin/src/controller.ts` or `kwin/src/logic.ts`, no
coupling to this project's own tile tree. Pure data in, pure data out.

`kwin/tests/move-conformance.test.ts` replays the entire corpus: it parses
each start state, applies each `(window, direction)` transition in order,
asserts the result matches the recorded tree exactly, and carries the result
forward as the next input. It also writes the per-transition rule-firing
trace consumed by the tables above.

**All 40 corpus transitions replay correctly against the model** as of this
writing (`npm test` in `kwin/`: 879 tests / 79 suites / 879 pass / 0 fail,
including the corpus's 40 transition assertions plus 1 trace-writing test).
This is a second, independent check on the hand-derived model in
`docs/reference-wm-comparison.md` section 11, not a restatement of it - had
any transition failed to replay, the model in section 11 would have been
wrong and this document would report that failure rather than silently
adjusting the corpus to match.

This reference implementation is a verification and future-reference
artifact only. It is not shipped tiling behaviour and must not be wired into
`kwin/src/controller.ts`, the production bundle, or any runtime path.
