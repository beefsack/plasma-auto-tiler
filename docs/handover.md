# Orchestrator Session Handover

## Process

- Mode: normal.
- Orchestrator selector: top-level session.
- Lead selector: `lead-openai`.
- Worker selector: `worker`.
- Model preference: `openai/gpt-5.6-terra` only.
- Host persona: distinct from the configured process roles.
- Context budget: 150000.
- Default context depth: 2; verified.
- No subagent sessions may be resumed.

## Repository

- Current HEAD after this transaction: `HEAD`.
- Tracked state: clean after the transaction commit.
- Forbidden unrelated untracked paths must not be enumerated or touched.
- Completed commits from this session: `HEAD` - `docs: record approved governance`.
- Agents are authorized to stage approved paths, commit, and push normally.
- This transaction runs no tests or live commands.

## Approved Decisions

- Core Distribution: `scripts/build-kpackage.sh` exclusively owns non-mutating,
  script-only release archive and checksum construction; `scripts/dogfood-install.sh`
  owns local script/native-effect/setup/configuration/documented D-Bus lifecycle.
  Shared assembly duplication is separate maintenance. Do not extend Native
  Effect Live Validation by analogy.
- Tray: portable Rust StatusNotifierItem carrier, KWin backend first, fail
  closed without a watcher, and a proof-first fixed whitelisted D-Bus bridge
  with outbound snapshots, reconnect/idempotence, and no shell/input injection.
  KCM remains sole settings owner; tray exposes state/actions/open-settings only;
  development is dogfood-only; before release the helper becomes official core
  while the tiler remains functional without it. Reversible namespaced user-local
  helper build/stage/start/stop, graphical-session autostart, and session D-Bus
  operations are standing-authorized; non-project state is prohibited.
- Unified Settings: KCM remains the sole settings owner; tray exposure is limited
  to state, actions, and open-settings.
- Layout: exact US registers existing shifted aliases; non-US, unknown,
  unavailable, or malformed state omits only layout-sensitive move aliases and
  preserves unrelated shortcuts; layout changes require reload; agents may
  snapshot/reconcile/rollback only this project's affected KGlobalAccel records.
  Non-project mutation requires separate approval.
- Interactive resize: pointer tiled resize adjusts shared split boundaries or
  ratios and reflows neighbors.
- COSMIC: one approved controller-integration successor exception, using a
  controller-owned adapter and live controller-path corpus. Topology corruption,
  duplicate occupancy, unsafe rollback, lost windows, and false restoration are
  strict non-deferrable invariants; minor visual/edge defects may defer. The old
  change remains historically parked and is not resumed or relabelled.
- Drag gap: production correction stays parked and separately scoped. Portable
  cross-WM/OS layout-engine research follows COSMIC and interactive resize; the
  proven KWin client-realization gap is not an engine defect.
- Deferred/Steam: generic pointer interactive resize is baseline; Steam live
  troubleshooting follows resize and remains paused until user-run live work.

## Change Status

- Native-effect discovery/loading regression: P1 open, first; prior host loading
  was observed, but visual rendering remains unclaimed.
- COSMIC successor: P1 open, second; old plan counters remain historical and no
  successor implementation unit has started. Historical frozen units are 03
  (attempt/correction/review 1/1/1), 03B (1/1/0), checkpointed 03C (1/1/0),
  and 03E (1/0/0); the successor is at zero.
- Interactive resize: P1 open, third; deferred units 01 and 02 are accepted,
  unit 03 is parked for user-run Steam work.
- Portable layout-engine research: after COSMIC and resize, P2 not yet scoped.
- Drag gap: P1 paused; production attempt 02 is parked, no-progress streak 3,
  change-wide counters are 5 implementation dispatches, 1 dispatch-invalid, 2
  changed-kind resets, 3 criteria moved, and no next dispatch.
- Install split: P3 open and decision-resolved; unit 01 accepted, unit 02 open,
  unit 03 deferred; implementation dispatch counters remain 0.
- Tray: P3 open and all decisions resolved; unit 01 accepted, units 02-05 not
  started or blocked; implementation dispatch counters remain 0.
- Layout shortcuts: P1 open and policy resolved; unit 01 open at zero attempts,
  unit 02 blocked, unit 03 parked at zero attempts.

## Next Order

1. Native diagnosis.
2. COSMIC controller-integration successor.
3. Interactive resize.
4. Portable cross-WM/OS layout-engine research.
5. Steam live troubleshooting.

## Live Blockers

- User-run live validation is required for native diagnosis, Steam behavior,
  tray registration/bridge behavior, and layout shortcut delivery.
- No live operation is authorized or claimed by this Worker.
- Native effect observed status: host-dogfooding previously confirmed loading;
  visual border rendering remains unconfirmed.
