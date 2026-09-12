# Unauthorized Rejection Route Audit

## Goal

- Determine whether the four standalone KWin adapters can statically parse and
  emit a strictly correlation-bound Planner `unauthorized` rejection.

## Scope

- Audit the production Rust authorization producer and the four adapter reply
  fences.
- Correct the deferred backlog statement to reflect the production route.

## Non-Goals

- No Rust Planner behavior, KWin adapter behavior, recoverable rejection, or
  live KWin/Plasma action changed.

## Acceptance

- The production producer is `PlannerEndpoint::describe_plan`, which returns
  `{"v":1,"outcome":"rejected","kind":"unauthorized","message":"unauthorized"}`
  with no `detail` or `correlation_id` when the caller is absent or fails the
  same-UID check.
- `DescribeFocus`, `DescribeMovement`, `DescribeResize`, and
  `DescribePointerResize` are test-only removed routes and have no production
  unauthorized producer.
- No adapter emits an unauthorized token: strict exact-correlation binding
  rejects the fixed production reply before its `kind` can be inspected.

## Evidence

- Static-only source audit: `src/planner_service.rs` confines the producer to
  `DescribePlan`; its legacy route names and unauthorized route helper are
  `#[cfg(test)]`. The authorization check is
  `verify_same_uid_caller` via `GetConnectionUnixUser` against `geteuid`.
- The fixed reply has no correlation ID, while all four standalone adapters
  require an exact correlation ID before rejection-kind handling. Adding the
  requested token would loosen that fence; making the reply bindable requires
  a Rust contract change, which is out of scope.
- Static parse/emit is therefore not implementable under the approved
  constraints. Live validation remains blocked on a user-authorized KWin
  script reload and cannot validate this missing contract binding.
