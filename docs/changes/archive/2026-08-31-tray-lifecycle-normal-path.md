# Tray Lifecycle Normal-Path Safety

## Goal

Add the smallest safe lifecycle for the existing tray helper without changing
the fixed `PublishSnapshot` route or KWin publisher behavior.

## Scope

- `tray-install`, `tray-start`, `tray-status`, `tray-stop`, and `tray-remove`
  acquire one project lifecycle lock before any artifact preflight or mutation.
- Descriptor-relative, no-follow validation protects the exact project-owned
  install, autostart, runtime record, and ephemeral runtime lock artifacts.
- PID records bind the helper PID to its start tick and installed binary;
  status and stop use the same binding, and stop uses a pidfd before signalling.
- Install, start, and remove roll back only identity-matching artifacts created
  by their ordinary in-process transaction. Removal quarantines then verifies
  artifacts, retaining identity-checked PID, data, and desktop copies only for
  that command. It restores only absent canonical artifacts and preserves
  replacements or ambiguous residue.
- Malformed/replaced records, unrecorded helpers, watcher errors, waiter
  failures, and interrupted residue fail closed. No command automatically
  recovers residual state from a prior crash or interruption.

## Non-Goals

- No durable transaction journal, crash or power-loss rollback, post-crash
  replay, hostile same-user replacement protection, live KWin/Plasma mutation,
  05b work, or publisher timing change.

## Acceptance

- Focused tests cover lock-first ordering, cooperative concurrency, PID record
  mode/schema, status binding, copy and restore replacement preservation,
  metadata/content fidelity, cleanup failure, normal rollback after PID/data/
  desktop removal failure, unrecorded helper refusal, watcher/waiter failure,
  and exact removal.
- Rust, installer, shell, package, and relevant non-live project gates pass.
- Independent security review finds no ordinary-concurrency, normal-rollback,
  or scoped filesystem-identity gap.

## Units

1. Contract simplification completed: retain normal-path ownership mechanics;
   exclude rejected durable recovery and pre-lock preflight behavior.
2. Implement bounded lifecycle commands, identity validation, and focused tests.
3. Final independent review accepted the ephemeral rollback-copy correction.

## Decisions

- The runtime lock is ephemeral synchronization infrastructure, not an
  installation artifact. It is removed after a command and its residual form
  is treated as ambiguous state rather than automatically repaired.
- Status is read-only: definitively stale records are reported, not removed.

## Verification

- Static gates passed: 33 Rust tests, 20 focused lifecycle/endpoint tests, 1002
  KWin tests across 98 suites, 255 start fixtures, 347 installer assertions,
  shell syntax, package build/checksum, and `git diff --check`.
- Final independent security review accepted with no findings. Partial PID,
  data, and desktop removal failures restore validated artifacts; partial data
  quarantine residue fails closed and reports `recovery-required`.
