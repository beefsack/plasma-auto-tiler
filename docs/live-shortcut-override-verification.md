# Live Shortcut Override Verification (Second PC)

## Purpose

User-run acceptance for the current Apply / Force / Revert contract in
`docs/decisions.md#shortcuts`, `docs/changes/shortcut-override.md`, and
`docs/changes/kde-shortcut-conflicts.md` (full catalog and presets).
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
(`kwin/native-effect/unifiedsettings.ui:shortcutDescription`).

## Apply

- Select `Authentic (keep all)` to stage the full canonical catalog. This
  does not write shortcuts. Existing empty own assignments initialize as
  Disable when the page opens; Authentic deliberately resets those choices.
- Click `Apply Shortcuts` and confirm only the dialog titled
`Apply Shortcuts` (`kwin/native-effect/unifiedsettings_module.cpp:runShortcutApply`).
It assigns all kept catalog bindings, including workspace and symbol aliases.
With focus-right kept, it takes `Meta+L` and moves Lock Session to `Meta+Esc`,
plus `Meta+Alt+K`, `Meta+Alt+L`, `Meta+Alt+Left`, `Meta+Alt+Down`,
`Meta+Alt+Up`, `Meta+Alt+Right`, `Meta+G`, `Meta+M`,
`Meta+Left/Down/Up/Right`, and `Meta+Shift+Left/Right`. The four focus arrows
clear KWin Quick Tile defaults; the two move arrows clear KWin's next/previous
screen defaults.
- Success assigns every enabled catalog action. A missing enabled action or
  preflight conflict refuses without writes;
  preserve the reported write count if a later operation fails.
Capture the resulting status verbatim.

## Force Preview (Arbitrary / Legacy / Foreign Holders)

- When Apply refuses on holders, the KCM offers a preview with `Force Apply`
and `Cancel` visible only for that pending preview
(`unifiedsettings_module.cpp:updateShortcutPresentation`).
- Require the preview to list every active holder with component/action,
found keys, exact required keys removed, and unrelated keys kept
(`unifiedsettings_module.cpp:buildForcePreviewText`).
This includes unknown and legacy `kwin/plasma-auto-tiler-*` IDs.
Exempt only: project actions, Lock Session, and the authorized System Monitor
`Meta+Esc` holder. A `.desktop`-default-only claimant with nothing to clear
blocks Force until unbound manually.
- Press `Cancel` (or decline either confirmation) and verify no change:
`Cancel` discards the preview without writes
(`unifiedsettings_module.cpp:requestShortcutForceCancel`).
Confirmed Force revalidates owner, project/lock images, and the full holder
snapshot after confirmation; stale state aborts with zero writes, including
zero cleared-list writes if it changed before the new snapshot. If a holder
changes after the cleared-ID list is persisted, Force stops before changing
that holder and retains the list for Revert.
- Change a row's Keep/Disable checkbox while a preview is pending: Force
  and Cancel must disappear. A new Force requires a new Apply/preview, and
  binds the exact staged choices and action presence as well as active keys.

## Confirmed Force

- Request a fresh preview, confirm `Force Apply Shortcuts`, and capture the result.
- Clearing removes only the required keys and preserves unrelated keys.
The union of cleared component/action IDs is persisted to
`shortcut-clearedrc` before clearing, so an interrupted Force stays revertible.

## Revert (Defaults, Not Preimages)

- Click `Revert Shortcuts` and confirm only the dialog titled
`Revert Shortcuts` (`unifiedsettings_module.cpp:runShortcutRevert`).
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
- `Meta+Alt+Left` / `Meta+Alt+Down` / `Meta+Alt+Up` / `Meta+Alt+Right`
  grow the focused pane outward (clearing `kwin/Switch Window
  Left/Down/Up/Right`).
- `Meta+Left/Down/Up/Right` move focus by direction without KWin quick tiling.
- `Meta+Shift+Left/Right` move the focused tiled window by direction without
  KWin moving it to another screen.
- `Meta+G` toggles float; `Meta+M` toggles maximize.
- Then Revert and confirm cleared non-project actions, including Quick Tile
  and next/previous screen, return to their KDE defaults. Project chords
  remain assigned, and old project IDs stay cleared.

## Conflict List, Disable, and Presets (User-Owned KDE Acceptance)

- Record commit, Plasma/KWin version, keyboard layout, and delivery route.
  Check all 66 rows appear with readable canonical/current/default chords;
  distinguish own holders from foreign conflicts. Missing/unavailable queries
  must not claim a clean or applied state. Include workspace digits and
  shifted-symbol aliases on the actual keyboard layout.
- Stage `Compatible (disable conflicting)`: known and discovered foreign
  default/current-holder conflicts become unchecked, other bindings stay Keep,
  and no replacement chords appear. Capture the disabled rows. Decline Apply,
  use ordinary Settings Apply, and close: shortcut assignments must not change.
- Stage Compatible again and explicitly confirm Apply Shortcuts. Disabled
  actions have no project assignment; their foreign holders are unchanged.
  In particular, disabling focus-right must not move Lock Session or alter
  Meta+Esc. On a previously Authentic session the existing lock relocation is
  retained until separately reverted; Compatible does not undo earlier Force.
- Disable one otherwise non-conflicting row manually, Apply, close/reopen:
  the row remains Disable. Log out/in through the documented native delivery
  route and verify the disabled chord does not invoke the tiler, while a kept
  focus/move/resize/workspace binding does. Capture any re-registration loss.
- Use an explicitly chosen disposable foreign shortcut with a project chord
  and an unrelated chord. Keep/Apply must refuse, Force must preview exact
  removals, and confirmed Force must retain the unrelated chord. Disable that
  project row instead: Apply must not clear its foreign holder. Change the
  foreign holder after preview and verify stale Force refuses without writes.
- After Force, stage Compatible again: a discovered foreign default conflict
  must still be disabled even when its current assignment was cleared.
  Revert Shortcuts separately restores recorded foreign KDE defaults; own
  Disable choices stay empty. Custom cleared bindings are lost by the existing
  default-restoration contract. No interrupted-Force recovery success is
  claimed until the existing retained-ID/retry checks above are performed.
- Stage Authentic, decline confirmation, then confirm a fresh Apply/Force:
  no change on decline; on success kept bindings return to canonical chords.
  A custom rebind made in KDE Shortcuts is shown as current, but this explicit
  project Apply deliberately replaces it. First-run prompt/in-page rebind
  controls are deferred; opening Settings alone must not correct shortcuts.

## Diagnostics

Bounded shortcut diagnostics only:

```sh
journalctl --user --no-pager -g "plasmaautotiler.shortcut op="
```

Records carry `op=`, `stage=`, `outcome=` with allowlisted identity and key
images; foreign occupants are redacted. Logging never gates behavior.
