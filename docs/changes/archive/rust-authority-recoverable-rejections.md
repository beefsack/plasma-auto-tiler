# Rust Authority Recoverable Rejections

## Goal

Keep packaged Rust-authority routes armed after an ordinary Planner refusal,
including the selected three-window gate, while retaining terminal fail-closed
teardown for malformed, identity, transport, authority, and transaction faults.

## Scope

- Classify the Planner's bounded rejected-detail token in all four KWin adapters.
- Keep a `window-count-mismatch` rejection armed and dispatch a later command.
- Preserve terminal handling for every other rejection and all divergence/fault
  paths.
- Correct the controller shortcut action-set declaration order.

## Non-goals

- No Rust, legacy fallback, eligibility, scope, geometry, or three-window-gate
  changes.
- No live KWin action or script reload.

## Acceptance

- Focus, movement, resize, and pointer-resize dispatch again after an ordinary
  rejected reply.
- Structural rejected replies and diverged replies still disable their adapter.
- Typecheck, KWin tests, and start-test harness pass except recorded unrelated
  baseline failures.

## Approach

- Treat only the Planner's bounded `window-count-mismatch` token as recoverable.
  It proves the request was declined solely because the selected exact-three
  product gate was unmet; all unknown or other tokens remain terminal.
- Reset the completed flight and owner pin on that refusal, just as the existing
  noop path does, without reattaching shortcuts or observers.

## Verification

- Focused adapter regressions cover ordinary rejection followed by a dispatched
  next command and a structural rejection that disables.
- Run the requested static suites.

## Outcome

- All four adapters recognize only a fully bound
  `v:1`/matching-correlation/`kind:"snapshot-invalid"`/
  `detail:"window-count-mismatch"` refusal as recoverable. They release the
  completed flight and owner pin but keep their observer subscriptions and
  enabled state; a subsequent command makes a new Planner request. Wrong
  version, wrong correlation, missing, unknown, unauthorized, and structural
  details remain terminal, as do every diverged and local structural-fault path.
- Focus coverage reaches the native entry seam with a non-Array indexed
  `windowList`, avoiding the plain-array engine-authority fixture limitation.
- `COMMAND_SHORTCUT_ACTION_IDS` now initializes before the controller method
  that references it.
- `npm --prefix kwin run typecheck` retains only the pre-existing unused
  `catalogValidationDiagnostics` error. `npm --prefix kwin test` executes the
  12 new route tests successfully but has 11 failures from protected untracked
  cosmic/POC residue. `bash scripts/start-test.test.sh` passes 399 checks.
