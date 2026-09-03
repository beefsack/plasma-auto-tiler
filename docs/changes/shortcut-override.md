# Shortcut Override

## Goal

Deliver the approved explicit KCM shortcut override for the MVP: focus-right
takes `Meta+L`, and explicit KCM Apply alone moves KDE lock to `Meta+Esc`.

## Scope And Non-Goals

- Explicit KCM Apply performs the override; explicit KCM Revert recovers it.
  Installation and startup never mutate global shortcuts.
- Non-conflicting project shortcuts register by default; only the conflicting
  Plasma-global lock binding changes, and only through Apply.
- Layout detection, omission, opt-in configuration, migration, KGlobalAccel
  reconciliation, and complete keyboard-layout support remain deferred to the
  parked post-release record in [Shortcut Scope](shortcuts.md).
- This record covers the override contract only, not COSMIC movement, pointer
  resize, runtime, border, tray, or Nix delivery behavior.

## Acceptance

- Fixed identities: `kwin` / `plasma-auto-tiler-focus-right` is `Meta+L`;
  `ksmserver` / `Lock Session` moves from `Meta+L` to `Meta+Esc` on Apply.
- Preflight fails closed on a `Meta+Esc` conflict: unexpected conflicts are
  refused, and Apply makes no partial mutation.
- Non-`Meta+L` lock keys are preserved unchanged.
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
  mutation, ordered two-write Apply, ownership-scoped Revert, and private
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
- Static KCM override/recovery implementation with the focused coverage above
  is accepted as static-only; no live evidence is accepted under this record yet.
- Resolved Plasma 6 KGlobalAccel compatibility defect: host Plasma/KWin 6.7.4
  exposes `setShortcutKeys(as actionId, a(ai) keys, u flags) -> a(ai)` with
  `QSet<QKeySequence>` annotations; old strict `asa(ai)u` validator failed
  Apply/Revert before writes; backend now validates exact split shape and typed
  `QSet`/`QKeySequence` marshalling/reply set semantics with pinned unique
  owner; native/full static/Nix checks passed; read-only probe confirmed exact
  affected current tuples unchanged; no live setter/Apply/Revert was run.

## Next Action

- Seek separate authorization for the single user-run live
  Apply/Revert/interrupted-recovery acceptance gate with exact restoration.
