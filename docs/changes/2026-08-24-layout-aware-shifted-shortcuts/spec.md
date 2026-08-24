# Layout-Aware Shifted Shortcuts

## Intent

Replace the US-only shifted-digit aliases used to move a focused window to a
workspace with a layout-aware, fail-closed registration path. This is a launch
blocker because KWin removes Shift from global shortcuts whose shifted keysym is
not a letter, making the current aliases layout-dependent.

## Proposal Status

This Standard proposal is approved for durable planning only. Implementation,
pending product decisions, and live acceptance are not approved.

## Scope

- Query `org.kde.keyboard` at `/Layouts` through `Script.callDBus()` during
  script startup or reload.
- Resolve the active configured layout into move-to-workspace shifted-key aliases
  before registering layout-sensitive shortcuts.
- Preserve existing KGlobalAccel action IDs and all unrelated shortcuts.
- Add a deterministic fixture boundary for successful, malformed, unavailable,
  and lost D-Bus replies when implementation is approved.

## Non-Goals

- No shortcut migration-policy change.
- No hardcoded host, keyboard, or user-specific exception.
- No claim that an in-session layout change updates registrations.
- No D-Bus signal bridge unless separately selected and proven supported.
- No live KWin/Plasma operation in static implementation work.

## Technical Recommendation

- Use `getLayout()` for the active zero-based layout index and `getLayoutsList()`
  for the configured layouts. The documented list response is `a(sss)` with
  `shortName`, `displayName`, and `longName` tuples.
- Delay layout-sensitive registration until the asynchronous reply is validated.
  Existing startup/reload registration otherwise remains unchanged.
- Use a pure resolver that returns a complete alias mapping for a supported
  layout identity or no layout-sensitive aliases.
- On an unknown, malformed, unavailable, or lost reply, omit only the
  move-to-workspace shifted aliases, retain unrelated shortcuts, and diagnose the
  failure. This is a recommendation pending product approval.
- Retain stable `plasma-auto-tiler-move-workspace-*` action IDs. The current
  scripting boundary has no unregister or in-place shortcut-update operation, so
  replacement registrations require script reload.

## Evidence

- The current US-only symbol table is in
  `kwin/src/controller-config.ts:205-221`.
- The startup lifecycle runs before synchronous shortcut registration in
  `kwin/src/controller.ts:1003-1176`.
- `Script.callDBus()` has an asynchronous callback and does not invoke it for
  D-Bus errors: `kwin/src/kwin-globals.d.ts:32-47` and `kwin/src/entry.ts:235-255`.
- The KWin scripting surface exposes shortcut registration but not unregistration:
  `kwin/src/kwin-globals.d.ts:15-23`.
- KDE's `org.kde.keyboard` interface exposes `getLayout()`, `getLayoutsList()`,
  `layoutChanged(uint)`, and `layoutListChanged()`: 
  `https://raw.githubusercontent.com/KDE/plasma-workspace/master/components/keyboardlayout/org.kde.KeyboardLayouts.xml`.
- The current KWin Script boundary exposes no supported D-Bus signal subscription.
  Therefore a startup query is not a dynamic-layout-update mechanism.
- Archived workspace-management evidence shows a US active layout and records
  the UK, German, and AZERTY risk, including the AZERTY `Meta+<digit>` collision:
  `docs/changes/archive/2026-08-19-workspace-management-fixes/spec.md:197-255`.

## Acceptance Criteria

- A pure resolver accepts only an approved layout/variant identity and returns a
  complete alias mapping; every unknown identity returns no move aliases.
- Registration waits for a validated active-layout response and retains stable
  action IDs.
- Malformed, unavailable, error, and lost replies omit only layout-sensitive move
  aliases while unrelated shortcuts remain registered.
- The implementation does not alter shortcut migration policy.
- Static tests cover the resolver and asynchronous reply cases. Existing static
  gates remain green.
- Live acceptance proves physical shortcut delivery and collision avoidance for
  every approved layout/variant, the selected dynamic-change contract, and
  unavailable-service behavior. It remains separately parked.

## Pending User Decisions

- Select the supported layout and variant matrix. The D-Bus list tuple has no
  separate documented variant field, so the resolver identity contract is not yet
  defined.
- Select startup/reload-only behavior or authorize a separately scoped and proven
  signal bridge for dynamic layout changes.
- Approve or reject the recommendation to fail closed by disabling only
  layout-sensitive move aliases on unresolved layout state.
- Assign live-acceptance ownership and resolve pre-existing user-owned
  KGlobalAccel shadowing without changing migration policy.
