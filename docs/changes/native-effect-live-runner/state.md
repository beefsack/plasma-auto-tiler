# State: Native Effect Live Runner

- Change class / approval: Expanded. `spec.md` and `plan.md` are approved by
  the user and Orchestrator on 2026-08-15.
- Lead succession: current Lead is OpenCode (`openai/gpt-5.6-terra`) under the
  Orchestrator. This file is the cross-restart and cross-Lead continuity record.
- Current unit: unit-01 and its restart gate are accepted. `devenv.nix` declares only
  `kdePackages.kwin` and `weston`, preserving `kdePackages.kwin.dev` and all
  previous dependencies. Lead inspection accepted the scoped two-line diff.
- Verification: `nix-instantiate --parse devenv.nix` and `git diff --check`
  passed. The Worker also completed a non-realizing package-list evaluation.
- Restart reconciliation: the current session resolves `kwin_wayland`,
  `weston`, and `weston-terminal`. `kwin_wayland --version` reports 6.7.3;
  non-realizing Nix evaluation reports KWin development output `kwin-6.7.3`;
  and `weston --version` reports 15.0.1. The prior `kwin` command wording was
  incorrect; the verified runtime command is `kwin_wayland`.
- Current units: unit-02 is accepted; unit-03 and unit-04 are accepted for
  fake/static evidence only; unit-05 independent review is accepted with no
  material defect. The review's out-of-brief timeout probe is excluded.
- Evidence: runner hash `4ae146fc...6244de6`; post-correction harness hash
  `7d6a113716e9d2b28d04b7075ae1ab6248d441a20e5f39dae850400ec9292995`.
  `bash -n` passed. After the one-line harness correction, the correction run
  exited 0 in 56s with 247 passes, 0 failures, and zero client-pids errors at
  `/tmp/opencode/native-effect-live-harness-correction-1786841439.log`.
 - Static-delivery checkpoint: after devenv reload, `kwin_wayland` 6.7.3, KWin
  development output `kwin-6.7.3`, `weston` 15.0.1, and `weston-terminal` are
  available. `/tmp/opencode/native-effect-verify-IZQe7JWE` is accepted for the
  247/0 native harness, independent review, and Nix/JS/shell/installer/native-
  format checks. `/tmp/opencode/native-effect-native-verify-M1seuI6L` is
  accepted for configure, two-job build, AUTOMOC, wrapped `clang-tidy`, and
  CTest 3/3. Malformed earlier comprehensive Worker evidence and the reviewer's
  out-of-brief timeout probe are excluded. No real/live run or visual acceptance
  is claimed; user-run nested visual acceptance remains the active gap.
- Live-runner `KILL_BIN` preflight resolver correction: a user-run quick
  attempt failed closed at `KILL_BIN` preflight before launch; Bash builtin
  precedence from `command -v` caused it although coreutils `kill` existed. The
  correction uses external PATH lookup and requires each candidate to be
  absolute and executable. Regressions cover default PATH, invalid override,
  and relative executable override; both syntax checks passed. The fake-tool
  suite at `/tmp/opencode/unit04-preflight-correction-attempt03-evidence/`
  passed 258/0 in 61 Bash seconds. A fresh independent review found no defect.
  No real nested run or visual acceptance occurred; user retry remains next.
