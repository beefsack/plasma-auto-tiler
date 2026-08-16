# Plan: Native Effect Live Runner

Ownership and approval:
- Owner: Lead
- Status: Expanded, approved 2026-08-15 by the user and Orchestrator.

## Technical Approach

Implement the runner only after its two system dependencies are declared and a
new development session is active. It must construct an isolated child
environment, preflight the exact private plugin build and renderer, then own
the nested compositor and client process groups until evidence-backed cleanup.
The host Wayland socket is an absolute read-only connection input, never a host
KWin control or mutation path.

## Work Units

| ID | Objective | Depends on | Bounded scope | Verification |
|---|---|---|---|---|
| unit-01 | Declare only `kdePackages.kwin` and `weston`; record the mandatory restarted-session gate. | - | `devenv.nix`; this change record | Nix evaluation only; no claim that the current session has new tools. |
| unit-02 | Write regression-first fake-tool contracts for arguments, preflight refusals, `/Effects` transitions, evidence, and owned cleanup. | unit-01 restart | Future runner tests and fakes | Full fake-tool suite, including `INT` and `TERM`. |
| unit-03 | Implement runner environment and lifecycle: private paths/D-Bus, exact private build preflight, visible nested launch, two clients, and nested `/Effects` operations. | unit-02 | `scripts/live-native-effect-test.sh` | Fake-tool contracts prove command, isolation, renderer refusal, PID/group ownership, and D-Bus order. |
| unit-04 | Implement evidence and cleanup: manifest/output capture, optional journal qualification, checklist, ordered owned-group teardown, and verification. | unit-03 | Runner evidence/cleanup paths and tests | Full fake-tool suite proves no historical-journal liveness claim and no unowned termination. |
| unit-05 | Independently review isolation and process ownership, complete final static verification, then hand user-live manual acceptance externally. | unit-04 | Scoped scripts/tests/docs only | Independent review record, diff check, static checks, and user-run acceptance checklist. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Execution Checkpoint

- 2026-08-15: unit-01 declared only `kdePackages.kwin` and `weston` in
  `devenv.nix`, retaining `kdePackages.kwin.dev` and every prior package.
  Non-realizing Nix parse/evaluation checks and `git diff --check` passed.
- Blocker: the current development session predates the declaration and is
  stale. Restart the devenv session before unit-02 or any implementation
  verification; no new command is currently claimed available.
- 2026-08-15 restart reconciliation: `kwin_wayland`, `weston`, and
  `weston-terminal` resolve in the current session. `kwin_wayland --version`
  reports 6.7.3, non-realizing Nix evaluation reports development output
  `kwin-6.7.3`, and `weston --version` reports 15.0.1. The restart gate is
  closed and unit-02 is authorized.
- 2026-08-15: unit-02 regression-first fake-tool contracts accepted in
  `scripts/live-native-effect.test.sh`. `bash -n` passes.
- 2026-08-16: unit-03 has begun. The production runner
  `scripts/live-native-effect-test.sh` exists and runs under the fake-tool
  suite. The suite no longer fails from an absent runner; its remaining red is
  the first unit-04-owned assertion (interruption-during-start cleanup), not a
  unit-03 defect.
- 2026-08-16: unit-03 and unit-04 are accepted for current fake/static
  evidence only. Runner hash: `4ae146fc...6244de6`; post-correction harness
  hash: `7d6a113716e9d2b28d04b7075ae1ab6248d441a20e5f39dae850400ec9292995`.
  `bash -n` passed. After the one-line harness correction,
  `nice -n 10 timeout 300 bash scripts/live-native-effect.test.sh` exited 0
  in 56s with 247 passes, 0 failures, and zero client-pids errors; curated log:
  `/tmp/opencode/native-effect-live-harness-correction-1786841439.log`.
- 2026-08-16: unit-05 independent review is accepted with no material defect.
  Its out-of-brief timeout probe is excluded from acceptance evidence.
- 2026-08-16: comprehensive non-live verification is accepted. After devenv
  reload, `kwin_wayland` 6.7.3, KWin development output `kwin-6.7.3`, `weston`
  15.0.1, and `weston-terminal` are available. The accepted 247/0 native
  harness, independent review, and Nix/JS/shell/installer/native-format checks
  are recorded in `/tmp/opencode/native-effect-verify-IZQe7JWE`. Clean native
  configure, two-job build, AUTOMOC, wrapped `clang-tidy`, and CTest 3/3 are
  accepted in `/tmp/opencode/native-effect-native-verify-M1seuI6L`. Malformed
  earlier comprehensive Worker evidence and the reviewer's out-of-brief timeout
  probe are excluded. No real/live run occurred; user-run visual acceptance
  remains pending.
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
- 2026-08-16: a user-run quick attempt reached a fail-closed
  `compositingType: unavailable` result. Static diagnosis established a
  socket-versus-private-D-Bus readiness race with hidden probe errors; inherited
  351-entry `XDG_DATA_DIRS` caused a non-causal private dbus-daemon watch
  warning. The accepted correction adds bounded private `/Compositor` polling,
  exact nested liveness checks, retained probe status/stdout/stderr/attempt
  evidence, valid non-OpenGL distinction, OpenGL-before-plugin ordering, a
  private D-Bus activation `XDG_DATA_DIRS`, and exact nested-child restoration.
  Both syntax checks passed; the one suite at
  `/tmp/opencode/native-effect-readiness-EIAJUw/harness.log` passed 298/0 in 78
  Bash seconds. A fresh independent review found no material defect. No real
  retry or visual acceptance has occurred; user retry remains pending.
- 2026-08-16: a second user retry briefly launched nested KWin but failed at
  `/Effects`. Static diagnosis found single-shot readiness, conflated
  query/support state, and an undiscoverable evidence root; later independent
  review found the incorrect uppercase `org.kde.KWin.Effects` interface. The
  accepted correction adds bounded `/Effects` readiness/liveness with retained
  status/stdout/stderr/attempt evidence, immediate evidence-root output,
  source-aligned `isEffectSupported` and `loadEffect` booleans, exact lowercase
  `org.kde.kwin.Effects`, a strict fake interface guard, and focused lifecycle
  tests. Both syntax checks passed. The one suite at
  `/tmp/opencode/live-native-effect.GHMi1Q` passed 347/0 in 86 Bash seconds;
  independent review is accepted. No successful real lifecycle or visual
  acceptance is claimed; user retry remains pending.
- 2026-08-16: third user retry evidence at `/tmp/tmp.Ew6l6rZCma` reached
  `gl2`, completed compositor and `/Effects` readiness, then received explicit
  `isEffectSupported=false`. The deterministic diagnosis was private plugin
  discovery failure: CMake emitted the plugin below
  `build/bin/kwin/effects/plugins`, while the runner exported `build` as
  `QT_PLUGIN_PATH`. The accepted correction canonicalizes the unique plugin,
  derives the exact prefix by stripping its required
  `/kwin/effects/plugins/<plugin>.so` suffix, records `plugin_so` and
  `qt_plugin_path`, aligns the fake layout, and distinguishes never-started
  from attempted-unowned client cleanup. Both syntax checks passed; the one
  suite at `/tmp/opencode/live-native-effect-plugin-prefix.IeyihO` passed
  366/0 in 87 Bash seconds; fresh independent review found no material defect.
  No successful real load or visual acceptance is claimed; user retry remains
  pending.
- 2026-08-16: user-reported evidence at `/tmp/tmp.RtDxl1Chxo` reports private
  support `true`, initial loaded `false`, load `true`, and post-load loaded
  `true`. The nested session displayed exactly the two intended terminals. The
  user observed the blue border visible, following focus, tracking dragging,
  and tracking resizing. Portal activation was on the private bus; no evidence
  establishes a host KWin mutation. Tiling absence is expected because this
  runner does not load the JavaScript controller. The user closed the outer
  nested window, so KWin exited before normal unload: unload and controlled
  cleanup are not accepted. No unreported visual criterion is inferred as
  tested. Remaining gate: rerun and end with Ctrl-C from the original host
  terminal while the nested window remains open, proving unload/post-unload and
  cleanup.

## Acceptance-Evidence Map

| Acceptance area | Required evidence |
|---|---|
| Dependency/restart gate | `devenv.nix` scoped diff, evaluation output, and recorded restarted-session prerequisite. |
| Isolation and topology | Manifest listing private path values, nested/client PIDs and process groups, and no host KWin target. |
| Exact plugin and renderer | ABI/version preflight output, private build output, plugin identity, and explicit OpenGL result. |
| Nested effect lifecycle | Nested `/Effects` discovery/load/`isLoaded`/unload request-response transition log. |
| Clients and output | Exact two `weston-terminal` client PIDs/groups and per-process stdout/stderr. |
| Cleanup | Ordered D-Bus attempt, client-group then nested-group status, and post-cleanup verification states. |
| Optional journal | Availability result plus exact nested PID and run duration; absence is recorded, never substituted. |
| Visual result | User-completed manual nested-compositor checklist. |

The accepted user observations are limited to the displayed terminals and blue
border behavior recorded in the execution checkpoint; no unreported visual
criterion is inferred as tested.

## Residual Risks

- KWin's native plugin ABI and effect interfaces are version-coupled; a mismatch
  must stop before launch.
- A nested compositor can fail for host graphics, socket, or service reasons;
  evidence can diagnose a failed run but cannot make it accepted.
- D-Bus may be unreachable during interrupt cleanup, leaving unload unverified.
- Process-group verification reduces but cannot prove cleanup after SIGKILL or
  power loss; neither outcome is claimed.
- Visual correctness remains a manual nested-session judgment.
- Static/fake acceptance does not establish user-run nested visual acceptance.
- No real/live runner has been executed; static evidence cannot establish the
  required visible nested-compositor behavior.

## Pending Decisions

- None.
