# Native Effect Live Runner Log

- 2026-08-15: Expanded artifact and nested-only governance decision checkpoint
  recorded. No implementation, tests, build, live command, staging, commit, or
  push was performed.
- 2026-08-15: unit-01 dependency checkpoint accepted after Lead inspection.
  `devenv.nix` adds only `kdePackages.kwin` and `weston`; it retains
  `kdePackages.kwin.dev` and all prior package declarations. Non-realizing Nix
  parse/evaluation checks and `git diff --check` passed. The active session is
  stale and must be restarted before unit-02 or any implementation
  verification. No shell was sourced or reloaded, and no new command is claimed
  available. No runner, build, live test, staging, commit, or push was
  performed.
- 2026-08-15: unit-01 restart gate accepted after current-session
  reconciliation. `kwin_wayland`, `weston`, and `weston-terminal` resolve;
  KWin runtime is 6.7.3, non-realizing Nix evaluation reports KWin development
  output `kwin-6.7.3`, and Weston is 15.0.1. No runner, build, live test,
  staging, commit, or push was performed.
- 2026-08-15: unit-02 accepted after Lead inspection of the test-only
  fake-tool contract suite. `bash -n scripts/live-native-effect.test.sh`
  passed. `bash scripts/live-native-effect.test.sh` exited 1 at the unit-02
  stage before a production runner existed; no runner, build, live test,
  staging, commit, or push was performed.
- 2026-08-15: Lead correction: unit-02 remains in progress. The expected-red
  baseline is valid, but the suite still lacks required private plugin-path,
  client socket/D-Bus, missing-tool, plugin-consumption, and ordered cleanup
  contract assertions.
- 2026-08-15: unit-02 accepted after final Lead inspection. The completed
  test-only fake-tool suite retains its syntax-valid expected-red boundary;
  no runner, build, live test, staging, commit, or push was performed.
- 2026-08-16: unit-03 attempt-02 correction. The production runner
  `scripts/live-native-effect-test.sh` exists and runs under the fake-tool
  suite, superseding the earlier "absent production runner" expected-red
  rationale. Three reconciliation findings were corrected: (1) the private
  environment is exported before any CMake build subprocess, after the host
  Wayland socket is resolved; (2) OpenGL is forced via `KWIN_COMPOSE=O2` and
  fail-closed by reading the `/Compositor` `compositingType` result; (3) the
   plan/log/state text no longer claims unit-03 has not begun. Remaining suite
   red is the first unit-04-owned assertion. No build, live test, staging,
   commit, or push was performed.
- 2026-08-16: unit-03 and unit-04 fake/static evidence accepted. Runner hash
  is `4ae146fc...6244de6`; post-correction harness hash is
  `7d6a113716e9d2b28d04b7075ae1ab6248d441a20e5f39dae850400ec9292995`.
  `bash -n` passed. The one-line harness correction run,
  `nice -n 10 timeout 300 bash scripts/live-native-effect.test.sh`, exited 0
  in 56s with 247 passes, 0 failures, and zero client-pids errors; curated log:
  `/tmp/opencode/native-effect-live-harness-correction-1786841439.log`.
- 2026-08-16: unit-05 fresh independent review accepted with no material
  defect. Its out-of-brief timeout probe is excluded. The active environment
  lacks `weston` and `weston-terminal`; no user-live or visual acceptance is
  claimed before devenv restart or reload and read-only version reconciliation.
- 2026-08-16: static-delivery checkpoint accepted. After devenv reload,
  `kwin_wayland` 6.7.3, KWin development output `kwin-6.7.3`, `weston` 15.0.1,
  and `weston-terminal` are available. Accepted evidence in
  `/tmp/opencode/native-effect-verify-IZQe7JWE` covers the 247/0 native harness,
  independent review, and Nix/JS/shell/installer/native-format checks. Accepted
  evidence in `/tmp/opencode/native-effect-native-verify-M1seuI6L` covers clean
  configure, two-job build, generated AUTOMOC, wrapped `clang-tidy`, and CTest
  3/3. Malformed earlier comprehensive Worker evidence and the reviewer's
  out-of-brief timeout probe are excluded. No real/live run occurred; user-run
  nested visual acceptance remains pending.
- 2026-08-16: live-runner `KILL_BIN` preflight resolver correction accepted. A
  user-run quick attempt failed closed at `KILL_BIN` preflight before launch;
  Bash builtin precedence from `command -v` caused it although coreutils `kill`
  existed. The correction uses external PATH lookup and requires each candidate
  to be absolute and executable. Regressions cover default PATH, invalid
  override, and relative executable override; both syntax checks passed. The
  fake-tool suite at `/tmp/opencode/unit04-preflight-correction-attempt03-
  evidence/` passed 258/0 in 61 Bash seconds. A fresh independent review found
  no defect. No real nested run or visual acceptance occurred; user retry
  remains next.
- 2026-08-16: user-run quick attempt reached fail-closed
  `compositingType: unavailable`. Diagnosis established a socket-versus-private-
  D-Bus readiness race and hidden probe errors; inherited 351-entry
  `XDG_DATA_DIRS` caused the non-causal private dbus-daemon watch warning. The
  accepted correction adds bounded private `/Compositor` polling, exact nested
  liveness checks, retained probe status/stdout/stderr/attempt evidence, valid
  non-OpenGL distinction, OpenGL-before-plugin ordering, private D-Bus
  activation `XDG_DATA_DIRS`, and exact nested-child restoration. Both syntax
  checks passed. The one suite at
  `/tmp/opencode/native-effect-readiness-EIAJUw/harness.log` passed 298/0 in 78
  Bash seconds; a fresh independent review found no material defect. No real
  retry or visual acceptance occurred; user retry remains pending.
- 2026-08-16: a second user retry briefly launched nested KWin but failed at
  `/Effects`. Static diagnosis found single-shot readiness, conflated
  query/support state, and an undiscoverable evidence root; later independent
  review found incorrect uppercase `org.kde.KWin.Effects`. The accepted
  correction adds bounded `/Effects` readiness/liveness with retained
  status/stdout/stderr/attempt evidence, immediate evidence-root output,
  source-aligned `isEffectSupported` and `loadEffect` booleans, exact lowercase
  `org.kde.kwin.Effects`, a strict fake interface guard, and focused lifecycle
  tests. Both syntax checks passed. The one suite at
  `/tmp/opencode/live-native-effect.GHMi1Q` passed 347/0 in 86 Bash seconds;
  independent review is accepted. No successful real lifecycle or visual
  acceptance is claimed; user retry remains pending.
- 2026-08-16: third user retry evidence at `/tmp/tmp.Ew6l6rZCma` reached
  `gl2`, completed compositor and `/Effects` readiness, then returned explicit
  `isEffectSupported=false`. Diagnosis identified private plugin discovery:
  CMake emitted `build/bin/kwin/effects/plugins/<plugin>.so`, but the runner
  exported `build` as `QT_PLUGIN_PATH`. The accepted correction derives the
  exact prefix from the canonical plugin's required suffix, records `plugin_so`
  and `qt_plugin_path`, aligns fake and real layout, and truthfully separates
  never-started from attempted-unowned client cleanup. Both syntax checks
  passed; the single suite at
  `/tmp/opencode/live-native-effect-plugin-prefix.IeyihO` passed 366/0 in 87
  Bash seconds; fresh independent review found no material defect. No
  successful real load or visual acceptance is claimed.
- 2026-08-16: reconciliation found `kwin/contents/code/main.js` clean and its
  working-file and `HEAD` hashes both
  `91023df4a888264968b300920893cadb9391a764`; prior differing hash reports
  were inconsistent. The file was not touched.
- 2026-08-16: user-reported evidence at `/tmp/tmp.RtDxl1Chxo` reports private
  support `true`, initial loaded `false`, load `true`, and post-load loaded
  `true`; exactly two intended terminals displayed; and a blue border visible,
  following focus, tracking dragging, and tracking resizing. Portal activation
  was on the private bus, with no evidence of host KWin mutation. Tiling
  absence is expected because the JavaScript controller is not loaded. The user
  closed the outer nested window before normal unload, so unload and controlled
  cleanup are not accepted. No unreported visual criterion is inferred as
  tested. Remaining gate: rerun and use Ctrl-C from the original host terminal
  while the nested window remains open to prove unload/post-unload and cleanup.
- 2026-08-16: Process violation recorded: a prior documentation checkpoint
  enumerated protected working-tree paths. No path details are retained here,
  and no further operation used those paths.
