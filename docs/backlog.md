# Backlog

Only meaningful pending or active work is listed.

Live runs are user-owned; agents do not run live cases
([testing](live-kwin-testing.md)). Architecture review claims must be verified
before acting ([review](research/architecture-review/review.md)); user
decisions of 2026-09-24 are under
[Architecture Direction](decisions.md#architecture-direction).

## Open work

- P0 | Windows port | KDE-first core extraction finished at K1 (user
  2026-09-30; K2/K3 deferred until Windows needs a shared contract, see
  [extraction](research/cross-platform-core/extraction.md),
  [K2 audit](changes/archive/portable-core-k2-settings-actions.md)).
  User decisions (2026-09-30): Windows 11 x64 only; managed per-monitor
  workspaces required for feature-complete; Meta/Win default shortcuts matching
  KDE (2026-10-01), Windows Snap takeover with a visible off setting, and Win+L
  explicit opt-in; custom-drawing
  underlay experiment with outline fallback; most obvious distribution
  (Store plus signed installer plus winget under evaluation); develop
  natively on the user's Windows 11 PC (also the KDE multi-output PC);
  elevated (administrator) windows unmanaged by default, a user-chosen
  run-elevated option possible later; logical workspace model refined in the
  spikes; shared settings/action intent (deferred K2) and difference
  classification (deferred K3) shaped when Windows needs them. Open: final
  package/update channel. Status 2026-10-02: Phase 1 lifecycle/recovery plus
  WH_KEYBOARD_LL input done and accepted on this single-display PC; Phase 2
  automatic Engine-driven tiling-only dogfood preview verified (no shortcuts,
  input hooks or hiding; stop/crash leaves windows in place). Shortcut slice
  completed with retained-Engine focus/move, default-on keyboard takeover and
  session-only mouse prevention plus explicit CLI off switches. Exact native
  foreground and geometry proof passed the full owned-helper journey
  `20261002-040025-21256`; graceful/crash setting restore and ordinary-app
  default-on/both-off smoke passed. Foreground lock is handled by E8 prime plus
  temporary foreground-thread attachment; the synthetic Shift misrouting was
  a proof-arrow extended-key encoding defect, corrected without changing
  product filtering. Native gates and independent mutation review pass.
  Initial SPI target mix-up was recovered; final arranging is 1 and pen is 35.
  Windows settings UI Apply/Revert, physical shortcuts and Snap
  Layouts/bar/Assist/shake coverage remain pending. Managed workspaces now pass
  current-artifact helper and scoped Notepad/Calculator/Paint journeys: existing
  ordinals, send/follow, trailing empty, independent layouts, identity-safe
  hiding and graceful/crash recovery. Terminal is an ordinary managed app by
  default. The physical send trace exposed a new-target outer-gap mismatch;
  fixed with both-domain regression coverage. Fresh independent review and
  native gates pass. Workspace latency fix 06f9d8d passes scoped helper and
  ordinary-app recovery/timing: 72-124 ms ordinary-app selects, 171-241 ms
  physical select/send trace; user accepts select/send/follow and drag-resize
  usability. [Latency evidence](changes/archive/windows-workspace-action-latency.md).
  Minimum-size hints shipped in 49d4191 and were physically accepted, including
  send into a populated workspace (2026-10-02). Late directional dogfood moves
  match KDE/core R2c/R3; minimum-pinned geometry explains zero visible change.
  [Minimum-size evidence](changes/archive/windows-minimum-size-hints.md).
  [Directional diagnosis](changes/archive/windows-directional-dogfood-diagnosis.md).
  Send split-axis defect fixed in `c4a837b` (shared core): stale destination
  focus after send-away/return now falls back to valid destination focus
  history; minimum sizes did not force the axis. One user return split
  stacked as expected, but a later run (2026-10-03) returned Notepad side
  by side at the right edge, then into the middle; see dogfood defects.
  [Evidence](changes/archive/windows-send-split-axis.md).
  Next: Windows feature parity queue below.
  [Managed workspaces](changes/archive/windows-managed-workspaces.md).
  [Shortcut slice and handover](changes/archive/windows-shortcut-slice.md).
  Full owned-helper proof passed `20261001-222611-6068`: 8/8 gaps at 125%,
  minimize/restore, close reflow, graceful/emergency stop preserving frames,
  11 owned writes and zero foreign writes; clean recovery. Normal-mode smoke
  `20261001-223101-30052` passed Notepad/Calculator/Paint/Terminal admission,
  true new-window open/close, Calculator minimize/restore and unchanged stop
  frames. Paint held 617px against a 543px plan, causing 66px overlap; minimum-
  size neighbour replanning was an initial preview limitation, resolved by the
  accepted minimum-size hints. Standard native gates
  passed; multi-monitor/mixed-DPI, gestures and games remain unaccepted.
  See [Phase 2 record](changes/archive/windows-phase2-tiling.md).
  [plan](research/windows-port/plan.md)
  [decision](decisions.md#windows-port)
  Day-one setup and pending governance: [Windows development environment](windows-dev-environment.md).
- P0 | Windows feature parity queue | User order (2026-10-02), each matching
  KDE behavior and bindings: (1) active window border done (`b5374ce`, native
  gates/CI and scoped composed-pixel/live routes pass;
  [evidence](changes/archive/windows-active-border.md); temporary development
  default `#ffff00` with theme off, `3fcc953`); (2) group underlay stages A/B
  done (`cb790d9`; [evidence](changes/archive/windows-group-underlay.md)), C
  (unfocused dragged subject) parked for reassessment with item 7;
  (3) maximise done (`1be97a1`, Win+M; [evidence](changes/archive/windows-maximise.md);
  physical button/input/feel checks remain); (4) fullscreen shipped
  (`e84b1a7`, Win+F11; [evidence](changes/archive/windows-fullscreen.md));
  (5) float shipped (`d8329e3`, Win+G; [evidence](changes/archive/windows-float.md));
  (6) sticky float shipped (`292d8c1`, Win+Shift+G;
  [evidence](changes/archive/windows-sticky-float.md)). Live acceptance of
  4-6 is user-owned: agent runs were disturbed by Xbox mode (cloaked
  `ApplicationFrameWindow` foreground, DWM cloak 0->2;
  [record](changes/archive/windows-foreground-acceptance.md)). Next
  (7) mouse drag window move; (8) mouse drag drop-zone square (preview);
  (9) multi-output support; (10) taskbar item showing workspaces (design to be
  discussed with the user; no presentation mechanism selected); (11) settings
  (UI with Apply/Revert parity, including Snap takeover off; decide the final
  accent/configured border default and remove the temporary yellow default;
  per-binding OS-conflict list with compatible/authentic quick-set presets,
  possibly offered on first run; [decision](decisions.md#cross-platform-behavior)).
  Provisional choices 2-6 accepted by the user (2026-10-03).
- P0 | Windows gaming coexistence | User (2026-10-03): (a) authentic mode
  until settings exist: our bindings must not leak to OS shortcuts (Win+G
  opened Xbox Game Bar when the foreground was unmanaged, and Xbox mode was
  entered during agent tests; user dogfood 2026-10-03: Win+F11 entered Xbox
  mode, so Win+F11 collides with the OS full screen experience shortcut);
  (b) detect Xbox mode (full screen
  experience), pause tiling, effects and shortcuts, remember windows and
  workspaces, restore on exit; (c) research alternate Game Bar access and
  anti-cheat false-positive risk (LL keyboard hook, overlays, window
  moves). Status 2026-10-03: (a) authentic containment offline-verified,
  CI green (`962b0f3`, `5746fca`; the Win+F11 leak was our deliberate
  pass-through). Physical test after those commits FAILED: Win+F11 still
  opens the Xbox mode prompt and Win+G still opens Game Bar (traces
  `run-01dd53116aa74f37.log`, `run-01dd5311a7282421.log`). (b) user chose
  documented-signal-only detection (2026-10-03); blocked until one exists.
  (c) researched; alternate Game Bar access deferred (see Future).
  [record](changes/windows-gaming-coexistence.md)
  [decision](decisions.md#cross-platform-behavior)
- P0 | Windows dogfood defects (user 2026-10-03, 4 windows, trace
  `%LOCALAPPDATA%\plasma-auto-tiler\session-1\run-01dd530861947ef5.log`):
  (a) initial tiling produced splits on one axis only, where a 2x2 (split
  plus a cross split on each side) was expected; minimum sizes may explain
  it, unproven; (b) Win+M unmaximise briefly left windows overlapping until a
  later retile. Later runs (traces under the same folder):
  (c) `run-01dd53116aa74f37.log`, 5 windows (Firefox, Steam, Terminal,
  Notepad, Paint): only Terminal and Notepad tiled, both on the right of the
  screen; cause (rejection or defect) unknown; (d) `run-01dd5311a7282421.log`,
  3 windows tiled correctly at start; Notepad send to workspace 2 and back
  split side by side at the right edge, a second round trip split side by
  side in the middle.
- P1 | Shortcut conflict model on KDE and macOS | Per-binding conflict list
  plus compatible/authentic presets (user 2026-10-03); KDE builds on its
  existing shortcut override Apply/Force/Revert; macOS when it starts.
- P2 | Hidden-workspace Alt+Tab option | Investigate whether official Windows
  APIs can include hidden-workspace windows in Alt+Tab. Future optional behavior,
  not critical; no design selected.
- P1 | Cross-platform functional specification | After the Windows tiling
  dogfood slice, define window/workspace behavior and keyboard shortcuts as
  the single source of truth for Linux, Windows and macOS. KDE is the current
  behavioral reference; macOS modifier mapping is decided when macOS starts.
  cosmic-comp (user favourite: n-ary splits, join/leave UX) is a key input.
  User proposal (2026-10-03): a reference-WM outcome matrix (action
  scenarios x input WMs such as COSMIC, Hyprland, bspwm, i3, xmonad) as the
  source of truth feeding the spec and its supported variants (for example
  n-ary vs binary splits); retrofill COSMIC outcomes from tests already
  done; every behaviour ambiguity adds a row the user can fill later when
  source code cannot answer it. Format pending user confirmation.
- P2 | Prior-art catalogue upkeep | Completed 2026-10-03 (`e4c1d92`):
  [maintained index](research/prior-art.md), grouped by desktop and type
  (compositor-native vs host-integrated) with algorithm families,
  mechanisms, workspaces, licences and clone inventory. Deferred to a
  Linux/macOS session: FancyWM core submodules, niri/sway/river/awesome/dwm
  source analysis (web-only now). Keep it updated as projects are studied.
  [Evidence](changes/archive/prior-art-catalogue.md).
- P1 | Cross-platform dev environment (mise) | Approved (user 2026-10-03):
  root `mise.toml` for Windows/macOS toolchains, devenv stays on Linux,
  minimal `AGENTS.md` update. Before macOS starts.
  [decision](decisions.md#windows-port)
- P1 | Windows reference-WM comparison | Compare glazewm (Rust) and komorebi
  (cloned under `~/Development`) with our Windows implementation; record
  learnings (hiding, input, recovery, multi-monitor, gaming coexistence).
- P1 | macOS port | Work expected soon (user 2026-10-03). Readiness research
  done (`f095042`): setup/TCC/signing runbook, sourced prior-art survey and
  tentative plan, which recommended public AX/AppKit. User direction
  (2026-10-03) supersedes that default: lower-level, lower-jank yabai-style
  route first, optional higher-level AeroSpace-style alternative later;
  default tier 2 (public plus private APIs, SIP enabled, no Dock injection).
  Next: revise the plan from local sources (yabai, AeroSpace, Amethyst,
  GlazeWM macOS backend, Rift, komorebi-for-mac) with exact tier-2
  mechanisms; confirm host/floor/Intel, stable signer and modifier mapping.
  [setup](macos-dev-environment.md)
  [survey](research/macos-port/prior-art.md)
  [plan](research/macos-port/plan.md)
- P1 | Rust toolchain tracking (recurring) | User (2026-09-30): track latest
  stable Rust pre-1.0 and fix breakage. Windows uses rustup `stable`; Linux
  and CI get Rust from the nixpkgs pin in `devenv.yaml`, which must be bumped
  regularly to stay close to stable. Revisit the upgrade process at 1.0.
- P1 | Tray tiling/floating workspace toggle | Shipped `e407531`; user
  confirmed live (2026-09-29) that toggling a workspace floating and back to
  tiled behaves as expected. Remaining live: default change, cross-boundary
  send (see Pending live checks). Tray invokes a keyless KWin script shortcut
  action over KGlobalAccel; the default is
  `kwinrc [Script-plasma-auto-tiler-kwin] defaultTiled`. Simplicity review
  done offline (2026-09-29): duplicated cache recovery consolidated, the
  rest kept as earning its place.
  [change](changes/archive/tray-workspace-toggle.md)
  [review](changes/archive/tray-toggle-simplicity.md)
- P1 | Group underlay on window movement only | User (2026-09-30): show the
  underlay only while moving windows, replacing Meta-held. Staged: A
  Meta+Shift hold; B focused-window interactive move (Meta+drag, title-bar
  drag); C unfocused dragged-window support. Move-only, hard-coded. Stop and
  report if any stage (especially C) grows complex. Next: stage A.
  [change](changes/group-underlay-move-trigger.md)
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
  Windows and macOS both need project-managed workspaces, so the trigger
  arrives with either port; extraction order and gates are in the
  cross-platform audit.
  [design](changes/architecture-review-ar6-workspaces.md)
  [audit](research/cross-platform-core/extraction.md)
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

## Future

Unprioritised ideas; not scheduled.

- Windows app-owned fullscreen UX spike: options for exiting/toggling
  fullscreen an application entered itself (user 2026-10-03, later).
- Windows alternate Game Bar shortcut experiment: keyboard and mouse players
  need a shortcut that opens Game Bar over a fullscreen game (for example
  Xbox voice chat); Start menu and controller access are not enough (user
  2026-10-03, after parity and correctness work).
- Windows sticky restart analogue improvement: current restart turns sticky
  windows into normal floats (user 2026-10-03, acceptable for now).

- Uninstall revert of host settings: reset our overridden KDE settings to
  defaults on uninstall. Parked by the user (2026-09-29) pending research,
  possibly via package manager hooks; no verified per-user hook exists for
  Nix/Home Manager, KDE Store or distro packages. Users can use the
  settings-page Revert buttons meanwhile.
  [research](changes/archive/host-settings-conflicts.md)

## Pending live checks

All items below shipped offline with no live result claimed.

### Single-output laptop

- Tray workspace toggle: floating/tiled toggling confirmed live by the user
  (2026-09-29). Remaining: default change logs `stage=persist
  ... outcome=written`, `plan:config-reloaded stage=default-tiled`, applies
  to new workspaces and to all workspaces after a session restart;
  cross-boundary send is a native move with tiled-side reflow. Red flags:
  geometry changes while floating, menu check disagreeing with KWin, re-tile
  without confirmed release, `native-failed` sends, a physical key bound to
  the keyless action.
  [change](changes/archive/tray-workspace-toggle.md)
- Active border skips Plasma applet popups (user option A, 2026-09-29;
  KRunner out of scope for now): with an ordinary bordered window active,
  opening the Application Launcher or a tray popup hides the border and logs
  `active-border:visible vis=0 reason=applet-popup appletPopup=1`; closing
  it and refocusing restores `vis=1 reason=eligible appletPopup=0`; ordinary
  dialogs and tool windows keep the border. Red flags: border on the
  launcher, `appletPopup=0` while the launcher is active. If more shell
  surfaces still get the border, tighten further.
  [decision](decisions.md#native-active-border)
- Host settings Revert and tray conflict indicator: Fix confirmed live by the
  user (2026-09-29). Remaining: Revert removes the local key and native edge
  previews return (one `op=revert setting=<key> outcome=ok reason=ok` line
  per click). Tray (fresh session): with a conflict, a `dialog-warning`
  overlay on the icon and a top "Conflicting KDE settings..." menu row that
  opens Settings; Fix clears both without a tray restart and logs one
  `outcome=conflict-updated conflict=false`; Revert brings them back with one
  `conflict=true`. Red flags: stale overlay/row, repeated conflict lines on
  heartbeats, left-click no longer opening the menu, snapshot-loss
  `NeedsAttention` changed.
  [change](changes/archive/host-settings-conflicts.md)

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
- Startup adoption recursive-cut fit (user decision 2026-09-29, replaces the
  near-strip fit): user confirmed live (2026-09-29) it works really well
  restarting over a previously tiled workspace. Remaining: confirmed
  Planner-loss fresh session; centre-split fallback for overlapping
  free-floating windows (user option B, shipped offline): two overlapping
  windows tile in position order with proportionate shares, `adoption-fit
  outcome=fitted ... centre_splits=1`; restarting over the result logs
  `centre_splits=0` with equal-rect skips. Red flags: fallback for distinct
  centres, reversed order, centre splits on clean tiles.
  [record](changes/placement-aware-startup-adoption.md)
- KWin controller silent unload (diagnostic only): attribute only with
  before/after `isScriptLoaded`, exact `Script<ID>`, and KWin PID/start
  evidence if it recurs.
  [protocol](live-kwin-testing.md)
- Correlated observability live capture: whole-system lifecycle coverage
  and live capture unproven; per-route offline diagnostics shipped.
  [coverage](changes/archive/observability-coverage-assessment.md)

### Multi-output PC

- Core extraction K1 visual policy: laptop confirmed by the user
  (2026-09-30: active border, fullscreen/maximise suppression, group
  underlay, drag preview). Remaining: border, underlay and preview remap
  correctly across outputs with differing scales/origins.
  [change](changes/archive/portable-core-k1-visual-policy.md)
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
