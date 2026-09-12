# Duplicate Window Verdict

## Goal

Determine whether the high volume of `duplicate-window` rejections in the
2026-09-12 `just dev` capture regressed in `fca2f81`.

## Scope And Non-Goals

- Compare the retained read-only pre- and post-`fca2f81` logs and the two
  identity implementations.
- Prove the adapter and Planner behavior hermetically without live KWin work.
- Do not change KWin/Plasma runtime behavior, native effects, shortcuts, or
  diagnostics.

## Verdict

- Correct benign behavior, pre-existing before `fca2f81`; no production code
  change is warranted.
- `fca2f81` cannot create an intra-observation duplicate dispatch: invalid,
  empty, or unparseable `internalId` values return `null`, and equal normalized
  IDs stop the entire observation before dispatch
  (`kwin/src/native-id.ts:68-86`, `kwin/src/plan-adapter-entry.ts:421-431`).
- The observed `rejected kind=duplicate-window` is instead the Planner's
  already-known-session refusal (`src/session.rs:970-971`). The separate
  intra-observation duplicate path is `snapshot-invalid` with detail
  `duplicate-window`, not this token.
- The retained pre-fix verbose capture `.4IZlK8.log` shows the exact cause:
  alternating `eDP-1` workspaces `cba9...` (two windows) and `5b55...` (two
  windows). After each switch, the adapter's single `lastGood` baseline sees
  the other scope's IDs as additions and probes `admit`; the Planner already
  retains a separate committed session for that domain and correctly refuses.
  The next genuinely new window is admitted and applied.
- The current redacted log proves 12 session-level duplicate refusals and 7
  `planned-applied` operations, but does not record output, workspace, IDs, or
  fingerprints. Its alternating `windows=1`/`windows=4` counts are consistent
  with the same two-scope probe pattern, but the precise current scope IDs are
  intentionally unobservable. This record does not claim more than the
  artifacts prove.
- No window was dropped by a rejection: refusal leaves the Planner session
  unchanged and KWin returns before geometry writes
  (`src/session.rs:871-894`, `kwin/src/plan-adapter.ts:1004-1011`). The current
  capture does not contain geometry payloads, so it cannot independently prove
  final visual layout; its seven planned-applied replies prove successful
  re-observation and native writes for those operations.

## Hermetic Evidence

- `kwin/tests/plan-adapter.test.ts` covers the alternating workspace sequence:
  a known-window `admit` is rejected without disabling the adapter, then a
  fresh scope observation with a new window plans and applies. It is the
  deterministic analogue of the retained pre-fix capture.
- Destroyed-window reply coverage remains at
  `kwin/tests/plan-adapter.test.ts:1013-1082` and
  `kwin/tests/plan-adapter.test.ts:1154-...`; it ensures the reply path never
  dereferences the old destroyed Window fixture.

## Verification

- Focused hermetic cross-workspace test: passed.
- KWin TypeScript suite: 386/386 passed, 47 suites. The baseline was 385; this
  record adds the one cross-workspace regression test.
- `npm run typecheck`: passed with 0 errors.
- Destroyed-window reply-boundary coverage: 3/3 passed within the KWin suite.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --all-features -- -D warnings`: passed.
- `nix flake check`: passed. It reports the pre-existing dirty-tree,
  `homeManagerModules`, and unset `system.stateVersion` evaluation warnings.
- CTest: 21/21 passed from a fresh isolated native-effect build. The existing
  `target/kwin-native-effect-build` was configured with testing disabled and
  reported 0 tests; that was an environment configuration, not a product test
  failure.

## Next Action

- None.
