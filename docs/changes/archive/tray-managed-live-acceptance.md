# Managed Tray SNI Repair

## Goal

Repair the current-generation immutable `tray-managed` SNI so Plasma can render
the item, show its status, and open its fixed Settings target.

## Scope

- Diagnose the exact immutable current-session process and its SNI wire contract.
- Restore D-Bus dispatch and implement only compatible icon, tooltip, fixed
  Settings activation, and required state-change signals.
- Validate focused Rust, package, module, and bounded current-session behavior.
- Reconcile producer facts, publish the producer, and update only the consumer
  producer lock.

## Non-Goals

- No KWin control path, tiler-state mutation, arbitrary launching, menu actions
  beyond the fixed Settings target, NixOS rebuild, or session boundary.
- Panel appearance and physical click remain user-observed evidence.

## Acceptance

- The current immutable process answers SNI introspection, properties, and
  activation requests after watcher registration.
- The SNI supplies a package-contained visible icon or valid pixmap fallback,
  non-empty useful tooltip, exact status, and only its fixed Settings action.
- Relevant SNI state changes emit compatible, idempotent signals.
- Producer and consumer static integration is verified and only intended files
  are committed and pushed.

## Plan

1. Capture the live managed process, watcher registration, object protocol, and
   narrowly relevant logs without mutation.
2. Independently review the dispatch, SNI, icon, and fixed-KCM design boundary.
3. Implement and verify the smallest compatible repair.
4. Run one bounded live smoke only if the managed lifecycle can replace and
   restore the exact process without retained-state ambiguity.
5. Reconcile accepted facts, publish producer, then pin and publish consumer.

## Prior Evidence

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
  identity and exact cleanup could not be proved at that time; this archived
  record makes no cleanup claim.

## Current Evidence

- Read-only current-session inspection found the exact current immutable
  `tray-managed` process owns and is registered as
  `org.plasmaautotiler.Tray/StatusNotifierItem`, but every SNI object request,
  including `org.freedesktop.DBus.Peer.Ping`, times out. The process is alive.
  Plasma therefore cannot obtain its icon, tooltip, menu, or activation method.
- The leading source hypothesis is that the endpoint blocks its object-server
  dispatch after registration. Icon fallback and unavailable status remain
  secondary until the service responds.

## Outcome

- The repair isolates owner-change monitoring from serving SNI dispatch, ships
  a project icon with a valid protocol pixmap fallback, supplies a status
  tooltip, emits idempotent status/icon/tooltip updates, and routes primary
  activation to the one fixed Nix-baked KCM command. Missing launcher metadata
  fails closed.
- Static evidence passed: formatting; 81 Rust all-target tests; 05a lifecycle
  fixture (19 sequence, 4 self); 05b managed fixture (9 lifecycle, 1 self); and
  the x86_64 tray build, icon install check, and module-boundary evaluation.
- A bounded candidate-store smoke answered SNI requests, reported valid icon,
  tooltip, menu, and fixed Settings activation contracts, launched and cleaned
  up one exact Settings process, and restored the original autostart process
  exactly. No panel visual or session-boundary claim is made.
- After rebuild/new session, the user manually observed only: the tray icon was
  visible and usable, and clicking it opened the native settings dialog. This
  is user visual/manual evidence, not automated/protocol evidence. No
  KWin-origin authoritative snapshot, watcher-ordering/login-autostart, or
  update/rollback generation claim is made.
