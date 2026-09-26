# Live Shortcut Override Verification (Second PC)

## Purpose

User-run acceptance for the current Apply / Force / Revert contract in
`docs/decisions.md#shortcuts` and `docs/changes/shortcut-override.md`.
Read `docs/live-kwin-testing.md` first. It does not grant authorization.
No agent participates. Use physical keys only: `invokeShortcut` bypasses xkb
and proves nothing about delivery.

Superseded machinery is gone: no journal, no migration, no Finish Apply,
no Restore, no preimage restore, no Force-limited-to-compiled-clear-rows.
Do not follow journal-era steps from Git history.

## Setup (Second PC)

- Pull this checkout on the second multi-output PC.
- Build and stage the native effect with the documented dev path only:

```sh
just build-native-effect
```

This stages under `target/kwin-native-effect-stage/kwin/...` without
touching KWin, D-Bus, config, or user paths (`README.md`, `justfile:build-native-effect`).

- For session delivery, the documented route is:

```sh
just dev-native-setup
```

It writes only `$XDG_CONFIG_HOME/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh`
for this checkout, then requires logout/login, and again after every rebuild
(`README.md`, `docs/decisions.md`).
- Packaging/install beyond that staging path (NixOS module, Home Manager,
flake package) is uncertain here and not prescribed. Report which route was
used rather than inventing store or system install steps.
- Start from a fresh Plasma login.

## Baseline (Read-Only)

- Open the project KCM (verified route in `README.md`):

```sh
kcmshell6 kwin/effects/configs/plasma-auto-tiler-active-border_config
```

- In its `Shortcuts` group, capture the status label verbatim before any click.
- Read-only cleared-list state lives at
`~/.config/plasma-auto-tiler/shortcut-clearedrc`
(`kwin/native-effect/shortcutreconciler.cpp:defaultClearedActionsPath`).
Inspect only; do not create, edit, or delete it.
- Ordinary Settings Apply never changes shortcuts
(`kwin/native-effect/activeborderconfig.ui:shortcutDescription`).

## Apply

- Click `Apply Shortcuts` and confirm only the dialog titled
`Apply Shortcuts` (`kwin/native-effect/activeborderconfig_module.cpp:runShortcutApply`).
It assigns focus-right to `Meta+L` and moves Lock Session to `Meta+Esc`,
plus `Meta+Alt+K`, `Meta+Alt+L`, `Meta+G`, `Meta+M`.
- Success assigns all five project chords. A preflight refusal writes nothing;
  preserve the reported write count if a later operation fails.
Capture the resulting status verbatim.

## Force Preview (Arbitrary / Legacy / Foreign Holders)

- When Apply refuses on holders, the KCM offers a preview with `Force Apply`
and `Cancel` visible only for that pending preview
(`activeborderconfig_module.cpp:updateShortcutPresentation`).
- Require the preview to list every active holder with component/action,
found keys, exact required keys removed, and unrelated keys kept
(`activeborderconfig_module.cpp:buildForcePreviewText`).
This includes unknown and legacy `kwin/plasma-auto-tiler-*` IDs.
Exempt only: project actions, Lock Session, and the authorized System Monitor
`Meta+Esc` holder. A `.desktop`-default-only claimant with nothing to clear
blocks Force until unbound manually.
- Press `Cancel` (or decline either confirmation) and verify no change:
`Cancel` discards the preview without writes
(`activeborderconfig_module.cpp:requestShortcutForceCancel`).
Confirmed Force revalidates owner, project/lock images, and the full holder
snapshot after confirmation; stale state aborts with zero writes, including
zero cleared-list writes if it changed before the new snapshot. If a holder
changes after the cleared-ID list is persisted, Force stops before changing
that holder and retains the list for Revert.

## Confirmed Force

- Request a fresh preview, confirm `Force Apply Shortcuts`, and capture the result.
- Clearing removes only the required keys and preserves unrelated keys.
The union of cleared component/action IDs is persisted to
`shortcut-clearedrc` before clearing, so an interrupted Force stays revertible.

## Revert (Defaults, Not Preimages)

- Click `Revert Shortcuts` and confirm only the dialog titled
`Revert Shortcuts` (`activeborderconfig_module.cpp:runShortcutRevert`).
It names the recorded cleared count and states custom cleared bindings are lost.
- Revert restores KDE defaults for every non-project cleared entry via
`defaultShortcutKeys` / `setForeignShortcutKeys`; project-owned IDs stay
cleared. Partial failure retains the list for resume; an empty list is a
no-op success.
- Old `shortcut-override-journalrc` files (including any kcmshell6 legacy path)
are ignored and must remain untouched. No migration, Finish, or Restore exists.

## Physical Checks

With disposable windows, physically press each chord and confirm:

- `Meta+L` moves focus right without locking.
- `Meta+Esc` locks the session (System Monitor displacement is expected).
- `Meta+Alt+K` / `Meta+Alt+L` grow the focused pane outward.
- `Meta+G` toggles float; `Meta+M` toggles maximize.
- Then Revert and confirm cleared non-project actions return to their KDE
  defaults. Project chords remain assigned, and old project IDs stay cleared.

## Diagnostics

Bounded shortcut diagnostics only:

```sh
journalctl --user --no-pager -g "plasmaautotiler.shortcut op="
```

Records carry `op=`, `stage=`, `outcome=` with allowlisted identity and key
images; foreign occupants are redacted. Logging never gates behavior.
