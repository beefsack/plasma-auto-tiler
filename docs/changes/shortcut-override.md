# Shortcut Override

## Goal

Deliver the approved explicit KCM shortcut override table for the MVP. Explicit
KCM Apply alone resolves only the closed compiled-in rows.

## Scope And Non-Goals

- Explicit KCM Apply performs the override; explicit KCM Revert recovers it.
  Installation and startup never mutate global shortcuts.
- Non-conflicting project shortcuts register by default. The closed table is
  the only conflict allowlist and carries each project identity/chord, foreign
  identity, expected foreign preimage, and either `relocate` or `clear`.
- Layout detection, omission, opt-in configuration, migration, KGlobalAccel
  reconciliation, and complete keyboard-layout support remain deferred to the
  parked post-release record in [Shortcut Scope](shortcuts.md).
- This record covers the override contract only, not COSMIC movement, pointer
  resize, runtime, border, tray, or Nix delivery behavior.

## Acceptance

- Row 1: `kwin` / `plasma-auto-tiler-focus-right` takes `Meta+L`; `ksmserver`
  / `Lock Session` relocates `Meta+L` to `Meta+Esc`. Non-`Meta+L` lock keys
  keep their order. The row deliberately displaces System Monitor
  `org.kde.plasma.systemmonitor` / `_launch`'s declared `Meta+Esc` default;
  that exact target occupant is compiled into the row and is never writable.
- Row 2: `kwin` / `plasma-auto-tiler-resize-outwards-up` takes `Meta+Alt+K`;
  `KDE Keyboard Layout Switcher` / `Switch to Next Keyboard Layout` clears
  from the exact preimage `Meta+Alt+K`.
- Row 3: `kwin` / `plasma-auto-tiler-resize-outwards-right` takes
  `Meta+Alt+L`; `KDE Keyboard Layout Switcher` / `Switch to Last-Used Keyboard
  Layout` clears from the exact preimage `Meta+Alt+L`.
- Whole-table preflight fails closed for any unexpected row preimage or target
  conflict, before journal creation or mutation.
- Revert restores only bindings still owned by that override.
- Live acceptance is one user-run Apply/Revert/interrupted-recovery gate:
  separately authorized, bounded, reversible manual confirmation with exact
  restoration under the live guide and standing live-test boundary; no live
  result is claimed by static evidence.

## Approach And Dependencies

- Minimal KCM-owned Apply/Revert path with fail-closed preflight and
  ownership-scoped revert; no install/startup mutation path.
- Depends only on the existing shortcut catalog and KGlobalAccel ownership
  checks; no settings-group, default, or unrelated binding changes.

## Verification

- Static-only complete: KCM Apply/Revert with Finish Apply/Restore recovery,
  confirmation-gated mutations, ordinary Settings Apply without shortcut
  mutation, ordered six-write Apply, ownership-scoped Revert, and private
  project journal.
- Focused static coverage in `shortcutreconciler_test.cpp` (Apply order,
  `Meta+Esc` refusal without mutation, partial-write resume, external-edit
  handling, journal/path safety) and `activeborderconfig_shortcut_test.cpp`
  (ordinary-save isolation, recovery routing, confirmation gates, state/error
  presentation). No live Apply/Revert/interrupted-recovery result is claimed.

## Material Decisions And Accepted Evidence

- Approved durable contract, including exact role allowlist, preserved
  non-`Meta+L` lock keys, and private project journal, is recorded in
  [decisions](../decisions.md#shortcuts); this record duplicates no decision.
- Static KCM table/recovery implementation with the focused coverage above is
  accepted as static-only. No live Apply/Revert/interrupted-recovery result is
  claimed under this record.
- Resolved Plasma 6 KGlobalAccel compatibility defect: host Plasma/KWin 6.7.4
  exposes `setShortcutKeys` as an out-first XML method: `a(ai)` out, then
  `as`, `a(ai)`, `u` inputs, with direction-relative `Out0`/`In1`
  `QSet<QKeySequence>` annotations. The validator incorrectly treated document
  order as input-first call order, rejecting this exact contract before writes.
  It now accepts the exact out-first contract and still rejects absent or
  mismatched methods.
- Resolved target-conflict blindness: Apply and KCM status now use strict
  `globalShortcutsByKey((ai)(i))` and `globalShortcutAvailable((ai)s)` checks
  for `Meta+L`, `Meta+Esc`, `Meta+Alt+K`, and `Meta+Alt+L`, including
  .desktop-declared defaults absent from the tuple enumeration. The only
  accepted foreign holder is the user-approved System Monitor `_launch` on
  row 1's `Meta+Esc` target; all other holders, malformed replies, and
  availability inconsistencies fail closed before journal creation or writes.
- Hermetic evidence: the exact captured out-first XML is accepted while absent
  and mismatched methods are rejected; keyed fake-store coverage makes a
  default-only holder (empty active keys, default `Meta+Esc`) visible despite
  its absence from `readAll`, and proves zero-write rejection for relocation
  and clear targets. It also proves the authorized System Monitor case applies
  six allowlisted writes without writing System Monitor. CTest passed 21/21;
  `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `nix flake check`, and the KWin TypeScript suite (385 tests, 47 suites)
  passed. No live Apply, setter, KWin, Plasma, or config mutation was run.
- Resolved the next masked preflight refusal: dynamic `QDBusInterface` objects
  perform implicit owner tracking and introspection at construction. In the KCM,
  that made the bus-daemon proxy invalid despite the connected session bus.
  Owner resolution now uses `QDBusConnection::interface()->serviceOwner()` and
  `serviceUid()`; KGlobalAccel reads and the pinned-owner setter use raw method
  calls, avoiding every dynamic proxy. The owner pin remains immutable and the
  write path still re-confirms it immediately before each write. Hermetic owner
  coverage accepts a valid owner, rejects an absent service before any write,
  and rejects owner drift without changing the pin. Read-only live inspection
  confirmed `org.kde.kglobalaccel` owner `:1.614`, UID `1000`, and the exact
  setter contract. No live Apply, setter, KWin, Plasma, or config mutation was
  run for this correction.

## Next Action

- Separate authorization remains required for the single user-run live
  Apply/Revert/interrupted-recovery gate; rebuild the native effect first, then
  follow the [verification runbook](../live-shortcut-override-verification.md).
  No live result is claimed.

## Retained Core Triage

- PID 3568836 aborted while KWin's D-Bus server demarshalled an inbound
  `QKeySequence` argument (`deliverCall`/`activateObject`), before its target
  method ran. This is unrelated to Apply/Revert, which sends `setShortcutKeys`
  from KWin to the separate KGlobalAccel service. The stripped stack does not
  identify the inbound method or sender.
