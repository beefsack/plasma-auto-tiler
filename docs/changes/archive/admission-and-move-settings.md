# D1: functional admission and same-axis move settings

## Goal and scope

- Deliver fixed-size admission predicate selection in shared core and KDE, and
  functional same-axis move value IDs throughout core/protocol/KDE/Windows.
- KDE `fixedSizePredicate`, Windows handoff `core.fixed_size_predicate`:
  `both-axes-fixed` default (Width and height both fixed; tooltip COSMIC),
  `either-axis-fixed` (Width or height fixed; tooltip Hyprland (Wayland), sway).
- Preserve existing hint validity guards, admission-only classification,
  no-touch automatic floating, and live-client user tile overrides.
- Same-axis IDs: `group-with-neighbor` default and `swap-with-neighbor`;
  old IDs follow existing invalid handling without aliases or migration.
- Windows predicate is documentation/handoff only; D5/D6/D7 and migration D8
  are outside this unit. Offline only; no commits or dependency installs.

## Acceptance and bounded units

1. Implementation: source/config/UI/test changes,
   targeted verification and discovery of full offline gate commands.
2. Inspect integration and update decisions/spec/matrices/Windows handoff
   and backlog as explicitly requested by the user.
3. Verification: full KWin, workspace Rust,
   native CTest, clippy, fmt, portable/Windows-target gates and counts.
4. Fresh independent review: diff and acceptance review;
   resolve concrete findings before delivery.

## Verification and outcome

- Initial HEAD `cd067a6`, clean. Delivered offline; evidence below.

## Accepted implementation and decisions

- Shared `FixedSizePredicate` selects AND/OR equality behind unchanged usable
  whole-vector guards. Missing/negative/sentinel/out-of-range/all-zero hints
  remain non-fixed under both settings; equal partial-zero vectors still count.
  R-SPC-06/07 record setting-switch and missing-other-axis discriminators;
  unsupported reference/native legs remain TBD. This keeps the change to one
  predicate operator and avoids adding a separate normalization policy.
- Retained Engine/Session setting updates affect subsequent admissions only;
  KDE exact-reference identities and user tile overrides survive. Non-default
  predicate travels on the existing request; omitted value preserves default.
- Functional same-axis enum/wire/config/UI IDs preserve grouping and swap
  behavior. Retired IDs normalize to default in KDE config/KCM; protocol rejects
  them as `snapshot-invalid/move-op-invalid`, the existing invalid-value path.
- Windows had no runtime same-axis schema field. Rename its compile defaults
  and update exact setting/schema/UI/live handoff; predicate stays handoff-only,
  Engine opt-in OFF. Linux portable evidence is not native Windows acceptance.
- Unified KCM loads/defaults/saves both settings, presents functional labels and
  per-value WM tooltips, and requests live reread without rebuilding trees or
  reclassifying clients. Effective values log with existing config reloads.
- Independent review found two overstated test claims and stale doc terms, no
  behavior blocker. Replaced placeholder wire coverage with real Planner-backed
  adapter assertions; protocol now exercises a retained, settled switch sequence.
  Normative docs use current IDs; historical records link this follow-up.
- Independent reviewer rechecked corrections and accepted the final diff with
  no blockers. Adapter timeout-switch payload coverage is separate from the
  successful retained core/protocol setting-switch evidence.

## Offline delivery evidence (2026-10-08)

- `cargo build --locked -p tiler-protocol --example planner_eval`, KWin tests
  and typecheck: 1195 tests / 171 suites, zero failures; production bundle built.
- `cargo test --workspace`: 1256 passed / 46 suite results, zero failures.
  Admission suite 27; protocol lib 149. New cases cover default/AND/OR guards,
  one-axis admission, retained setting switches, live tile overrides, real
  adapter payload/no-touch behavior, and retired move-token invalid handling.
- Workspace strict clippy and fmt pass after review corrections.
- `just check-portable`: zero normal core dependencies, no platform leaks.
  CI Windows portable allowlist build/test/clippy pass on Linux (1108 tests).
  No installed Windows Rust target; no Windows-target/native run claimed.
- `nix build .#checks.x86_64-linux.native-effect-tests --print-build-logs --no-link`:
  33/33 CTest pass, including KCM predicate/default/retired-token contracts.
- All nine offline shell suites pass after bundle/planner build (1713 counted
  assertions plus build-kpackage contracts). No live operations performed.
- Full initial gate logs retained; review corrections
  reran affected KWin, full workspace Rust, clippy and fmt successfully.
- Decisions, functional spec, matrices, logging docs and Windows handoff updated;
  D1 backlog sub-bullet removed, D5/D6/D7 and migration D8 retained, KDE UI live check added.
- Final `git diff --check` clean; portable allowlist tests/check-portable rechecked
  after corrections. Change staged for user review, uncommitted.
- No dependency installation or commit. Pending: user-owned native settings UI
  journey and Windows runtime handoff. Next action: user chooses commit cadence.
