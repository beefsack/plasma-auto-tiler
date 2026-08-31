# Reversible Conflicting Shortcut Configuration

## Intent

Provide explicit Apply and Revert controls in the unified native QWidget KCM
for the approved shortcut override. Apply moves KDE lock from `Meta+L` to
`Meta+Esc` and enables Plasma Auto Tiler focus-right on `Meta+L`; Revert
restores only bindings still owned by that applied override. Registration of
all non-conflicting shortcuts remains default behavior. Installation and
startup never mutate global shortcuts.

## Status

Paused on material product and data-semantics decisions discovered during
reconciliation. No production source, test, package, installer, or live state
was changed.

## Confirmed Evidence

- `kwin/metadata.json` selects only
  `kwin/effects/configs/kcm_kwin4_genericscripted`; no native QWidget KCM is
  implemented, packaged, or discovered.
- The generic KCM owns only `main.xml` settings and has no action controls,
  D-Bus client, conflict UI, or persisted override journal.
- COSMIC focus-right currently registers `Meta+L` at startup. A failed shortcut
  registration disables the controller, so pre-Apply activation behavior cannot
  be inferred safely.
- The repository proves the KGlobalAccel D-Bus read and write surface:
  `allComponents()`, `allShortcutInfos("default")`, and
  `setShortcutKeys(as, a(ai), u)` with `SetPresent | NoAutoloading` (`6`).
  Existing mutation is deliberately limited to the explicit
  `scripts/start-test.sh reconcile-shortcuts --apply` command.
- Existing installer, package, and normal startup paths do not mutate global
  shortcuts and must retain that property.

## Pending Decisions

- Select the trusted, user-triggered KCM owner and its package/discovery path:
  implement the previously planned native QWidget KCM, or explicitly authorize
  another UI surface. The current generic scripted KCM cannot safely host the
  operation.
- Define the pre-Apply registration and reload behavior for focus-right, so the
  controller neither advertises nor requires a conflicting `Meta+L` binding
  before Apply succeeds.
- Define a durable ownership journal and crash recovery policy: exact KDE lock
  action identity, profile-change handling, full-key-set ownership predicate,
  concurrent KCM behavior, pending apply/revert recovery, and the visible
  recovery-required state. This must not infer ownership from the shortcut value
  alone or perform automatic recovery at startup.
- Define conflicts for both target chords, including exact exemptions and the
  handling of missing, duplicate, renamed, or externally edited KDE lock
  records.

## Candidate Technical Contract

After the pending decisions are resolved, the smallest supported route is a
typed Qt DBus client generated from the existing KGlobalAccel signatures. It
would persist only a schema-versioned, profile-scoped journal for exact touched
records, write and verify one record at a time, retain the journal before each
write, and fail closed on absent service, malformed state or replies, conflicts,
or verification failure. Revert would skip any record whose full current key
set differs from the recorded applied key set, retain its journal, and show an
explicit user-retry/recovery status. This remains a candidate, not an accepted
implementation contract.

## Acceptance After Resumption

- Hermetic fake-D-Bus proof covers apply, conflict detection, snapshot scope,
  partial failure, verified rollback, missing service, malformed journal, user
  edits, ownership-safe restore, repeated operations, and no installer/startup
  mutation.
- KCM UI clearly shows inactive, ready, applied, conflict, external-edit, and
  recovery-required states with Apply/Revert feedback.
- Static build, focused tests, package/installer tests, and independent review
  pass. KCM rendering and behavior remain a separate user-run live release
  gate.
