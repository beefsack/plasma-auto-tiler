# Managed Tray Live Acceptance

## Goal

Validate the current-generation immutable `tray-managed` runtime in the current
Plasma session without changing KWin state or testing a session boundary.

## Scope

- Capture current generation, autostart, D-Bus, KWin, runtime, and SNI baselines.
- Start the exact immutable store binary once only if identity and restoration
  checks pass, then validate managed runtime, SNI registration, KWin snapshot,
  and the fixed Settings action where exact cleanup is safe.
- Stop only the process started by this run and prove restoration.
- Reconcile accepted facts in producer governance.

## Non-Goals

- Login/autostart, active-border/plugin identity, visual panel behavior, and
  physical Settings behavior require a user-performed new session or observation.
- No Nix rebuild, Home Manager switch, consumer change, KWin mutation, commit,
  or push.

## Acceptance

- The process, managed runtime state, D-Bus/SNI identity, and KWin snapshot are
  tied to the current immutable store binary.
- The Settings action is invoked at most once only with exact resulting-process
  cleanup.
- Exact baseline restoration is verified; surprises fail closed.

## Plan

1. Independently review the preflight facts and live mutation/cleanup boundary.
2. Run one bounded lifecycle execution only after the review passes.
3. Independently assess the resulting evidence and restoration.
4. Correct only a proven bounded defect, otherwise update governance to accepted
   facts and stage intended changes without committing.

## Outcome

- Current generation 113 updated the Home Manager autostart target to the
  immutable store binary, while the booted generation remains 109. A manual run
  proved process/runtime binding, SNI registration in `Unavailable` state, and
  one fixed Settings launch with exact Settings-process cleanup.
- KWin snapshot authority, visual panel behavior, login/autostart delivery,
  native plugin identity, and baseline restoration remain unaccepted.
- TERM left the exact managed PID record for the dead helper. This is the
  documented fail-closed interrupted-process behavior, not a product defect;
  it remains untouched pending user-authorized exact recovery.
- An unauthorized review call also left an unidentifiable KWin Script1. Its
  identity and exact cleanup cannot be proved, so this note remains active.
