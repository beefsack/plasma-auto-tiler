# Principles

Development process principles, approved by the user. Product goals live in
`VISION.md`; active product and architecture decisions live in
`docs/decisions.md`.

## Alignment

- All goals must align with the vision.
- All tasks must align with a goal.
- All effort spent must make a meaningful step towards completing a task.

## Bias Towards Action

- Bias towards action.
- Avoid overthinking, overdesigning, and process overhead that does not provide
  more value than the effort it costs.

## Scope, Not Arbitrary Limits

- Do not impose arbitrary gates or numeric constraints on work. They cause
  failures and worse implementations, because the work gets contorted to fit a
  number rather than shaped to be correct.
- Control effort by scoping the work down to a sensible level instead. Keep the
  implementation the smallest one that is actually correct for that scope.

## Observability

- Observability is a core requirement across every component of the project.
  Implementation and review must include the evidence needed to diagnose its
  behavior and failures.
- Emit consistent, structured logs throughout operation lifecycles, with enough
  coverage of requests, significant decisions, failures, recovery, and terminal
  outcomes to reconstruct what happened.
- Carry trace or correlation IDs across component and service boundaries so a
  request and its related operations can be followed end to end. Distinguish
  dispatch, acceptance, completion, and uncertainty rather than implying success.
- Make bounded lifecycle and failure summaries visible in normal operation;
  keep high-volume detail in opt-in trace logging. Prefer meaningful event
  coverage over repetitive per-frame or polling noise.
- Logs must exclude secrets, application content, raw native identifiers, and
  raw native D-Bus payloads. Logging failures must never change product behavior
  or prevent operations.
