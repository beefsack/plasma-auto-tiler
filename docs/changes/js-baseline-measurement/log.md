# Log: JS Baseline Measurement (KWin windowAdded pop-in and overhead)

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-09 (spec/plan)

- Role / unit: Lead / spec.md+plan.md / -
- Result: Spec approved by user via Orchestrator with the Variant B
  (stateful) amendment applied. Plan restructured into non-invasive units
  (unit-01..04) cleared to proceed, and live-session units (unit-05, unit-06)
  gated on a fresh Orchestrator authorization per the mandatory stop
  instruction.
- Files / commit: `spec.md`, `plan.md` (not yet committed)
- Verification: ASCII-only check (`grep -P` for em dash/smart quotes/ellipsis)
  passed on both files.
- Notes: No live-session or invasive work performed yet.

## 2026-08-09 (unit-01)

- Role / unit: Worker / unit-01 / attempt-01
- Result: accepted. PipeWire ScreenCast via xdg-desktop-portal-kde is viable
  with caveats for the Q1 capture method: one-time human consent required to
  mint a restore token (proven from installed backend 6.7.3 source), then
  unattended thereafter; gst-launch-1.0 pipewiresrc is the only viable
  PipeWire video consumer on this host (ffmpeg has no pipewire support,
  pw-record/pw-cat are audio-only); frame-integrity check vs 60 Hz needed to
  distinguish true negative from a missed transient.
- Files / commit: docs/changes/js-baseline-measurement/research/capture-method.md
  (new; not committed)
- Verification: ASCII-only check passed; git status confirms no file outside
  docs/changes/js-baseline-measurement/research/ was touched; `qdbus
  org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping` exit 0 post-unit.
- Notes / incident: a broadly-authorized non-interactive
  `ScreenCast.CreateSession` D-Bus probe crashed `xdg-desktop-portal` 1.20.4
  (SEGV, known upstream bug flatpak/xdg-desktop-portal#1747). systemd
  auto-restarted it; portal, KWin, and portal-kde backend all verified
  responsive afterward. kwin_wayland itself was never called by this unit.
  Flagged to Orchestrator. Implication recorded for unit-05: must not
  hand-roll raw D-Bus portal calls with arbitrary tokens; use a proper
  portal client.

## 2026-08-09 (unit-02)

- Role / unit: Worker / unit-02 / attempt-01
- Result: accepted. Variant A script written (windowAdded handler: normal/
  managed-window filter, O(1) rectangle from the triggering window's own
  output geometry only, no persistent counter, one frameGeometry write,
  Date.now() start/end timestamps, one fire-and-forget callDBus log call).
  Discovery: KWin's loadScript QJSEngine has no filesystem API and no Qt
  global; log lines are emitted via callDBus to a reserved sink interface
  (com.plasmaAutoTiler.LogSink) which the unit-04 harness must capture
  (dbus-monitor or an owned service). Log format (shared with Variant B):
  `windowAdded,<internalId>,<start-ms>,<end-ms>,<elapsed-ms>` CSV at
  /tmp/plasma-auto-tiler/variant-a.log.
- Files / commit: docs/changes/js-baseline-measurement/script/variant-a.js,
  docs/changes/js-baseline-measurement/README.md (new; not committed)
- Verification: `node --check` syntax OK (syntax-only, does not validate
  KWin globals); ASCII-only check passed; Lead independently verified
  workspace.windowAdded, window.normalWindow/managed/internalId/output,
  frameGeometry read-write, and callDBus's documented async semantics
  against the official KWin 6.0 scripting API docs (develop.kde.org) -
  all match; official global-function list confirms no file-write API,
  corroborating the DBus-log-sink design.
- Notes: no live load, no window spawned (per unit scope). Live load/unload
  smoke test deferred to unit-05.

## 2026-08-09 (unit-03)

- Role / unit: Worker / unit-03 / attempt-01
- Result: accepted. Variant B script written: own managed-window map keyed
  by internalId (never re-derives from workspace.windowList()), populated/
  depopulated on windowAdded/windowRemoved, same normal/managed filter as
  Variant A. Both signals trigger reconcile() over the maintained model:
  columns layout (N equal-width columns), one frameGeometry write per
  currently-managed window, exactly one log line per triggering event
  (event-type field is "windowAdded" or "windowRemoved", distinct values).
  Reuses Variant A's log-sink contract exactly, different path
  (/tmp/plasma-auto-tiler/variant-b.log).
- Files / commit: docs/changes/js-baseline-measurement/script/variant-b.js
  (new), docs/changes/js-baseline-measurement/README.md (extended; not
  committed)
- Verification: Lead independently re-ran `node --check` on variant-b.js
  (syntax OK) and confirmed variant-a.js still parses (untouched); ASCII-only
  grep clean on both changed files; code inspection confirms N geometry
  writes vs 1 log line per event, matching spec's Variant B requirement.
- Notes: no live load, no window spawned. Spec's two Unresolved-Questions
  items (layout algorithm choice, removal-event logging) both resolved and
  documented in README rather than left implicit.

## 2026-08-09 (clock-resolution probe, live session)

- Role / unit: Worker / clock-resolution probe (authorized live-session work)
  / attempt-01
- Result: empirically probed the live KWin 6.7.3 loadScript QJSEngine.
  Findings: NO higher-resolution clock exists (no performance, no process,
  no globalThis; Date.now() strictly 1 ms integer steps, 100k iterations,
  28 distinct values, min/max step 1 ms). console and QTimer confirmed
  present (README claims verified). loadScript does NOT evaluate top-level
  code; org.kde.kwin.Scripting.start runs it (re-calling start() verified
  not to re-run). Implication: variant scripts need load+start; Q2
  thresholds not resolvable by JS wall clock.
- Files / commit: script/clock-probe.js (new),
  research/clock-resolution.md (new), README.md (manual-recovery section),
  log.md (this entry); not committed
- Verification: node --check passed on clock-probe.js; ASCII-only grep clean
  on all three authored files; dbus-monitor capture path proven live via a
  controlled ServiceUnknown method call; script loaded, ran (201 facts
  emitted via callDBus to com.plasmaAutoTiler.LogSink), unloaded; all three
  plugin names isScriptLoaded=false afterward; `qdbus org.kde.KWin /KWin
  org.freedesktop.DBus.Peer.Ping` exit 0 post-cycle; no dbus-monitor left
  running.
- Notes / incident: none. Manual-recovery commands (qdbus and busctl
  unloadScript) verified returning false/exit 0 against an unloaded name
  before any live load.

## 2026-08-09 (unit-02/unit-03 amendment: synthetic amplification)

- Role / unit: Worker / unit-02 + unit-03 (Lead-directed amendment,
  implementing the Orchestrator's timing-resolution amplification
  requirement) / attempt-01
- Result: added an opt-in, OFF-by-default synthetic amplification
  measurement to variant-a.js and variant-b.js, per the Orchestrator's
  instruction: keep per-event Date.now() timing for the real-dispatch
  distribution AND add an amplified measurement (execute the handler's
  compute body K times per event, bounded, then divide) reported as a
  clearly-labelled synthetic figure in a separate log, never merged into the
  real distribution. Enabled by readConfig("amplify","0") !== "0", read once
  per handler invocation after the real log line is emitted. Loop reuses
  clock-probe's bounded bailout pattern (Date.now()-based wall-time guard
  checked every 64 iterations, config caps amplifyMaxMs default 20 and
  amplifyMaxIterations default 5000); whole loop timed, divided by iteration
  count, divide-by-zero guarded (0 reported, no throw). Real-dispatch
  measured interval (start/end Date.now() around the compute/write) is
  byte-for-byte unchanged in both files: pre/post extraction of the measured
  blocks diff clean and sha256-identical. Amplification logged to separate
  files (/tmp/plasma-auto-tiler/variant-a-amplified.log,
  variant-b-amplified.log) via the same LogSink contract, demuxed by a
  source-tag prefix (amplified-a,/amplified-b,) in the first CSV field, since
  the sink carries no target-file encoding; documented in README. Idempotency
  confirmed for both variants (variant-a: identical rect writes each pass;
  variant-b: reconcile() derives geometry only from the unchanged
  managed-window model and output). kwinrc group for direct-loaded scripts
  established as Script-<pluginName> from KWin source
  (AbstractScript::config()) and documented with the tutorial citation.
- Files / commit: script/variant-a.js, script/variant-b.js (modified),
  README.md (new "Synthetic amplification measurement" section), log.md (this
  entry); not committed
- Verification: `node --check` exit 0 on both modified scripts (syntax only,
  does not validate KWin globals, same caveat as the existing scripts);
  ASCII-only grep clean on all touched files; pre/post diff confirms only
  additions outside the measured interval (variant-a: new top-level
  functions plus an if-block after the real callDBus; variant-b: guard
  constant plus an if-block after the real callDBus inside logEvent plus new
  functions); no new code executes between the existing start/end Date.now()
  calls in either variant.
- Notes / incident: none. Non-invasive: no script loaded, no window spawned;
  live smoke test deferred to unit-05/unit-06. This entry records a
  Lead-directed amendment to the accepted unit-02/unit-03 deliverables, not a
  new work unit.

## 2026-08-09 (unit-02/unit-03 safety amendment: terminal-protection scope restriction + fail-safe watchdog)

- Role / unit: Worker / unit-02 + unit-03 (Lead-directed, Orchestrator-mandated
  safety amendment to the accepted unit-02/unit-03 deliverables, which were
  already amended once for amplification) / attempt-01
- Result: added two mandatory safety mechanisms to variant-a.js and variant-b.js
  so live sweeps (unit-05/unit-06) can run without endangering the controlling
  terminal or leaving window management captured indefinitely. (1)
  resourceClass filter: each script acts only on windows whose resourceClass
  exactly matches the config key managedResourceClass (default sentinel
  "__unset__": unconfigured means inert, not permissive), read once at top
  level; added as the first guard in the add handler in both variants and also
  gating variant-b's handleWindowRemoved (defense in depth: removal already
  implicitly scoped via the managedWindows map, but resourceClass can
  theoretically change between add and remove - KWin documents a
  windowClassChanged signal). (2) fail-safe watchdog: a single-shot QTimer
  instance (new QTimer(); KWin 6.7.3 exposes its ScriptTimer via newQMetaObject,
  verified in src/scripting/scripting.cpp; QTimer.singleShot static absent,
  not used) started at script start with interval watchdogMaxLifetimeMs
  (default 300000), firing after the lifetime to disconnect workspace.windowAdded
  (and, variant-b, windowRemoved) and emit watchdog-a/watchdog-b,fired,<elapsed-ms>
  through the same LogSink; disconnect is the correct self-unload mechanism
  because a script cannot call unloadScript on itself (Scripting D-Bus method
  only, never a JS global). Real-dispatch measured interval (start/end
  Date.now()) byte-for-byte unchanged in both files: pre/post extraction of
  the measured blocks diff clean and sha256-identical.
- Files / commit: script/variant-a.js, script/variant-b.js (modified),
  README.md (config-keys table extended with managedResourceClass and
  watchdogMaxLifetimeMs; new "Terminal-protection scope restriction" and
  "Fail-safe watchdog" subsections; filter/demux/API-notes sections updated),
  log.md (this entry); not committed
- Verification: `node --check` exit 0 on both modified scripts (syntax only,
  does not validate KWin globals, same caveat as the existing scripts);
  ASCII-only grep clean on all touched files (script/variant-a.js,
  script/variant-b.js, README.md, log.md); pre/post measured-block extraction
  diff clean and sha256-identical for both variants; resourceClass guard
  confirmed as the first evaluated condition in both variants' add handlers
  and in variant-b's removal handler.
- Notes / incident: none. Non-invasive: no script loaded, no window spawned;
  live load/unload smoke test deferred to unit-05/unit-06. Deliberate deviation
  from the originally-scoped "any normal/managed window" behavior is recorded
  in README and flagged for the unit-07 findings report (validity implications:
  realistic for the harness's own synthetic windows; guaranteed-ignored real
  windows are the intended safety property, not a measurement artifact). This
  entry records a Lead-directed safety amendment to the accepted
  unit-02/unit-03 deliverables, not a new work unit.

## 2026-08-09 (unit-04)

- Role / unit: Worker / unit-04 / attempt-01
- Result: harness built and dry-run-verified. `harness/run.sh` takes
  `--variant a|b`, `-n <count>` (any positive integer), and `--dry-run`;
  dry-run prints the exact numbered command sequence for a run without
  executing any of it; non-dry-run mode is written (not run here) for
  unit-05/06. Design choices recorded in `harness/README.md`.
- Files / commit: docs/changes/js-baseline-measurement/harness/run.sh (new),
  docs/changes/js-baseline-measurement/harness/README.md (new), log.md (this
  entry); not committed
- Verification: 8 dry-run invocations (variants a,b x N=5,20,50,100) all exit
  0; spawn-line count in each trace equals N; b-variant renders plugin
  plasma-auto-tiler-variant-b and variant-b.log correctly; grep of script and
  all 8 outputs confirms no mutating call fired (no real qdbus mutating call,
  no real xterm spawn, no real kwriteconfig6 write - dry-run prints only);
  `bash -n harness/run.sh` syntax OK; offline fixture test of the awk demux
  (all routing cases incl. amplified-a/amplified-b tags and watchdog line) and
  of the FIFO/stdbuf/fflush plumbing pass; post-unit state verified: no
  scripts loaded (all three plugin names false), kwin_wayland Ping exit 0, no
  stray dbus-monitor/xterm processes, `/tmp/plasma-auto-tiler/` unchanged
  (only pre-existing clock-probe artifacts), kwinrc Script-* keys unset
  (managedResourceClass and amplify both empty via kreadconfig6). ASCII-only
  grep clean on all three authored files.
- Notes / discoveries: (1) `pgrep -x kwin_wayland` returns nothing on this
  host - comm names are 15-char truncated and dot-prefixed
  (`.kwin_wayland-w` compositor, `.kwin_wayland_w` wrapper); the working
  discriminator is `pgrep -f '[k]win_wayland --'` (verified: uniquely returns
  the real compositor PID 2532, ~270 MB RSS, excluding wrapper 2527, ~21 MB).
  (2) RSS sample points: three per run (no-script baseline, loaded-zero-
  windows, loaded-N-windows); tier delta = loaded-N minus baseline per my
  reading of the spec AC wording, with the middle point kept to split load
  cost from per-window growth. (3) Test window = `setsid xterm -class
  PlasmaAutoTilerTestWindow -e sleep 3600`; class string is the single source
  of truth for both the kwinrc `managedResourceClass` write and the xterm
  `-class`. (4) Capture = dbus-monitor (proven filter) piped through a FIFO
  into an awk demux (first-CSV-field routing), with `stdbuf -oL` on
  dbus-monitor and awk `fflush()` per line so no buffered tail is lost at
  teardown. (5) `wmctrl`/`xdotool`/`xwininfo` absent on this host, so leak
  verification is process-based (`pgrep -f` on the exact xterm command line).
  (6) Only `managedResourceClass` is written; amplify and
  watchdogMaxLifetimeMs stay at defaults (amplification is a separate
  calibration pass). (7) Real mode not executed (non-invasive scope); unit-05
  smoke test is its first live execution and must confirm resourceClass
  matching before the full sweep.
- Notes / incident: none. No script loaded, no window spawned, no config
  written, no log file created by this unit.

## 2026-08-09 (successor-Lead session handover checkpoint)

- Role / unit: Lead (successor) / session summary / -
- Result: Successor Lead accepted prior state (unit-01/02/03) and completed,
  in order: (1) clock-resolution probe (live, accepted), revealing no
  higher-resolution clock exists and that `loadScript` does not run a
  script's top-level code without a following `Scripting.start()` call --
  the latter finding required a correction to README's load/unload
  instructions for both variants, applied directly by this Lead; (2)
  synthetic amplification measurement added to both variant scripts
  (non-invasive, accepted); (3) terminal-protection resourceClass filter and
  fail-safe watchdog added to both variant scripts per the Orchestrator's
  mandatory live-session conditions (non-invasive, accepted, watchdog
  mechanism sourced from actual KWin 6.7.3 source, not guessed); (4) unit-04
  harness with dry-run mode (non-invasive, accepted). plan.md Progress
  updated to reflect unit-04 complete and to list the timing-resolution work
  pending a formal spec.md/plan.md addition (not yet made -- Orchestrator
  approval required first, per the successor-Lead brief).
- Files / commit: script/clock-probe.js, research/clock-resolution.md,
  README.md (load/unload correction, amplification section, terminal-
  protection section, watchdog section, manual-recovery section),
  script/variant-a.js, script/variant-b.js (both amended twice: amplification,
  then resourceClass filter + watchdog), harness/run.sh, harness/README.md,
  plan.md (Progress section), log.md; none committed to git.
- Verification: each unit independently re-verified by this Lead directly
  (not only trusting Worker reports): `node --check`/`bash -n` re-run on
  every script, ASCII-only greps re-run, live `isScriptLoaded`/Ping re-run
  after every live-touching unit, a `pgrep` self-match false-positive caught
  and confirmed harmless (same class of false positive the clock-probe
  Worker had already flagged), `git status` confirms nothing outside
  `docs/changes/js-baseline-measurement/` was touched this session.
- Notes / decision pending: unit-05 (Variant A live sweep), unit-06
  (Variant B live sweep), and unit-07 (findings report) are not started.
  Q1's frame-capture procedure (research/capture-method.md section 9)
  requires one interactive human consent click in KWin's ScreenChooserDialog
  to mint a portal restore token -- this cannot be performed by an agent and
  requires either the user's direct interaction or an explicit decision to
  skip Q1 capture and document it as unavailable per the spec's own
  acceptance-criterion fallback. This Lead is reporting to the Orchestrator
  before proceeding into the live sweep given its scale (8 run combinations,
  each spawning up to 100 real windows) and this open blocker, per the
  handover's own guidance to prefer an honest checkpoint over rushing.

## 2026-08-09 (spec.md/plan.md formalization)

- Role / unit: Lead / spec.md+plan.md amendment / -
- Result: Orchestrator approved both pending decisions. Wrote the approved
  "Timing Resolution and Live-Session Safety Amendment" section into
  spec.md (clock-resolution finding, the 0.4-1.5 ms unresolvable band as an
  explicit Q2 caveat, the synthetic amplification figure as a separately-
  labeled metric never merged into the real-dispatch distribution, and the
  terminal-protection deviation with its validity impact stated as a safety
  control, not a sampling choice). Extended the Acceptance Criteria caveats
  bullet accordingly. Added unit-04a to plan.md's Work Units table
  (retroactively, since the work was already done and accepted this
  session) and updated unit-05/unit-06/unit-07's Depends-on and scope text
  to reference it. Updated Progress checklist.
- Files / commit: spec.md, plan.md; not committed.
- Verification: ASCII-only grep clean on both files after edit.
- Notes: proceeding next to unit-05's smoke test per Orchestrator
  instruction (real-mode harness has never executed; smallest possible real
  case first, before committing to the full sweep). Q1's interactive
  consent dialog will NOT be triggered until a separate stop-and-report to
  the Orchestrator, per its explicit instruction, describing exactly what
  will appear on screen first.

## 2026-08-09 (unit-05/unit-06 live smoke test, both variants, N=1)

- Role / unit: Worker / unit-05+unit-06 smoke test / attempt-01
- Result: BOTH variants passed the real-mode N=1 smoke test end-to-end.
  Real-dispatch instrumentation is verified live, not just assumed: each
  spawned window produced exactly one `windowAdded` line (Variant B also one
  `windowRemoved` line on teardown), with plausible 0-1 ms elapsed on the
  1 ms clock, and live geometry readback via `org.kde.KWin.getWindowInfo`
  confirmed the spawned window was actually placed by the script (Variant A:
  left half of the 1536x1024 output = 768x1024; Variant B at N=1: full-width
  single column = 1536x1024, matching `reconcile()`'s columns formula).
  Clean session state before and after each run; full sweep (5/20/50/100)
  can proceed in the next unit.
- Files / commit: no source files changed (verification unit only); new
  data artifacts in /tmp/plasma-auto-tiler/: variant-a.log, variant-b.log,
  variant-a-amplified.log (0 bytes), variant-b-amplified.log (0 bytes),
  rss-a-1.txt, rss-b-1.txt; log.md (this entry); not committed
- Verification per variant, in order:
  - Pre-flight before each run: all three plugin names `isScriptLoaded`
    false; `org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping` exit 0;
    no stray `xterm -class PlasmaAutoTilerTestWindow`; no stray dbus-monitor
    LogSink capture (an initial unbracketed `pgrep -f 'dbus-monitor.*LogSink'`
    hit was confirmed to be a self-match from the probe's own command line,
    not a real process; bracketed/`ps`-based re-check showed none).
  - Variant A run: `bash docs/changes/js-baseline-measurement/harness/run.sh
    --variant a -n 1` exit 0. `variant-a.log` exactly one line:
    `windowAdded,{71abb42a-6d38-4800-9139-537ad77a5e05},1786257122612,1786257122613,1`.
    RSS: baseline 270692, loaded-0 270940, loaded-1 276044 KB (all distinct,
    delta +5352 KB). Amplified log empty (amplify off).
  - Variant B run: same harness, `--variant b -n 1`, exit 0. `variant-b.log`
    exactly two lines (same internalId):
    `windowAdded,{58e559df-1508-4d3c-a316-27d9a67ea569},1786257395155,1786257395156,1`
    and
    `windowRemoved,{58e559df-1508-4d3c-a316-27d9a67ea569},1786257398635,1786257398635,0`.
    RSS: baseline 272132, loaded-0 272380, loaded-1 282372 KB (all distinct,
    delta +10240 KB). Amplified log empty (amplify off).
  - Placement confirmation (read-only): re-ran a controlled load/spawn/query/
    teardown per variant using `org.kde.KWin.getWindowInfo(<internalId>)`
    while the test window was alive. Variant A live geometry: x=0 y=0
    w=768 h=1024 (left half of output; KWin default placement is not
    half-width-at-origin). Variant B live geometry: x=0 y=0 w=1536 h=1024
    (full output width, the N=1 columns result). Both confirm the script's
    frameGeometry write actually moved the window, not just that the handler
    ran.
  - Reversal after every live step (harness runs and both placement checks):
    `isScriptLoaded` false for all plugin names, KWin Ping exit 0, no leaked
    test windows (bracketed `pgrep -f '[x]term -class
    PlasmaAutoTilerTestWindow'`), no leftover dbus-monitor/demux processes,
    sink.fifo removed, no `watchdog-*` lines in either log (watchdog never
    fired; lifetime untouched at default 300000 ms).
  - kwinrc: `managedResourceClass` left set to `PlasmaAutoTilerTestWindow`
    for both plugin groups (by harness design; it is idempotent across
    runs); `amplify` unset (default "0"); `watchdogMaxLifetimeMs` unset
    (default "300000"). No other kwinrc changes.
- Notes / incident: none. No source modifications were required; the
  resourceClass filter matched the spawned xterm exactly (confirmed by the
  log lines appearing only after spawn and by the live resourceClass field
  readback), so the terminal-protection guard is effective. Placement
  evidence is from `getWindowInfo` (window x/y/w/h fields), a read-only KWin
  D-Bus method; no portal/ScreenCast/Q1 work was touched. Scrutiny per the
  Orchestrator's "implausibly clean data is suspect" instruction: the single
  and only `windowAdded` line per spawn rules out both inert-script (would
  be zero lines) and over-logging (multiple lines) failure modes, and the
  RSS values being all-distinct rules out a degenerate no-change baseline.
  Remaining caveat for the full sweep, unchanged from prior units: 1 ms
  clock means per-event elapsed is 0 or 1 ms by construction.

## 2026-08-09 (unit-05, Variant A full sweep + synthetic amplification calibration)

- Role / unit: Worker / unit-05 / attempt-01
- Result: Variant A 4-tier real sweep completed cleanly (N=20, 50, 5, 100 in
  that order) plus the one-off synthetic amplification calibration pass.
  Every tier produced exactly N `windowAdded` lines, no watchdog lines, empty
  amplified log, exit 0. Per-tier distribution (elapsed ms, field 5):
  N=5: 5 events, all 1-2 ms, min=1 med=1 p95=2 p99=2 max=2, 0 at 0 ms;
  N=20: 20 events (15x1, 5x2), min=1 med=1 p95=2 p99=2 max=2, 0 at 0 ms;
  N=50: 50 events (1x0, 41x1, 8x2), min=0 med=1 p95=2 p99=2 max=2, 1 at 0 ms;
  N=100: 100 events (4x0, 76x1, 20x2), min=0 med=1 p95=2 p99=2 max=2, 4 at 0 ms.
  No event in any tier exceeded 2 ms. RSS tier delta (harness convention
  loaded_N - baseline_no_script): N=5 +18168 KB, N=20 +66952 KB, N=50
  +173840 KB, N=100 +344048 KB. Delta is dominated by KWin's own per-window
  state (~3.3-3.6 MB/window, consistent across all tiers and the N=1 smoke
  test); pure script-load cost (loaded_0 - baseline) is ~248-252 KB at every
  tier; RSS returned toward baseline after each teardown, confirming the
  delta is window-driven, not a script leak. Amplification calibration: 3
  amplified lines, all `wallcap` (20 ms cap binding; iteration cap 5000 never
  hit), iterations 2752/3136/3200, per-op-ms 0.007267/0.006378/0.00625
  (mean 0.006632, min 0.006250, max 0.007267); config reset to amplify=0
  immediately after and read back verified as "0".
- Files / commit: docs/changes/js-baseline-measurement/results/variant-a/
  tier-5.log, tier-5-rss.txt, tier-20.log, tier-20-rss.txt, tier-50.log,
  tier-50-rss.txt, tier-100.log, tier-100-rss.txt, amplified-calibration.log
  (new; raw per-tier data only, no interpretation), log.md (this entry); not
  committed
- Verification per tier: variant-a.log line count == N exactly (verified
  before each next tier), event type all `windowAdded`, no watchdog lines,
  amplified log 0 bytes (amplify off for all tiers), RSS file three plausible
  non-identical values; reversal after every run (isScriptLoaded false, KWin
  Ping exit 0, bracketed `pgrep -f '[x]term -class
  PlasmaAutoTilerTestWindow'` no match). Amplified calibration line count 3
  == 3 spawned windows, matching internalIds across amplified and
  real-dispatch logs; config reset to 0 read back via kreadconfig6 after
  `qdbus org.kde.KWin /KWin reconfigure`; post-calibration reversal verified
  (isScriptLoaded false, Ping OK, no leaked windows, no leftover dbus-monitor).
  ASCII-only and session state confirmed: variant-a amplify=0, variant-b
  amplify unset, watchdogMaxLifetimeMs unset, no scripts loaded, no stray
  processes.
- Notes / incident: none. All 175 measured events (5+20+50+100) read 0-2 ms
  on the 1 ms clock; p95/p99 = 2 ms at every tier. That sits at the edge of
  the clock's resolvable band (the spec's ~1.67 ms threshold is inside the
  0.4-1.5 ms unresolvable range, and 2 ms reads are just above it) - reported
  as raw data for unit-07 to interpret against the Decision Rule, not
  interpreted here. Q1/portal/ScreenCast flow untouched, per authorization.

## 2026-08-09 (unit-06, Variant B full sweep + synthetic amplification calibration)

- Role / unit: Worker / unit-06 / attempt-01
- Result: Variant B 4-tier real sweep completed cleanly (N=20, 50, 5, 100 in
  that order) plus the one-off synthetic amplification calibration pass.
  Every tier produced exactly N `windowAdded` lines AND exactly N
  `windowRemoved` lines (2N total), every add/remove pair matched on
  internalId, no watchdog lines, empty amplified log during the sweep
  (amplify off), exit 0. Per-tier distribution (elapsed ms, field 5):
  - N=5: adds n=5 min=2 med=3 p95=4 p99=4 max=4 (0 at 0 ms);
    removes n=5 min=0 med=0 p95=1 p99=1 max=1 (3 at 0 ms);
    pooled n=10 min=0 med=1.5 p95=4 p99=4 max=4 (3 at 0 ms).
  - N=20: adds n=20 min=1 med=7.5 p95=14 p99=14 max=14 (0 at 0 ms);
    removes n=20 min=0 med=0 p95=3 p99=3 max=3 (11 at 0 ms);
    pooled n=40 min=0 med=1.5 p95=14 p99=14 max=14 (11 at 0 ms).
  - N=50: adds n=50 min=1 med=21 p95=42 p99=90 max=90 (0 at 0 ms);
    removes n=50 min=0 med=1.5 p95=3 p99=8 max=8 (9 at 0 ms);
    pooled n=100 min=0 med=3 p95=42 p99=90 max=90 (9 at 0 ms).
  - N=100: adds n=100 min=0 med=11.5 p95=95 p99=526 max=526 (7 at 0 ms);
    removes n=100 min=0 med=2 p95=7 p99=14 max=14 (14 at 0 ms);
    pooled n=200 min=0 med=2 p95=72 p99=149 max=526 (21 at 0 ms).
  - RSS tier delta (harness convention loaded_N - baseline_no_script):
    N=5 +15672 KB, N=20 +24156 KB, N=50 +24960 KB, N=100 +28880 KB. Pure
    script-load cost (loaded_0 - baseline) = 248 KB at every tier, matching
    Variant A's ~248-252 KB. RSS returned toward baseline after each
    teardown. Amplification calibration (N=5, amplify=1): 10 amplified
    lines = exactly 2 per window (one per add, one per remove), confirming
    Variant B's amplification fires on BOTH triggers as designed. All
    `wallcap` except the final 0-window reconcile which hit `iterationcap`
    (5000 iterations, 1 ms, per-op 0.0002). Per-op-ms scales with the
    then-managed window count: 0.00601 (1-window reconcile), 0.011161 (2),
    0.017361 (3), 0.020833 (4), 0.026042 (5), then 0.024038/0.018382/
    0.012019/0.006563 on the shrinking removals. NOTE: Variant B's per-op-ms
    is the cost of one full reconcile() pass over the calibration tier's
    window count (N geometry writes), NOT Variant A's single-window compute;
    the two are not directly comparable without that caveat. Cross-check:
    Variant B's 1-window reconcile per-op 0.00601 ms vs Variant A's
    single-write per-op mean 0.006632 ms - consistent, both measure the same
    base write cost. Config reset to amplify=0 immediately after and read
    back verified as "0".
- Files / commit: docs/changes/js-baseline-measurement/results/variant-b/
  tier-5.log, tier-5-rss.txt, tier-20.log, tier-20-rss.txt, tier-50.log,
  tier-50-rss.txt, tier-100.log, tier-100-rss.txt, amplified-calibration.log
  (new; raw per-tier data only, no interpretation), log.md (this entry); not
  committed
- Verification per tier: variant-b.log line count == 2N exactly (N
  `windowAdded` + N `windowRemoved`), verified before each next tier; add/
  remove internalId pairing complete for every tier; event types only
  `windowAdded`/`windowRemoved`; no watchdog lines; amplified log 0 bytes
  during sweep; RSS file three plausible non-identical values; reversal
  after every run (isScriptLoaded false, KWin Ping exit 0, bracketed
  `pgrep -f '[x]term -class PlasmaAutoTilerTestWindow'` no match, no
  leftover dbus-monitor/awk demux, sink.fifo removed). Amplified calibration
  id sets match the real-dispatch log exactly (5 unique ids, 2 amplified
  lines each); config reset to 0 read back via kreadconfig6 after
  `qdbus org.kde.KWin /KWin reconfigure`; post-calibration reversal verified.
  ASCII-only and session state confirmed: variant-a and variant-b amplify=0,
  no scripts loaded, no stray processes, kwin_wayland responsive.
- Notes / discovery (reported for unit-07 interpretation, not interpreted
  here): Variant B add times are BIMODAL and grow with N, unlike Variant A's
  flat 0-2 ms. Mechanism identified and verified against every add in every
  tier: with columns layout width `Math.floor(output.width / count)`, the
  column width is unchanged for many consecutive counts at large N (e.g.
  1536/50 = 1536/51 = 30). On a same-width add, reconcile() writes identical
  geometry to all existing windows, which KWin's moveResize processes as
  no-ops, so only the new window's write is real work and the read is ~1 ms;
  on a width-change add, all N windows change and the full N-write reconcile
  cost is read. Width-change-only adds: N=5 n=5, N=20 n=20 (all adds;
  1536/k distinct up to k=20), N=50 n=48 (med 22.5 p95 42 p99 90 max 90),
  N=100 n=63 (med 29 p95 107 p99 526 max 526); same-width adds: N=50 n=2
  (1 ms), N=100 n=37 (med 1 p95 5 p99 88 max 88). The full adds distribution
  therefore UNDER-estimates the real per-event reconcile cost at N>=50. Also
  flagged: remove-triggered reconciles read much cheaper than add-triggered
  ones at the same managed count (N=20 removes 0-3 ms vs adds up to 14 ms)
  because teardown kills all windows in a burst and reconcile's geometry
  writes go to concurrently-dying windows, so burst-teardown removal timings
  do not exercise the full reconcile cost either. RSS deltas differ in
  character from Variant A (sub-linear per window, ~24-29 MB flat from
  N=20-100 vs Variant A's ~3.4 MB/window linear growth); possible partial
  cause is Variant B actively resizing xterm to tiny column widths (<30 px at
  N>=50) reducing per-window KWin/client state, but this is a question for
  unit-07, not asserted here. All raw data files preserved. Q1/portal/
  ScreenCast flow untouched, per authorization.

## 2026-08-09 (unit-07, findings report, Q2 portion)

- Role / unit: Lead / unit-07 / attempt-01 (Q2 only; Q1 pending)
- Result: `findings.md` written. Before trusting the Variant B sweep
  Worker's reported percentile figures, the Lead independently recomputed
  every p95/p99 value directly from the raw per-tier logs via `awk`/`sort`
  using a standard nearest-rank method (index = ceil(p*N), 1-indexed,
  hand-verified against known index values for several N before trusting
  the automation). This found the Worker's own arithmetic was WRONG at
  several tiers, most materially N=100 windowAdded (Worker reported
  p95=95/p99=526; correct values are p95=88/p99=149) and N=50/N=100 pooled
  (Worker's pooled figures matched the add-only figures, apparently
  copied rather than recomputed for the pooled set; correct pooled values
  differ: N=50 p95=39/p99=62 vs reported 42/90, N=100 p95=63/p99=109 vs
  reported 72/149). `findings.md` uses only the Lead-recomputed values and
  states the correction explicitly in Section 3.2 rather than silently
  fixing it. The bottom-line native-justifying verdict for Variant B is
  unaffected by the correction (even the smallest corrected figure,
  p95=39 ms at N=50 pooled, is 23x the 1.667 ms threshold), but the exact
  numbers reported are materially different from what the Worker claimed
  and would have been wrong if taken on trust.
- Result (continued): Applied the spec's Decision Rule separately per
  variant. Variant A: literal p95=2ms reading nominally crosses the
  native-justifying threshold, but the amplification calibration
  (0.0066ms true per-operation cost, ~300x smaller) strongly contradicts
  that literal reading; verdict reported as JS-sufficient with the
  literal-vs-amplification conflict stated explicitly rather than
  resolved by fiat, so a reader who disagrees with this Lead's judgment
  call can see the raw disagreement. Variant B: native-justifying, robust,
  timing evidence alone sufficient (magnitudes 8x-54x threshold, too large
  for clock quantization). RSS: ~250 KB pure script-load cost for both
  variants (clean, uncontaminated, well under 5 MB); the larger raw RSS
  deltas are confounded across variants by differing test-window sizes
  (Variant A always half-output-width, Variant B's columns shrink with N),
  stated as a validity caveat rather than resolved.
- Files / commit: `findings.md` (new), `plan.md` (Progress: unit-05/unit-06
  marked complete, unit-07 marked in-progress); not committed.
- Verification: ASCII-only grep clean on `findings.md`; every number in
  Sections 3-6 traced back to a specific `awk`/`grep` command against the
  raw files in `results/variant-a/` and `results/variant-b/`, re-run by
  the Lead directly rather than only reading the Workers' summaries.
- Notes: Q1 section of `findings.md` is a placeholder pending the
  interactive consent click; not triggered yet, per the Orchestrator's
  explicit instruction to stop and describe the on-screen interaction
  first. That description is being returned to the Orchestrator now,
  separately from this log entry.

## 2026-08-09 (successor Lead: state.md creation + timing attribution)

- Role / unit: Lead (successor, lead-anthropic) / unit-A (state.md) and
  unit-B (timing attribution) / attempt-01
- Result unit-A: `state.md` created (was missing across three prior Leads).
  Reconstructed from `spec.md`, `plan.md`, `log.md`, `findings.md`,
  `results/`. Notes the plan.md Progress-vs-Final-Outcome contradiction
  found during reconstruction (see below).
- Result unit-B: Non-invasive attribution analysis only (source reading +
  re-analysis of already-collected raw logs; no new live captures).
  Findings in `research/timing-attribution.md`:
  - Logging overhead (item 3) definitively excluded from the measured
    window in both variants, confirmed by direct source read
    (`script/variant-a.js:98-118`, `script/variant-b.js:67-80`): `end` is
    captured before `callDBus` is invoked.
  - Independently re-derived the CHANGE/SAME (width-changing vs same-width)
    split for `results/variant-b/tier-100.log` directly from the raw file
    (previous Lead had flagged the Worker's version of this breakdown as
    not independently re-verified); reproduced the Worker's numbers exactly
    (n=63/37, med 29/1, p95 107/5, p99 526/88, max 526/88) and added a new
    control: the SAME group has a *higher* mean window count per event
    (76.2 vs 35.4) yet is ~12.7x cheaper (3.4ms vs 42.9ms mean) -- strong
    evidence against JS loop/compute cost (item 1) being dominant, since
    more JS iterations correlates with *less* wall time here.
  - Cross-referenced against KWin's public source (X11Window::
    updateServerGeometry, commit 21a45c27/dfa08f22): KWin skips X11
    protocol configure requests when target geometry matches last-
    configured geometry, matching the CHANGE/SAME pattern exactly. This
    attributes the dominant cost to item 2 (moveResize/frameGeometry round
    trip into KWin's compositor/X11-protocol layer), not item 1.
  - Consequence: Variant B's "native-justifying" verdict (findings.md
    Section 4.2) is not supported as reasoned -- the cost measured is
    KWin's own compositor work, which a native plugin calling the same
    C++ API would incur identically. Flagged as reversed-or-inconclusive
    on the compute-speed rationale, with one unresolved open question
    (whether native code has access to a cross-window geometry batching
    primitive, e.g. GeometryUpdatesBlocker, unavailable to the JS scripting
    API -- not investigated).
  - Consequence: Variant A's "JS-sufficient" verdict (findings.md Section
    4.1) rests on an amplification cross-check shown to be invalid: the
    amplification loop runs after the real write already placed the
    window, so it repeats an idempotent (already-correct) geometry write,
    landing in the same no-op-skip path as the SAME group above, not a
    genuine write. Reclassified as inconclusive pending a corrected
    (non-idempotent) calibration, not attempted in this pass.
  - `findings.md` amended with a "CONTESTED" notice at the top pointing to
    `research/timing-attribution.md`; Sections 4.1/4.2 text left unedited
    (not overwritten) pending Orchestrator review.
- Files / commit: `research/timing-attribution.md` (new), `findings.md`
  (contested notice prepended), `state.md` (new), `log.md` (this entry);
  not committed.
- Verification: `research/timing-attribution.md`'s numeric claims re-run
  directly against `results/variant-b/tier-100.log` via `awk` (classification
  and both group statistics reproduced in this session, not copied from
  the prior Worker's log.md entry). Source claims about KWin's geometry-
  skip behavior are corroborated via public KWin commit history search, not
  a byte-verified read of the installed 6.7.3 source tree (stated as a
  caveat in the research file itself, Section 3/6).
- Discovery: `plan.md`'s "Progress" checklist (unit-05/unit-06/unit-07
  marked complete/in-progress) contradicts its own "Final Outcome" section
  (says unit-04 not yet dispatched, unit-05/06 unauthorized, unit-07 not
  started) -- the Final Outcome section was evidently never updated by the
  Lead(s) who ran unit-05 through unit-07. Not corrected in this stint
  (out of scope for unit-A/unit-B); flagged in `state.md` for a successor.
- Notes: Q1/portal/ScreenCast flow untouched, per explicit exclusion from
  this stint. No live KWin script load, no window spawn, no compositor
  interaction performed in this stint at all -- entirely source-reading and
  raw-log re-analysis.

## 2026-08-09 (unit-C, geometry-batching research)

- Role / unit: Worker / unit-C (geometry-batching/coalescing API asymmetry
  research) / attempt-01
- Result: resolved the surviving native-plugin argument (a native-only
  geometry batching primitive) against a byte-verified KWin 6.7.3 source
  tree (prior clone found at /tmp/opencode/kwin-src, sparse checkout,
  HEAD = tag v6.7.3 = commit 45ec9a6d0ed312a803ff5658a2a3e61f221566c6,
  matching the running /nix/store/...-kwin-6.7.3). (1) `X11GeometryUpdatesBlocker`
  (the class prior research called `GeometryUpdatesBlocker`; no such name
  exists in 6.7.3) is per-window RAII deferral only: `blockGeometryUpdates`
  counters on a single X11Window; geometry remembered in memory, one
  `configure()` X11 round trip issued at unblock. No cross-window batching
  anywhere in src/. (2) No equivalent is reachable from the JS API:
  `blockGeometryUpdates` is a plain public method on X11Window (not
  Q_INVOKABLE/slot), absent from QJSEngine surface; JS geometry writes go
  through `frameGeometry` WRITE `Window::moveResize` with the block counter
  at 0. (3) A binary KWin::Plugin could in principle reach it (x11window.h,
  window.h, workspace.h, plugin.h are installed Devel headers;
  blockGeometryUpdates/configure/moveResize exported from libkwin.so.6.7.3
  verified via nm), but no kwin dev output is materialized on this host
  (only `out` present; nixpkgs 26.11 mkKdeDerivation defines dev/devtools
  outputs but they are unbuilt), and src/plugin.h:24 requires recompilation
  per KWin release. (4) `X11GeometryUpdatesBlocker` is X11-only; Wayland
  xdg-shell has an analogous but different per-window configure coalescing
  (scheduleConfigure/sendConfigure idle timer, src/xdgshellwindow.cpp:85-133),
  also not cross-window. Final verdict: "no asymmetry exists" for the
  geometry-batching argument.
- Files / commit: docs/changes/js-baseline-measurement/research/
  geometry-batching.md (new), log.md (this entry); not committed
- Verification: all file:line citations read directly from the v6.7.3 clone
  (git rev-parse confirmed tag/HEAD match); running-lib symbol claims
  verified via `nm -DC` on
  /nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/lib/libkwin.so.6.7.3;
  host header/package claims verified via /usr/include, /nix/store listings,
  and the nixpkgs 26.11 channel source at
  /nix/store/aiapnjc6w07cz0jxy8s3j8cg1vfh1k8b-source; ASCII-only grep clean
  on geometry-batching.md; git status confirms nothing outside
  docs/changes/js-baseline-measurement/research/ and log.md was touched.
- Notes: no live KWin/D-Bus interaction, no script loading, no window
  spawning (read-only unit).

## 2026-08-09 (unit-D, Wayland-native client revalidation)

- Role / unit: Worker / unit-D (Wayland-native revalidation of Variant B's
  X11/XWayland timing attribution) / attempt-01
- Result: live re-measurement of Variant B at N=20 and N=50 using genuinely
  Wayland-native test clients (`konsole --separate --desktopfile
  plasma-auto-tiler-test -e sleep 3600`), surface type verified via
  `xlsclients`/`xprop` (zero X11 clients while 20/50 test windows open) and a
  new one-shot `script/window-enum-probe.js` read-only enumeration, not by
  application reputation. Verdict: the X11/XWayland attribution in
  `timing-attribution.md` holds and is confirmed dominant. Under Wayland
  every per-event `windowAdded`/`windowRemoved` measurement collapses to the
  0-1 ms clock floor at both tiers (tier-20: median 0, p95/p99/max 1; tier-50:
  median 0, p95/p99/max 1), versus the prior X11 figures (tier-20 median 7.5/
  max 14; tier-50 median 21/max 90). The bimodal CHANGE/SAME pattern does not
  appear under Wayland (both groups read 0-1 ms). RSS deltas are comparable
  to or modestly larger than X11 (tier-20: +31432 KB Wayland vs +24156 KB
  X11; tier-50: +28852 KB vs +24960 KB), so the timing collapse is not
  explained by lighter windows. Cross-referenced against
  `research/geometry-batching.md` Q4 (Wayland's per-window deferred
  `xdg_surface.configure` scheduling, no protocol round trip per write).
  Optional stretch (non-idempotent amplification calibration) explicitly not
  attempted; left for a successor, no script file modified by that decision.
- Files / commit: `docs/changes/js-baseline-measurement/research/
  wayland-revalidation.md` (new), `script/window-enum-probe.js` (new),
  `harness/run-wayland.sh` (new), `harness/README.md` (extended, Wayland
  sections), `results/variant-b-wayland/tier-20.log`, `tier-20-rss.txt`,
  `tier-20-spot.txt`, `tier-20-amplified.log`, `tier-50.log`, `tier-50-rss.txt`,
  `tier-50-spot.txt`, `tier-50-amplified.log` (new, raw data only); log.md
  (this entry, written by reconciling Lead after a cancelled attempt -- see
  reconciliation note below); not committed
- Verification (reconstructed by the reconciling Lead from artifact
  evidence, since the attempt that performed this work was cancelled before
  it could log its own verification): `tier-20.log`/`tier-50.log` line
  counts are 40/100 respectively (exactly 2N add+remove pairs), all
  plausible sequential timestamps and internalIds, not null/placeholder
  data; `tier-{20,50}-spot.txt` show real live window enumeration (23 and 53
  total windows respectively, matching 3 pre-existing real windows + N test
  windows, all test windows `class=plasma-auto-tiler-test`, `xlsclients`
  empty confirming no XWayland proxy); RSS files show three distinct
  plausible values per tier; amplified logs correctly empty (amplify off
  during real sweep); `window-enum-probe.js` passes `node --check`;
  `research/wayland-revalidation.md` and `harness/README.md`'s Wayland
  sections are ASCII-only clean (`grep -nP` Unicode-punctuation check, both
  files, no matches). Live-session state confirmed clean by the reconciling
  Lead post-hoc: `kwin_wayland` Ping exit 0, all five known script plugin
  names (`plasma-auto-tiler-variant-a`, `-variant-b`, `-clock-probe`, and
  the two `-wayland` suffixed names) report `isScriptLoaded=false`, no
  leaked `xterm`/`konsole` test-window processes, no leftover
  `dbus-monitor` LogSink capture. `devenv.nix` mtime predates this unit's
  artifact mtimes and was not modified; `konsole` was already present on
  the host (`/run/current-system/sw/bin/konsole`, a system package), so no
  ad-hoc dependency install occurred.
- Notes / incident: **Reconciliation note.** This unit's work (live
  measurement, cleanup, and the `wayland-revalidation.md` write-up) was
  performed by a prior Lead attempt that was cancelled by a host quota
  failure before it could append this log entry or update `state.md`. Per
  the cancelled-attempt protocol, the reconciling Lead treated this as
  unverified until independently checked: live-session cleanliness was
  re-verified from scratch (not assumed), and every quantitative claim in
  `wayland-revalidation.md` was spot-checked against the underlying raw
  files listed above before this entry was written. No discrepancy found.
  The work is accepted as-is; no rework was dispatched. One harness bug is
  self-reported in `wayland-revalidation.md`'s Caveats (a cosmetic
  integer-comparison error in the spot-check when `xlsclients` returned
  zero clients, fixed before the tier-50 run, did not affect measurement or
  teardown).

## 2026-08-09 (unit-E, Q1 capture attempt; unit-F, findings/plan rewrite)

- Role / unit: Lead (successor by succession, lead-anthropic) / unit-E
  (Q1 frame-presentation capture) and unit-F (findings.md rewrite, plan.md
  reconciliation) / attempt-01
- Result unit-E: dispatched a Worker with full live-session authorization
  (user present and ready to interact with the ScreenChooserDialog).
  Negotiation stalled at `ScreenCast.CreateSession`: the call returned a
  valid request object path with no error, but no `Request.Response`
  signal ever arrived on a broad, pre-registered `dbus-monitor` listener,
  and the request object subsequently disappeared from the portal's object
  tree. No crash occurred (unlike unit-01's token-validation SEGV; ASCII-
  only tokens were used throughout). The `ScreenChooserDialog` never
  appeared; the user was never interrupted. Diagnosis (reasoned from the
  symptom and general `org.freedesktop.portal.Request` semantics, not
  source-verified against `xdg-desktop-portal-kde` for this exact path):
  Request objects are tied to the creating client's D-Bus connection, and
  every CLI tool on this host (`busctl`, `qdbus`, `dbus-send`) opens a new
  connection per invocation and disconnects immediately after the
  synchronous method reply, before the portal backend can complete the
  async negotiation. No scripting-language D-Bus binding was available to
  build a persistent-connection client without installing a new package
  (`python3`/`perl`/`ruby`/`node` all checked live, none have a usable
  D-Bus binding); writing one in Rust was rejected as contradicting
  `spec.md`'s explicit "no Rust code in this change" Non-Goal. Verdict:
  **Q1 not measurable**, specific tooling reason recorded, not a
  substitute negative. The Lead independently re-verified live-session
  cleanliness after the Worker's own report (not assumed): `kwin_wayland`
  and portal both answer `Ping`; both variant scripts report
  `isScriptLoaded=false`; no leaked `konsole`/`dbus-monitor`/`gst-launch`
  processes; no leftover portal request objects. No script was ever
  loaded and no test window was ever spawned by this unit, so there was
  nothing invasive to reverse.
- Result unit-F: rewrote `findings.md` Sections 4.1, 4.2, and 7 (the
  CONTESTED sections) into a final, non-contested verdict integrating
  `research/timing-attribution.md`, `research/geometry-batching.md`,
  `research/wayland-revalidation.md`, and `research/popin-observation.md`.
  Variant A: timing reclassified inconclusive (the original JS-sufficient
  call's basis -- the amplification cross-check -- is retracted as
  measuring no-op-skip cost, not genuine write cost; no native-justifying
  claim is supported either, since the literal reading remains inside the
  clock's unresolvable band and Variant A was never Wayland-revalidated);
  RSS remains JS-sufficient on the one clean (script-load-only) figure.
  Variant B: timing reversed from native-justifying to JS-sufficient,
  resting on the Wayland-native revalidation (the platform matching the
  user's real session) where the same workload collapses to the 1 ms
  clock floor; RSS deltas that nominally cross the 15 MB threshold are not
  treated as native-justifying because they are confounded by per-window
  backing-store size, an architecture-independent cost. Section 7 rewritten
  to a combined verdict: no accepted evidence from this change supports a
  native C++/Rust KWin plugin; named and closed all three arguments the
  evidence base could speak to (compute speed, memory, batching asymmetry);
  explicitly distinguished "no accepted evidence for X" from "X disproven."
  Updated Section 8 (Q1) and Section 9 (caveats, additively: Wayland
  coverage partial -- Variant B only, N=20/50 only, konsole-only client;
  corrected amplification calibration never run) to stay consistent with
  the rewrite. Replaced the CONTESTED banner with a FINAL supersession
  notice explaining what changed and why. Separately, reconciled `plan.md`:
  corrected the stale "Final Outcome" section (previously contradicted its
  own Progress checklist, unedited by every Lead since unit-05/06/07 were
  actually run); added unit-A through unit-F to the Progress checklist
  (they existed only as log.md entries and state.md prose before this,
  with no plan-level record); rewrote the Acceptance-Criterion Evidence
  table to cite the corrected sources and reasoning per criterion.
- Files / commit: `docs/changes/js-baseline-measurement/research/
  popin-observation.md` (new); `findings.md` (top notice, Sections 4.1,
  4.2, 7, 8, 9 edited); `plan.md` (Progress checklist, Acceptance-Criterion
  Evidence table, Final Outcome section edited); `state.md` (this
  reconciliation recorded); `log.md` (this entry); not committed.
- Verification: ASCII-only re-checked (`grep -nP '[^\x00-\x7F]'`) clean on
  `findings.md`, `plan.md`, and `popin-observation.md`. Every numeric claim
  carried into the `findings.md` rewrite (percentiles, RSS deltas, the
  12.7x SAME/CHANGE control, the Wayland 0-1 ms collapse) was traced back
  to its source research file rather than re-derived from raw logs in this
  stint -- this stint is a synthesis/write-up unit, not a new measurement
  unit (except unit-E's live but ultimately unsuccessful negotiation
  attempt). Live-session state re-verified directly by the Lead post-unit-E
  (see above), not taken on the Worker's report alone.
- Notes: unit-E's Worker dispatch and this Lead's own follow-up commands
  are the only live-session/D-Bus interaction in this stint; no `devenv.nix`
  change, no package installed, no Rust code written. This Lead stint ends
  here per the 3-completed-work-unit context threshold (unit-E, unit-F, and
  the state.md/plan.md reconciliation that closes them out). Remaining for
  a successor or the Orchestrator: alignment review and the completion
  transaction (see `state.md`).
