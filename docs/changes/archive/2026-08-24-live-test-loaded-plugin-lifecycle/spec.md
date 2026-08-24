# Specification: Live-Test Loaded Plugin Lifecycle

## Approval

- User approved this Standard change and one later user-run full retry on
  2026-08-24.
- The Orchestrator approved this initial specification and plan.
- This approval creates planning artifacts only. Source implementation requires
  a later explicit dispatch.

## Intent

Make the documented `live-test.sh run` lifecycle work after a clean reboot when
the installed Plasma plugin is enabled and therefore already loaded. The runner
must take ownership only by disabling its exact enabled plugin first, then
checking that no controller remains loaded before it starts its nonce-owned
controller.

## Defect Evidence

The user ran `bash scripts/live-test.sh run` after a clean install and reboot.
Full preflight passed, but the run aborted with:

```
error: direct status does not report exactly 'loaded: not-loaded'; cannot safely own the controller
```

Evidence is retained at
`/run/user/1000/plasma-auto-tiler-live/live-20260824T182159-4265`.
Its `manifest.txt` records `installed-before=yes`, `enabled-before=yes`,
`cleanup-stop-attempted=no`, `cleanup-restore=not-needed`, and
`lock-removed=yes`. The failed nonce never reached a nonce-owned `start` and
its final status or diagnostics are not startup evidence.

## Scope

- Reorder the enabled-plugin disable and direct loaded-state ownership check in
  `scripts/live-test.sh`.
- Add the clean-reboot enabled-and-loaded lifecycle regression to
  `scripts/live-test.test.sh`.
- Statically verify the script and test harness, then perform one user-run full
  retry after static acceptance.

## Non-Goals

- Changes to `scripts/start-test.sh`, `scripts/dogfood-install.sh`, the KWin
  controller, packaging, shortcuts, or documentation.
- Native-effect discovery or loading, COSMIC directional movement, and the
  existing `Meta+L` lock-screen collision.
- Agent-run host mutation, live retry, staging, commit, or push.

## Ownership And Restoration

- Record the exact installed plugin enable state before any lifecycle change.
- If and only if that plugin was enabled, disable only that plugin before the
  direct loaded-state gate and record that this run owns its restoration.
- After disable, proceed only when direct status contains the exact
  `loaded: not-loaded` line; a remaining loaded controller fails closed.
- On exit, restore the installed plugin enable state only when this run changed
  it and verified restoration. Never stop or restore a controller this run did
  not start or own.

## Acceptance Criteria

- [ ] An enabled plugin that is auto-loaded after reboot is disabled before the
      direct loaded-state gate, allowing the nonce-owned start path to proceed.
- [ ] A controller that remains loaded after that disable still fails closed.
- [ ] The existing disabled-but-loaded refusal remains unchanged.
- [ ] The live-test harness covers the enabled-and-loaded clean-reboot state,
      start ordering, and exact enable-state restoration on exit.
- [ ] Focused and broad static gates pass against their recorded baselines.
- [ ] The user completes one fresh full `bash scripts/live-test.sh run` retry
      after static acceptance, observing successful post-disable ownership and
      verified restoration of the prior enabled state.

## Risks

- KWin reconfigure may not unload the enabled plugin instance. The mandatory
  post-disable status gate must refuse ownership if it remains loaded.
- Reordering must not weaken the existing refusal for an unowned direct load.

## Pending Decisions

- None before the first implementation dispatch. The user-run retry remains a
  final acceptance gate and is not agent-executed.
