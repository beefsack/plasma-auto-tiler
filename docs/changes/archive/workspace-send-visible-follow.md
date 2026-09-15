# Workspace Send Visible Follow

## Goal

- After a committed same-output workspace send, follow the target visibly and
  focus the moved window without treating JavaScript wrapper identity as native
  desktop identity.

## Scope

- Keep the existing one-shot native desktop setter/readback boundary.
- Confirm the readback by opaque desktop id, preserving failed-follow truth and
  later send availability.
- Cover the production Plan entry with a fresh-wrapper native mock.

## Non-Goals

- No retry, polling, replay, reset, reseed, queue, lifecycle change, or border
  diagnosis.

## Outcome And Evidence

- KWin's scripting setter is void and cannot report the result of native
  `setCurrent`. The prior immediate readback compared JavaScript object identity,
  which a fresh wrapper could fail despite matching the target desktop.
- The Plan entry now captures the planned target id and compares one immediate
  current-desktop readback by that id. Missing, throwing, malformed, or
  mismatched reads retain the committed send but do not focus or report a
  completed follow.
- `plan-send-coordination.test.ts` drives full planned/acknowledged/verified
  commit wiring, returns a fresh same-id desktop wrapper after the setter, and
  proves follow completion plus mover focus. It fails under the prior identity
  comparison. The existing no-op-setter test continues to prove no false follow
  completion and a later distinct send remains usable.
- `npm run typecheck` and all 656 KWin tests pass. Static
  evidence cannot establish the physical compositor switch. The current
  `/tmp/dev.log` shows committed and `follow outcome=completed`, but no visible
  desktop state; user observation remains the physical acceptance evidence.
