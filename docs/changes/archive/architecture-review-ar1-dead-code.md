# AR1: Dead code and unused dependencies

## Goal and scope

Remove only routes verified unreachable from shipped Rust, KWin and native-effect entry points, plus tests, build references, unused crate dependencies and stale decisions that exclusively describe removed routes. Preserve shipped behavior and active decisions. No live KWin/Plasma testing or host mutation.

## Approach

- Verify the shipped esbuild entry metafile and cross-reference D-Bus calls in script, effect, packaging and tooling before deleting routes.
- Remove unshipped TS adapters and tests, test-only Rust services and tests, and `evaluate_plan_json` only if no production caller exists.
- Prune dependencies only after checking references; refresh Cargo.lock with Cargo. Reconcile direct fallout in build and test configuration.
- Verify full offline Rust and KWin checks and obtain independent diff review.

## Acceptance

Record metafile non-shipment proof; pass cargo check, full cargo test, clippy where used, KWin typecheck, full tests and production bundle build; build and test native effect if touched. Summarize lines removed and any retained routes with rationale. Update the AR1 backlog line and archive this note when complete.

## Outcome and evidence

- Removed three test-only Rust services, their five integration test files, trio-only Planner test stubs, test-only `evaluate_plan_json` and its exclusive handlers/tests, eight unshipped TS adapter/entry files and five exclusive test files. Pruned obsolete shared-test assertions and two package test scripts. Cargo dropped four unused direct crates and refreshed the lockfile. Approximately 30,600 lines removed overall (including tests and lockfile).
- A fresh esbuild metafile of `kwin/src/entry.ts` lists 15 inputs, none from the deleted adapters or `provenance-entry.ts`. `kwin/contents/code/main.js` is unchanged after production build. The actual Planner D-Bus interface exposes only `DescribePlan`.
- Retained `provenance-entry.ts`: `scripts/live-test.sh` and its hermetic tests hash it for a checkout provenance receipt. No change to that separate testing contract. No native-effect files changed; no native-effect build needed.
- `docs/decisions.md` now identifies the shipped sole `DescribePlan` route, preserves its same-UID and gap-reload decisions, and drops stale legacy authority and deleted-route entries. The AR1 backlog line records completion and this exception.
- Final offline checks: `cargo fmt --check`, `cargo check`, `cargo test` (312 lib + 204 integration = 516 passing), `cargo clippy --all-targets` (success with existing style warnings); `npm run typecheck`, `npm test` (715 passing in 100 suites), `npm run build`; `git diff --check`. Independent Worker review found no shipped-route regression; its test-coverage findings were resolved by restoring three retained Planner geometry tests and the five-op validation assertion.
