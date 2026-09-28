# Unify duplicate implementations

## Goal and scope

Behavior-preserving net deletion for the six audited rules, in order: admission target, proportional allocation, fresh floating convergence, seed-admit step, KWin rectangle bounds, KWin QML list decoding. No unrelated refactoring, live testing, or changes to `devenv.nix`.

## Acceptance and approach

- Each rule has one implementation with caller-specific semantics retained; skip any item that requires complexity outweighing deletion or raises a product question.
- One small Worker unit per item, Lead source/diff review and a green check after each; Rust items precede KWin items.
- Existing tests are the safety net; add only missing caller-specific coverage. Final checks: Rust workspace tests, fmt, strict clippy; KWin test and typecheck; `git diff --check`.

## Progress and evidence

- Baseline: `main` ahead 5 with only the user's existing `devenv.nix` edit. No other worktree changes before this note.
- 1. Admission target shared, caller-specific focus eligibility preserved; source net -3, tests 0. Green: `cargo test -p tiler-core --lib -q` (202), `cargo fmt --all -- --check`, strict `cargo clippy -p tiler-core --lib`.
- 2. Shared proportional base sizes; caller validation, minimum adjustment, and error mappings remain separate. Source net -7, tests 0 (existing no-hint parity matrix). Green: `cargo test -p tiler-core -q`, fmt check, strict all-targets clippy.
- 3. Fresh floating-aware convergence now shared across admit, all-floating reconcile, and toggle-float; per-op gates, creation failure and reply/follow-on remain at callers. Source net -57, tests 0. Green: `cargo test -p tiler-core` (all targets), `cargo check -p tiler-core`, strict lib clippy, fmt check.
- 4. One seed-admit propose/ack/verify step; callers pass their distinct admitted observation and post fingerprint. Source net -7, existing tests augmented +17 (item total +10); `cargo test -p tiler-core -q`, fmt and strict all-targets clippy green. The caller-specific regression assertions account for the positive total.
- 5. Skipped: sharing only normalized KWin rectangle bounds added 27 source lines across five call sites and a new helper while removing no useful branches. Reverted the attempted diff exactly; the parser-specific checks remain. Worker `npm test` (797) and typecheck passed before reversal.
- 6. One pure `qml-list.ts` decoder replaces four copies (including the identical dev send entry), avoiding a workspace-native dependency on drag logic. Source net -97, tests 0. Green: `npm test` 797/797, `npm run typecheck`, `git diff --check`.

## Outcome

Five shared rules delivered; one bounds-predicate proposal skipped because it increased code without reducing parser complexity. Net production -171 lines, test +17, overall -154 (excluding this note and the unrelated `devenv.nix` edit). Final verification: `cargo test --workspace -q`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, KWin `npm test` (797 passed), `npm run typecheck`, and `git diff --check` passed. No live testing performed.
