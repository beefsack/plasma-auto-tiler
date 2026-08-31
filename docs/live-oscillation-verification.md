# Live Runtime Oscillation Verification

## Purpose

This is an executable runbook for verifying, on a real running KWin/Plasma
session, that the trailing-empty-workspace anti-oscillation design holds
under actual KWin event-loop timing, signal re-entrancy, and QML/D-Bus event
coalescing - none of which the static `node --test` suite (mocked `Harness`)
  can exercise. It closes the remaining live-runtime risk for the delivered
  trailing-empty workspace model.

Read `docs/live-kwin-testing.md` in full before running any part of this
document. It is the authoritative operational contract; this document does
  not grant mutation authorization. The script lifecycle operations are within
  the standing dogfood boundary, but every scenario's window creation, drag,
  keyboard input, and desktop mutation requires fresh explicit authorization.
  Use one disposable throwaway window on a purpose-made desktop and never touch
  the user's real windows or desktops.

## Applicability

This document has two parts:

- **Single-output scenarios (A, B, C)** - runnable on any machine, including
  a single-output laptop.
- **Multi-output scenarios (MO-1 through MO-5)** - require at least two
  physically or virtually connected outputs; MO-2 and MO-3 need three. Do
  not attempt these on a single-output machine. Run them later, on hardware
  that has the required outputs.

Each scenario below is labeled with its output requirement. A future reader
on a single-output machine runs A/B/C only and skips the rest; a future
reader on a multi-output machine runs all of them.

## Safety Rules (recap - `docs/live-kwin-testing.md` is authoritative)

- Never remove one of the user's real desktops.
- Never move one of the user's real windows.
- Never switch the user's visible desktop unexpectedly.
- Use one disposable throwaway window (a normal, resizable, Wayland-native
  test client) on a purpose-made desktop for every scenario. Never touch a
  desktop or window that existed before this runbook started.
- On any populated-desktop removal or unexpected window move: stop
  immediately, run `devenv shell --impure -- bash scripts/dogfood-install.sh
  disable`, and report before taking any further action. Do not attempt to
  diagnose further with the plugin still enabled.
- `invokeShortcut` over D-Bus bypasses the xkb layer and cannot prove
  shortcut delivery. Every shortcut step in this document is a physical
  keypress on a real keyboard, never a D-Bus `invokeShortcut` call.
- `dogfood-install.sh effect-status` stage (c) permanently reports "could
  not determine" on this project because the sandboxed process lacks
  `CAP_SYS_NICE`; this is expected, not a failure. Stage (d)
  (`isEffectSupported`) is the authoritative check for that command; it is
  informational only and not required by this document, which validates the
  KWin script path, not the native effect.
- `qdbus6` and `kwriteconfig6` are not on `PATH` outside `devenv shell
  --impure`. Every command below that needs them is already wrapped in
  `devenv shell --impure -- ...`.

## Anti-oscillation design under test

Per domain, per `cleanupDesktops()` dispatch, `ensureTrailingEmptyDesktop`
(`kwin/src/controller.ts:1683-1710`) identifies the trailing empty
structurally - last position, currently empty - and excludes it from
removal; removes every other empty and invisible desktop; re-reads state
after removal; appends exactly one desktop only if the trailing slot is now
occupied or absent; otherwise no-ops. No cache, no debounce, no timer. All
three `workspaceMode`s funnel their append through one primitive,
`appendDesktop()` (`kwin/src/controller.ts:7945`).

## Log substring reference

All diagnostics carry the fixed prefix `plasma-auto-tiler:`
(`kwin/src/controller.ts:66`).

| Substring | Meaning | Source line |
|---|---|---|
| `workspace-created-owned` | a new desktop was appended, any mode, any trigger | `controller.ts:7974` |
| `workspace-cleanup-removed:<id>` | a desktop was removed by the cleanup pass | `controller.ts:8456`, `8710`, `9116` |
| `workspace-cleanup-remove-failed:<reason>` | removal attempted and failed | `controller.ts:8459`, `8713`, `9119` |
| `workspace-append-create-failed:<reason>` / `workspace-append-created-unverified` / `workspace-append-created-unresolved` | create attempted, failed to resolve | `controller.ts:7959`, `7964`, `7970` |
| `workspace-cleanup-deferred:<reason>` | a whole cleanup pass was skipped this dispatch. Reasons: `drag-live`, `reconstruction-pending`, `move-unsettled`, `output-visibility-unknown`, `window-occupancy-unknown` | `controller.ts:8314-8368` |
| `workspace-zero-invoked` / `workspace-zero-completed` / `workspace-zero-no-op:already-there` / `workspace-zero-deferred` | Meta+0 lifecycle, `finishWorkspaceZero` | `controller.ts:7649-7817` |
| `workspace-create-deferred:move` / `workspace-move-deferred-cancelled:stale` / `workspace-move-deferred-cancelled:scope` | Meta+Shift+0 lifecycle, `finishMoveToTrailing`; its create still surfaces as `workspace-created-owned` | `controller.ts:7804`, `7858-7867` |
| `workspace-navigate-swap` / `workspace-navigate-swap-failed:<reason>` | ordinary Meta+1..9 cross-output swap-if-visible-elsewhere fired. Must NEVER appear from a trailing-empty-path trigger (Meta+0, Meta+Shift+0, or `moveActiveToWorkspace(0)`) in `global-unique` mode | `controller.ts:8926`, `8928` |
| `workspace-navigate-set` | shared-mode per-output synchronization write (hotplug or Meta+0) | `controller.ts:7588`, `7598`, `7607` |

HEALTHY: for every real trigger you see at most one `workspace-created-owned`
and/or a small number of `workspace-cleanup-removed` lines mapping 1:1 to
that trigger, then silence. Rapid repeated Meta+0/Meta+Shift+0 with no
window movement produce zero `workspace-created-owned` after the first
stabilization.

OSCILLATION (FAIL): `workspace-created-owned` and `workspace-cleanup-removed`
alternating with no new trigger between them; a `workspace-created-owned`
with no preceding real action; the Pager desktop count growing or shrinking
beyond one step per real action.

Monitoring command (run in its own terminal, left open through every
scenario, Ctrl-C to stop):

```
journalctl --user -f | grep --line-buffered 'plasma-auto-tiler:'
```

## Preconditions (read-only, record fresh results every session)

Do not enshrine any prior PID, `HEAD`, or hash as fact - each is
host-specific and time-specific. Run the following and record the actual
output before starting any scenario.

1. Identify the running KWin process:
   `pgrep -a kwin_wayland`
2. Confirm the plugin is installed and enabled:
   `devenv shell --impure -- bash scripts/dogfood-install.sh status`
    Expect `installed: yes`, `enabled: yes`. If not, stop and obtain the
    required authorization under the Safety Boundary before proceeding.
3. Confirm the installed bundle matches the current repository checkout -
   do not assume it does:
   `sha256sum ~/.local/share/kwin/scripts/plasma-auto-tiler-kwin/contents/code/main.js kwin/contents/code/main.js`
   If the hashes differ, rebuild and reinstall before proceeding:
   `devenv shell --impure -- bash scripts/dogfood-install.sh setup`
   then re-run this hash check until it matches.
4. Informational only, not a gate:
   `devenv shell --impure -- bash scripts/dogfood-install.sh effect-status`
   Stage (c) "could not determine" is expected (see Safety Rules above).
5. Record the current output configuration:
   `kscreen-doctor -o | grep '^Output:'`
6. Record the exact current desktop count and names from the Pager widget,
   and which one is the trailing empty on each output. This is the baseline
   to restore at cleanup.

The config group for this script is `Script-plasma-auto-tiler-kwin`
(confirmed by sibling groups in `~/.config/kwinrc`). The default
`workspaceMode` when unset is `per-output-local`
(`kwin/src/controller.ts:159`).

## Mode switching

```
devenv shell --impure -- bash -c 'kwriteconfig6 --file ~/.config/kwinrc --group Script-plasma-auto-tiler-kwin --key workspaceMode <mode>'
devenv shell --impure -- bash scripts/dogfood-install.sh disable
devenv shell --impure -- bash scripts/dogfood-install.sh enable
devenv shell --impure -- bash scripts/dogfood-install.sh status
```

`<mode>` is one of `per-output-local`, `global-unique`, `shared`. Restore
the default with:

```
devenv shell --impure -- bash -c 'kwriteconfig6 --file ~/.config/kwinrc --group Script-plasma-auto-tiler-kwin --key workspaceMode --delete'
devenv shell --impure -- bash scripts/dogfood-install.sh disable
devenv shell --impure -- bash scripts/dogfood-install.sh enable
```

## Single-output scenarios

These run on any machine, including a single-output laptop.

### Scenario A - rapid repeated shortcuts, no occupation

1. Switch to the current trailing empty.
2. Physically press Meta+0 five times, about 1 second apart.
   PASS: the first press logs `workspace-zero-invoked` then
   `-no-op:already-there` or `-completed`; zero `workspace-created-owned`
   across all five presses.
   FAIL: any create or remove appears.
3. Focus the throwaway window on a non-trailing desktop, physically press
   Meta+Shift+0 five times about 1 second apart.
   PASS: the window moves on the first press only; `workspace-created-owned`
   appears exactly once; the remaining presses log
   `workspace-create-deferred:move` or an equivalent no-op with no further
   creates.
   FAIL: more than one create, or a create/remove pair repeating.

### Scenario B - mixed-trigger interleaving around one real occupation

1. Throwaway window closed or off the trailing desktop, settled.
2. Within 1-2 seconds: (a) focus the throwaway window, press Meta+Shift+0;
   (b) immediately click a different Pager thumbnail; (c) immediately press
   Meta+0 once.
3. PASS: exactly one `workspace-created-owned` for the whole burst; no
   `workspace-cleanup-removed` on the desktop now holding the throwaway
   window; the Pager count grows by exactly one, once.
   FAIL: more than one create, any removal of the occupied desktop, or a net
   count change other than +1.

### Scenario C - drag onto trailing empty plus immediate unrelated event

1. Settle to baseline, throwaway window closed.
2. Open the throwaway window on a non-trailing desktop.
3. Drag its title bar onto the trailing empty desktop's Pager thumbnail.
4. Before the drop settles, click a different Pager thumbnail.
5. PASS: exactly one `workspace-created-owned`, never zero, never two.
   FAIL: zero (trailing invariant lost) or two-or-more (duplicate
   replacement).

## Multi-output scenarios

Require at least two connected outputs unless noted otherwise. Run each mode
separately using Mode switching above; restore to baseline between modes.
Every desktop-count/current-desktop claim below is derived directly from the
landed code, cited per scenario; none of it is inferred or guessed.

### MO-1 - hotplug oscillation: repeated plug/unplug of a second output

Requires two outputs, one of which can be physically or virtually
disconnected and reconnected. Run twice per mode: once with the throwaway
window left on the departing output's trailing empty when it disconnects,
once with the trailing empty left genuinely empty.

**per-output-local** (default mode). On disconnect,
`rebuildLocalMapping` (`controller.ts:8611-8658`) deletes the disconnected
output's entire local-list key (lines 8629-8633); every desktop that was in
that list becomes unassigned to any domain. The very same cleanup pass's
orphan sweep (`enforceLocalTrailingEmpties`, `controller.ts:8544-8557`)
removes any such orphaned desktop that is empty and invisible - including
the departing output's own trailing empty - with no grace period. A desktop
that still holds the throwaway window is skipped by the same sweep
(`occupied.has(id)` check, line 8553) and is never removed while occupied;
it stays present but unmanaged by any domain until the window is later
closed or moved, at which point the next real cleanup dispatch (any
trigger, any mode-consistent domain) sweeps it away.

On reconnect, the output gets its stable key back (matched by physical
tuple, `SessionOutputKeys.keyFor`, `controller.ts:438-451`) with an empty
list (nothing was preserved), so the next cleanup dispatch creates exactly
one fresh trailing empty for it (`controller.ts:8498-8500`).

PASS (empty-trailing case): each disconnect removes exactly the departing
output's own trailing empty (one `workspace-cleanup-removed`), each
reconnect creates exactly one fresh trailing empty (one
`workspace-created-owned`), and the surviving output's own list and current
desktop never change across the whole flap sequence.
PASS (occupied-trailing case): disconnect produces zero removals for the
occupied desktop; it reappears unmanaged; only after the window is closed or
moved does exactly one removal occur, on the next dispatch.
FAIL: any removal or creation on the surviving output; more than one
create/remove per individual plug or unplug event; any `workspace-created-
owned` with no preceding plug/unplug.

**global-unique**. `rebuildGlobalUniqueMapping` (`controller.ts:8983-9021`)
unassigns every desktop of a disconnecting output's group (lines 8992-8998)
and, in the very same call, folds each of those now-unassigned desktops into
the `globalUniquePrimary` output's group (lines 9000-9008) - never left
orphaned, and never treated as adopted/reusable by name; membership is
purely structural from that point on. `enforceGlobalTrailingEmpty`
(`controller.ts:9035-9065`) then removes every desktop in the merged primary
group that is not the group's own structurally-last (by `x11DesktopNumber`)
member. In the common case the primary's own true trailing empty (created
most recently, so numerically highest) remains last and the departing
output's former trailing empty is removed in this same pass. See "literal-
last-wins" in Known accepted properties below for the accepted exception.
Reconnect always creates a fresh trailing empty via
`appendDesktopForGlobalUniqueKey` (`controller.ts:8953-8959`), never an
adopted spare - regression-tested at
`kwin/tests/controller.test.ts:16192` ("a newly connected output gets a
freshly created trailing empty, never an adopted spare desktop").

PASS: same shape as per-output-local above, substituting "folded into the
primary group and removed unless structurally protected" for "orphaned and
swept"; the un-disconnected survivor's own group and current desktop never
change. If the primary output itself is the one disconnected, a new primary
is chosen from the remaining connected outputs (`controller.ts:8989-8991`) -
this is expected, not a defect; note in your run log which output was
primary before and after.
FAIL: same as per-output-local; additionally, any `workspace-navigate-swap`
during this scenario (the trailing-empty path never uses the cross-output
swap - see MO-5).

**shared**. Hotplug never creates or removes a desktop in this mode
(`controller.ts:7614-7619`); a newly connected output is synchronized onto
the current shared desktop via `synchronizeShared`
(`controller.ts:7580-7612`), and disconnect leaves the shared desktop list
untouched.
PASS: zero `workspace-created-owned` and zero `workspace-cleanup-removed`
across the entire flap sequence, in both the occupied-trailing and
empty-trailing runs; each connect logs `workspace-navigate-set` for the
newly connected output only.
FAIL: any create or remove.

### MO-2 - three or more simultaneously connected outputs

Requires three outputs connected at once (physical, or virtual/dummy outputs
if your KWin build and hardware support them - skip this scenario entirely
if you cannot bring up three outputs; do not attempt to fabricate one with
the nested-compositor recipe in `docs/live-kwin-testing.md`, which is scoped
to isolated validation spikes, not this dogfood path).

**per-output-local**. Each connected output develops its own independent
trailing empty (`enforceLocalTrailingEmpties` loops `connectedOutputKeys()`
once per output, `controller.ts:8518-8527`); regression-tested at
`kwin/tests/controller.test.ts:15531` ("three simultaneously connected
outputs each develop their own distinct, non-overlapping local trailing
empty").
PASS: connecting the third output while the other two are already settled
produces exactly one new trailing empty (one `workspace-created-owned`), and
the Pager count grows by exactly one; the two pre-existing outputs' own
trailing empties and current desktops are unaffected.
FAIL: more than one create for the new output; any change to either
pre-existing output's trailing empty or current desktop.

**global-unique**. Same shape, scoped to each output's own
`globalUniqueAssigned` group via `globalUniqueOrdered`; regression-tested at
`kwin/tests/controller.test.ts:16290` ("a third simultaneously connected
output develops its own distinct trailing empty...").
PASS/FAIL: identical to per-output-local above.

**shared**. All connected outputs share the single global trailing empty;
adding a third output never creates a new desktop, only synchronizes it onto
the current shared desktop (`controller.ts:7614-7619`); regression-tested at
`kwin/tests/controller.test.ts:16896` ("three simultaneously connected
outputs all synchronize onto the same single shared desktop...").
PASS: zero `workspace-created-owned` when the third output connects; one
`workspace-navigate-set` for it.
FAIL: any create.

### MO-3 - disconnect from three outputs to two

Requires the three-output setup from MO-2, already settled.

**per-output-local**. Disconnecting one of the three outputs removes only
that output's own empty, invisible desktops (the orphan sweep from MO-1);
the two survivors' own lists and current desktops are completely
unaffected; regression-tested at `kwin/tests/controller.test.ts:15602`
("disconnecting one of three connected outputs removes only its own empty,
invisible desktops and leaves the two survivors' local lists and current
desktops completely unaffected").
PASS: exactly the departing output's own trailing empty (and any other
empty/invisible desktops it owned) are removed; both survivors show zero
change.
FAIL: either survivor's trailing empty, other desktops, or current desktop
changes.

**global-unique**. Disconnecting one of the three outputs folds only its
own desktops into the primary group (per MO-1's global-unique mechanism);
the other, non-primary survivor's own group and current desktop are
completely unaffected; regression-tested at
`kwin/tests/controller.test.ts:16290` (same test as MO-2, covers both the
connect and the subsequent disconnect).
PASS/FAIL: same shape as per-output-local, with the literal-last-wins
exception noted in Known accepted properties applying only to the group
that receives the fold-in.

**shared**. Disconnecting one of the three stays fully synchronized on the
remaining two, with no spurious create; regression-tested at
`kwin/tests/controller.test.ts:16896` (same test as MO-2, covers both
connect and the subsequent 3-to-2 disconnect).
PASS: zero creates or removes.
FAIL: any create or remove.

### MO-4 - output replug (disconnect then reconnect the identical output)

Requires two outputs; the same physical output tuple (same name and serial,
matched by `outputTuple`/`SessionOutputKeys`, `controller.ts:388-457`) is
disconnected and then reconnected, not swapped for a different output.

**per-output-local**. The output gets its original key back; its local list
was fully cleared on disconnect (MO-1), so the next dispatch creates exactly
one fresh trailing empty for it - never an adopted pre-existing desktop;
regression-tested at `kwin/tests/controller.test.ts:15174` ("marks a removed
output's owned empties as cleanup candidates once it disconnects, and a
replug creates nothing (no replenish)" - "no replenish" refers to the
disconnect instant itself; the replenish happens on the next dispatch once
the replugged output's domain is next touched).
PASS: replug alone (no window activity) logs no create until the next real
dispatch touches that output's domain, at which point exactly one fresh
trailing empty appears; it is never one of the desktops that existed before
the disconnect.
FAIL: an existing desktop id from before the disconnect reappears as the
replugged output's trailing empty (an adoption, not a fresh create).

**global-unique**. Same shape: replug always creates a fresh trailing empty,
never adopts a spare; regression-tested at
`kwin/tests/controller.test.ts:16388` ("output replug (disconnect then
reconnect the identical output) creates a fresh trailing empty for the
returning output, never adopting a spare desktop left over from before it
disconnected").
PASS/FAIL: same as per-output-local.

**shared**. Replug never creates a desktop (MO-1's shared behavior applies
unchanged); pre-existing coverage at `kwin/tests/controller.test.ts:16719`
("hotplug adds a new output at the current shared workspace and never
creates a desktop") already covers the identical-tuple replug case.
PASS: zero creates on replug.
FAIL: any create.

### MO-5 - global-unique cross-output behavior on the trailing-empty path

`global-unique`-only; requires two outputs. Verifies that the trailing-empty
path (Meta+0, Meta+Shift+0, `moveActiveToWorkspace(0)`) never invokes the
ordinary Meta+1..9 cross-output swap (`globalUniqueSwapIfVisibleElsewhere`,
`controller.ts:8876-8932`), per the Q-Domain ruling. `finishGlobalWorkspaceZero`
(`controller.ts:7705-7724`) resolves strictly within the active output's own
`globalUniqueAssigned` group and calls `focusTrailingEmpty`
(`controller.ts:7784-7787`), which writes only the active output's own
current desktop - it never reads or writes any other output's current
desktop, and never calls the swap helper.

1. Set mode `global-unique`, two outputs (A and B).
2. On output A, physically press Meta+1 through Meta+9 a few times to
   exercise ordinary navigation (informational baseline only - confirms the
   swap path itself still works normally when it is supposed to; not part
   of this scenario's pass/fail).
3. Focus output B (click into it or focus a window there) and note its
   current desktop visually.
4. Focus output A and physically press Meta+0.
5. PASS: `workspace-zero-invoked` then `-completed` or
   `-no-op:already-there`; zero `workspace-navigate-swap` in the log for
   this press; output B's visible current desktop is unchanged.
   FAIL: `workspace-navigate-swap` appears, or output B's visible desktop
   changes.
6. Repeat step 3-5 using Meta+Shift+0 on A instead (with the throwaway
   window focused there first), and again using ordinary navigation
   (`Meta+1..9`) on A targeting the same index as A's own trailing empty
   position, to confirm the trailing-empty resolution path specifically
   (not general navigation) never swaps.

## Known accepted properties - report as EXPECTED, not a failure

- **literal-last-wins** (global-unique disconnect only). If the
  disconnected output's former trailing empty carries a HIGHER
  `x11DesktopNumber` than the primary survivor's own true trailing empty,
  `globalUniqueOrdered`'s ascending sort makes the folded-in desktop the
  structurally-last (protected) member instead of the survivor's own
  trailing empty, so the survivor's own trailing empty is removed like any
  other non-trailing empty desktop and the folded-in one is kept. This is
  accepted, not a defect; regression-tested at
  `kwin/tests/controller.test.ts:16213`). Self-healing: once a window
  occupies the protected-but-"wrong" desktop, the group's last position
  becomes occupied and the next cleanup dispatch appends exactly one new
  trailing empty, converging back to the single-trailing invariant. Expect
  this in MO-1 and MO-3 whenever the departing/disconnected output's
  desktop happens to have a higher number than the survivor's; do not
  report it as a bug. Record which desktop was protected and confirm it
  self-heals on the next occupation before moving on.
- **Q-Zero**: Meta+0 is a no-op (`workspace-zero-no-op:already-there`) when
  the active output is already showing its own trailing empty. Expected in
  Scenario A step 2 and throughout.
- **Q-Manual**: a manually created empty workspace not in the trailing
  position stays cleanup-eligible while invisible and self-heals to exactly
  one trailing spare on the next dispatch. If you manually create a desktop
  via the Pager during any scenario, expect it to be swept on the next
  cleanup dispatch unless it becomes the new trailing empty.
- **Q-Pager**: the trailing empty appears normally in the Pager widget, like
  any other desktop. This is expected, not a leak.

## Abort

Stop pressing anything. Run:

```
devenv shell --impure -- bash scripts/dogfood-install.sh disable
```

Report before taking any further action. Restore with
`scripts/dogfood-install.sh enable` only after the report is reviewed.

## Cleanup

1. Close every throwaway window entirely.
2. Do NOT manually delete any desktop. Click a Pager thumbnail to trigger a
   cleanup pass and confirm self-removal of any leftover script-owned
   desktop (failure to self-remove is itself a finding - leave it in place
   and report it, do not delete it manually).
3. Restore `workspaceMode` to its original value (or delete the override if
   it was unset at the start) using Mode switching above.
4. Ctrl-C the journal monitor.
5. Compare the Pager against the baseline recorded in Preconditions step 6;
   every output should show the same desktop count and names it started
   with (plus or minus exactly the throwaway desktops this run legitimately
   created and then let self-clean).
