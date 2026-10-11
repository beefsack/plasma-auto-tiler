# Resilience simplicity pass

## Goal and acceptance

Reduce production complexity introduced by resilience changes `07fb520`, `8178edb`, and `5fe0eb5` without changing behavior, including logs. Existing behavior tests retain intent.

## Scope and approach

- Inspect small, independent areas in `kwin/src/plan-adapter.ts`, `kwin/src/plan-adapter-entry.ts`, and, if worthwhile, native effect/Rust changes. Consolidate duplicated exact-ref removal work and unnecessary parameter threading only where semantics stay identical.
- Remove genuinely redundant guards, flags, commentary, or tests pinning internals where behavioral evidence remains.
- Decline and report any attractive simplification that changes observable behavior. No live tests; do not edit `devenv.nix`.

## Bounded units

1. Simplify entry native-ID cache/ownership threading and exact removal if safely possible.
2. Simplify adapter sticky/born-fullscreen lifecycle and other local resilience machinery.
3. Review entry retry/topology/bridge logic for local deletions; native effect/Rust only if clear local wins.
4. Integrate and verify; archive and update backlog.

## Verification

KWin `npm test` and typecheck; Rust workspace tests and `cargo fmt --all -- --check`; if native effect files change, `just build-native-effect` and full host-matched native CTest; `git diff --check`. Inspect each diff before accepting.

## Decisions and evidence

- Baseline branch `main`, HEAD `350405a`, clean worktree; KWin baseline 766 and native CTest baseline 29/29 per request.
- Native-ID ownership/removal unit accepted: shared exact-ref eviction, removed redundant map membership check and spread snapshot in `plan-adapter-entry.ts`; production +10/-12 after dropping redundant commentary, focused tests 237 pass, typecheck pass. Keep owner threading separate from the string-keyed cache for now.
- Adapter exact-ref marker eviction uses direct delete-only iteration; redundant first-non-fullscreen equality check dropped. Production +3/-6 after removing explanatory comments; focused tests 198 pass, typecheck pass. Merging distinct marker lifecycles or sticky-on/off state would alter behavior.
- A-interim acceptance: share existing background-attempt clear operation and combine identical success-case resets, retaining distinct foreground/background criteria; production +12/-22, focused tests 216 pass, typecheck pass. Entry retry wrapper and owner/cache bundling reviewed and declined (no net deletion without changing recovery or increasing indirection).
- G stale-replan scope uses existing equivalent `sameReprojectionScope`; production +1/-4, focused tests 222 pass and typecheck pass.
- Shared scope identity predicates deduplicate snapshot/observed domain and window-set checks including R4 fences; production +53/-61, full KWin 766 pass and typecheck pass. Retain the looser scope predicate for pointer echoes, which do not require directional-domain equality.
- Full KWin suite exposed a pre-existing mismatch in the tray bridge test-only state model: lower revisions cleared the trusted snapshot despite the existing fixture and production C4 policy. The test model now keeps the snapshot, matching both fixture and production; test +5/-0, no test intent changed.

## Outcome

- Total production +79/-105, net -26 lines; tests +5/-0. No native effect or Rust source edits.
- Final acceptance: KWin `npm test` 766/766 and `npm run typecheck` pass; `cargo test --workspace` passes; `cargo fmt --all -- --check` passes; `git diff --check` passes. No live tests.
- Declined: combining independent sticky/initial-fullscreen/entry native-owner maps, eliminating entry retry failure boundaries, and bundling owner+ID cache parameters; these either alter observable recovery/eviction behavior or add indirection and lines. Do not implement without a separately justified behavior decision.
