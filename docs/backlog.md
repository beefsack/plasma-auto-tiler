# Backlog

Only meaningful pending or active work is listed.

Live runs are user-owned; agents do not run live cases
([testing](live-kwin-testing.md)). Architecture review claims must be verified
before acting ([review](research/architecture-review/review.md)); user
decisions of 2026-09-24 are under
[Architecture Direction](decisions.md#architecture-direction).

## Open work

- P1 | Ghostty/local native alignment | The ~56 px shortfall is unexplained
  (source-only baseline fix is in; needs a fresh `just dev trace` local-move
  plus follow-on command trace), and one requested `2032x1092` became
  `1920x1036` while another primary Ghostty accepted full size (per-window
  native cap or stale output-derived cap unproven). Hypothesis
  (Orchestrator, 2026-09-28): 1920x1036 equals HDMI-A-2's work area, so the
  window may be constrained to the other output. Next: PC `just dev trace`
  with one tall tiled window on DP-6; check output, bounds and constraints.
  Gates reconciliation phase 2.
  [bounds fix](changes/archive/multi-output-domain-bounds.md)
  [phase 2 parked](changes/learned-size-limits.md)
  [drag investigation](changes/window-alignment-drag-investigation.md)
- P1 | Navigation/movement while maximised | No suppression policy selected;
  semantics await the user's COSMIC comparison.
  [behavior](decisions.md#window-and-workspace-behavior)
- P1 | External NixOS/Home Manager delivery validation | Clean external
  install, update, rollback, and host-matching KWin ABI still unproven
  off the dev machine.
  [change](changes/archive/nix-current-host-delivery.md)
- P2 | Simplify drag preview + cross-output drop code | Post-live cleanup only:
  cut advisory `hover_prior` validation, lag-only fences, verbose comments;
  net deletion, no behavior change.
  [change](changes/archive/cross-output-drag-preview.md)
- P2 | Conflicting host settings detection | User direction (2026-09-29):
  detect KDE/KWin/Plasma settings that conflict with the tiler (e.g. native
  edge/quick tiling, conflicting key bindings), alert via tray icon state or
  a notification, and offer settings-page helpers to correct and ideally
  revert them. Evidence: native edge tiling fired on an off-screen drag
  (trace `~/Downloads/plasma-auto-tiler-dev.H28tD1.log`; our tiler retiled
  correctly after drop) and competed visibly with our Meta-drag preview.
  Interim (user, 2026-09-29): leave as is. Exact KWin setting keys
  unverified; research first.
- P2 | Live sibling reflow while dragging | Deferred, not light (est. several
  hundred to ~1,000 lines, write-fighting risk); research done.
  [research](research/drag-and-drop-reorganisation.md)
- P2 | Robust difference reconciliation | Scope decided (user, 2026-09-28):
  (1) event/next-command detection only, no polling (revisit after testing);
  (2) learn size limits only from settled repeatable evidence; (3) replan
  neighbours around learned limits only, native maximum behavior unchanged;
  (4) KWin script and Rust tiling only, native effect unchanged. Added
  complexity must deliver more value than it costs. Phase 1 (shared
  foreground/hidden classifier, refresh classification logs) passed the
  user's laptop live test at `062d707` (2026-09-28, "felt good and minimally
  janky"; trace `~/Downloads/plasma-auto-tiler-dev.uE1S5n.log`). Quiet
  refresh outcomes were ~60% of refresh log lines. Phase 2 (learned limits)
  parked by the user (2026-09-28) after a candidate exceeded the complexity
  rule; preserved on branch `wip/learned-size-limits`; resumes only if the
  P1 Ghostty/output check leaves a genuine client-held limit.
  [record](changes/archive/robust-difference-reconciliation.md)
  [parked](changes/learned-size-limits.md)
- P2 | PID 3568836 SIGABRT (`QKeySequence` D-Bus abort) | Formally open;
  needs sender, method, and fault-stack evidence before attributing it to
  the effect or script.
  [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- P2 | Integrated Plasma feasibility verdict | Establish a safe structural
  verdict; the unsafe nested path stays stopped.
  [change](changes/integrated-plasma-structural-feasibility.md)
- P2 | JavaScript workload evidence | Sustained-workload evidence before any
  native replacement for discrete window management.
  [change](changes/js-workload.md)
- P2 | Grouped-window stability proof | Multi-window Custom Tile stability
  before selecting grouped or tabbed behavior.
  [change](changes/grouped-windows.md)
- P2 | Keyboard-layout support | After initial release; US keyboards only
  for MVP.
  [change](changes/shortcuts.md)
- P2 | Mainstream install path | Target: single mainstream KDE install
  (distro packages built alongside KWin). OBS is a partial fit with a
  proposed Tumbleweed-then-Fedora POC. Needs the user: OBS account/project,
  Fedora release, neon/Kubuntu pursuit, absent-during-upgrade policy, pacman
  repo vs AUR.
  [research](research/distribution-package-feasibility/feasibility.md)
  [OBS](research/distribution-package-feasibility/obs.md)
- P3 | AR6/AR7 workspace model + portable policy in core | Deferred until a
  non-KWin host needs it; current KWin is the "native workspaces" mode.
  [design](changes/architecture-review-ar6-workspaces.md)
- P3 | Gap-drag anchor | Deferred experimentation incl. gap-0; research complete
  (layer-shell gap surfaces first, KWin input filter fallback; needs a Rust
  split-boundary request).
  [native boundary](decisions.md#native-integration-boundary)
- P3 | Stale branches | Twelve stale branches need explicit user
  authorization before deletion.
  [branches](https://github.com/beefsack/plasma-auto-tiler/branches)
- P3 | Other compositor validation | bspwm, Hyprland, COSMIC runtime
  validation only; pinned-semantics research is not a substitute.
  [comparison](reference-wm-comparison.md)
  [profile research](research/reference-wm-profile-support.md)
- P3 | Artifact publication | KDE Store plus GitHub Release after MVP
  delivery dependencies complete.
  [foundations](changes/archive/delivered-foundations.md)
- P3 | Live workspace-mode switch (post-MVP) | Quiesce, rebuild mapping,
  fresh-adopt without native moves; needs a safe Planner generation
  transition.
  [research](research/live-settings-after-ar15.md)
- P3 | Post-MVP tiling profiles | Re-expose `shortcutProfile` with distinct
  catalogs and live switching when adding new tiling types.
  [change](changes/shortcuts.md)

## Pending live checks

All items below shipped offline with no live result claimed.

### Single-output laptop

- Confirmed live by the user (2026-09-29): tiling gap Save re-spaces tiles
  without restart and the unified settings page shows everything (closes the
  P0 settings live-application launch blocker); group underlay survives
  workspace switches and `just dev` restarts, its settings apply live and it
  slides with workspace transitions; a plain drag released off-screen
  retiles correctly with no `snapshot-invalid` (trace `H28tD1`); mid-drag
  workspace send now tiles the mover on its destination (after `8be1a32`).
  Maximise and fullscreen hide the underlay; tray Settings and Desktop
  Effects Configure open the unified page. KWin Scripts Configure is not
  listed under `just dev` (script loaded from the worktree, not installed);
  verify with an installed package when available.
  [settings](changes/archive/unified-settings-page.md)
  [underlay](changes/archive/group-underlay-and-preview-colors.md)
  [mid-drag](changes/archive/mid-drag-destination-recovery.md)

- Quiet refresh logs: compare `stage=refresh terminal=quiet` under normal
  and trace logging; non-quiet terminals stay visible in both. (Unfloat
  placement and the duplicate-implementation unification were confirmed live
  by the user on 2026-09-28.)
  [change](changes/archive/unfloat-admission-axis.md)
- Same-output drag drops + preview overlay: user confirmed live at
  `826b233` (2026-09-28) that a paused drag stays under the pointer, the
  preview renders well and drops place correctly. Remaining: overlay
  independent of the Meta outline, Esc/cancel/no-Finished clearing.
  [change](changes/archive/cross-output-drag-preview.md)
  [policy](changes/archive/drag-drop-reorganisation.md)
- Drop-intent edge drag leftovers: tiled Meta+left snap-back, Esc/zero-move,
  size-increment client, and the `p13` 36 px bottom-edge shortfall.
  [follow-up](changes/archive/passive-press-move-snapback.md)
- Convergence step-1 leftovers: close/reopen focus, transient unreadable
  frames, minimize/fullscreen/maximize restoration, rapid commands (sticky /
  Meta+G cross-workspace already confirmed live).
  [change](changes/archive/observation-convergence.md)
- Resilience batches: empty-login open, resize completion, Meta+M; group
  bridge demarshalling, modifier/render delivery and performance, including
  outline after config change and close/reopen; endpoint
  `stage=failed`/`available=1` transitions; tray status current.
  [change 3](changes/archive/resilience-change-3.md)
  [change 4](changes/archive/resilience-change-4.md)
  [audit](changes/archive/resilience-audit.md)
  [sweep](changes/archive/fail-closed-sweep.md)
  [bridge](changes/archive/active-group-highlight-design.md)
- Tray icon and login/autostart: confirm panel presence and the worktree tray
  lifecycle under `just dev`; no tray launcher existed in the earlier report.
  [audit](changes/archive/resilience-audit.md)
- Tray Active status under `just dev` (worktree tray): healthy shows Active,
  snapshot loss shows NeedsAttention. Systemd unit checks need a packaged
  Home Manager install: login starts one tray; killing it restarts it; a
  second invocation exits cleanly; logout stops it without a loop; `just dev`
  preserves the packaged owner; tray diagnostics appear once each in
  `journalctl --user` (native journald submission removed).
  [change](changes/archive/tray-and-restart-followups.md)
- Process-loss and sleep recovery cases on the laptop.
  [live plan](changes/archive/recovery-process-sleep-audit.md#live-test-plan)
- Native border delivery and suppression: fresh-session plugin discovery,
  border rendering, and oracle endpoint; fullscreen/any-maximise suppresses
  both outlines; active-border disappearance gets a fresh combined trace if
  it recurs.
  [diagnostics](changes/archive/active-border-visibility-diagnostics.md)
  [decision](decisions.md#native-active-border)
- Sticky adoption restart/re-enable: already-sticky window becomes a normal
  float on the current workspace, then tiles on the next toggle.
  [decision](decisions.md#window-and-workspace-behavior)
- Non-visible workspace tiling: hidden startup/open/move with unchanged
  native focus/desktop and no rendered-state claim.
  [record](changes/background-tiling.md)
- Reliability gates: fullscreen residual-cost gate plus gaming cost baseline,
  maximize-admission clear gate (session-restored maximized app restores,
  tiles, no re-maximize loop), work-area projection gate (resolution/scaling/
  work-area change incl. fullscreen isolation and restoration).
  [investigation](changes/reliability-condition-investigation.md)
- Custom Tile manual runtime check: separately authorized run with exact
  restoration.
  [change](changes/custom-tile-runtime.md)
- Nested placement visual smoke: occupied-leaf whole-rectangle preview and
  nested split placement.
  [change](changes/archive/nested-placement-affordance.md)
- Tray live/release acceptance: KWin-owner snapshots, watcher ordering,
  login/autostart, update/rollback.
  [change](changes/archive/architecture-review-ar13-tray.md)
  [carrier](changes/archive/tray-carrier.md)
- Drag-oracle post-fix proof: rebuild/new session with committed resizes,
  8 px gaps, one planned-applied result, no immediate reconcile.
  [decision](decisions.md#production-interactive-edge-drag)
- Placement-aware startup adoption: fresh near-strip adoption including the
  session-restart case.
  [record](changes/placement-aware-startup-adoption.md)
- KWin controller silent unload (diagnostic only): attribute only with
  before/after `isScriptLoaded`, exact `Script<ID>`, and KWin PID/start
  evidence if it recurs.
  [protocol](live-kwin-testing.md)
- Correlated observability live capture: whole-system lifecycle coverage
  and live capture unproven; per-route offline diagnostics shipped.
  [coverage](changes/archive/observability-coverage-assessment.md)

### Multi-output PC

- Born-fullscreen dogfood: game fullscreen beside tiles (no gap,
  `initial-fullscreen-held`), exit (fresh tile, `initial-fullscreen-released`),
  re-enter/exit (slot retained); optionally close before first exit.
  [change](changes/archive/born-fullscreen-admission.md)
- Directional + shortcut + convergence re-test: shortcut Apply/Force/Revert per
  [shortcut plan](live-shortcut-override-verification.md) (Lock Session
  relocation, Revert, Phase-2 resize chords insofar as not covered there),
  then the observation-convergence steps 2-3 list (startup fit; open/close
  foreground and hidden; float/sticky/maximize/fullscreen restore; gap
  reload; displaced return; hidden admission; sends incl. rapid;
  refusal/close; R4 occupied/empty/failed; follow-once; phantom revisit;
  correlated logs).
  [contract](changes/shortcut-override.md)
  [failures](changes/archive/multi-output-failures.md)
  [snapshot](changes/archive/multi-output-directional-snapshot.md)
  [convergence](changes/archive/observation-convergence.md)
- Cross-output drops at the pointer: occupied and empty destinations (incl.
  native-output lag), source membership removal, preview/drop agreement at
  group edges, center snap-back with hidden preview, wrong-output and refusal
  recovery.
  [change](changes/archive/cross-output-drag-preview.md)
- KWin restart with surviving Planner: all-new window IDs fresh-adopt
  spatially per output (no ID-order rebuild), tray status recovers; script
  reload with shared IDs keeps groups/splits.
  [change](changes/archive/tray-and-restart-followups.md)
- Reconciliation phase 1 (PC): hidden and sticky domains stay quiet without
  ping-pong, unreadable outputs imply no departure, stale replies ignored,
  immediate/delayed send/R4 follow and forced refresh.
  [record](changes/archive/robust-difference-reconciliation.md)
- Process-loss and sleep recovery cases on the PC.
  [live plan](changes/archive/recovery-process-sleep-audit.md#live-test-plan)
- Output hotplug displacement/return: disconnect preserves layouts per
  surviving monitor; reconnect returns workspaces with current contents;
  explicit moves stay at their destination.
  [investigation](changes/reliability-condition-investigation.md)
- Multi-output workspace anti-oscillation: trailing-empty behavior on the
  multi-output machine.
  [runbook](live-oscillation-verification.md)
- Native dev lifecycle removal/dogfood coexistence: removal and
  dogfood-coexistence refusal unverified (startup/discovery already
  accepted).
  [record](changes/archive/native-dev-setup-lifecycle.md)
  [host builder](changes/archive/host-matched-native-development-builds.md)

## Open user decisions

- OBS POC inputs: OBS account/project, GitHub PAT/webhook wiring, Fedora
  release, neon/Kubuntu pursuit, absent-during-upgrade policy, pacman repo
  vs AUR.
  [OBS](research/distribution-package-feasibility/obs.md)
  [research](research/distribution-package-feasibility/feasibility.md)
- Gap-drag gap-0 behavior: deferred experimentation; choose whether a zero-gap
  layout exposes a drag anchor before prototyping.
  [native boundary](decisions.md#native-integration-boundary)
- Borderless-windowed fullscreen heuristic (born-fullscreen option 3): only
  if dogfooding shows games arriving non-fullscreen.
  [change](changes/archive/born-fullscreen-admission.md)
- Navigation/movement while maximised: no suppression policy selected;
  semantics await the user's COSMIC comparison.
  [decision](decisions.md#cosmic-movement-and-groups)

## Known issues and risks

- PID 3568836 SIGABRT (`QKeySequence` D-Bus abort) unattributed; needs
  sender, method, and fault-stack evidence.
  [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- Whole-snapshot `window-out-of-bounds` rejection removed offline
  (2026-09-29); observed out-of-work-area frames are now tolerated drift.
  Watch for any regression where a genuinely foreign window is tiled.
  [change](changes/archive/mid-drag-workspace-recovery.md)
- Ghostty-class shortfalls (~56 px) have no proven native cause; interim
  acceptance can leave a visible gap or reassert the accepted rect when a
  neighbour drifts.
  [bounds fix](changes/archive/multi-output-domain-bounds.md)
  [drag investigation](changes/window-alignment-drag-investigation.md)
  [record](changes/archive/robust-difference-reconciliation.md)
- Sticky pager appearance and Ghostty fullscreen-to-maximise on workspace
  return remain unconfirmed; no native cause or workaround established.
  [behavior](decisions.md#window-and-workspace-behavior)
