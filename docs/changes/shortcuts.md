# Shortcut Scope

## Goal

Preserve the initial US-keyboard shortcut catalog and the explicit KCM boundary
for conflicting Plasma-global bindings.

## Scope And Acceptance

- Existing shifted aliases remain. Layout detection, migration, opt-in support,
  and reconciliation are post-release work.
- Non-conflicting registration is automatic. The explicit KCM override alone
  may move KDE lock from `Meta+L` to `Meta+Esc`; Revert restores only bindings
  still owned by that override.

## Next Action

Choose complete post-release layout support only after initial release.
