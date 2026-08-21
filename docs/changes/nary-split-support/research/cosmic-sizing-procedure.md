# COSMIC sizing procedure

## Purpose

The structural rule set is already closed by
`docs/cosmic-move-conformance.md`; this procedure tests sizing only. Judge
observations by eye in coarse proportions, not pixels. Run every vector
independently from a fresh state. Use distinguishable terminal window titles
`A`, `B`, `C`, and so on, matching the corpus notation.

`H[...]` is a horizontal split with left-to-right children and `V[...]` is a
vertical split with top-to-bottom children. The layouts below use no second
tree notation. Construction steps are intent-level: this procedure does not
document COSMIC's exact splitting affordance or keybindings, so adapt them as
needed while verifying the stated tree. Before each operation, manually resize
the indicated dividers to the deliberately uneven coarse targets. Create the
stated start layout before timing the vector; the one operation listed under
each test is the only directional operation in that vector.

The corpus ground truth and each raw observation recorded here outrank every
hypothesis below. Do not treat any prediction as an expected COSMIC result.

Record the actual start layout and coarse proportions before the operation. Do
not force them to match the target: a different but recorded start is usable;
an unrecorded start is not. If the observed geometry matches none of the
hypotheses, record the raw observation verbatim and select `None of the stated
hypotheses`. A recorded surprise is a successful test result, not a failed one.

## Sizing hypotheses

Use the resulting container's split axis for every proportion below.

- **H-equalize:** all children of the affected container are equal on that
  axis.
- **H-preserve:** existing children retain relative proportions; a new
  inserted child receives the mean share; a wrapping container has its wrapped
  pair's combined former size; a promoted child has the dissolved container's
  size; nothing outside the affected container moves. When those assignments
  exceed a fixed receiving container, use them as weights and normalize once
  within that container. This is necessary to make the hypothesis measurable,
  not a claim about COSMIC.
- **H-local:** the new child gets space only from the near-side neighbor fixed
  by the closed rules, and all other children remain unchanged. Where the
  local donor and newly placed child are the only remaining adjustable pair,
  divide their combined span equally. A one-child promotion retains the
  dissolved container's span before that local transfer.

No further sizing hypothesis is included: these three differ at coarse scale
in every vector and cover the currently relevant alternatives.

## Independent vectors

### SZ-01 - R2b flat insert

- **Fresh start:** `H[A,H[B,C,D,E]]`.
- **Construction:**
  1. Open `A`, then create `B` as its horizontal neighbor to the right.
  2. Using the affordance that creates a nested horizontal group rather than a
     flat outer group, add `C`, `D`, then `E` to the right-hand group in that
     order, so `A` remains its other outer child.
  3. Verify `H[A,H[B,C,D,E]]`; adapt the construction if COSMIC's available
     split action would otherwise flatten or nest a different group.
- **Deliberate unevenness:** make `A` roughly one quarter of the width and the
  nested group the remaining three quarters. Within that group, make `D`
  clearly widest at roughly two fifths, `B` clearly narrowest, and `C` and `E`
  visibly intermediate, with `E` wider than `C`.
- **Operation:** focus `A`, then move **right** exactly once.
- **Closed structural routing:** R2b flat-inserts `A` before `D`, yielding the
  direct order `B,C,A,D,E` on the horizontal axis.
- **Pre-operation predictions:**
  - **H-equalize:** all five direct children are roughly equal.
  - **H-preserve:** `D` remains clearly widest at about a third and `B` remains
    clearly narrowest; `C`, `A`, and `E` are intermediate, with `A` and `E`
    around a fifth each.
  - **H-local:** `D` is the right-side, near-side neighbor selected by the
    flat insertion. The newly placed `A` gets space only from `D`; `B`, `C`,
    and `E` keep their prior coarse widths. `A` and `D` become the two clearly
    widest, equal children.
- **Discriminator:** equalization makes all five roughly equal. Preservation
  leaves `D` clearly widest and `B` clearly narrowest. Local sizing leaves
  `B`, `C`, and `E` at their old widths while `A` and `D` are the two clearly
  widest, equal widths. These are grossly different, so the observed pattern
  selects exactly one hypothesis.
- **Observation/result:**

   ```
   Actual start layout and coarse proportions (before operation):
   Observed direct widths/order:
   Raw observation:
   Selected hypothesis: H-equalize / H-preserve / H-local / None of the stated hypotheses
   Notes:
   ```

### SZ-02 - R2c wrap

- **Fresh start:** `H[A,B,C,D]`.
- **Construction:**
  1. Open `A`.
  2. Create horizontal right-side neighbors `B`, then `C`, then `D`, keeping
     all four as direct children in that left-to-right order.
  3. Verify `H[A,B,C,D]`; adapt the actions if COSMIC nests a pair instead of
     keeping the group flat.
- **Deliberate unevenness:** make `A` roughly half the width, `B` a very narrow
  child, `C` roughly a quarter, and `D` a modest remaining child.
- **Operation:** focus `B`, then move **right** exactly once.
- **Closed structural routing:** R2c wraps the directional pair, yielding
  `H[A,H[B,C],D]` with `B` on the near side of the pair.
- **Pre-operation predictions:**
  - **H-equalize:** the three affected outer children are roughly equal; `B`
    and `C` are equal halves of the middle wrapper.
  - **H-preserve:** `A` remains roughly half the width, the wrapper remains a
    little over a third, and `D` remains modest. Inside the wrapper, `B` stays
    very narrow beside a much wider `C`.
  - **H-local:** as the local analogue for this wrap, the focused near-side
    leaf `B` takes space only from `C`, its right-side, directional neighbor,
    inside the new `H[B,C]`. The wrapper keeps its inherited outer span, `A`
    and `D` keep their prior coarse widths, and `B` and `C` become equal within
    the wrapper.
  - **Discriminator:** equalization visibly shrinks `A` and makes the outer
    children roughly equal. Preservation keeps the inherited wrapper span with
    a very narrow `B` beside a much wider `C`. Local sizing also preserves that
    wrapper span and leaves `A` and `D` unchanged, but transfers space only
    within the wrapper from `C` to focused `B`, making its leaves equal. Each
    outcome is coarse and distinct.
- **Observation/result:**

   ```
   Actual start layout and coarse proportions (before operation):
   Observed outer widths and B/C widths:
   Raw observation:
   Selected hypothesis: H-equalize / H-preserve / H-local / None of the stated hypotheses
   Notes:
   ```

### SZ-03 - R3 escape with one-child promotion

- **Fresh start:** `H[A,H[B,C],D,E]`.
- **Construction:**
  1. Open `A`, then create `B` as its horizontal neighbor to the right.
  2. Create `C` as a horizontal right-side neighbor inside `B`'s group, making
     the nested `H[B,C]` while retaining `A` as an outer child.
  3. Add `D`, then `E` as horizontal neighbors to the right of that nested
     group at the outer level.
  4. Verify `H[A,H[B,C],D,E]`; adapt the actions if COSMIC selects a different
     nesting or flattening behavior.
- **Deliberate unevenness:** make the outer `H[B,C]` group roughly half the
  width, with `A`, `D`, and `E` visibly smaller around it. Within the nested
  group, make `B` roughly a fifth and `C` the clear remainder.
- **Operation:** focus `C`, then move **right** exactly once.
- **Closed structural routing:** R3 escapes `C`; `B` is promoted when
  `H[B,C]` becomes one child. The receiving parent order is `A,B,C,D,E`.
- **Pre-operation predictions:**
  - **H-equalize:** all five direct children are roughly equal.
  - **H-preserve:** `B` is clearly largest at about two fifths; `C` is about a
    fifth, with `D` somewhat narrower and `A` and `E` narrowest and equal.
  - **H-local:** promotion gives `B` the dissolved group's broad span. Newly
    inserted `C` gets space only from `D`, its right-side, near-side neighbor;
    `A`, `B`, and `E` keep their prior coarse widths, while `C` and `D` become
    equal narrow children.
- **Discriminator:** equalization makes every child roughly equal. Preservation
  leaves `B` clearly largest, `C` intermediate, `D` somewhat narrower, and
  `A` and `E` narrowest and equal. Local sizing leaves `B` broad while both
  `C` and `D` are narrow and equal. The three patterns differ grossly.
- **Observation/result:**

   ```
   Actual start layout and coarse proportions (before operation):
   Observed direct widths/order:
   Raw observation:
   Selected hypothesis: H-equalize / H-preserve / H-local / None of the stated hypotheses
   Notes:
   ```

## Why R1 Is Not Separate

R1 is not separately tested. Its new directional wrapper has two direct
children, so these hypotheses do not yield an additional grossly
discriminating sizing observation there: equal sharing, a mean new share, and
a sole local donor all produce a half-and-half wrapper. SZ-02 already tests
the wrapping allocation that is distinguishable by eye. This procedure does
not infer any unmeasured R1 resize behavior from that fact.

## Results Summary

| Test | Rule | Observed coarse geometry | Selected hypothesis (or `None of the stated hypotheses`) | Result/notes |
|---|---|---|---|---|
| SZ-01 | R2b flat insert |  |  |  |
| SZ-02 | R2c wrap |  |  |  |
| SZ-03 | R3 escape and one-child promotion |  |  |  |

## Limits

These observations can select only among the stated coarse sizing hypotheses
for these shallow, single-operation vectors. They cannot settle pixel-level
rounding, resize animation timing, behavior after further manual resizing,
the absorbing-sibling policy for a user drag in a 3+-child split, deeper-than-
one parity descent, output crossing, or any structural rule. The corpus's
closed structural ground truth outranks every result recorded here.
