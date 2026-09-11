# Snapshot-Invalid Details

## Goal

- Make every Planner `snapshot-invalid` rejection identify its failing check with
  a bounded redacted detail token.

## Scope

- Add static detail tokens to existing `PlanReply` rejection replies.
- Split compound Planner validation and command checks into diagnostic branches.
- Keep only `window-count-mismatch` recoverable in the standalone adapters.

## Non-Goals

- No live KWin/Plasma action or live capture was run.
- No kind, outcome, contract version, reply fallback, or planner acceptance and
  rejection behavior changed.

## Acceptance

- Every Planner `snapshot-invalid` producer emits one token from this map.
- Tokens are static lowercase ASCII identifiers with no runtime data.
- New details remain terminal in all four standalone adapters.

| Token | Producing condition |
| --- | --- |
| `domain-output-invalid` | Domain output opaque ID is invalid. |
| `domain-workspace-invalid` | Domain workspace opaque ID is invalid. |
| `focused-id-invalid` | Nonempty focused-window opaque ID is invalid. |
| `window-limit` | Observation exceeds `PLAN_MAX_WINDOWS`. |
| `observed-window-invalid` | Observed window opaque ID is invalid. |
| `observed-output-invalid` | Observed output opaque ID is invalid. |
| `observed-workspace-invalid` | Observed workspace opaque ID is invalid. |
| `duplicate-window` | Observation repeats a window ID. |
| `domain-bounds-invalid` | Carried domain bounds are invalid. |
| `gap-low` | Domain gap is below zero. |
| `gap-high` | Domain gap exceeds `GEOMETRY_MAX_GAP`. |
| `outer-gap-low` | Domain outer gap is below zero. |
| `outer-gap-high` | Domain outer gap exceeds `GEOMETRY_MAX_GAP`. |
| `window-rect-invalid` | Observed window rectangle is invalid. |
| `window-out-of-bounds` | Observed window rectangle is outside carried bounds. |
| `focused-not-observed` | Nonempty focused window is absent from observation. |
| `inset-exhausted` | Applying the outer gap exhausts domain bounds. |
| `domain-invalid` | Projected `OutputDomain` fails validation. |
| `commit-rejected` | Retained Planner acknowledgement or lifecycle verification fails. |
| `missing-seed-order` | Directional rebuild cannot infer a safe spatial seed order. |
| `seed-failed` | Planner session seeding fails. |
| `placement-bounds-invalid` | Explicit admit placement bounds are invalid. |
| `admit-op-invalid` | Admit command operation is not `admit`. |
| `admit-window-invalid` | Admit command window opaque ID is invalid. |
| `admit-output-invalid` | Admit command output opaque ID is invalid. |
| `admit-workspace-invalid` | Admit command workspace opaque ID is invalid. |
| `remove-op-invalid` | Remove command operation is not `remove`. |
| `remove-window-invalid` | Remove command window opaque ID is invalid. |
| `move-op-invalid` | Move command operation is not `move`. |
| `move-window-invalid` | Move command window opaque ID is invalid. |
| `focus-op-invalid` | Focus command operation is not `focus`. |
| `focus-window-invalid` | Focus command window opaque ID is invalid. |
| `resize-op-invalid` | Resize command operation is not `resize`. |
| `resize-window-invalid` | Resize command window opaque ID is invalid. |

## Evidence

- Static-only verification: `cargo test` passed 225 library tests and the
  integration suites; `cargo fmt --check` and `nix flake check` passed.
- `cargo test --lib planner_protocol` passed 20 tests.
- Adapter suites passed: movement 65, focus 46, resize 40, pointer-resize 63.
- Exact-detail assertions retain the correlation ID and detail, confirming the
  `PLAN_MAX_REPLY_BYTES` fallback was not selected. The fallback string is
  unchanged.
