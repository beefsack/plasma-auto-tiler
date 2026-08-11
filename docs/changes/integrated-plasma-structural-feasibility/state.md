# State: Integrated Plasma Structural Feasibility

- Current major unit / attempt: `unit-04/nested-kwin-feasibility`. The user
  approved parking further investment in the unsafe live harness and replacing
  it with one source-only, non-launching nested-KWin feasibility prerequisite.
  `unit-04/attempt-01` FAILED (interrupted at the manual T2 checkpoint; runtime
  evidence inadmissible). `unit-04/attempt-02`, its staged protocol, and the
  staged harness are authored but NOT executed and are parked, not deleted.
  No proof completion is claimed.
- Governance: `spec.md` and `plan.md` are approved by the user. The change is
  the active structural-feasibility gate authorized by the archived
  [integrated-tiling-workspace-value verdict](../archive/2026-08-10-integrated-tiling-workspace-value/findings.md).
- Completed unit: unit-01 source-only matrix in
  `research/kwin-api-surface.md` is pinned to KWin `v6.7.3` commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`. Capability 1 is supported;
  capabilities 2, 3, 7, 8, and 9 are version-coupled only; capabilities 4, 5,
  and 6 require runtime validation; capability 10 lacks a supported separate-
  process interface but has a bounded native/private route.
- Fail-fast result: no mandatory capability lacks every extension route, so
  downstream units are not parked. The full workflow has no supported-
  scripting-only proof recommendation; unit-02 assessed the explicit version-
  coupled composition boundary. This remains a classification, not architecture
  selection.
- Completed unit: unit-02 source-only composition research in
  `research/package-composition.md` establishes one JavaScript `KWin/Script`
  KPackage as the smallest reversible proof carrier, not a production
  architecture selection. It uses supported root lookup and version-coupled
  Custom Tile access; KWin owns persisted topology, and no panel, IPC, effect,
  or native component is required for the approved workflow. Pager satisfies
  the workspace indicator without structural-tree state. Upgrade/removal
  semantics and bounded reload timing remain proof-protocol validation items.
- Safety: unit-01 through unit-03 are source/protocol only. Unit-04 requires
  the exact unit-03 protocol and fresh user authorization before any live
  interaction.
- Dependencies: accepted unit-01 gates unit-02; unit-01 and unit-02 gate unit-03;
  unit-03 plus the nested-KWin feasibility prerequisite gate any future unit-04
  live work; a recommended smoke still requires fresh user authorization;
  unit-04 gates unit-05.
- Scope deviation: attempt-02 ran read-only local tool-presence/help checks
  despite the no-live-query boundary. No KWin/session, D-Bus, package,
  configuration, terminal-control, or window mutation occurred. The protocol
  must remove these observations as evidence; the deviation is recorded in
  `log.md` and will be reported at acceptance.
- Recovery resolution: the accepted protocol uses the required D-Bus
  `loadScript`/`start`/`unloadScript` carrier with no package installation,
  no `[Plugins]` or `Script-*` mutation, and no persistent script-config
  mutation.
- Shortcut finding: KWin's script `registerShortcut` parents its `QAction` to
  the script; destruction on unload drives the installed KGlobalAccel client's
  asynchronous targeted unregister. The exact shipped D-Bus API also exposes
  `unregister(component, action)` and `Component.invokeShortcut(action)`.
  The proof creates only a randomized sentinel action, dynamically discovers
  its component, invokes it by name, and polls action/config absence after
  unload before using a one-action unregister fallback. No broad shortcut or
  config operation is allowed.
- Residual boundary: `invokeShortcut` proves daemon-to-script callback dispatch,
  not the physical key-to-daemon/Wayland input path. Harness death before unload
  can leave the sentinel registered; recovery is outside unit-04 and requires
  fresh authorization. The interrupted unit-04 attempt does not authorize a
  rerun.
- Crash recovery, 2026-08-10: `unit-04/attempt-01` reached the manual T2
  checkpoint, timed out awaiting its go signal, and recorded abort/recovery.
  It is unsuccessful. All runtime output under `results/` from this attempt is
  inadmissible for acceptance or a feasibility verdict, including its partial
  preflight, workflow, and claimed recovery lines. Preserve the files for
  inspection; do not delete or rewrite them.
- Lead read-only reconciliation after the user's external Plasma/KWin restart:
  KWin Ping succeeded; proof id `plasma-auto-tiler-structural-proof` is not
  loaded; the pre-run desktop vector, current desktop, count, and rows exactly
  match the durable D-Bus snapshot; attempted desktop id
  `099828b1-f155-487c-8801-42340019fb64` has no `[Tiling]` subgroup; and the
  recorded sentinel action id/prefix has no live component or
  `kglobalshortcutsrc` entry. The process-pattern checks were inconclusive
  because each `pgrep -af` matched its checking shell; no no-process claim is
  recorded.
- Cleanup reconciliation, 2026-08-10: the user authorized and the Lead ran only
  `kwriteconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled false`.
  Read-back is `false`; `isScriptLoaded("krohnkite") == false`; and KWin Ping
  succeeds. The `[Script-krohnkite]` group and 35 `Krohnkite*` shortcut entries
  remain deliberately untouched and are not an enabled or loaded Krohnkite
  instance.
- The same read-only reconciliation verifies the proof script remains unloaded;
  desktop vector/current/count/rows still equal the pre-run D-Bus snapshot; the
  attempted proof `[Tiling]` subgroup and sentinel shortcut action/config are
  absent; and corrected non-self-matching process checks find no sentinel
  windows, D-Bus sink/logger, capture, or harness processes. The failed
  `unit-04/attempt-01` evidence remains inadmissible. No unit-04 resumption is
  authorized.
- Staged protocol revision, 2026-08-10 (`unit-04/attempt-02` preparation):
  the user-authorized revision rewrote `research/proof-protocol.md` into an
  exact staged state machine and rewrote `proof/run-proof.sh` as a stage
  dispatcher. Stages: PRE (read-only gate, 60 s, inadmissible evidence),
  AUT-KEY (T8 start/T3a/T9/T9b), AUT-WAY (T3b/T6), AUT-BRANCH (T5a/T5b/T4),
  M1 (T2 drag-to-split), M2 (T7 drag+Esc), each live stage a separate
  supervisor command bounded to a fixed 90 s deadline with signal-safe cleanup
  (`timeout --signal=INT --kill-after=5 90`). No session persists across user
  turns; no go files or external signals; the supervisor waits only for an
  exact matching proof event. Every stage ends in the full reversal (capture
  teardown, window close, script unload, sentinel removal, desktop/topology
  restoration, verification); no proof state survives a user turn. Fresh
  proof/snapshot/evidence identifiers per repeated setup; the proof window
  carries a run-specific title announced verbatim to the user. Krohnkite
  not-loaded AND disabled preconditions and real-window exclusion are enforced
  per stage. attempt-01 and PRE evidence remain inadmissible to proof success.
  `proof/structural-proof.js` is unchanged. Static checks only: shell and JS
  syntax verified; no live execution occurred.
- `unit-04/attempt-02` execution status: NOT authorized and NOT executed. The
  revised staged protocol and harness are review input. Fresh user
  authorization of the staged protocol plus a fresh user live-stage
  authorization before each manual stage is required before any stage runs.
- Plan correction, 2026-08-10: the user approved replacing further live-session
  harness investment with one tiny feasibility spike. The active prerequisite
  is source and non-launching binary-capability inspection of isolated nested
  KWin only. It must answer backend/output, XDG/runtime-socket, D-Bus,
  scripting/client/service, teardown, hotplug, and installed-dependency
  questions in `research/nested-kwin-feasibility.md`. If the path is not
  obvious, isolated, and two-output capable with deterministic teardown,
  implementation proceeds without a smoke launch.
- Nested-KWin spike result, 2026-08-10: blocked. Pinned-source and non-launching
  CLI inspection establishes `--wayland-display`/`--socket`, virtual startup
  outputs, and installed KWin/D-Bus/client/process-group commands, but not the
  exact private-XDG-runtime access to the parent socket, complete isolated
  D-Bus/KGlobalAccel service composition, deterministic teardown, or external
  virtual-hotplug control. No smoke launch is recommended. The sole Worker
  stopped at 14 of 15 calls before writing a deliverable and reported one
  inadmissible scope deviation (reading inherited XDG/Wayland environment);
  the Lead verified Git-object citations and non-launching CLI evidence and
  recorded the durable blocked matrix without using that observation.
- Cross-change coordination, 2026-08-10: the approved
  `../custom-tile-vertical-slice/` Standard change owns useful runtime discovery
  for its narrow production slice only through a separately authorized smoke.
  This does not authorize, reuse, or unblock this change's unsafe live harness
  or nested-KWin path, and cannot supply this change's feasibility verdict.
