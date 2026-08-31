# Research: Wayland-Native Revalidation of Variant B Timing Attribution (unit-D)

Status: New live measurement against the user's real running `kwin_wayland`
session, using genuinely Wayland-native test clients (konsole). Answers the
open question from `timing-attribution.md`: does the X11/XWayland attribution
for Variant B's large p95/p99/max figures hold under genuine Wayland-native
clients, shrink, or vanish?

**Verdict: the X11/XWayland attribution holds, and the X11-only cost path is
confirmed as the dominant measured cost. Under genuinely Wayland-native
clients the large figures vanish entirely: every per-event measurement, for
both genuine (CHANGE) and no-op (SAME) geometry writes, collapses to the
0-1 ms floor of the 1 ms `Date.now()` clock.** The bimodal CHANGE/SAME
pattern does not appear under Wayland because both groups now measure
sub-1 ms and are indistinguishable from the measurement floor.

## Method

### Client and spawn command

- Client: `konsole` 26.04.3 (KDE/Qt terminal, the lightest Wayland-native
  KDE client available on this host among konsole/dolphin/kate).
- Spawn command (exact, per tier): `setsid konsole --separate --desktopfile
  plasma-auto-tiler-test -e sleep 3600 >/dev/null 2>&1 &`
- `--desktopfile plasma-auto-tiler-test` overrides the default app_id so the
  window's `resourceClass` is the sentinel value `plasma-auto-tiler-test`
  instead of konsole's default `org.kde.konsole`.
- `--separate` forces a fresh konsole process per spawn so each spawn is a
  distinct window (avoids konsole's single-instance window reuse).
- `-e sleep 3600` holds the window open for a bounded hour, matching the
  xterm harness pattern; killed at teardown.
- Pacing identical to the X11 harness: 0.5 s settle between spawns, 2 s
  settle after the last spawn.
- `QT_QPA_PLATFORM` is unset on this host, so Qt/KDE apps default to the
  Wayland platform backend; this was verified before the sweep
  (`QT_QPA_PLATFORM=<unset>`, `WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`).

### Wayland-native surface-type verification

`xwininfo`, `wmctrl`, and `xdotool` are confirmed absent from this host
(re-documented in `harness/README.md` and verified again this unit), so the
X11-listing check used the X client listing that IS installed:
`xlsclients` against the running Xwayland display (`DISPLAY=:0`), plus
`xprop -root _NET_CLIENT_LIST` for cross-check. X11/XWayland clients appear
in these listings; Wayland-native clients never do.

Per-tier evidence (`tier-{20,50}-spot.txt`, captured live while N test
windows were open):

- tier-20: `winenum,count,23` (3 pre-existing real windows + 20 test),
  20 windows with `class=plasma-auto-tiler-test`, `xlsclients_lines=0`.
- tier-50: `winenum,count,53` (3 + 50), 50 windows with
  `class=plasma-auto-tiler-test`, `xlsclients_lines=0`.
- `xlsclients` output was empty in both spot files: **zero** X clients on the
  Xwayland display while 20 and 50 konsole windows were open, i.e. no test
  window was proxied through XWayland.

### Distinguishing resourceClass verification (safety precondition)

The one-shot no-mutation window-enumeration probe
(`script/window-enum-probe.js`, following the `clock-probe.js` load pattern:
`loadScript` then `start`, emit via the LogSink, then `unloadScript`) was
run before any test spawn. It found exactly 3 real windows: two
`plasmashell` (normal=false, skipped) and one user terminal
`class=com.mitchellh.ghostty` (the user's real controlling terminal). No
real konsole window was present, but the sentinel `plasma-auto-tiler-test`
is distinct from every real window's class anyway (including the user's
ghostty terminal and any future konsole defaulting to `org.kde.konsole`), so
the terminal-protection filter could never act on a real window. The smoke
test then spawned one konsole with the sentinel `--desktopfile` and re-ran
the enumeration probe: it reported `class=plasma-auto-tiler-test` (not the
default), normal=true, managed=true, and did not appear in `xlsclients`.
After teardown the window was gone from `workspace.windowList()`. Only then
was `managedResourceClass=plasma-auto-tiler-test` written to kwinrc and the
real sweep run.

### Harness

`harness/run-wayland.sh` - a parallel harness to `harness/run.sh`, same
structure: pre-flight session checks (abort on any failure), LogSink capture
via `dbus-monitor` -> FIFO -> awk demux, three RSS samples
(baseline / loaded-0-windows / loaded-N-windows) of the real `kwin_wayland`
compositor process, per-tier spot-check, teardown (kill each `setsid`
process group), unload, full reversal verification, and log-data sanity
check (`windowAdded >= N` and `windowRemoved >= N` per tier). The
`variant-b.js` script itself was loaded unmodified.

## Results

### Real-dispatch timing, `windowAdded` events

| Tier | Client | n | min | median | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|
| 20 | X11/xterm (prior) | 20 | 1 | 7.5 | 14 | 14 | 14 | 7.4 |
| 20 | Wayland/konsole | 20 | 0 | 0 | 1 | 1 | 1 | 0.3 |
| 50 | X11/xterm (prior) | 50 | 1 | 21 | 42 | 90 | 90 | 21.9 |
| 50 | Wayland/konsole | 50 | 0 | 0 | 1 | 1 | 1 | 0.3 |

### Real-dispatch timing, `windowRemoved` events

| Tier | Client | n | min | median | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|---|
| 20 | X11/xterm (prior) | 20 | 0 | 0 | 3 | 3 | 3 | 0.55 |
| 20 | Wayland/konsole | 20 | 0 | 0 | 1 | 1 | 1 | 0.15 |
| 50 | X11/xterm (prior) | 50 | 0 | 1.5 | 3 | 8 | 8 | 1.58 |
| 50 | Wayland/konsole | 50 | 0 | 0 | 1 | 1 | 1 | 0.14 |

### RSS delta (tier delta = loaded_N_windows - baseline_no_script)

| Tier | Client | baseline KB | loaded_0 KB | loaded_N KB | delta KB |
|---|---|---|---|---|---|
| 20 | X11/xterm (prior) | 303568 | 303816 | 327724 | 24156 |
| 20 | Wayland/konsole | 313932 | 314180 | 345364 | 31432 |
| 50 | X11/xterm (prior) | 303888 | 304136 | 328848 | 24960 |
| 50 | Wayland/konsole | 311804 | 312052 | 340656 | 28852 |

## Analysis

### The X11 cost vanishes under Wayland-native clients

The headline numbers for Variant B `windowAdded` drop from
median 7.5 / p95 14 / max 14 (X11, tier-20) and median 21 / p95 42 / max 90
(X11, tier-50) to median 0 / p95 1 / max 1 (Wayland, both tiers). Every
per-event measurement under Wayland reads 0 or 1 ms - the floor of the
1 ms `Date.now()` clock documented in `research/clock-resolution.md` - for
all 70 measured `windowAdded` events across both tiers. The same collapse
appears in `windowRemoved` (X11 p99 up to 8 ms at tier-50; Wayland max 1 ms).

This directly confirms the mechanism in `timing-attribution.md` Sections 2-3:
the large X11 figures were the `X11Window::updateServerGeometry()` / XCB
`ConfigureWindow` round-trip path (via Xwayland), which is X11-specific. A
genuinely Wayland-native client (`XdgSurfaceWindow`) does not pay that cost,
and `research/geometry-batching.md` Q4 independently established that the
Wayland path (`XdgSurfaceWindow::moveResizeInternal` -> scheduled
`xdg_surface.configure`) is a deferred per-window configure with no
per-write protocol round trip.

### No bimodal CHANGE/SAME pattern under Wayland

`timing-attribution.md` Section 2's bimodal CHANGE/SAME split
(CHANGE median 29 ms vs SAME median 1 ms at tier-100, X11) was reproduced
as a *classification* on the Wayland logs: at tier-20 all 20 `windowAdded`
events are CHANGE by the `floor(1536/count)` formula (width changes every
count); at tier-50, 48 CHANGE and 2 SAME. But the measured durations do not
split - both groups read 0-1 ms (tier-50 duration distribution: 78 events at
0 ms, 22 at 1 ms across both add and remove). The bimodal pattern is an
X11-only artifact of the X11 configure round trip; under Wayland-native
clients both a genuine geometry change and a no-op write measure the same
sub-1 ms cost. The distinction remains real (a CHANGE write still updates
KWin geometry) but it is no longer measurable at this clock's resolution.

### RSS

Wayland deltas (31432 KB at 20, 28852 KB at 50) are comparable to X11
(24156 KB at 20, 24960 KB at 50) - the Wayland figures are modestly larger,
not smaller. This is expected: the RSS delta includes kwin's per-window
state for the test windows themselves (a heavier Qt client than xterm, and
the script's per-window managed model), and the measurement is of the whole
`kwin_wayland` process, not the script alone. The timing collapse happens
despite a comparable or slightly larger footprint, so the timing difference
is not an artifact of the Wayland windows being cheaper to manage overall.

## Corrected calibration (non-idempotent writes)

Not attempted. An optional stretch (a config-gated
`amplifyAlternate` mode writing two alternating rects so every amplification
iteration is a genuine geometry change) requires modifying
`runAmplifiedReconcile` in `variant-b.js` plus a live load/run. The required
precondition verification, smoke test, two full tiers, and reversal verification
left no safe opportunity to run the stretch, so it remains untested rather than
being treated as an incomplete calibration. No script file was modified by this
unit.

## Verdict

- Does the X11/XWayland attribution in `timing-attribution.md` hold under
  genuine Wayland-native clients? **Yes - and it is confirmed as dominant.**
  The measured cost was X11-specific `ConfigureWindow` round trips (through
  Xwayland). Under Wayland-native clients every Variant B per-event
  measurement collapses to the 0-1 ms clock floor at both 20 and 50 windows.
- Is it smaller or does it vanish? **It vanishes within clock resolution.**
  median 0 ms, p95/p99/max 1 ms vs X11 median 7.5/21 ms and max 14/90 ms.
- The bimodal CHANGE/SAME pattern **does not appear** under Wayland; both
  groups measure at the 0-1 ms floor.
- RSS footprint is comparable or slightly higher than X11, so the timing
  collapse is not explained by lighter windows.
- Open question from `timing-attribution.md` Section 4 (whether a
  batching/deferral primitive for multi-window writes exists) is unaffected:
  `geometry-batching.md` already resolved that no cross-window batching
  exists in either backend, and this live result is consistent with the
  Wayland per-window deferred-configure path being cheap.

## Caveats

- `Date.now()` 1 ms resolution means "0/1 ms" is the measurement floor, not
  a precise sub-ms figure. The result is still decisive directionally: the
  same script, same harness structure, same N-window reconcile workload
  measured 0-1 ms under Wayland vs up to 90 ms under X11.
- The 1536 px screen width used for CHANGE/SAME classification was verified
  live (`kscreen-doctor`: eDP-1 geometry 0,0 1536x1024).
- This is a timing-log measurement only; no frame-presentation capture and
  no PipeWire/ScreenCast interaction was performed (hard rule of the unit).
- One live-session run had a cosmetic harness bug (integer-comparison error
  in the spot-check when `xlsclients` returned zero clients); it did not
  affect measurement or teardown and was fixed before the tier-50 run.
