# Placement-Aware Startup Adoption

## Decision Proposal

- Recommend a new, versioned Rust-owned first-startup adoption policy that
  recognizes only a uniquely replayable exact layout before the current seed.
  It is not selected or implementation-ready.
- For a recognized layout, infer a deterministic ordered split tree and positive
  shares, validate it with the existing projector, and emit its projection. Its
  movement cost is zero by construction.
- For no unique exact match, prefer the current deterministic seed as the
  compatibility fallback. Its consequence is the currently observed reflow.
  A no-write/park fallback preserves placement but creates a new unmanaged
  startup state and lifecycle policy; it is the only materially different
  fallback option.
- Do not add a tolerance or near-layout fit in the first policy. It needs an
  explicit error metric, allowed error, candidate tie-break, and fallback choice.
  If selected later, it belongs in the versioned Rust policy rather than KWin TS.

## Current Behavior And Boundary

- On first non-empty observation, KWin enables the adapter, observes the active
  output/workspace and eligible normal-window rectangles, then requests a
  resync (`kwin/src/plan-adapter-entry.ts:866-1064,1746-1766`).
- With no committed membership baseline, the adapter admits only the focused
  window (`kwin/src/plan-adapter.ts:1619-1643`). The empty Rust planner rebuilds
  a session by spatially ordering all observed windows with focus last, then
  sequentially performs normal focused-leaf admissions
  (`src/planner_protocol.rs:838-967,1432-1505`). Each split is based on the
  existing projected target, not the incoming rectangle
  (`src/planner_protocol.rs:808-836`). A good pre-existing layout is therefore
  reprojected.
- This proposal applies only when there is no usable retained session for the
  first startup domain. It does not change a pending acknowledgement,
  post-observation verification, divergence, or transaction-recovery path.
- Rust owns topology and policy; KWin remains a thin observer/actuator using
  direct geometry (`docs/decisions.md:403-408`). Candidate construction,
  fitting, and selection therefore belong in Rust, with TS sending only the
  primitive normalized snapshot.
- The KCM/restart boundary remains unchanged: validated gaps are resolved once
  at adapter startup and are not hot-reloaded, reseeded, or mutated in flight
  (`kwin/src/plan-adapter-entry.ts:1525-1531`; `kwin/src/domain-gap.ts:1-7`).

## Recognition Strategy

- Normalize the existing observation against the current domain work area,
  configured `outerGap` inset, and `innerGap`; these are KCM values with
  defaults `(8, 8)` and range `0..64`, not a hardcoded 8px rule
  (`kwin/src/domain-gap.ts:1-13,89-113`; `docs/decisions.md:446-452`).
- Build only guillotine candidates: recursively partition the normalized
  rectangles at a full-width horizontal or full-height vertical separation;
  order children by their physical coordinate; allow each resulting group to be
  N-ary and nested. Derive positive integer shares only when the existing
  `project` function reproduces every rectangle exactly. It already enforces
  containment, non-overlap, configured sibling gaps, ordered child allocation,
  and integer rounding (`src/geometry.rs:108-165,167-269`).
- Accept a candidate only if the selected inference grammar and share
  canonicalization yield one topology. Otherwise report an adoption ambiguity
  and take the selected fallback. Do not claim that an accepted normal form is
  the prior tree: rectangles cannot reveal historical same-axis grouping,
  shares with equivalent integer projections, sibling intent, or domain MRU.
  For example, a flat horizontal three-leaf group and nested horizontal groups
  can project to the same bands while later admissions behave differently.
- A near-layout extension would generate the same bounded candidates, project
  each using the current geometry code, and rank the projected-versus-observed
  displacement under a selected metric. It must reject equal best scores and
  overlapping/unrepresentable input. The metric, tolerance, share
  canonicalization, and whether a small nonzero movement is acceptable are
  product decisions, not facts recoverable from rectangles or COSMIC source.

## Eligibility, Ambiguity, And Exceptions

- Preserve current observation eligibility: normal windows on the active
  output and current desktop (including existing all-desktops handling), valid
  quantized frame rectangles, stable IDs, and an active member
  (`kwin/src/plan-adapter-entry.ts:888-1069`). Empty scopes remain disabled.
- Do not infer from duplicate rectangles, overlap, out-of-bounds geometry,
  missing full-span partitions, gap/inset exhaustion, or multiple candidate
  trees. These are not evidence of a tiled arrangement. Integer rounding and
  direct-geometry sequencing also mean an exact rectangle match is not proof
  of historical topology.
- Existing exception semantics remain authoritative: fullscreen and retained
  maximized members skip geometry writes; admission-time maximize clearing is
  an explicit KWin-native deviation; floating/sticky state is exceptional
  (`docs/decisions.md:261-290,416-445`). The current adapter observes these
  flags but omits fullscreen/maximized/sticky from the Rust request, while Rust
  reconstructs them as false (`kwin/src/plan-adapter-entry.ts:1048-1058`,
  `kwin/src/plan-adapter.ts:1973-1979`,
  `src/planner_protocol.rs:675-689`). An implementation must first reconcile
  that wire/eligibility contract or exclude such windows before inference; this
  proposal selects neither behavior.

## Feasibility And Evidence

- The topology is already an ordered, nested N-ary tree with one positive
  `u64` share per child (`src/directional.rs:107-123`); the observer and wire
  cap one request at 64 windows and one planner at 16 domains
  (`src/planner_protocol.rs:52-60`; `src/session.rs:99-101`). Current seeding
  is `O(n log n)` ordering plus bounded sequential admission/projection. Exhaustive
  enumeration of all trees, orders, and share vectors is exponential and is not
  an acceptable adoption strategy. A recursive guillotine recognizer must use
  the existing 64-window cap and a finite deterministic grammar, not search all
  N-ary topologies.
- Future implementation evidence: Rust unit/property cases for exact flat and
  nested layouts, configured gaps and outer inset, integer-remainder shares,
  stable candidate ordering, and zero-change projections; rejection vectors for
  overlaps, ties, ambiguous grouping, floats/exceptions, bounds failures, and
  no candidate; adapter payload contracts; and Stage 3 offline trace fixtures.
  A live journey is not requested by this design.
- Independent source review found no COSMIC rectangle-to-tree inversion rule.
  COSMIC source parity covers forward focused-cell admission and N-ary share
  evolution, not recovering prior intent from placement
  (`docs/decisions.md:416-445`; `src/cosmic_v1.rs:50-198`). A fitted adoption
  policy is therefore a documented project policy, not claimed COSMIC parity.

## Pending Product Choices

- Select exact-only recognition or authorize a versioned near-layout policy.
- If near layouts are selected: choose the error metric, tolerance, share/tree
  canonicalization, tie disposition, and movement threshold.
- Select the no-candidate fallback: current seed/reflow, or preserve geometry
  by parking the domain until a separately selected activation path.
- Select the exception wire/eligibility resolution before implementation.

## Backlog Maintenance Finding

- `docs/backlog.md:89-90` is stale: production supports general retained
  per-domain lifecycle and ordered N-ary trees for up to 64 observed windows,
  not exactly three (`src/planner_protocol.rs:1432-1505`;
  `src/directional.rs:107-123`). Narrow follow-up: remove or rewrite only that
  exact-three decision line. Do not change it in this design record.
- `docs/backlog.md:93-94` is also stale as written: current rebuilding uses
  stable spatial `(y, x, h, w)` order with focus last, not lexical opaque-ID
  order or the historical fixed `H[A,V[B,C]]` seed
  (`src/planner_protocol.rs:928-967`). Narrow follow-up: replace it with a
  current-policy question only if ordering remains intentionally unsettled.
- `docs/decisions.md:127-132` also describes Rust as lacking adoption and
  add/remove lifecycle, contrary to the current production path above. This is
  a material documentation contradiction to resolve separately, not an
  authorization to alter lifecycle policy.
