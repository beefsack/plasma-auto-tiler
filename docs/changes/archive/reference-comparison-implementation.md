# Reference comparison implementation

## Goal and acceptance

- Deliver G-05 per-axis-zero admission, G-06 maximized directional operations,
  G-37 migration source-refill setting and G-D2 maximized workspace-send carry
  in shared core and KDE under the 2026-10-10 decisions.
- Windows receives exact handoff seams in items 17-20; runtime behavior changes
  remain Windows work. Preserve gaming, focus and fullscreen safety fences.
- Offline verification only; refresh pending user-owned native checks.
- Current decisions/spec/matrix/backlog reflect offline delivery; tidy stale B9
  consensus wording. Archive this note after independent review and verification.

## Approach and bounded units

1. Measure HEAD baseline and implement G-05.
2. Implement G-06 and G-D2 with observed native-state discipline.
3. Implement G-37 config/KCM/core selection and retained-history routing.
4. Integrate durable records and exact Windows handoff; independently review
   public behavior and fences; run final offline gates.
5. Inspect intended diff and publish.

## Verification and material decisions

- Initial HEAD is ad44ed5; worktree clean. User's three stashes are untouched.
- Supplied a8e32ce baseline: KWin 1258, Rust 1288, Linux Windows portable
  allowlist 1136, native CTest 33/33; remeasure before implementation.
- No live KWin testing, dependency installation or public-policy pivots.
- Authoritative IDs are `last-remaining-workspace` and
  `most-recently-used-workspace` (decision records), with KDE
  `migrationSourceRefill` and Windows `core.migration_source_refill`.
- MRU snapshots item-1.2 per-output previous stable ID before map mutation;
  eligibility is live membership in the remaining source scoped ring excluding
  the migrated ID. Surviving empties qualify; missing/removed/migrated/out-of-scope
  entries fall back to last remaining. A still-scoped live source current view
  is retained in both modes; destination/invalidation/lifecycle stay unchanged.
- Directional move makes one native clear attempt with B9 exact-reference echo
  discipline, then rereads directional topology. Only observed clear with the
  same reference/focus/domain continues in that invocation, through ordinary
  tiled movement or eligible float half-snap. Failure/races log narrow refusal
  without a structural move, delayed intent or automatic retry.
- Native maximize remains omitted from KDE's planner wire: existing born-maximized
  admission depends on ordinary-tile admission plus local overlay isolation.
  KDE's local focus fence is authoritative; the tested shared Engine opt-in
  supports direct maximized observers and remains off for Windows.
- Maximized tiled workspace sends pass observer/flag-stable arrival fences and
  use native membership/output setters without restore/remaximize or overlay
  geometry writes. Actual KWin arrival state still needs user observation;
  fullscreen-send refusal/observe-first and migration D8 remain distinct.

## Review and corrections

- Initial G-06/G-D2 implementation review exposed a float-origin bypass,
  stale post-clear directional descriptors and overbroad fit-exclusion admission.
  Corrected before acceptance: clear precedes eligible-origin routing, fresh
  directional reread validates domain/reference/focus, independent exclusions
  still refuse. Added race/synchronous-signal and cross-output carry regressions.
- The Windows source-refill schema was added despite handoff-only scope;
  all those hunks were removed before acceptance. No Windows source/runtime
  changes remain; shared optional behavior defaults preserve Windows.
- Independent source/public-contract/fence and durable-record review found no findings;
  its full KWin and targeted core checks passed. Subsequent fixture-only additions
  prove isolated maximized movement and source default/MRU through production
  entry plus retained real Engine, without canned replies or map-only assertions.
- No failed product approach or unresolved design choice remains. The admission
  wire conflict was resolved by preserving the existing local overlay contract,
  without a protocol/admission redesign. No live compositor testing occurred.
- Final typecheck caught one new fixture's untyped `.call`; a single causal
  type-narrowing repair preserved its oracle/behavior. Typecheck, bundle and
  all three fixture cases then passed. Final staged-source native build/check
  completed with 33/33 after extending the shell timeout (no product failure).

## Outcome and offline evidence (2026-10-10)

- G-05 shared predicate/KDE mirror now require equal nonzero bounds per axis;
  both orientations and both settings tested through real Planner; retained
  classifications are unchanged by live predicate changes.
- G-06 shared opt-in/local KDE focus fences and one-attempt unmaximize/move
  sequence delivered, including ordinary float half-snaps and race refusals.
- G-37 shared pure `select_migration_source_refill` and KDE KCM/config/live reread
  delivered. Functional labels/tooltips/defaults use the decision-record IDs.
- G-D2 flag-stable same-/cross-output tiled maximize carry delivered offline;
  native maximize preservation remains pending observation, not inferred proof.
- Updated current decisions/spec/matrix/review, backlog/handoff items 17-20 and
  pending live checks. Stale B9 consensus wording now reflects unmaximize/fresh
  admission. Windows source and user's three stashes untouched at completion.
- Baseline remeasured at ad44ed5: KWin 1258, Rust 1288, Linux Windows portable
  allowlist 1136, native CTest 33/33, all offline gates clean.
- Final `npm --prefix kwin test`: 1307 passed (+49), zero failures. Latest run
  includes production-entry real-Engine G-06/G-37 discriminators.
- `cargo test --workspace --offline`: 1304 passed (+16); locked portable crate
  allowlist (`tiler-core`, `tiler-protocol`, `tiler-kwin-effect-ffi`, `tiler-windows`)
  1152 passed (+16), zero failures. No native Windows target locally; CI verifies it.
- Workspace all-target clippy `-D warnings`, fmt check, `just check-portable`,
  KWin typecheck and production/test build/bundle, planner build all pass.
- All nine offline mock shell suites pass: kpackage contracts; custom-tile 131,
  dev-loop 380, native-dev 163, dogfood 572, floor-ratio 92, live-harness 237,
  host-build 93, tray 29 fixture + 16 self-test assertions.
- Native Nix effect/tests checks pass with `--no-link --offline`, CTest 33/33,
  including the new KCM source-refill defaults/validation/persistence contract
  inside the existing scenario. No dependency changes.

## Pending user-owned acceptance

- KCM Save/Defaults/Revert/live pickup, actual partial-zero hint representation.
- Maximized directional focus/no-op and one clear then tiled move/float half-snap,
  partial-axis states and native synchronous/delayed clear timing; no delayed move.
- Multi-output source default/MRU/fallback, independent observed history,
  surviving-empty eligibility and lifecycle timing, retained target insertion.
- Numbered/relative follow/stay maximized send, same-/cross-output native maximize
  preservation, no geometry fight, later native restore into the target slot.
- Windows handoff items 17-20 remain pending adapter work. KDE fullscreen native
  send remains observe-first; no new carry policy selected.
