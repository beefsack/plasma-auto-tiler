# Live Shortcut Override Verification

## Purpose

This is the user-run acceptance procedure for the KCM shortcut override. Read
`docs/live-kwin-testing.md` first. It does not grant authorization; perform this
only under the separately authorized live gate. No agent participates in any
step. Use physical keys only: D-Bus `invokeShortcut` does not prove xkb delivery.

The KCM has one whole-table `Apply Shortcuts`, not a row-selective Apply. Apply
necessarily reconciles all three conflict rows (six managed action records, not
six rows). Phase 1 observes row 1 only; do not test rows 2-3 until Phase 2, and
Revert after Phase 1 before proceeding.

## KCM Status Vocabulary

This is the status-label vocabulary at
`kwin/native-effect/activeborderconfig_module.cpp:274-412` at HEAD. Capture
the `Shortcuts` group status label VERBATIM as the first instruction immediately
after Apply, before retrying, closing the dialog, or anything else. Do not
paraphrase. The separate error label can contain the reconciler result
(`activeborderconfig_module.cpp:203-225`); preserve it too if displayed.

- `Shortcut state unavailable: reconciler is not configured.`
  (`activeborderconfig_module.cpp:274`)
- `Shortcut state unavailable: %1` - dynamic wrapper at
  `activeborderconfig_module.cpp:284,291,298,304,363`. It covers journal-load,
  setter-contract, owner, read-all, and keyed-occupancy unavailable detail. The
  `:363` site is the unavailable branch of the same keyed gate as `Conflict` at
  `:361`. KGlobalAccel malformed-reply details are now static bounded tokens,
  including `unexpected allShortcutInfos reply: empty action`, `...: oversized
  friendly`, and `...: wrong signature`; the complete token map is in
  [Shortcut Override](changes/shortcut-override.md#diagnostic-token-map).
  Record the full rendered string; it identifies the exact refusing condition
  and never includes foreign reply data.
- `Shortcut state unavailable: allowlisted bindings are missing.`
  (`activeborderconfig_module.cpp:339`)
- `Shortcut state unavailable: unrelated tuple is unbounded.`
  (`activeborderconfig_module.cpp:348`)
- `Conflict: %1. Apply is refused.` (`activeborderconfig_module.cpp:361`) -
  preflight refusal. Performs no write; see "Preflight Refusal" below. This is
  legitimate and safe, not a test failure.
- `Interrupted apply found (phase %1). Finish Apply or Restore.`
  (`activeborderconfig_module.cpp:372`) -
  interrupted phase; `%1` is the journal phase (e.g. apply-pending,
  focus-applied). Only then are `Finish Apply` and `Restore` visible.
- `Shortcuts applied (journal complete, 3 rows).`
  (`activeborderconfig_module.cpp:381`) - full applied, journal-complete image
  matches.
- `Shortcuts drifted after apply-complete; live bindings differ from the recorded post image.`
  (`activeborderconfig_module.cpp:383`)
- `Shortcuts applied (3 rows): focus-right owns Meta+L, Lock Session owns Meta+Esc, resize-outwards-up owns Meta+Alt+K, Switch to Next cleared, resize-outwards-right owns Meta+Alt+L, Switch to Last-Used cleared.`
  (`activeborderconfig_module.cpp:398-400`) - applied live image without a
  matching complete journal.
- `Ready (3 rows): Apply will assign focus-right to Meta+L and move Lock Session to Meta+Esc; assign resize-outwards-up to Meta+Alt+K clearing Switch to Next; assign resize-outwards-right to Meta+Alt+L clearing Switch to Last-Used.`
  (`activeborderconfig_module.cpp:405-408`) - ready long string.
- `Shortcuts differ from the allowed image.`
  (`activeborderconfig_module.cpp:412`) - catch-all divergence.

Apply confirmation (`activeborderconfig_module.cpp:205-209`) is titled `Apply
Shortcuts` and names all three rows. Revert confirmation
(`activeborderconfig_module.cpp:229-233`) is titled `Revert Shortcuts` and says
external edits stay untouched. Ordinary Settings Apply never changes shortcuts.

## Preconditions And Baseline

1. Use a disposable desktop with three normal, resizable, Wayland-native test
   windows. Do not move real windows or alter unrelated settings.
2. Open a terminal and run these read-only commands. Preserve the complete
   terminal output as the baseline ledger. `kreadconfig6` prints an empty line
   for an absent or empty key, so retain the `grep` output as the authoritative
   absent-versus-present record.

```sh
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/kglobalshortcutsrc"
printf 'CONFIG=%s\n' "$CONFIG"
stat -c 'size=%s mtime=%y' "$CONFIG"
sha256sum "$CONFIG"
grep -n -F -e '[kwin]' -e '[ksmserver]' -e '[KDE Keyboard Layout Switcher]' \
  -e 'plasma-auto-tiler-focus-right=' \
  -e 'plasma-auto-tiler-resize-outwards-up=' \
  -e 'plasma-auto-tiler-resize-outwards-right=' \
  -e 'Lock Session=' \
  -e 'Switch to Next Keyboard Layout=' \
  -e 'Switch to Last-Used Keyboard Layout=' "$CONFIG"
awk '/^\[/{group=$0} /Meta\+Esc/{printf "%s:%d:%s\n", group, NR, $0}' "$CONFIG"
kreadconfig6 --file kglobalshortcutsrc --group kwin --key plasma-auto-tiler-focus-right
kreadconfig6 --file kglobalshortcutsrc --group kwin --key plasma-auto-tiler-resize-outwards-up
kreadconfig6 --file kglobalshortcutsrc --group kwin --key plasma-auto-tiler-resize-outwards-right
kreadconfig6 --file kglobalshortcutsrc --group ksmserver --key 'Lock Session'
kreadconfig6 --file kglobalshortcutsrc --group 'KDE Keyboard Layout Switcher' --key 'Switch to Next Keyboard Layout'
kreadconfig6 --file kglobalshortcutsrc --group 'KDE Keyboard Layout Switcher' --key 'Switch to Last-Used Keyboard Layout'
```

3. Locate the private journal read-only. Its verified filename is
   `shortcut-override-journalrc`, with group `[ShortcutOverride]` and schema
   `shortcut-override-v2`. Source uses the KCM process's
   `QStandardPaths::AppConfigLocation`, so the exact host directory is
   intentionally not guessed. This command discovers it if it already exists:

```sh
JOURNAL="$(grep -rl -m1 -F 'SchemaVersion=shortcut-override-v2' "${XDG_CONFIG_HOME:-$HOME/.config}" 2>/dev/null || true)"
printf 'JOURNAL=%s\n' "$JOURNAL"
test -z "$JOURNAL" || { stat -c 'size=%s mtime=%y' "$JOURNAL"; sha256sum "$JOURNAL"; grep -n -F -e '[ShortcutOverride]' -e 'SchemaVersion=' -e 'Phase=' "$JOURNAL"; }
```

4. A nonempty `JOURNAL` is a possible project journal, not proof of its state.
   Do not start a fresh Apply. Open the project KCM and use its displayed status
   to choose "Interrupted Recovery" or the normal Revert route below.
5. Run `just dev-status`; it must report `dev mode: DOWN`. Otherwise do not run
   this procedure over an existing runtime. Restore that runtime through its own
   approved route first. Then start the authorized test runtime in a dedicated
   terminal with `just dev`. Copy the path printed as `combined log: ...`; leave
   that terminal running until testing is complete. It captures Planner and KWin.
6. Open the exact project KCM with:

```sh
kcmshell6 kwin/effects/configs/plasma-auto-tiler-active-border_config
```

   The graphical route is System Settings `Desktop Effects`; the direct command
   above is the verified project KCM route. In its `Shortcuts` group, the ready
   long string (`Ready (3 rows): ...`) is valid. `Shortcuts differ from the
   allowed image.` is also valid when the baseline already gives focus-right
   `Meta+L` while Lock Session still has it. A `Conflict:` / `Shortcut state
   unavailable:` preflight status is also valid and means Apply is refused
   without mutation; follow "Preflight Refusal", not "Failures". Do not use
   ordinary Settings Apply: it never changes shortcuts.

## Override Scope

Three compiled-in conflict rows at `kwin/native-effect/shortcutreconciler.cpp:322-334`
(six managed action records: three project actions plus three foreign actions):

- Row 1: focus-right (`kwin` / `plasma-auto-tiler-focus-right`) takes `Meta+L`;
  Lock Session (`ksmserver` / `Lock Session`) moves its `Meta+L` to `Meta+Esc`.
- Row 2: resize-outwards-up (`kwin` / `plasma-auto-tiler-resize-outwards-up`)
  takes `Meta+Alt+K`; Switch to Next (`KDE Keyboard Layout Switcher` /
  `Switch to Next Keyboard Layout`) is cleared.
- Row 3: resize-outwards-right (`kwin` /
  `plasma-auto-tiler-resize-outwards-right`) takes `Meta+Alt+L`; Switch to Last
  (`KDE Keyboard Layout Switcher` / `Switch to Last-Used Keyboard Layout`) is
  cleared.

Rows 2-3 were written by the first successful Finish Apply: both Switcher
actions are cleared in the confirmed postimage. Their physical resize chords
remain untested. The same postimage confirms project actions at `Meta+L`,
`Meta+Alt+K`, and `Meta+Alt+L`; Lock Session contains `Meta+Esc` and no
`Meta+L`; and `Meta+Esc` has no other claimant in the config output.

## Preflight Refusal

A `Conflict: ... Apply is refused.` or keyed `Shortcut state unavailable: ...`
status shown before Apply writes is a legitimate safe refusal, not a test
failure. It performs NO mutation and `kglobalshortcutsrc` remains byte-identical.

Verified observed run (not a universal expected baseline): after one such
refused preflight, the ledger showed `~/.config/kglobalshortcutsrc`, size
20105, mtime 2026-09-11 23:10:02, sha256
`57be857aa008a7ea45289dfcc0006e77dd11a726ea93be49146f102b43c86dc3`; no journal
file anywhere under `~/.config`; nothing to restore.

On a refused preflight: preserve the VERBATIM status first, then re-run the
baseline ledger commands and the `JOURNAL` discovery command to confirm
byte-identity and journal absence. Do not retry Apply, do not run Revert or
Restore, do not run manual restoration. A refused preflight with no mutation
needs no restore.

## Intended System Monitor Impact

After a successful Apply, `Meta+Esc` will no longer open System Monitor because
the user authorized displacement of its `_launch` default. It instead locks the
session. This is expected correct behavior, not a bug.

The shipped default is `X-KDE-Shortcuts=Meta+Esc` at
`/run/current-system/sw/share/applications/org.kde.plasma-systemmonitor.desktop:189`,
held by `org.kde.plasma-systemmonitor.desktop` / `_launch`
(`kwin/native-effect/shortcutreconciler.h:99-112`). Apply displaces that chord
onto Lock Session without rebinding System Monitor itself
(`shortcutreconciler.cpp:338-347,622-633,1141-1146`,
`activeborderconfig_module.cpp:353-367`).

## Phase 1 - Row 1 Observation

1. Click `Apply Shortcuts`. The confirmation is titled `Apply Shortcuts` and
   names all three rows: focus-right/Lock Session, resize-outwards-up/Switch to
   Next, and resize-outwards-right/Switch to Last-Used. Select `Yes` only if it
   matches the baseline ledger.
2. Capture the status VERBATIM immediately, before anything else.
   - If it is a preflight `Conflict:` / `Shortcut state unavailable:`, follow
     "Preflight Refusal" above. Stop; this run is complete as a safe refusal.
   - Otherwise expect `Shortcuts applied (journal complete, 3 rows).` or the
     equivalent full applied long string spelling out that focus-right owns
     `Meta+L`, Lock Session owns `Meta+Esc`, and both Switcher actions are
     cleared. Any other unexpected status goes to "Failures"; do not retry.
3. Re-run the six `kreadconfig6` commands plus the `grep` and `awk` commands
   from the baseline. Find and record the now-created journal with the `JOURNAL` command.
   It must show the project actions at `Meta+L`, `Meta+Alt+K`, and `Meta+Alt+L`;
   Lock Session must contain `Meta+Esc` and no `Meta+L`; the two Switcher actions
   must be empty. Record every non-`Meta+L` Lock Session key in its displayed
   order. `Meta+Esc` must have no other claimant in the config output.
4. With the left test window focused, physically press `Meta+L`. PASS: focus
   moves right without locking the session.
5. Physically press `Meta+Esc`. This is intentionally part of the test. PASS:
   the session locks (System Monitor must not open; see "Intended System
   Monitor Impact"). Authenticate normally to return, then verify the same
   disposable windows remain usable. Do not substitute another lock method.
6. Physically test every captured non-`Meta+L` Lock Session key in its recorded
   order. PASS: each still locks the session; authenticate back in after each.
   FAIL: a missing, reordered, or changed lock key.

## Phase 1 Revert

1. In the `Shortcuts` group click `Revert Shortcuts`. The confirmation is titled
   `Revert Shortcuts` and says external edits stay untouched. Select `Yes`.
2. Re-run every baseline command. PASS: all six allowlisted records, every
   `Meta+Esc` line, the `kglobalshortcutsrc` hash, and journal state match the
   ledger. The journal must be absent. The captured mtime is provenance only and
   may legitimately differ after a content-exact restore.
3. The KCM error label must not report `Untouched:`
   (`activeborderconfig_module.cpp:244-247`). If it does, or the config hash
   differs, stop: restoration is not exact or it detected an external edit and
   deliberately left that entry alone.

## Interrupted Recovery

`Apply Shortcuts` remains synchronous with no supported user cancel point, but
an actual KCM crash has produced a `focus-applied` journal. Do not attempt a
timed close, kill, logout, power loss, or configuration edit to reproduce it.
When an actual interruption leaves the journal, reopen the project KCM. Its
status must say `Interrupted apply found (phase ...). Finish Apply or Restore.`
naming the journal phase (for example, `phase apply-pending` or
`phase focus-applied`); only then are `Finish Apply` and `Restore` visible.

1. `Finish Apply` is live-proven once. The observed status was `Interrupted
   apply found (phase focus-applied). Finish Apply or Restore.`; after the user
   chose `Finish Apply`, it was `Shortcuts applied (journal complete, 3 rows).`
   The complete three-row postimage was confirmed, and physical `Meta+L` moved
   focus right. This does not prove the Lock Session checks or Revert.
2. `Restore` remains unexecuted. It would repeat the Revert confirmation; PASS
   would require all six allowlisted entries equal their recorded preimage and
   the journal absent. Do not induce an interruption to test it.

## Phase 2 - Clear Rows

Run this only after the remaining Phase 1 locking checks and Revert pass.
Rows 2-3 are written live but physically unproven; treat physical success here
as first evidence.

1. Apply again through `Apply Shortcuts` and its same confirmation. Capture the
   status VERBATIM first; a preflight refusal ends this run per "Preflight
   Refusal". Otherwise confirm the complete three-row postimage and keep the
   combined log path.
2. Arrange the three disposable windows as the normal `H[A,V[B,C]]` shape: a
   left pane `A`, and a right column with top `B` and bottom `C`. Keep focus on
   the indicated pane for each test.
3. Focus the LEFT pane `A`, then physically press `Meta+Alt+L`. PASS: its right
   edge grows and the right neighbor adjusts. This must be the left pane:
   grow-right on the rightmost pane is a legitimate COSMIC `unchanged` no-op.
4. Focus the BOTTOM pane `C`, then physically press `Meta+Alt+K`. PASS: its top
   edge grows and the top neighbor adjusts. This must be the bottom pane:
   grow-up on the topmost pane is a legitimate COSMIC `unchanged` no-op.
5. `Meta+Alt+H` and `Meta+Alt+J` have no competing config claim and are known
   controls. Focus the TOP-RIGHT pane `B`: test one outward `Meta+Alt+H` toward
   `A`, one outward `Meta+Alt+J` toward `C`, then their `Shift` inward forms.
   This distinguishes a general runtime failure from either cleared chord.
6. The outer inset consumes 8 px on each side, or 16 px per axis. Therefore a
   `pair-below-minimum` refusal is slightly more likely and is a correct refusal,
   not a shortcut or COSMIC bug. It is distinct from the edge `unchanged` no-op.
7. Click `Revert Shortcuts`, accept its confirmation, and require the entire
   baseline ledger again before closing the KCM.

## Failures And Logs

Applies only to unexpected post-Apply states, failed physical tests, or changed
baselines after a write. A preflight refusal is not a failure; use "Preflight
Refusal" instead.

1. Do not retry Apply, Finish Apply, Revert, or Restore after an unexpected
   status, missing key, or changed baseline. Capture the VERBATIM KCM status,
   the baseline/postimage output, and the private journal path and hash.
2. Preserve the exact file printed as `combined log:`. It contains `[planner]`
   and PID-filtered `[kwin]` output and persists after `just dev` tears down.

3. Look for `plasma-auto-tiler:plan:shortcut-failed action=<action>
   sequence=<sequence>`; it names the exact refused project chord. For a resize
   refusal, the diagnostic is `plasma-auto-tiler:plan:cmd=<correlation>
   kind=resize windows=<N> outcome=rejected`, followed by
   `plasma-auto-tiler:plan:rejected kind=pair-below-minimum` when the pair is
   below its valid minimum. Boundary no-ops are `unchanged`, not that rejection.
4. For `kind=snapshot-invalid`, retain the paired Planner detail token and map
   it with `docs/changes/archive/snapshot-invalid-details.md`. Do not treat the
   generic kind as sufficient diagnosis; the bounded `detail` token names the
   failed Planner check.

## Manual Restoration

Run this teardown only when a write actually happened and the project KCM route
is unavailable: a partial Apply, a missing recovery button, or an unavailable
project KCM. A refused preflight with a byte-identical ledger and no journal
needs no restore; do not run this section for it. First preference is always
the project KCM's `Restore` (interrupted journal) or `Revert Shortcuts`
(complete journal): both restore only entries whose live postimage is still
project-owned.

If that route is unavailable, open the verified system Shortcuts module:

```sh
systemsettings kcm_keys
```

Restore only these exact component/action records (six managed records across
three rows) from the baseline ledger, then save through that module and rerun
all baseline commands until they match:

| Component | Action | Restore value |
| --- | --- | --- |
| `kwin` | `plasma-auto-tiler-focus-right` | captured preimage, including absent/empty |
| `ksmserver` | `Lock Session` | captured preimage, preserving every key and order |
| `kwin` | `plasma-auto-tiler-resize-outwards-up` | captured preimage, including absent/empty |
| `KDE Keyboard Layout Switcher` | `Switch to Next Keyboard Layout` | captured preimage |
| `kwin` | `plasma-auto-tiler-resize-outwards-right` | captured preimage, including absent/empty |
| `KDE Keyboard Layout Switcher` | `Switch to Last-Used Keyboard Layout` | captured preimage |

The exact in-module control labels for editing a specific entry are unverified
without launching that KCM, so do not assume a button name: select only the
listed component/action and enter the captured value. No source-verified CLI
can replay this journal, and direct `kglobalshortcutsrc` editing is not an
accepted restoration route. If the Shortcuts module cannot represent a captured
value or preserve Lock Session order, stop with the ledger and journal intact;
do not edit config files or delete the journal. Finish by stopping `just dev`
with Ctrl-C if it was started, then retain its printed combined log.
