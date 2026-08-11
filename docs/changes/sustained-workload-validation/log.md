# Log: Sustained Workload Validation (KWin transform animation, extension-point asymmetry, GC behaviour)

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-09 (cancelled-attempt reconciliation)

- Role / unit: Lead / reconciliation / cancelled host attempt
- Result: no unit accepted. The cancelled attempt added partial Q-A research in
  `research/extension-point-asymmetry.md`, written after the approved
  `spec.md` and `plan.md`. Its completion labels conflict with its remaining
  native effect-loader, JS binding, and Decision Rule verdict work, so unit-01
  remains incomplete. unit-02 through unit-07 have not started.
- Files / commit: `log.md` (new), `state.md` (reconciled), `plan.md` (stale
  approval status only); no commit.
- Verification: repository has no commits and every project file is untracked;
  no tracked diff or index change exists. `docs/backlog.md` retains exactly two
  active linked changes. KWin test script names checked by `isScriptLoaded`
  were false; no harness xterm or konsole test process or LogSink capture was
  present; `org.kde.KWin` answered `org.freedesktop.DBus.Peer.Ping`.
- Notes / blocker: `spec.md` and `plan.md` top-level approval statuses are
  approved, but the remaining threshold wording is stale against the approved
  status and handover. It was not changed because this reconciliation permits
  status-only spec/plan correction. No live-session workload or new unit was
  started.

## 2026-08-09 (unit-01, Q-A extension-point asymmetry)

- Role / unit: Lead / unit-01 / attempts 01a-01c
- Result: accepted. Q-A closes against reviving native on API-access grounds:
  `.js` ScriptedEffect reaches the paint-time transform path, and QML
  declarative effects reach continuous touchpad/touchscreen swipe progress.
  No decisive or narrow native-only capability is established. Co-using those
  two non-native surfaces in one effect remains an implementation-feasibility
  caveat, not evidence of a capability asymmetry.
- Files / commit: `research/extension-point-asymmetry.md` (final verdict),
  `spec.md` and `plan.md` (stale approved-threshold status wording and unit
  evidence/progress), `state.md` (accepted state), `log.md` (this entry); no
  commit.
- Verification: `/tmp/opencode/kwin-src` is tag `v6.7.3` at commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`. Source citations in the
  research report were Lead-inspected: effect loader/factory version coupling,
  `.js` transform API and paint implementation, and QML
  `SwipeGestureHandler` registration/wiring. Focused `nm -DC` on the running
  KWin library confirms exported `EffectPluginFactory` symbols; loader
  behavior is evidenced by source, not inferred from symbols. ASCII checks
  passed on all changed milestone-2 artifacts.
- Notes: this source-only unit did not load a script, spawn a window, or alter
  the live session. unit-02 and Q-B/Q-C were not started.

## 2026-08-09 (Q-B user-approved amendment)

- Role / unit: Lead / Q-B planning amendment / no dispatch
- Result: Q-B is transform-first. Its primary workload is Wayland-native
  window animation through `.js` `ScriptedEffect` paint transforms, supported
  by accepted unit-01 evidence that this path avoids geometry writes. Persistent
  final geometry, if needed, is a one-time separately reported phase;
  per-frame geometry writes are controls only and cannot provide native-vs-JS
  evidence.
- Files / commit: `spec.md`, `plan.md`, `state.md`, `log.md`; no commit.
- Verification: Q-B now requires discovery and validation of a read-only,
  authoritative actual-presentation timestamp source before its harness is
  scoped. `Date.now()` handler duration and proxies are excluded. The approved
  p99 limit remains 18.3337 ms (110% of 16.667 ms); `missed[i] = max(0,
  floor((t[i] - t[i-1]) / 16.667 ms + 0.5) - 1)` is defined before measurement,
  with `missed[i] >= 3` as failure.
- Notes / blocker: if no qualifying source exists, Q-B is not measurable under
  the approved criteria without C++ compositor instrumentation. No harness,
  measurement, live-session interaction, Q-A, unit-02, Q-C, or decision record
  was changed.

## 2026-08-09 (execution pause for product-justification audit)

- Role / unit: Lead / execution status / no dispatch
- Result: execution paused pending the approved
  `integrated-tiling-workspace-value` audit's product-justification decision.
- Files / commit: `plan.md`, `state.md`, `log.md`, `docs/backlog.md`; no commit.
- Verification: accepted unit-01 Q-A, the approved Q-B transform-first
  amendment, all Q-B/Q-C thresholds, and unit-01 through unit-07 definitions
  remain unchanged. unit-02 and all Q-B/Q-C work remain unstarted.
- Notes / blocker: resume, narrowing, continued pause, or closure follows the
  audit's approved Decision Rules. No live-session work occurred.

## 2026-08-10 (archived audit linkage reconciliation)

- Role / unit: Lead / execution status / no dispatch.
- Result: the accepted integrated-tiling-workspace-value audit is archived with
  a scoped strong-justification verdict. Sustained-workload execution remains
  paused pending the proposed structural-feasibility gate authorized by the
  archived verdict; this is not a resumption.
- Files / commit: `plan.md`, `state.md`, `log.md`, and `docs/backlog.md`; no
  commit.
- Verification: the archived verdict link resolves to
  `../archive/2026-08-10-integrated-tiling-workspace-value/findings.md`.
  Accepted Q-A, the approved Q-B transform-first amendment, thresholds, and
  unit definitions remain unchanged. No later unit or live-session work started.

## 2026-08-10 (active feasibility-gate linkage reconciliation)

- Role / unit: Lead / execution status / no dispatch.
- Result: the approved integrated-plasma-structural-feasibility gate is active.
  Sustained-workload execution remains paused pending that gate; activation is
  not a resumption.
- Files / commit: `plan.md`, `state.md`, `log.md`, and `docs/backlog.md`; no
  commit.
- Verification: the active gate link resolves to
  `../integrated-plasma-structural-feasibility/`. Accepted Q-A, the approved
  Q-B transform-first amendment, thresholds, and unit definitions remain
  unchanged. No later unit or live-session work started.
