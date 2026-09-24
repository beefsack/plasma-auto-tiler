# Drop-intent drag live follow-up

## Goal and scope

Resolve the diagnosed drag-23 Meta+right-drag top-left corner miss without
changing keyboard or non-pointer focus policy. The user accepted the
Orchestrator's three recommendations on 2026-09-24: permit an inactive dragged
tiled window to resize without changing active/remembered focus; restore the
retained layout after a rejected drop via one correlated reconcile; classify
well-interior starts by KWin's exact thirds and keep frame-edge starts on the
existing nearest-edge/corner rule. Keep AR8's oracle disposition pending.

## Acceptance and approach

- Replay drag-23 offline: start (680,538,848,478), pointer (828,647), final
  (397,315,1131,701); dragged window is not focused. Route left+up through
  one pointer-resize and project both sibling shares while focus remains
  unchanged. Preserve keyboard resize focus requirements.
- Use pinned KWin 6.7.5 `src/window.cpp:2098-2124` for interior Meta+right
  gravity, including center-third left/right behavior. Establish ordinary
  decoration-start cursor bounds from pinned source before selecting the
  interior threshold; keep frame-edge starts on the shipped classifier.
- On adapter or Planner refusal, use a single bounded, drag-correlated
  reconcile through the existing route, never replay/retry the pointer
  request or loop. Log grab source, exact refusal, follow-up dispatch and
  terminal outcome with bounded correlations.
- Verify Rust tests/format/Clippy/portable and KWin typecheck/tests/build.
  No native code, live mutation, host change, or commit.

## Bounded units and dependencies

1. Source-backed input-ring research and precise threshold.
2. Rust pointer-only target-focus decoupling, including left+up replay and
   keyboard-focus regression.
3. Adapter grab classification and one-shot refusal convergence with
   correlated tests; independent review of the focus/rejection contracts.

## Evidence and outcome

KWin 6.7.5 `window.cpp:2111-2124` chooses Meta+right gravity by exact
thirds; its decoration hit-test latches gravity at press, while the start
signal can follow drag-distance or delay (`window.cpp:2688-2712,2773-2780,
1121-1138`). Breeze None has an invisible `largeSpacing` left/right/bottom
resize strip (`breezedecoration.cpp:416-436`); decorated visible borders and
Qt drag distance vary with font, scale and host settings. A conservative
interior depth is therefore a heuristic to validate live, not a KWin constant.
The Orchestrator's coalesced per-domain restore-needed marker (2026-09-24) is a
technical choice within the user's rejected-drop convergence rule, not a new
user decision.

Rust pointer-only focus decoupling and left+up drag-23 Session projection pass
offline; keyboard focus guard remains. KWin thirds classification sends one
left+up request from drag-23 and preserves the adapter's active identity.
The Orchestrator selected a coalesced per-domain restore-needed marker on
rejection: a subsequent complete-geometry plan satisfies it, otherwise one
reconcile dispatches when the slot is free. Each coalesced drag receives its
own correlated terminal; failed reconciles are never retried. A new gesture
that suppresses an in-flight marker reconcile cancels that dispatch and
re-arms the marker pending with correlated cancellation logs. A new same-domain
accepted drop can satisfy it; rejection shares one follow-up. An older marker
outside the observed domain cannot block a later eligible marker. Disable and
re-enable settle pending markers unavailable; unknown-window refusals cannot
claim an unrelated domain. A synchronous pointer-dispatch failure reports
refusal even if the marker reconcile immediately occupies the slot.

Only a plan actually covering every tiled domain member claims
`outcome=applied covered=N/N`. Skipped fullscreen/maximized members produce a
truthful `outcome=partial covered=R/N` terminal on the marker's own reconcile,
with no retry; another plan's partial application leaves the marker pending.
An independent review of the full uncommitted diff found dispatch-result,
partial-coverage, teardown, and unanchored-domain issues, all resolved with
regressions. No additional equivalent marker-stranding path remains in the
offline audit. Cross-output R4 completes through its separate transaction
route and does not itself satisfy a marker; an idle marker dispatch follows.
Entry verdicts rejected before a usable drag start or window identity is
bound remain fail-closed without a convergence claim.

Offline acceptance: `cargo test --workspace --offline` (593 passed),
`cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets`
(pre-existing warnings only), `just check-portable`, KWin typecheck and build,
and `git diff --check` passed; KWin tests: 784 passed. Public protocol and
native code unchanged. Live user acceptance remains pending: check the
drag-23 inactive Meta+right corner with focus held on the other tile, rejected
drop convergence, edge/corner and center-third starts, fullscreen/maximize
isolation, Esc and zero-move, and size-increment behavior under the reviewed
live KWin testing guide. The 64 px interior gate is a heuristic, not a proven
universal decoration bound. No live mutation or commit was performed.
