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
R1. C is PERPENDICULAR to D
      -> extract W; wrap C in a new split on D's axis; W placed at
         the D end. C collapses if left with a single child.

R2. C is PARALLEL to D and W has a neighbour S in direction D with
    exactly 2 direct children:
      R2a. S is a leaf -> swap W and S.
      R2b. S is a container with n direct children (a nested group is one
           direct child). The parity descent behavior applies only if S is
           PERPENDICULAR to D: if n is even, flat-insert W at n/2; if n is
           odd, replace child (n-1)/2 with a D-axis split containing that
           child and W on the near side (S1-08, S3-13). If S is PARALLEL to
           D, W flat-inserts at S's NEAR EDGE, the end adjacent to W's
           original side (S1-17, S3-08). This defines child order and count,
           not geometry. This prose correction changes zero authored vectors
           and zero model code.

R2c. C is PARALLEL to D and has 3 or more direct children:
     wrap W and any neighbour S together in a new split of C's own
     orientation, with W on the near side.

R3. C is PARALLEL to D and W sits at C's edge in that direction:
    remove W from non-root C and insert it immediately on C's D side in
    C's parent. Collapse C if one child remains. The escape ends, except a
    perpendicular receiving parent immediately applies R1.

R4. A direct root-edge child crosses only to an adjacent output in D. An
    occupied target gains a top-level D-axis split with W nearest the source
    and the target tree on the other side; an empty target receives W alone.
    With no target it is a no-op. It never crosses workspaces.
```

S18 proves R2c also wraps a container neighbour. S19 proves odd-parity
near-side placement in both directions. Only deeper-than-one parity descent
and post-resize behavior remain explicitly unobserved.

Horizontal output adjacency places the target in a top-level H split;
vertical output adjacency places it in a top-level V split. This is prose
only; the corpus has no fabricated vertical-adjacency vector.

## Sizing

These are observed sizing facts, separate from the structural rules above.

- S1. Joining a group resizes the mover: a window entering a container takes
  `1/n` of that container's extent on its axis after insertion; a nested group
  is one direct child.
- S2. Existing direct children retain their relative proportions and each
  scales by `(n-1)/n`; do not equalize or recalculate them.
- S3. Leaving a group never resizes anything at any nesting depth.
  Extraction and one-child collapse preserve absolute geometry; a promoted
  child keeps its own size and does not inherit the dissolved container's
  extent.
- S4. Resize only when entering a group the mover was not already
  transitively a member of. R3 escape does not resize because W is already in
  the receiving parent; R2b descent and R2c wrapping do resize because the
  target was not previously inside.

Evidence: for R2b, `H[A,H[B,C]]` with B/C at extremes, moving A right gives
`A=1/3`; with four children the mover is `1/4` and B/C retain their 40:60
proportion within the remaining `2/3`. For R2c, start `H[A,B,C,D]` uneven;
focus B/right gives `H[A,H[B,C],D]`; A/D are unchanged, the wrapper retains
the pair's combined former extent, and B/C halve inside it. For R3, start
`H[A,H[B,C],D,E]` uneven; focus C/right gives no resize, confirmed with
another nesting level.

The canonical result is `1/n`. It is mathematically identical to taking the
new child as the mean existing weight and then normalizing, yielding a `1/n`
mover and `(n-1)/n` for the rest.

Not observed: R1 sizing, pixel rounding, behavior after manual resize, and
which sibling absorbs a user drag in a 3+ split.

## The corpus

S1-S3 are transcribed from the user's original COSMIC recording. S4-S23 are
authored, already-chained observations. Each row is: focused window,
direction, resulting tree. Each result is the input to the next row.

**S1-S3 count note**: 21 transitions in S1, 5 in S2, and 14 in S3: 40 total.

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

### Sequence S4 - three terminals, R2c through R3

Start: `H[A,B,C]`, widths 33/33/33. Observes R2c, R2a, then R3.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S4-01 | A | right | `H[H[A,B],C]` (25/25/50, faint grouped border) |
| S4-02 | A | right | `H[H[B,A],C]` (same widths) |
| S4-03 | A | right | `H[B,A,C]` (33/33/33) |

### Sequence S5 - output-edge no-op

Start: `H[A,B]`, single output with no adjacent output. Observes R4 no-op.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S5-01 | A | left | `H[A,B]` unchanged, no animation |

### Sequence S6 - vertical R1, R2a, and R4

Start: `H[A,B]`. Observes R1, R2a, then R4 no-op.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S6-01 | B | down | `V[A,B]` |
| S6-02 | B | up | `V[B,A]` |
| S6-03 | B | up | `V[B,A]` unchanged, no animation |

### Sequence S7 - odd R2b

Start: `H[A,B,C,D]`, 25% each. Observes R1 then odd R2b; B and D are near side, with D below B.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S7-01 | D | down | `V[H[A,B,C],D]` |
| S7-02 | D | up | `H[A,V[B,D],C]` |

### Sequence S8 - even R2b

Start: `H[A,B,C,D,E]`, 20% each. Observes R1 then even R2b with a middle-gap flat insertion.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S8-01 | E | down | `V[H[A,B,C,D],E]` |
| S8-02 | E | up | `H[A,B,E,C,D]` |

### Sequence S9 - odd R2b with a container child

Start: `H[A,B,H[C,D],E]`; A, B, and E are 25%, and C/D share the remainder. Observes R1 then odd R2b: top children are thirds, the vertical split is half-height, C/D are half their third, and the group counts as one child (`n=3`).

| Step | Focus | Dir | Result |
|---|---|---|---|
| S9-01 | E | down | `V[H[A,B,H[C,D]],E]` |
| S9-02 | E | up | `H[A,V[B,E],H[C,D]]` |

### Sequence S10 - two-child leaf swap

Start: `H[V[A,C],V[B,D]]`. Observes R2a.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S10-01 | A | down | `H[V[C,A],V[B,D]]` |

### Sequence S11 - no descent into populated below row

Start: `V[H[A,B],H[C,D]]`. Observes R1.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S11-01 | A | down | `V[V[B,A],H[C,D]]` |

### Sequence S12 - odd R2b

Start: `H[A,B,C,D,E,F]`, about 16.7% each. Observes R1 then odd R2b, with C above F.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S12-01 | F | down | `V[H[A,B,C,D,E],F]` |
| S12-02 | F | up | `H[A,B,V[C,F],D,E]` |

### Sequence S13 - even R2b

Start: `H[A,B,C]`. Observes R1 then even R2b.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S13-01 | C | down | `V[H[A,B],C]` |
| S13-02 | C | up | `H[A,C,B]` (33/33/33) |

### Sequence S14 - R2c, R3, and R4

Start: `H[A,B,C,D]`, 25% each. Observes R2c, R3, then R4 no-op.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S14-01 | A | right | `H[H[A,B],C,D]` |
| S14-02 | B | right | `H[A,B,C,D]` |
| S14-03 | A | left | `H[A,B,C,D]` unchanged |

### Sequence S15 - repeated R2c and R3

Start: `H[A,B,C,D]`. Observes R2c twice, then R3.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S15-01 | A | right | `H[H[A,B],C,D]` |
| S15-02 | C | right | `H[H[A,B],H[C,D]]` |
| S15-03 | B | right | `H[A,B,H[C,D]]` |

### Sequence S16 - R3 into R1 at a perpendicular parent

Start: `H[A,B,C]`. The second move observes R3 then R1 at the perpendicular parent.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S16-01 | C | down | `V[H[A,B],C]` |
| S16-02 | B | right | `H[V[A,C],B]` |

### Sequence S17 - single-output directional no-ops

Start: `A` alone on a single output. Observes R4 no-op in every direction; a directional move never crosses workspaces.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S17-01 | A | left | `A` unchanged |
| S17-02 | A | right | `A` unchanged |
| S17-03 | A | up | `A` unchanged |
| S17-04 | A | down | `A` unchanged |

### Sequence S18 - R2c container neighbour

Start: `H[A,B,C,D]`. Proves R2c container behavior. Widths are not recorded.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S18-01 | B | right | `H[A,H[B,C],D]` |
| S18-02 | A | right | `H[H[A,H[B,C]],D]` (wraps the whole adjacent group) |

### Sequence S19 - odd-parity near-side placement

Start: `H[A,B,C,D]`. Proves odd-parity near-side placement in both directions. Widths are not recorded.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S19-01 | D | up | `V[D,H[A,B,C]]` |
| S19-02 | D | down | `H[A,V[D,B],C]` (D above B on the near side) |

### Sequence S20 - horizontal output crossing

Start: `L=X`, `R=H[A,B]`. Observes R4 crossing; A becomes L's right half.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S20-01 | A | left | `L=H[X,A]`, `R=B` |

### Sequence S21 - perpendicular-wrap/no-cross case

Start: `L=X`, `R=V[A,B]`. A at R's top left does not cross; R1 applies within R.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S21-01 | A | left | `L=X`, `R=H[A,B]` |

### Sequence S22 - output crossing into empty target

Start: `L=empty`, `R=H[A,B]`. Observes R4 crossing into the empty target.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S22-01 | A | left | `L=A`, `R=B` |

### Sequence S23 - R2c, R3, then output crossing

Start: `L=X`, `R=H[A,B,C]`. Observes R2c, R3, then R4 crossing.

| Step | Focus | Dir | Result |
|---|---|---|---|
| S23-01 | A | right | `L=X`, `R=H[H[A,B],C]` |
| S23-02 | A | left | `L=X`, `R=H[A,B,C]` |
| S23-03 | A | left | `L=H[X,A]`, `R=H[B,C]` |

## Executable replay

`kwin/tests/move-conformance-model.ts` is a pure, self-contained TypeScript
implementation for the S1-S3 tree replay - no KWin imports, no dependency on
`kwin/src/controller.ts` or `kwin/src/logic.ts`, and no coupling to this
project's own tile tree.

`kwin/tests/move-conformance.test.ts` replays the single-output authored
S1-S19 vectors through `move`. For S1-S3, it parses each start state, applies
each `(window, direction)` transition in order, asserts the result matches the
recorded tree exactly, carries the result forward as the next input, and
writes the per-transition rule-firing trace. S4-S19 invoke `move` in explicit
single-output tests. S20-S23 invoke `moveAcrossOutputs` in explicit
multi-output tests. A separate chain check applies to every authored S4-S23
sequence, ensuring each non-first start exactly equals the preceding expected
result; no authored sequence is only chain-checked.

**All 40 S1-S3 transitions replay correctly against the model** as of this
writing. The replay is a second, independent check on the original
hand-derived model in `docs/reference-wm-comparison.md` section 11, not a
restatement of it - had any transition failed to replay, the model in section
11 would have been wrong and this document would report that failure rather
than silently adjusting the corpus to match.

This reference implementation is a verification and future-reference
artifact only. It is not shipped tiling behaviour and must not be wired into
`kwin/src/controller.ts`, the production bundle, or any runtime path.
