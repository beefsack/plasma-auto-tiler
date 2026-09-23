# AR5: LayoutPolicy seam and Session split

## Goal and scope

Route every Session COSMIC policy call through a core `LayoutPolicy` implemented by `cosmic_v1`, then split Session into cohesive world state, operations (lifecycle, move, focus, resize, drag, float, workspace), and near-layout fit. Engine and Session retain the selected policy. COSMIC remains the only selected policy. Preserve behavior and all existing test assertions and wire goldens.

## Non-goals

No second policy, scrolling projector, transaction-model changes, settings/wire/UI changes, KWin TypeScript edits, live KWin/Plasma testing, host mutation, toolchain/dependency changes, or edits to the dated architecture review. Keep independent per-domain Sessions and transient pairs, as recorded in `docs/decisions.md`.

## Approach and acceptance

- First establish the actual policy surface from Session call sites and implement the trait and COSMIC implementation with offline checks green.
- Then separate world state, operation families, and near-layout fit while retaining existing fences, scopes, ordering, and behavior. Keep the tree green at each coherent step.
- Verify workspace fmt/check/clippy/test; KWin typecheck/tests/build; portable gate; byte-exact wire goldens; zero production `cosmic_v1::` references outside the implementation (or justify exceptions); before/after Session sizes and module map; independent behavior-preservation review. Account for test-count differences.

## Initial findings

- Baseline `crates/tiler-core/src/session.rs`: 11,030 lines, 58 `cosmic_v1::` occurrences including comments and type references. Engine has no direct COSMIC calls; pair/split machinery still serves existing transaction semantics.
- The review's broad insert/remove/resize/drop sketch does not match current call boundaries. Use the actual policy primitives and grouping without claiming a second policy is validated.

## Outcome and decisions

- `LayoutPolicy` contains the 14 policy decisions Session actually consumes: directional plan, admission axis and shares, keyboard/pointer resize constraints, and drag/drop classification. The stateless `CosmicV1Policy` delegates each to the existing COSMIC functions. Engine and Session share the selected policy handle; COSMIC remains the only selected implementation. No policy selection setting or wire change. Engine stamps fresh and retained sessions, and canonical pair/split carries the handle without changing revision, fingerprint, pending, or focus behavior.
- Split Session into `session/world.rs` (631 lines: domains, windows, focus MRU, exceptions), `session/fit.rs` (179: fitted admission), and `session/ops/{lifecycle,move,focus,resize,drag,float,workspace}.rs` (614, 1,242, 450, 1,342, 1,189, 148, 240 lines). `session/ops/mod.rs` is 14 lines. `session.rs` is now 5,256 lines, including existing tests, shared tree/validation/projection helpers and transaction/pair mechanics, down from 11,030 before AR5. Kept this parent file path for the existing `include_str!` test fixtures. Shared helpers remain in the parent where multiple operation families use them. No second policy, scrolling projector, or transaction-model decision is implied.
- The existing `docs/decisions.md` per-domain Session and temporary pair entry remains accurate; no decision entry required editing. The architecture review is unchanged.

## Verification and review

- Offline `cargo fmt --all -- --check`, `cargo check --workspace --offline`, `cargo clippy --workspace --all-targets --offline` (existing style warnings), `cargo test --workspace --offline` (585 pass; unchanged from baseline), `just check-portable` (zero normal core dependencies and no platform leaks). KWin `npm run typecheck && npm test && npm run build` (715 pass; unchanged from baseline). `git diff --check` clean. Existing test assertions and byte-exact wire goldens remain unchanged and pass; no KWin TypeScript changed.
- `cosmic_v1::` in Session/ops outside the policy implementation: zero production code references. Remaining Session matches: seven source-citation comments/doc comments and four direct calls inside unchanged test assertions; ops matches are doc citations. Engine has zero. Two test-only helper wrappers use `CosmicV1Policy` behind `#[cfg(test)]` and are not compiled into production.
- Independent Worker reviewed the diff against HEAD, clone/pair policy propagation, policy call routing, public APIs, wire/KWin scope and tests; found no behavior break. One concrete finding about test helpers compiled in production was fixed with `#[cfg(test)]`, then full checks reran. The reviewer noted that mixed policies supplied through explicit constructors could be re-stamped by Engine or a source pair; only COSMIC is selected in this slice, and no second-policy behavior is claimed.
