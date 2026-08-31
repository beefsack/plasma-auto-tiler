# R2b Target-Axis Coverage

## Verdict

**Contradiction.** Existing transcribed corpus coverage includes two parallel
(same-axis) target containers. Both record near-edge insertion and flattening,
which agrees with the new live observation but disagrees with the closed R2b
parity-only wording. This is not purely additive.

`S1-17` is explicitly recorded as a model-derived direction correction awaiting
user confirmation. `S3-08` has no such caveat.

## Structural R2b Coverage

Items below satisfy the requested structural condition: C is parallel to D,
C has two children, and its directional neighbour S is a container. The corpus
uses legacy `2a (descend into container)` annotations for these cases.

| Item | Provenance | Input; focus, direction | S vs D | Recorded insertion position | Evidence |
|---|---|---|---|---|---|
| S1-08 | Transcribed corpus | `V[H[T1,T3],T2]`; `T2` up | Perpendicular (`H` vs `V`) | Middle gap: `H[T1,T2,T3]` | conformance:90-91 |
| S1-17 | Transcribed corpus | `H[H[T1,T3],T2]`; `T2` left | Parallel (`H` vs `H`) | Near edge of S: after `T3`, then collapse to `H[T1,T3,T2]` | conformance:99-100,149-153 |
| S3-08 | Transcribed corpus | `V[T4,V[T2,H[T1,T3]]]`; `T4` down | Parallel (`V` vs `V`) | Near edge of S: before `T2`, then collapse to `V[T4,T2,H[T1,T3]]` | conformance:128-130 |
| S3-13 | Transcribed corpus | `V[T2,V[T4,H[T1,T3]]]`; `T4` down | Perpendicular (`H` vs `V`) | Middle gap: `H[T1,T4,T3]` | conformance:133-135 |
| S7-02 | Authored vector | `V[H[A,B,C],D]`; `D` up | Perpendicular (`H` vs `V`) | Odd midpoint: replace `B` with `V[B,D]` | conformance:186-193 |
| S8-02 | Authored vector | `V[H[A,B,C,D],E]`; `E` up | Perpendicular (`H` vs `V`) | Even middle gap: between `B` and `C` | conformance:195-202 |
| S9-02 | Authored vector | `V[H[A,B,H[C,D]],E]`; `E` up | Perpendicular (`H` vs `V`) | Odd midpoint: replace `B` with `V[B,E]` | conformance:204-211 |
| S12-02 | Authored vector | `V[H[A,B,C,D,E],F]`; `F` up | Perpendicular (`H` vs `V`) | Odd midpoint: replace `C` with `V[C,F]` | conformance:229-236 |
| S13-02 | Authored vector | `V[H[A,B],C]`; `C` up | Perpendicular (`H` vs `V`) | Even middle gap: between `A` and `B` | conformance:238-245 |
| S19-02 | Authored vector | `V[D,H[A,B,C]]`; `D` down | Perpendicular (`H` vs `V`) | Odd midpoint: replace `B` with `V[D,B]` | conformance:296-303 |

## Counts And Model

- Parallel-S corpus coverage: 2 (`S1-17`, `S3-08`).
- Parallel-S authored-vector coverage: 0.
- Authored vectors whose expected result would change under a
  perpendicular-only precondition: 0 of 6.
- The model branches on target S axis in the two-child container path:
  `s.axis === c.axis` uses the near edge; `s.axis !== c.axis` uses parity.
  Parity is not unconditional. See
  `kwin/tests/move-conformance-model.ts:206-251`.

## Verification

- `S1-17`: inspected the preceding input at conformance:99 and its result at
  conformance:100. With `T2` right of same-axis S and moving left, the recorded
  result places `T2` at S's right, source-near edge.
- `S7-02`: inspected the input/result at conformance:192-193. Vertical D
  enters horizontal S and replaces its three-child midpoint `B`, confirming the
  perpendicular odd-parity case.
