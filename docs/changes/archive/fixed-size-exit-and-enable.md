# D5/D6: fixed-size classification on fullscreen exit and tiling enable

## Goal and scope

- Deliver R-SPC-04 D5/D6 in shared core and KDE using the D1 predicate.
- First born-fullscreen exit classifies as fresh admission; fixed windows float
  untouched, others tile. Prior fixed floats restore. Fullscreen stays no-write.
- Workspace tiling enable checks every tile candidate, including floating-mode
  arrivals; explicit tile overrides and intentional/sticky float rules survive.
- Automatic fixed floats receive no geometry, focus, stacking, keep-above or
  maximize-clear writes. Game safety takes precedence over COSMIC parity.
- Windows runtime remains handoff-only; offline verification only.

## Acceptance and bounded units

1. Sequential muse-spark Worker: shared core/KDE implementation and targeted
   regressions, including held born-fullscreen exits and both predicates.
2. Lead: inspect integration and update decisions/spec/reference outcomes,
   Windows handoff and backlog as explicitly requested by the user.
3. Sequential muse-spark Worker: full offline gates and exact evidence/counts.
4. Fresh independent muse-spark Worker: review diff and acceptance; resolve
   findings before authorized commit and push.

## Verification and outcome

- Initial HEAD `844e3ee`, clean; baseline KWin 1195, Rust 1256, native 33/33.
- Required gates: KWin tests/typecheck/bundle, Rust workspace tests/clippy/fmt,
  native CTest, portable/Windows allowlist and nine offline shell suites.
- Lead owns records; one active Worker at a time. No live tests or installs.

## Accepted implementation and Lead choices

- Shared convergence holds born-fullscreen clients slotless until exit, then
  classifies with current hints/predicate; adapter automatic-origin assertions
  adopt membership without native writes. Windows opt-out stays unchanged.
- KDE removes the former first-exit tile pin and skips held-exit maximize
  clear when fixed. Confirmed-release enable resets sighted automatic and
  ordinary admission pins, preserving omitted identities, explicit user tile
  overrides and float intent.
- Lead reading of first exit: first observed non-fullscreen state for the
  exact live client, using then-current hints/predicate. Subsequent toggles
  retain ordinary admission identity (D2); no birth-time hint snapshot.
- Lead reading of D6/Q3 intersection: fixed automatic windows remain slotless
  on enable even while maximized, then restore floating; explicit tile
  overrides retain Q3 reserved-slot behavior. This follows D6's every-window
  check and no-touch game-safety rule. Repeated workspace enables recheck.
- R-SPC-11/12 contain minimal discriminating variants for these readings;
  unsupported reference and native outcomes remain TBD.
- Lead rejected the first no-op enable approach: it skipped current-hint/
  predicate rechecks of retained automatic and ordinary admission pins.
  Separate ordinary pins from explicit wins and reset only at confirmed
  enable; regressions cover both. No unresolved failed approach.

## Offline delivery evidence (2026-10-09)

- Final full verification Worker: KWin 1207 tests / 171 suites, Rust workspace 1264
  tests, native CTest 33/33, all zero failures. Typecheck and production bundle,
  strict workspace clippy, fmt and `just check-portable` pass.
- CI Windows portable allowlist build/test/clippy (1116 tests) pass on Linux; no native
  Windows acceptance claimed. No Windows runtime edits required.
- Nine offline shell suites pass: 1713 counted assertions plus build-kpackage
  contracts, after real Planner fixture and tray builds. No live operations.
- Final logs retained.
- Decisions/spec/reference Ours cells and Windows handoff updated; D5/D6 P0
  sub-bullets removed, named user-owned live checks added. D7 remains pending.
- Independent review found an opt-out fullscreen gate regression; it is now
  opt-in-only with sensitive opt-out/opt-in regressions. Reset uses current
  domain sightings to protect omitted clients moved during floating mode.
- Reviewer ordinary-pin transfer concern was disproved by production-entry/
  real Planner evidence: confirmed domain release removes the entire core
  session, including override sets; subsequent enable reclassifies the pin.
  Keep wire suppression during transfer to preserve D2, with no new schema.
- Independent reviewer rechecked corrections and accepted the final diff with
  no blockers. Final full gates and `git diff --check` pass after corrections.
- Ready for user-authorized commit and push; live checks remain user-owned.
