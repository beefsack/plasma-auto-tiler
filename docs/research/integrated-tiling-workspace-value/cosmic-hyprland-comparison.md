# COSMIC Epoch 1.5.0 and Hyprland v0.56.2: Source Audit Report

- Unit: `unit-03/attempt-02` (reopened 2026-08-10 per plan Amendment Status;
  adds the structural-authoring/direct-placement workflow evidence: J9-J10,
  D9.1-D9.6, D4.8-D4.11, and the pinned bounded bspwm structural reference).
- Role: source/design research only. No live desktop/session interaction, no
  installation, no configuration or system/devenv change, no compositor/session
  restart, no local introspection, no `sustained-workload-validation` contact.
- Evidence date: 2026-08-09 for the retained J1-J8 / D4.1-D4.7 evidence;
  2026-08-10 for the structural-workflow evidence added by attempt-02 (each new
  record carries its own retrieval date).
- Scope: audit COSMIC Epoch 1.5.0 (Pop!_OS 24.04 rolling packaging pin
  `cosmic-comp 1:1.5.0`) and Hyprland v0.56.2 against the accepted rubric
  `research/evaluation-rubric.md`, applying its section 10 evidence-record model
  to every J1-J10 cell and to D4.1-D4.11, establishing a coherent baseline
  configuration per comparator, separating built-in behavior from optional
  ecosystem components, and recording bspwm 0.9.12 strictly as the bounded
  structural-interaction reference (rubric section 2.3) within this report.
- Boundary: this is NOT a product conclusion. Decision Rule mapping is unit-05.
  Unknowns are explicit; no comparator failure is assumed. This report is the
  unit-03 acceptance evidence for `plan.md` unit-03.
- Correction history (retained): unit-03/attempt-01 accepted 2026-08-09
  (log.md); attempt-02 adds the J9-J10 / D9 / D4.8-D4.11 cells under the
  amended rubric and the bounded bspwm reference within this report. No prior
  cell is removed or re-scored; the accepted COSMIC `autotile=false` correction
  (unit-04/attempt-01) is retained exactly as ONE J1/D6.1 MF and is not
  altered or re-counted here.

## 1. Scope, Versions, Evidence Date, and Source-Quality Rules

### 1.1 Comparators and pins (from rubric section 2)

| Comparator | Baseline | Pinned identity | Pin evidence |
|---|---|---|---|
| COSMIC | COSMIC Epoch 1.5.0 (cosmic-comp compositor + COSMIC shell), Wayland session | Epoch tag `epoch-1.5.0`, commit `0ce7ec30ac05416e9a85465404be548ced89cba6`, released 2026-07-29; submodule pins at that tag: cosmic-comp `81cd5fdbaa41c3973369ae85bccf829137836e20`, cosmic-workspaces-epoch `8faab4c2a92f438a704d072e3c5aa9526d2acc88`, cosmic-settings `7287257ec9f2ca301642bd4800f391ad9079d3e9`, cosmic-panel `d6699ffc423a3830bf4cab7e2c7f08a173e998f0`, cosmic-session `b5ef6c0c0d68762b2991e4f5906cc70599e2f1fc`, cosmic-settings-daemon `e37160f14d1e7ee428f973cd2848b4e95f83dfe1`; Arch `cosmic-comp 1:1.5.0` | C-01, C-02, C-33 |
| Hyprland | Hyprland dynamic-tiling Wayland compositor, Lua config era | tag `v0.56.2`, commit `efb50993780079460b0cbed1363e2166a2de1d9f`, released 2026-08-05 | H-01 |

COSMIC identity note: `epoch-1.5.0` is a maintenance release (bug fixes,
translation updates); no tiling/workspace feature changes are listed in its
release notes (C-01). The compositor submodule (`cosmic-comp`) is the
authoritative source for the workspace/tiling/focus semantics assessed here and
is pinned at the tag's gitlink commit (C-02). The rubric's pinned Pop!_OS
24.04 rolling packaging (`cosmic-comp 1:1.5.0`) matches the Epoch tag line
(C-33).

Hyprland identity note: since Hyprland 0.55 the config language is Lua;
hyprlang is deprecated (H-22). The first-run config generator writes a stub
config that points to the shipped reference config `example/hyprland.lua`
(H-02). The wiki is maintained as "latest git", not per-version; wiki pages are
cited as snapshot docs on the evidence date and never sole-support a semantic
claim where source inspection establishes it.

Attempt-02 structural pins (retrieved/verified 2026-08-10): all structural
claims below were read from local clones of the pinned identities - cosmic-comp
commit `81cd5fdbaa41c3973369ae85bccf829137836e20`,
cosmic-settings-daemon commit `e37160f14d1e7ee428f973cd2848b4e95f83dfe1`
(shortcut/action surface), Hyprland commit
`efb50993780079460b0cbed1363e2166a2de1d9f` (tag v0.56.2), and bspwm commit
`c5cf7d3943f9a34a5cb2bab36bf473fd77e7d4f6` (tag 0.9.12). The bspwm reference is
bounded by rubric section 2.3: structural authoring and direct placement only -
split type/ratio, preselect/manual insertion, automatic schemes, receptacles,
state dump/load. No desktop-wide, multi-output, installation, workspace,
indication, or broad lifecycle claim is made for or from bspwm (rubric sections
2.3, 3.5; spec Evidence Standards). Rubric unknown U11 is resolved in section
4B: the default sxhkd binding set does not expose pointer preselect/split and
bspwm's own pointer actions are move/resize/focus only, so bspwm provides no
pointer-directed drag-to-split placement (D9.3 = CB reference, explicit
negative).

### 1.2 Source-quality rules applied

- Prefer current upstream source and official documentation; record version,
  retrieval date, source type, and exact capability semantics per claim.
- Secondary sources (news coverage, third-party bars/scripts) provide discovery
  context only and never sole-support a capability result.
- Every favorable and every unfavorable result carries a direct evidence
  record. Documentation silence is recorded as UK, never as a negative finding.
- No live desktop/session interaction of any kind was performed. No comparator
  was installed, configured, or run; no system or devenv file was touched.

## 2. Baseline Install-Enable-Configure Paths and Optional-Component Boundary

### 2.1 COSMIC Epoch 1.5.0 baseline (rubric 3.3)

COSMIC is a shipped desktop (compositor + panel + settings + workspaces overlay
as one release, `epoch-1.5.0`); nothing extra must be installed for the
journeys. The compositor configuration lives in cosmic-config namespaces
(`com.system76.CosmicComp`, `com.system76.CosmicSettings.Shortcuts`,
`com.system76.CosmicWorkspaces`, `com.system76.CosmicSettings.WindowRules`),
read at startup and watched for live updates.

| Step | Documented path | Evidence |
|---|---|---|
| Install: Pop!_OS 24.04 ships COSMIC Epoch 1 as the session (release ISO or rolling packaging); Arch package `cosmic-comp 1:1.5.0` | C-31, C-33 |
| Enable: select the COSMIC session at login (Wayland); nothing to install | C-31 |
| Autotile: shipped config default `autotile=false`; enabling is a single documented toggle, `ToggleTiling` bound to Super+y (Global behavior persists `autotile` to config and applies live); no restart required | C-03, C-14, C-29 |
| Workspace model: default `workspace_mode=OutputBound` (each output has its own workspace set); `Global` mode is an explicit Settings option; `workspace_layout` default `Vertical`; `workspace_wraparound` default true | C-04, C-28 |
| Tiling: binary-split tree per workspace; new windows insert as sibling splits; orientation toggle (Super+o), stacking (Super+s), per-window float (Super+g), swap (Super+x), resize (Super+r / Super+Shift+r) | C-14, C-20, C-21 |
| Focus/move: Super+arrows/hjkl directional focus (with the default Vertical layout, Up/Down fall through to Previous/NextWorkspace at the workspace edge and Left/Right fall through to SwitchOutput at the output edge; the mapping swaps under the Horizontal layout); Super+Shift+direction moves; Super+Shift+Alt+direction moves to next output; Super+Ctrl+direction switches workspace; Super+1-9 / Super+Shift+1-9 workspace switch / move-to-workspace | C-14, C-15, C-16 |
| Workspaces: dynamic (auto-create empty at end, auto-remove empty non-active); pinned workspaces persist across sessions with their output identity | C-07, C-12, C-13 |
| Indication: on-demand Workspaces overlay (Super+w) shows per-output workspaces; `show_workspace_name`/`show_workspace_number` configurable; no persistent per-output workspace indicator ships in the default panel | C-14, C-28, C-32 |
| Exceptions: shipped `tiling-exceptions.ron` regex rules plus per-app rules editable in Settings; dialogs/transients/fixed-size windows auto-float | C-22, C-23 |

Baseline-config note (rubric 3.3 vs source, resolved in unit-04/attempt-01):
the rubric states the COSMIC baseline is "default configuration, with its
built-in tiling enabled as shipped." Source shows the shipped default
`CosmicCompConfig::autotile` is `false` (C-03). Per the accepted scoring
correction, the source default is scored as ONE enablement/configuration
friction in J1 coherence only (D6.1 = MF; the one-step, live-applying,
persisting Super+y toggle, C-14/C-29, is the friction). It is NOT scored as
tiling-workflow friction (J1 D2.1 stays PD, evaluated against the rubric's
explicitly enabled-tiling baseline) and is NOT double-counted in the other J1
cells (D6.2, D7.1, D8.5 stay PD).

### 2.2 Hyprland v0.56.2 baseline (rubric 3.4, unknown U6 resolved)

Hyprland is a compositor only; it ships no bar, panel, or indicator. The
baseline is the compositor plus its config file. The first-run generator writes
a stub config (`DefaultConfig.hpp` `EXAMPLE_CONFIG`) whose content directs the
user to the shipped reference config `example/hyprland.lua` (H-02). The
baseline config for this audit is the shipped `example/hyprland.lua`
(dwindle layout default, monitors auto, animations on, the example binds listed
below) **plus the documented `movewindow` and `swapwindow` binds** required by
J3/J5, which the example leaves unbound but which are wiki-documented
dispatchers assignable through the standard config surface (H-03, H-23). This
is a documented-configuration decision under rubric 3.4's bounded standard
("minimal documented configuration that supports the rubric journeys without
hacks"); it is not an optional ecosystem component.

| Step | Documented path | Evidence |
|---|---|---|
| Install: distribution package (e.g. Arch `hyprland`); session launched via `Hyprland` binary / wayland-session | H-01 |
| Enable: login session; first run generates `~/.config/hypr/hyprland.conf` (stub) if absent | H-02 |
| Configure: config file is the surface; changes apply via `hyprctl reload` (documented, no restart); Lua config since 0.55 | H-02, H-22, H-23 |
| Layout: `general.layout = "dwindle"` default; master/scrolling/monocle selectable | H-03, H-23 |
| Focus: Super+arrows movefocus (directional, cross-monitor capable by default `binds:window_direction_monitor_fallback=true`) | H-03, H-11, H-12 |
| Move: baseline adds Super+Shift+direction `movewindow` (cross-monitor capable) and `swapwindow` binds | H-13, H-23 |
| Workspaces: Super+1-0 focus; Super+Shift+1-0 move-to-workspace; Super+scroll `e+1`/`e-1`; `previous`; special workspaces (Super+S) | H-03, H-15 |
| Workspace model: global workspace IDs, each workspace shown on one monitor at a time; per-monitor binding is an explicit `workspace=` rule (`monitor:`); persistent via `persistent` rule | H-04, H-06, H-07, H-08 |
| Groups/tabs: groupbar enabled by default; `togglegroup`/`changegroupactive` dispatchers | H-17, H-23 |
| Exceptions: `hl.window_rule` match by class/title/workspace with float/move/workspace/etc. properties | H-19, H-03 |
| Indication: none shipped; `hyprctl workspaces` is the CLI surface; `ext-workspace-v1` protocol exists for third-party bars (optional, excluded per rubric section 4 standard) | H-23, H-15 |

### 2.3 Optional-component boundary

- COSMIC: no companion components are admitted. Everything the journeys use
  (compositor tiling/workspace/focus, panel, settings, workspaces overlay) is
  part of the shipped Epoch release.
- Hyprland: third-party bars (waybar, eww), launchers, notification daemons,
  wallpaper utilities, and hyprpm plugins are **not** part of the baseline.
  Where a journey cell (D4.5/D5.1 indication) is gated on a bar, the cell is
  classified against the raw compositor baseline and recorded; a bar is never
  added to erase the gap.

## 3. Complete J1-J10 Comparison Matrix

Classifications: CB (critical blocker), MF (material friction), PD (preference
difference), FT (feature trivia), UK (unknown). Ownership:
C = COSMIC (integrated Epoch release), H = Hyprland (compositor + config),
X = composition/version note.

### J1 Onboard and enable

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D2.1 First app tiles on launch | PD. Dynamic tiling on window add when enabled; first app tiles via split insertion. C-23, C-20 / C | PD. New windows auto-tile in dwindle on launch. H-03, H-13 / H |
| D6.1 Install/enable/configure coherence | MF. Shipped desktop; no install, but the shipped source default `autotile=false` (C-03) means a fresh baseline does not tile until the documented one-step toggle Super+y is pressed; the toggle persists and applies live (C-14, C-29). One enablement/configuration friction scored in J1 coherence only; not double-counted in other J1 cells (unit-04/attempt-01). C-03, C-14, C-29, C-31 / C | PD. Package install; config file surface; stub generated on first run pointing to the shipped reference config. H-02, H-22 / H |
| D6.2 Config applies without session restart where documented | PD. cosmic-config watch applies changes live (autotile toggle applies immediately; settings keys watched). C-03, C-29 / C | PD. Config surface is the file; documented `hyprctl reload` applies without restart. H-23 / H |
| D7.1 No manual rescue step in normal use | PD. No reboot/restart required to enable tiling. C-29 / C | PD. No restart required for config changes (reload documented). H-23 / H |
| D8.5 Temporary disablement | PD. Super+y toggles tiling globally (persists) or per-workspace in PerWorkspace mode; Super+g floats a window. C-14, C-29 / C | PD. Super+V toggles per-window float (per-window branch of the criterion); layout state retained. H-03 / H |

### J2 Daily launch and placement

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D1.2 Workspace retention on close-all | PD. Dynamic model: closing all windows leaves the workspace until auto-removal; `ensure_last_empty` keeps the active or trailing empty workspace and removes other empties; policy deterministic. C-07 / C | PD. Workspaces persist after creation; no empty-workspace auto-removal found in source; policy stable and predictable. H-16 / H |
| D1.6 Recovery after session restart | UK. No compositor-side window session restore: session socket carries only `SetEnv`; `cosmic-session` is a systemd session manager without window restore; only pinned workspaces persist. C-26, C-27, C-12 / U | UK. No session-restore implementation found in source (no xdg-session-management handler); restore relies on user `exec` autostart and app behavior. H-20 / U |
| D2.1 Initial placement | PD. New windows insert as a sibling split sized by geometry; predictable, no overlap. C-20, C-23 / C | PD. Dwindle split insertion is deterministic; no overlap. H-13 / H |
| D2.3 Insertion | PD. Additional windows split the focused/root node and reflow; closing refills. C-20 / C | PD. New windows split a sibling and reflow. H-13 / H |
| D3.1 Directional focus | PD. Super+arrows/hjkl focus within the layout; at a workspace edge focus falls through to the previous/next workspace (layout primary axis; Up/Down for the default Vertical layout) or the next output (other axis; Left/Right for the default Vertical layout); lands on a visible window. C-15, C-14 / C | PD. `movefocus` resolves a window in direction over all windows; with `window_direction_monitor_fallback=true` (default) candidates on other monitors are eligible; `general:no_focus_fallback=false` (default) falls back to the nearest window. H-11, H-12 / H |
| D7.2 No observable degradation under repeated actions | UK. No source/docs evidence; performance measurement is a non-goal (spec Non-goals). C-30 / U | UK. No source/docs evidence for repeated-action degradation; non-goal. H-21 / U |

### J3 Focus and relocate during a task

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D1.5 Migration to another workspace | PD. Super+Shift+1-9 `MoveToWorkspace` moves the window and re-tiles it on the target workspace; float state handled per window. C-14, C-16, C-23 / C | PD. Super+Shift+1-9 `movetoworkspace` moves the window; window re-tiles on the target workspace. H-03 / H |
| D2.2 Layout changes reflow | PD. Orientation toggle (Super+o), stacking (Super+s), resize (Super+r) reflow the tree predictably with animation. C-14, C-20, C-21 / C | PD. `togglesplit`, layout cycle, and `layoutmsg` reflow the layout predictably. H-03, H-23 / H |
| D3.1 Directional focus | PD (see J2). / C | PD (see J2). / H |
| D3.2 Move/swap window | PD. Super+Shift+direction moves within the tree (creating groups/reflow); `SwapWindow` (Super+x) swaps via overview grab; move to another workspace/output documented. C-14, C-16, C-18 / C | PD. `movewindow` (directional, bound in baseline) and `swapwindow` move/swap within and across monitors; cross-monitor move by default. H-13, H-14, H-23 / H |
| D3.3 Cross-workspace focus | PD. Focus falls through to workspace switch at edges; `MoveToWorkspace`; focus lands deterministically. C-15, C-16 / C | PD. `focus` on a window on another workspace changes workspace first; `movefocus` respects workspace boundaries (same-monitor hidden-workspace windows excluded). H-11, H-15 / H |
| D3.4 Focus/click consistency | PD. Per-seat focus stack; keyboard and pointer focus consistent; layout position derived from the window model. C-05, C-06 / C | PD. Follow-mouse and keyboard focus managed in one focus state; consistent. H-11, H-12 / H |
| D7.1 No rescue step | PD. Focus/relocate actions have no documented rescue step. / C | PD. No rescue step in normal use. / H |

### J4 Multi-window session with mixed types

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D2.4 Stack/tab behavior | PD. `ToggleStacking` (Super+s) converts a node to a stack (tabbed); new windows over a focused stack are added to it; stack windows move in/out. C-21, C-23 / C | PD. Groups with groupbar are enabled by default (`group:groupbar:enabled=true`); `togglegroup`/`changegroupactive` documented. H-17, H-23 / H |
| D2.5 Mixed tiling/floating | PD. Dialogs/transients/fixed-size windows auto-float (`is_dialog`); regex tiling exceptions; `ToggleWindowFloating` (Super+g); floating survives focus/layout changes. C-22, C-23, C-14 / C | PD. `togglefloating` per window; floating windows coexist with tiled; float state survives layout switches. H-03 / H |
| D8.1 Float a window | PD. Super+g toggles floating. C-14 / C | PD. Super+V toggles floating. H-03 / H |
| D8.2 Fullscreen | PD. Super+F11 toggles fullscreen; `map_fullscreen` stores restore state (`FullscreenRestoreState`), returns to prior tiled/floating state on exit. C-14, C-24 / C | PD. `fullscreen` dispatcher with layout-managed fullscreen; fullscreen windows are not re-tiled; restore on exit. H-18 / H |
| D8.3 Manual override | PD. `Resizing` (Super+r / Super+Shift+r) resizes the focused window and the tree reflows; drag-and-drop re-tiles at the drop position; free placement is the float path. C-14, C-20 / C | PD. Mouse drag (Super+LMB) and resize (Super+RMB) move/resize; floating windows free-place; tiled drag re-tiles predictably. H-03 / H |
| D8.5 Temporary disablement | PD (see J1). / C | PD (see J1). / H |
| D7.1 No rescue step | PD. No rescue step in mixed-session use. / C | PD. No rescue step in mixed-session use. / H |

### J5 Multi-output working session

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D3.2 Cross-output move | PD. Super+Shift+Alt+direction `MoveToOutput` moves the window to the next output; `move_current` places it on the target output's active workspace and re-tiles; focus follows for Move (SendToOutput does not). C-14, C-18 / C | PD. `movewindow` with `window_direction_monitor_fallback=true` (default) assigns the window to the focal monitor's active workspace. H-13, H-12 / H |
| D4.1 Workspace model global vs output-local | PD. Default `OutputBound`: each output has its own `WorkspaceSet` and workspace list; `Global` mode is an explicit Settings option; the model is visible and documented. C-04, C-05, C-28 / C | PD. Global workspace IDs, one `m_activeWorkspace` per monitor; per-monitor binding is an explicit `workspace=` rule (`monitor:`); the model is explicit and documented. H-04, H-06, H-07 / H |
| D4.2 Directional focus/move across outputs | PD. Directional focus falls through to `SwitchOutput` at an output edge; directional move falls through to `MoveToOutput`; dedicated Super+Alt/Super+Shift+Alt output actions exist. C-15, C-16, C-17, C-18 / C | PD. `movefocus` and `movewindow` cross monitor boundaries by default (`window_direction_monitor_fallback=true`); `focusmonitor` dedicated action. H-11, H-13, H-23 / H |
| D4.3 Lifecycle across outputs | PD. Per-output sets; removing an output migrates its workspaces (auto-removing empty ones) and merges sticky/minimized windows into a remaining output; adding an output reclaims workspaces that prefer it; other outputs untouched. C-08, C-09 / C | PD. Moving a workspace off a monitor triggers "plug gap" (a next workspace is created/assigned on the old monitor); windows follow their workspace; pinned windows stay. H-07 / H |
| D4.5 Per-output indication | MF. No persistent per-output workspace indicator ships in the default panel (the panel only reacts to the overlay being shown); at-a-glance per-output workspace state requires invoking the on-demand Workspaces overlay (Super+w), which shows each output's workspaces with active/name/number. C-14, C-28, C-32 / C | MF. The baseline compositor ships no visual indication at all; per-output workspace state is queryable only via `hyprctl workspaces` (CLI); a persistent indicator requires an external bar (optional, excluded from the baseline). H-23, H-15 / H |
| D4.6 Window/layout preservation | PD. Windows follow their workspace across output changes; tiled/floating/fullscreen state preserved; `output_stack` records output history for return. C-09, C-06 / C | PD. Moving a workspace moves its windows (floating/fullscreen repositioned); tiled state preserved; pinned windows stay. H-07, H-09 / H |
| D5.1 See/name workspaces, know current per output | PD. Workspaces carry id/name; the overlay shows names/numbers per output (`show_workspace_name`/`show_workspace_number`); on-demand view, no naming gap. C-28, C-14 / C | MF. Workspaces are named (`renameworkspace`, `defaultName`) and listed via `hyprctl workspaces`, but there is no visual per-output view of current workspaces in the baseline. H-23, H-06 / H |
| D5.2 Navigation without state loss | PD. Super+Ctrl+direction, Super+1-9, Super+w overview, touchpad gestures; focus/layout persist across switches. C-14 / C | PD. Super+1-10, `e+1`/`e-1`, `previous`, special workspaces; state persists. H-03, H-15 / H |
| D7.2 Repeated high-frequency actions | UK (see J2). / U | UK (see J2). / U |

### J6 Dock, undock, hotplug

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D1.6 Recovery | UK (see J2). / U | UK (see J2). / U |
| D4.4 Connect/disconnect/reconnect | PD. `add_output` creates a set and reclaims workspaces whose `output_stack`/`prefers_output` matches the reconnected output; `remove_output` migrates non-empty workspaces to a remaining output (empty ones auto-remove), merges sticky/minimized windows, and preserves a `backup_set` when the last output disconnects; pinned workspaces restore by output match on the first output. C-08, C-09, C-06, C-13 / C | PD. Disconnect records `rememberWorkspaceForMonitor(name, workspaceID)` and moves the monitor's workspaces to a backup monitor, marking `m_lastMonitor`; reconnect moves RETURNING/orphaned workspaces back and re-activates the remembered workspace; `setupDefaultWS` assigns the next available workspace ID (or the `workspace=` rule target) to a new monitor. H-09 / H |
| D4.6 Preservation | PD. Windows follow their workspace; tiled/floating/fullscreen state preserved across the output change. C-09, C-06 / C | PD. Windows follow their workspace; floating/fullscreen geometry repositioned; tiled state preserved. H-09 / H |

### J7 Workspace lifecycle management

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D1.1 Creation | PD. Dynamic: an empty workspace is appended when the last workspace is non-empty (`add_empty_workspace`/`ensure_last_empty`); activation of a new index creates it. C-07 / C | PD. Workspaces are created on demand (`workspace N`, `e+1`, `previous`); `setupDefaultWS` creates the first workspace per monitor. H-05, H-09 / H |
| D1.2 Retention | PD (see J2). / C | PD (see J2). / H |
| D1.3 Removal | PD. Empty workspaces auto-remove (kept: active, trailing, pinned, or activation-token-protected); window-bearing workspaces are removed only via explicit workspace removal from the overlay, and their windows migrate with the workspace set; no window is lost. C-07 / C | CB. No workspace-removal dispatcher or documented removal path exists in v0.56.2 (dispatchers list has `workspace`, `renameworkspace`, but no kill/remove; workspace state contains no removal path), so the rubric's remove-a-workspace end-to-end workflow cannot complete through a documented affordance; per rubric section 8 this is CB. Medium-frequency (J7) CB; input to unit-05, not a product conclusion. H-23, H-16 / H |
| D1.4 Ordering/reordering | PD. `move_workspace` reorders a workspace before/after another; indices renumbered (`update_workspace_idxs`); navigation and overlay follow the new order. C-11, C-07 / C | CB. No workspace-reorder action exists in v0.56.2 (no reorder/renumber dispatcher); workspace order is ID-based and stable, so the rubric's reorder end-to-end workflow cannot complete through a documented affordance; per rubric section 8 this is CB. Medium-frequency (J7) CB; input to unit-05, not a product conclusion. H-23 / H |
| D1.5 Migration | PD (see J3). / C | PD (see J3). / H |
| D4.3 Lifecycle across outputs | PD (see J5). / C | PD (see J5). / H |

### J8 Configure and tune

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D6.1 Install/config coherence | PD (see J1). / C | PD (see J1). / H |
| D6.2 Config applies coherently | PD (see J1). / C | PD (see J1). / H |
| D4.7 No hidden per-output setup | PD. OutputBound workspaces behave correctly on a second output with no per-output config; `Global` mode is an explicit option; moving a workspace to an output is a documented action (`MigrateWorkspaceToOutput`); no hidden setup. C-04, C-19, C-08 / C | PD. A second output gets the next available workspace ID by default; per-monitor binding is an explicit, documented `workspace=` rule (`monitor:`); no hidden per-output configuration. H-09, H-06, H-08 / H |
| D8.4 Exceptions | PD. Regex tiling exceptions (shipped `tiling-exceptions.ron` + Settings-editable per-app/title rules); dialogs auto-float. C-22, C-23, C-28 / C | PD. `hl.window_rule` matches by class/title/workspace with float/move/workspace/ignore properties. H-19, H-03 / H |

### J9 Author a persistent structure (TS; D9.1, D9.2, D9.4, D9.5, D9.6)

Operational-model grounding: both comparators maintain LIVE-WINDOW binary trees
(rubric section 5, "Operational semantics"): each workspace carries a tree whose
leaves are the currently open windows, maintained as windows map and unmap.
Neither exposes an authored topology, a persistent saved topology, or a
receptacle/preselection-style region that exists independently of windows. Each
D9 cell is scored on its own sequence (rubric section 5 D9 preamble); automatic
reflow or automatic insertion alone evidences nothing for D9.1-D9.6.

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D9.1 Arbitrary-leaf split (both axes) | CB. No standalone leaf-split affordance exists: the complete shortcut Action enum and shipped `keybindings.ron` contain no split or preselect action (C-35, C-36); the only splits are placement byproducts - new-window insertion splits the focused leaf with an auto-derived axis from target/output geometry (`map_to_tree`, C-34) and the overview drag split is a placement act scored under D9.3 (C-37). No editor and no empty-region authoring exist, so the D9.1 sequence cannot be completed as an authored act. / C | CB. No standalone leaf-split affordance exists in dwindle: `layoutmsg togglesplit`/`rotatesplit`/`swapsplit` mutate the existing split of the current window (they do not create a new two-region split), and `layoutmsg preselect` only directs the insertion split of the next window (scored under D9.2); every split is a byproduct of window insertion (H-24, H-25). No empty-region/receptacle authoring exists. / H |
| D9.2 Keyboard-directed insertion | CB. The complete shortcut Action enum (C-36) and shipped `keybindings.ron` (C-35) contain no action that selects a target leaf + insertion side for the NEXT window before it opens; `map_to_tree`/`map_internal` insert a new window as a sibling split of the last-active (focused) leaf with an auto-derived axis, so the target region and insertion side are not user-selectable (C-34, C-39). / C | PD. `layoutmsg preselect <l/r/u/t/d>` sets a one-time override direction applied to the focused (target) leaf on the next window insertion (`m_overrideDirection`, DwindleAlgorithm.cpp layoutMsg ~713-746, used in `addTarget` ~160-179); `permanent_direction_override` persists it; the window lands in the directed region and the tree updates predictably. Documented on the wiki: preselect is "valid for the next window to be opened, only works on tiled windows". H-24, H-25 / H |
| D9.4 Structure independent of window ordering | CB. The tree IS the window set (live tree): `unmap` captures an in-memory `RestoreTilingState` (used for minimize/remap within the session only) and `unmap_internal` removes the leaf and flattens its group when it empties; the tree is never serialized and is re-derived as windows map/unmap (C-38). No structure independent of window ordering exists. / C | CB. Dwindle is a live-window binary tree (`SDwindleNodeData` leaves are windows, `isNode` marks internal splits); `onWindowRemovedTiling` removes the leaf and promotes the sibling, collapsing the parent; no dwindle state is serialized (H-27). Wiki quirk: "Dwindle splits are NOT PERMANENT" (H-25). / H |
| D9.5 Automatic placement preserving authored structure | CB. New windows split the last-active leaf automatically (predictable, no overlap), but there are no authored regions to preserve; the placement targets the live tree, not authored regions, so the criterion's authored-structure-preservation sequence cannot be observed (C-39). / C | CB. New windows auto-split a target node (window under cursor by default with `use_active_for_splits=false`, or the focused window when true), predictably, but there are no authored regions to preserve; the placement targets the live tree (H-25). / H |
| D9.6 Empty-branch semantics | CB. When the last window of a group closes, `unmap_internal` removes the leaf and flattens the group (regions merge by construction); this is collapse of the live-window tree, not documented authored-branch retention/collapse, and no empty region is retained (C-38). / C | CB. `onWindowRemovedTiling` collapses the parent by construction when a leaf's window closes (sibling promoted); derived-structure collapse, not authored-branch semantics; no empty-region retention (H-27). / H |

### J10 Direct placement and empty-branch handling in a live task (TS; D9.3, D9.5, D9.6)

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D9.3 Pointer-directed drag-to-split placement | PD. Dragging a tiled window (pointer move grab) enters the overview (`grab.is_tiling_grab()` -> `set_overview_mode`, C-37); while hovering, `update_pointer_position` computes `TargetZone::WindowSplit(window_id, direction)` from the cursor half over the target window and shows a `DropZone` placeholder; on release the move-grab path calls `tiling_layer.drop_window`, which splits the target window in the chosen direction to make room (C-37). The drop result is predictable. Official System76 docs describe drag-to-place with visual landing hints; the split-on-drop path itself is source-evident at 81cd5fd. / C | PD. Mouse drag (`hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })`, shipped in the example config, H-26) of a tiled window; on release the drag controller re-tiles the window via `movedTarget(target, focalPoint)` and dwindle re-inserts it splitting the node closest to the cursor with the split direction following cursor position (smart_split/precise_mouse_move/wasDraggingWindow branches in `addTarget` ~180-227). This is a target-directed split-on-drop. H-26 / H |
| D9.5 Automatic placement preserving authored structure | CB (see J9). / C | CB (see J9). / H |
| D9.6 Empty-branch semantics | CB (see J9). / C | CB (see J9). / H |

### 3.1 Journey status per comparator (rubric section 9 Step 2, input only)

Most severe evidenced classification per journey (UK never counts toward
CB/MF; Decision Rule application is unit-05):

| Journey | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| J1 | MF (D6.1) | PD |
| J2 | UK (D1.6) | UK (D1.6) |
| J3 | PD | PD |
| J4 | PD | PD |
| J5 | MF (D4.5, D5.1) | MF (D4.5, D5.1) |
| J6 | UK (D1.6) | UK (D1.6) |
| J7 | PD | CB (D1.3, D1.4) |
| J8 | PD | PD |
| J9 (TS) | CB (D9.1, D9.2, D9.4, D9.5, D9.6) | CB (D9.1, D9.4, D9.5, D9.6) |
| J10 (TS) | CB (D9.5, D9.6) | CB (D9.5, D9.6) |

Hyprland has two evidenced CB cells, both on the medium-frequency J7 journey:
D1.3 (no documented workspace-removal affordance) and D1.4 (no documented
workspace-reorder affordance). The journey-frequency label does not change the
evidence-cell classification (rubric section 8: a documented end-to-end
workflow that cannot complete is CB); the medium-frequency CB is input for the
Decision Rule mapping in unit-05, not a product conclusion. In the
pre-amendment J1-J8 scope COSMIC has no evidenced CB; its J1-J8 frictions are
the J1 enablement/config friction (D6.1, per unit-04/attempt-01 scoring
correction) and multi-output indication (J5). Hyprland's J1-J8 frictions are
multi-output indication (J5). With the amended structural journeys included,
the all-journey position is that both comparators now carry evidenced CB cells:
Hyprland on the medium-frequency J7 (D1.3/D1.4) and both comparators on the
target-segment J9/J10 structural journeys (COSMIC: D9.1/D9.2/D9.4/D9.5/D9.6;
Hyprland: D9.1/D9.4/D9.5/D9.6; both J10: D9.5/D9.6). None of these is a product
conclusion. Both comparators share the D1.6 (session restore) and D7.2
(degradation) unknowns. This is input for unit-05; no baseline-coherence
conclusion is drawn here.

Per rubric 9.1, the amended J9/J10 structural CB cells above are target-segment
(TS) cells: whether a TS journey CB makes baseline coverage "broken" depends on
the target-segment scoping (failure in the documented normal daily workflow,
not rescued by a documented step), which is a unit-05 Decision Rule
determination built on the evidence in the J9/J10 matrices above and section 4A
- not a conclusion drawn here. COSMIC's J9 gaps are D9.1/D9.2/D9.4/D9.5/D9.6 (no standalone split, no
keyboard-directed insertion, live tree, no authored regions, collapse-by-
construction); Hyprland's J9 gaps are D9.1/D9.4/D9.5/D9.6 with D9.2 satisfied
by `layoutmsg preselect`; both comparators satisfy D9.3 (pointer drag-to-split)
but fail the J10 authored-structure cells D9.5/D9.6.

## 4. Dedicated D4.1-D4.11 Matrix

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D4.1 Workspace model (global vs output-local) | PD. Default `WorkspaceMode::OutputBound`: one `WorkspaceSet` per output with its own ordered `workspaces` vector and `active` index; `Global` mode is an explicit Settings option that shares one set across outputs; `migrate_workspace` is a no-op in Global mode. Model explicit and predictable. C-04, C-05, C-10, C-28 | PD. Global workspace IDs; each `CWorkspace` is bound to one `m_monitor`; each monitor shows one `m_activeWorkspace`; per-monitor binding is an explicit `workspace=` rule (`monitor:`), persistent via `persistent`. Model explicit and documented. H-04, H-06, H-07 |
| D4.2 Directional focus/move across outputs | PD. `Action::Focus`: no window in direction falls through to `Previous/NextWorkspace` (layout primary axis) or `SwitchOutput` (other axis) based on `workspace_layout` (default Vertical: Up/Down to workspace, Left/Right to output); `Action::Move`: `MoveFurther` at a workspace edge falls through to `MoveToWorkspace`/`MoveToOutput`; dedicated Super+Alt/Super+Shift+Alt output actions. Focus lands on the target output's active workspace window. C-15, C-16, C-17, C-18 | PD. `movefocus`/`movewindow` include other-monitor windows and assign windows to the focal monitor's active workspace by default (`binds:window_direction_monitor_fallback=true`); `focusmonitor`/`moveworkspacetomonitor` dedicated actions. H-11, H-12, H-13, H-23 |
| D4.3 Lifecycle across outputs | PD. `add_output` creates a set and reclaims workspaces that `prefers_output(output)` from other sets; `remove_output` migrates workspaces to a remaining set (auto-removing empty ones), merges sticky/minimized windows, clamps active state; other outputs not silently disturbed. C-08, C-09 | PD. `moveWorkspaceToMonitor` moves the workspace and its windows; when the moved workspace was active, the old monitor is given a next workspace (created from ID 1 upward, skipping rule-bound IDs); `swapActiveWorkspaces` swaps two monitors' workspaces. C-07, H-07, H-10 |
| D4.4 Connect/disconnect/hotplug recovery | PD. Output history (`output_stack`, `prefers_output` by edid/connector) reclaims workspaces on reconnect; `remove_output` migrates windows with their workspace and preserves a `backup_set` for the last-output case; pinned workspaces restore by output match. C-06, C-08, C-09, C-13 | PD. `rememberWorkspaceForMonitor` on disconnect; workspaces (with windows) move to a backup monitor; on reconnect RETURNING/RECOVERY workspaces move back and the remembered workspace is re-activated; new monitors get the next available ID. H-09 |
| D4.5 Per-output indication | MF. Default panel has no persistent workspace indicator (panel only reacts to the overlay being shown); per-output workspace state is visible only through the on-demand Workspaces overlay (Super+w) with configurable name/number. C-14, C-28, C-32 | MF. No shipped visual indication; per-output workspace state queryable only via `hyprctl workspaces`; a persistent indicator requires an external bar (optional component, excluded). H-15, H-23 |
| D4.6 Window/layout preservation | PD. Windows follow their workspace across output changes; tiled/floating/fullscreen state and restore data preserved; `output_stack` history enables return. C-06, C-09 | PD. Moving a workspace moves its windows (floating/fullscreen geometry adjusted, pinned windows stay); tiled state preserved. H-07, H-09 |
| D4.7 No hidden per-output setup | PD. OutputBound default behaves sensibly on a second output without per-output configuration; Global mode explicit; workspace-to-output move is a documented action; no hidden setup. C-04, C-19, C-08 | PD. Second output defaults to the next available workspace ID; per-monitor binding is an explicit, documented rule; no hidden per-output configuration. H-09, H-06, H-08 |

D4.8-D4.11 are the structural-state multi-output criteria. Neither comparator
supports authored structure (live-window trees only, section 4A), so per the
rubric's D4.8-D4.11 preamble these are recorded OUT OF SCOPE for the
authored-structure dimension rather than scored absent; the underlying
per-output/per-workspace structural-state model is recorded in each cell and is
not a re-scoring of D4.1-D4.7.

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D4.8 Structural scope per output | Out of scope for authored structure (no authored-structure support). Recorded model: each `Workspace` owns its own `TilingLayout` binary tree (workspace.rs ~106, ~391-398) and the default `OutputBound` mode gives each output its own `WorkspaceSet`, so live-tree scope is per output per workspace - explicit and consistent with D4.1. C-40 | Out of scope for authored structure. Recorded model: each workspace owns its own tree (`CWorkspace` creates a `CSpace` with an algorithm provider, Workspace.cpp ~60-61); workspaces are bound to one monitor and a monitor shows one active workspace (D4.1), so live-tree scope is per workspace per monitor. H-28 |
| D4.9 Structural cross-output moves | Out of scope for authored-position preservation (no authored position exists). Recorded move behavior (cited by C-41): `move_tree` re-inserts the moved window into the target output's workspace tree as a sibling split of the focused node (with the given direction when present), tiling/mod.rs ~658-757. Focus/move and indication outcomes for the cross-output path are the pre-existing D4.2 (C-15..C-18) and D4.5 (C-14, C-28, C-32) results; no new score is added here. | Out of scope for authored-position preservation. Recorded behavior: cross-monitor `movewindow`/`moveworkspacetomonitor` assign the window to the target monitor's active workspace and its dwindle tree re-tiles it predictably (cross-ref D4.2). H-25 |
| D4.10 Structural persistence/recovery | Out of scope for authored structure. Recorded: the tiling tree is in-memory only (no serialization found in cosmic-comp; C-38); only pinned workspace identity persists (C-12, C-13); window-level hotplug/session preservation is covered by D4.4/D1.6 and stays UK there. C-38 | Out of scope for authored structure. Recorded: the dwindle tree is in-memory only (no serialization; H-27); `workspace=` `persistent` rules preserve workspace existence, not tree structure (H-06, H-08); window-level hotplug/session preservation is covered by D4.4/D1.6 and stays UK there. H-27 |
| D4.11 Structural indication | Out of scope for authored structure. Recorded: no authored-structure indicator exists; per-output workspace indication is covered by D4.5 (MF). C-28, C-32 | Out of scope for authored structure. Recorded: no authored-structure indicator exists; per-output workspace indication is covered by D4.5 (MF). H-23 |

## 4A. D9 Structural Authoring and Direct Placement Matrix

Operational-model grounding (rubric section 5, "Operational semantics"): COSMIC
and Hyprland both maintain live-window binary trees (leaf = open window, tree
maintained on map/unmap, no authored or persisted topology); bspwm 0.9.12 is the
bounded reference for receptacles/preselection and state dump/load (section
4B). Neither COSMIC nor Hyprland exposes receptacles, an authored topology, or a
preselect-on-empty-region model. Each criterion is scored on its own sequence
(rubric section 5 D9 preamble); automatic reflow or automatic insertion alone
evidences nothing.

| Criterion | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|
| D9.1 Arbitrary-leaf split (both axes) | CB. No split action in the complete Action enum / shipped keybindings (C-35, C-36); splits are placement byproducts (auto-insertion axis is geometry-derived, C-34/C-39; overview drop split is D9.3, C-37). | CB. No standalone split command (togglesplit/rotatesplit/swapsplit mutate existing splits); every split is an insertion byproduct (H-24, H-25). |
| D9.2 Keyboard-directed insertion | CB. No preselect/target-leaf+side action for the next window in the complete Action enum / keybindings (C-35, C-36); auto insertion splits the last-active leaf with auto axis (C-34, C-39). | PD. `layoutmsg preselect <dir>` (documented wiki + source, H-24) directs the next window's insertion side on the focused leaf; `permanent_direction_override` persists it. |
| D9.3 Pointer-directed drag-to-split placement | PD. Overview drag -> `TargetZone::WindowSplit` -> `drop_window` splits the target (C-37). | PD. Mouse-drag re-tile splits the node closest to the cursor with cursor-derived direction (H-26). |
| D9.4 Structure independent of window ordering | CB. Live tree; leaf count tracks windows; `unmap_internal` collapses empty groups; no serialization (C-38). | CB. Live tree; `onWindowRemovedTiling` collapses; no serialization; wiki "splits are NOT PERMANENT" (H-27, H-25). |
| D9.5 Automatic placement preserving authored structure | CB. Auto insertion splits the focused leaf (predictable) but no authored regions exist to preserve (C-39). | CB. Auto insertion splits a target node predictably but no authored regions exist to preserve (H-25). |
| D9.6 Empty-branch semantics | CB. Groups flatten on last-window close by construction; no authored-branch retention/collapse (C-38). | CB. Parent collapses on last-window close by construction; no authored-branch retention/collapse (H-27). |

Completeness statement: every D9.1-D9.6 and D4.8-D4.11 cell above has a
classification and a direct evidence record (section 6); no cell relies on
documentation silence. No D9.1-D9.6 cell is UK: each mechanism or its absence
is established from the pinned source surface (complete action/shortcut enums,
insertion/removal code paths, drag/drop code paths). D4.8-D4.11 are recorded
out of scope for authored structure per the rubric preamble because neither
comparator supports authored structure; the underlying per-output/per-workspace
live-tree model is recorded in each cell. D9.2 is the one positive COSMIC/
Hyprland differentiation: Hyprland satisfies it via `layoutmsg preselect` while
COSMIC has no keyboard-directed-insertion affordance.

## 4B. bspwm 0.9.12: Bounded Structural-Interaction Reference

Scope boundary (rubric sections 2.3, 3.5; spec Evidence Standards): bspwm is a
versioned structural-authoring/direct-placement interaction reference ONLY.
This section evidences how a structural workflow can look and what semantics are
observable; it yields NO desktop-wide, multi-output, installation/configuration
coherence, workspace, indication, or broad lifecycle result for bspwm or for
the Plasma-product question. bspwm is not a full desktop comparator and has no
journey cells (rubric sections 3.5, 7).

Reference facts (all from tag 0.9.12 sources, retrieved 2026-08-10):

- bspwm represents windows as leaves of a full binary tree (README, B-02). It
  responds only to X events and messages on its socket; it "doesn't handle any
  keyboard or pointer inputs: a third party program (e.g. *sxhkd*) is needed in
  order to translate keyboard and pointer events to *bspc* invocations"
  (README, B-02).
- Receptacles: "A leaf node that doesn't hold any window is called a receptacle.
  ... A receptacle can be inserted on a node, preselected and killed.
  Receptacles can therefore be used to build a tree whose leaves are
  receptacles." (bspwm.1.asciidoc, B-03). `bspc node -i`/`--insert-receptacle`
  inserts an empty receptacle leaf (B-03; tree.c `insert_receptacle` ~464-473).
- Preselection / manual insertion: `bspc node -p DIR|cancel` and `-o RATIO`
  preselect the splitting area of a node; "A node with a preselected area is
  said to be in 'manual insertion mode'." (bspwm.1.asciidoc, B-04). Insertion
  on a preselected node follows the preselect direction/ratio; insertion on a
  receptacle replaces the receptacle (tree.c `insert_node` ~291-430, B-05).
- Automatic insertion: `automatic_scheme` accepts `longest_side`, `alternate`,
  `spiral`; `initial_polarity` picks first/second child (bspwm.1.asciidoc,
  B-05).
- State dump/load: `bspc wm -d`/`--dump-state` dumps the current world state;
  `bspc wm -l`/`--load-state <file>` loads a world state (bspwm.1.asciidoc,
  B-06). The shipped `examples/receptacles` scripts (`extract_canvas`,
  `induce_rules`) document storing and recreating a layout by replacing each
  window with a receptacle and re-placing windows by rules (B-06).
- Removal/collapse: when a managed window is destroyed, `unmanage_window` ->
  `remove_node` -> `unlink_node` unlinks the leaf and promotes the sibling
  subtree (window.c ~237-252; tree.c ~1337-1403), so a window-leaf closes by
  collapsing its branch; receptacles are the explicit retention mechanism
  (B-07).

Bounded reference matrix (structural cells only; classifications describe the
reference model, never a desktop comparison):

| Criterion | bspwm 0.9.12 reference (bounded) |
|---|---|
| D9.1 Arbitrary-leaf split (both axes) | PD (reference). `bspc node -p DIR` preselects a split direction on any leaf at any depth; `bspc node -i` inserts an empty receptacle leaf, splitting a node into two regions in either axis. B-03, B-04 |
| D9.2 Keyboard-directed insertion | PD (reference). `bspc node -p/-o` preselect via keyboard; the shipped default `examples/sxhkdrc` binds `super + ctrl + {h,j,k,l}` -> `bspc node -p {west,south,north,east}` and `super + ctrl + {1-9}` -> `bspc node -o 0.{1-9}`; the next window opens into the preselected region; `node newest.marked.local -n newest.!automatic.local` sends a marked window to the newest preselected node. B-08 |
| D9.3 Pointer-directed drag-to-split placement | CB (reference, explicit negative). The D9.3 workflow cannot complete through bspwm's documented affordances: bspwm itself provides NO pointer-input handling (README, B-02), its documented pointer actions are `pointer_modifier` + button1/2/3 = move / resize-side / resize-corner and `pointer_action<n>` = move / resize_side / resize_corner / focus / none - none is a preselect or drag-to-split (bspwm.1.asciidoc Pointer Bindings, B-09), and the shipped default `examples/sxhkdrc` contains no pointer bindings at all (B-08). This is an evidenced absence within the reference model (U11 resolved), not documentation silence; a workaround would require an undocumented third-party sxhkd pointer configuration outside the pinned reference. It is a reference-cell result, never a J9/J10 desktop journey score. |
| D9.4 Structure independent of window ordering | PD (reference). The in-memory tree is maintained independently of window ordering; receptacles are empty leaves that persist; `wm --dump-state`/`--load-state` serialize/deserialize the whole world state and `examples/receptacles` stores/recreates a receptacle tree (B-06). A closing window removes its leaf (branch collapse, B-07); authored receptacle leaves persist until explicitly killed. |
| D9.5 Automatic placement preserving authored structure | PD (reference). In automatic insertion mode the `automatic_scheme` places new windows; on a preselected node (manual mode) insertion follows the preselect; on a receptacle the new node replaces it - so windows sent to an authored region land there and authored branches are not restructured. B-05, B-03 |
| D9.6 Empty-branch semantics | PD (reference). Receptacles are documented retained empty leaves (retention); a window-leaf close collapses its branch (B-07); `node -i` re-creates an empty leaf. Both documented semantics are observable. B-03, B-07 |

No desktop-wide, multi-output, installation, workspace, indication, or broad
lifecycle claim is derived from any bspwm reference cell above (rubric sections
2.3, 3.5; spec Evidence Standards).

## 4C. Structural-Model Distinctions and a Source-Supported Combination Model

### 4C.1 Semantic distinctions (rubric section 5, "Operational semantics")

| Model | COSMIC 1.5.0 | Hyprland v0.56.2 | bspwm 0.9.12 (bounded reference) |
|---|---|---|---|
| Tree model | Live-window binary split tree per workspace (C-38) | Live-window binary tree (dwindle) per workspace (H-27) | Persistent full-binary-tree per desktop with window AND receptacle leaves (B-03) |
| Keyboard-directed insertion | None (complete action/shortcut surface contains no preselect, C-36) | `layoutmsg preselect <dir>` one-shot direction override for the next window (H-24) | `bspc node -p/-o` preselection = manual insertion mode (B-04); default sxhkdrc keyboard bindings (B-08) |
| Empty-region authoring | None (placeholders are transient during the overview drag, C-37) | None (no empty leaves, H-27) | Receptacles = documented empty leaves; `node -i` inserts them (B-03) |
| Structure vs window ordering | Structure IS the window set; closes collapse groups (C-38) | Structure IS the window set; closes collapse parents (H-27) | Structure independent of windows (receptacles persist); window closes collapse their own branch, not authored receptacles (B-07) |
| Persistence | None for the tree (in-memory only; only pinned workspaces persist, C-38, C-12/C-13) | None for the tree (workspace `persistent` rules keep workspaces, not structure, H-06/H-27) | `wm --dump-state`/`--load-state` + `examples/receptacles` = persistent saved topology (B-06) |
| Automatic placement | New window splits the last-active leaf, auto axis (C-39) | New window splits the cursor/focused node with cursor- or override-driven direction (H-25) | Automatic scheme (`longest_side`/`alternate`/`spiral`) in automatic mode; preselect/receptacle in manual mode (B-05) |
| Empty-branch collapse/retention | Collapse by construction on window close (C-38) | Collapse by construction on window close (H-27) | Window-leaf collapse by construction; receptacle retention explicit (B-07, B-03) |
| Pointer drag-to-split | Overview drag -> WindowSplit target -> split on drop (C-37) | Mouse-drag re-tile -> closest-node split with cursor direction (H-26) | Not provided by bspwm (CB reference, explicit negative; no pointer input, pointer actions are move/resize/focus only, B-02/B-08/B-09, U11 resolved) |

Persistence summary: neither COSMIC nor Hyprland persists any tiling tree or
authored structure; COSMIC persists only pinned workspace identity (C-12/C-13)
and Hyprland persists only workspace existence via `workspace=` rules (H-06).
bspwm's `wm --dump-state`/`--load-state` (with `examples/receptacles`, B-06) is
the only documented persistent saved topology among the three. "Generated
automatic layouts" (Krohnkite layout engines, Hyprland master/monocle, bspwm
automatic schemes) remain balanced geometry computed by a scheme, distinct from
authored structure (rubric section 5).

### 4C.2 Combination model (source-supported, NOT a unit-05 product conclusion)

Which structural/direct-placement capability a prospective integrated Plasma
product could borrow from each reference (source-established above):

- From COSMIC: a shipped, coherent desktop surface (no separate tiling install
  in the journeys), per-workspace live binary tiling with automatic insertion,
  pointer drag in the overview that splits a target window on drop (D9.3),
  output-bound per-workspace workspace sets, dynamic workspace lifecycle, and
  pinned-workspace persistence.
- From Hyprland: keyboard-directed insertion via `layoutmsg preselect` (target
  leaf = focused window, user-chosen insertion side, D9.2), directional split
  control, cross-monitor default focus/move, and mouse-drag target-directed
  re-tiling with cursor-derived split direction (D9.3).
- From bspwm (reference only): the authored persistent topology model -
  receptacles as retained empty regions, keyboard preselection (manual insertion
  mode), automatic insertion schemes, and `wm --dump-state`/`--load-state`
  persistence - i.e. the structural-authoring/direct-placement workflow the
  rubric's D9.1-D9.6 describe (X-10).

Desired behavior not delivered coherently by any single reference: the full
combination of (a) persistent authored structure independent of window ordering
(D9.4), (b) automatic placement preserving that authored structure (D9.5),
(c) keyboard-directed insertion (D9.2), (d) pointer drag-to-split placement
(D9.3), and (e) explicit empty-branch retention/collapse (D9.6) is not achieved
by COSMIC, Hyprland, or the bspwm reference alone: COSMIC lacks (a), (b), (c)
(and (e) as an authored semantic); Hyprland lacks (a), (b), and (e) as authored
semantics; the bspwm reference provides (a), (b), (c), (e) but no pointer
drag-to-split (d) and is not a desktop. Each reference is a partial model; this
is source-supported combination evidence for unit-05's plausibility assessment
(rubric section 9 Step 4), not a product conclusion.

## 5. Findings

### 5.1 Favorable findings (evidenced capabilities)

- COSMIC 1.5.0 ships an output-bound workspace model by default (per-output
  workspace sets, dynamic create/auto-remove of empty workspaces, per-output
  sticky layer), a Global mode option, and output-memory via `output_stack` and
  pinned workspaces. (C-04, C-05, C-06, C-07, C-08, C-09, C-13)
- COSMIC's directional focus and move **fall through** workspace and output
  boundaries (`FocusResult::None`/`MoveResult::MoveFurther` map to workspace and
  output actions), so cross-output focus and window movement are one-step
  documented actions, not extra steps. (C-15, C-16)
- COSMIC tiling is a binary-split tree with per-direction insertion, swap,
  stacking, orientation toggle, dialogs/transients auto-floating, regex tiling
  exceptions, and native fullscreen restore. (C-20, C-21, C-22, C-23, C-24)
- COSMIC configuration applies live through cosmic-config watch (no reboot);
  the tiling toggle persists. (C-29, C-03)
- Hyprland v0.56.2 crosses monitor boundaries by default for both directional
  focus and directional window move (`binds:window_direction_monitor_fallback`
  default true), and ships dedicated `focusmonitor`/`moveworkspacetomonitor`
  actions. (H-11, H-12, H-13)
- Hyprland records per-monitor workspace memory across hotplug
  (`rememberWorkspaceForMonitor`/`rememberedWorkspaceForMonitor`) and migrates
  workspaces and their windows to a backup monitor on disconnect, returning them
  on reconnect. (H-09)
- Hyprland's per-monitor workspace binding and persistent workspaces are
  explicit, documented `workspace=` rules, not hidden setup. (H-06, H-08)
- Both comparators ship complete default keyboard coverage for the journeys
  (focus, move, workspace switch, move-to-workspace, float, fullscreen, swap).
  (C-14, H-03)
- COSMIC 1.5.0 provides pointer-directed drag-to-split placement in the
  overview: dragging a tiled window enters the overview and hovering over a
  target window computes a `TargetZone::WindowSplit` (direction by cursor half)
  with a `DropZone` placeholder; on release `drop_window` splits the target to
  make room. (C-37)
- Hyprland v0.56.2 provides keyboard-directed insertion (`layoutmsg preselect`,
  a one-time direction override for the next window, persisted optionally by
  `permanent_direction_override`) and target-directed mouse-drag splitting:
  dragging a tiled window re-tiles it by splitting the node closest to the
  cursor with a cursor-derived direction. (H-24, H-26)
- Hyprland v0.56.2 documents its dwindle split semantics explicitly (wiki
  "Dwindle splits are NOT PERMANENT"; `preselect`, `smart_split`,
  `precise_mouse_move`, `use_active_for_splits` configuration). (H-24, H-25)
- The bspwm 0.9.12 reference documents the complete authored-structure model the
  rubric's D9 criteria describe: receptacles (retained empty leaves), keyboard
  preselection (manual insertion mode), automatic insertion schemes, and
  `wm --dump-state`/`--load-state` persistent saved topology. (B-03..B-07)

### 5.2 Unfavorable findings (evidenced frictions)

- COSMIC ships `autotile=false` by default (C-03), contradicting rubric 3.3's
  phrasing "with its built-in tiling enabled as shipped." Resolved in
  unit-04/attempt-01 per the accepted scoring correction: the source default is
  ONE enablement/configuration friction, scored in J1 coherence only (D6.1 =
  MF; Super+y is the documented, live-applying, persisting enable step, C-14/
  C-29). It is NOT scored as tiling-workflow friction (J1 D2.1 stays PD against
  the enabled baseline) and is NOT double-counted in the other J1 cells (D6.2,
  D7.1, D8.5 stay PD).
- Neither comparator ships a persistent per-output workspace indicator:
  COSMIC's is an on-demand overlay; Hyprland ships none at all (CLI only).
  D4.5/D5.1 = MF for both. (C-28, C-32, H-23)
- Hyprland has no workspace-removal or workspace-reorder affordance
  (dispatchers list and workspace state contain no such action), so the rubric's
  D1.3/D1.4 end-to-end workflows cannot complete through a documented
  affordance; per rubric section 8 these are CB cells. Both sit on the
  medium-frequency J7 journey, so this is a medium-frequency CB that feeds the
  Decision Rule mapping in unit-05 and is not itself a product conclusion. The
  ID-based workspace model keeps navigation consistent. (H-23, H-16; D1.4
  interpretation flagged for later review)
- Both comparators lack compositor-side session window restore (D1.6 UK):
  COSMIC persists only pinned workspaces; Hyprland persists nothing beyond
  config. (C-26, C-27, H-20)
- Hyprland is compositor-only: onboarding J1 requires assembling a session
  (terminal, launcher, bar) that COSMIC ships; cells are assessed against the
  compositor baseline so no optional component is credited.
- Neither COSMIC nor Hyprland can author or retain empty regions: both are
  live-window trees with no receptacle/empty-leaf model, so D9.4/D9.5/D9.6 (and
  D9.1 for both) cannot complete the authored-structure sequences; closing a
  window collapses its branch in both. (C-38, H-27)
- COSMIC has no keyboard-directed insertion for the next window: the complete
  shortcut Action enum and shipped `keybindings.ron` contain no
  preselect/target-side action, so D9.2 cannot complete by keyboard. (C-35,
  C-36)
- Hyprland's dwindle has no standalone split affordance (D9.1): `layoutmsg
  togglesplit`/`rotatesplit`/`swapsplit` mutate existing splits only, and
  splits otherwise arise only from window insertion (preselect-directed or
  automatic). (H-24, H-25)
- bspwm (bounded reference) provides no pointer-directed drag-to-split
  placement: it handles no pointer input (sxhkd translates events to bspc), its
  documented pointer actions are move/resize/focus only, and the default
  sxhkdrc ships no pointer bindings. (B-02, B-08, B-09)

### 5.3 Unknowns

- D1.6 (both comparators): whether typical applications restore their windows
  on a Wayland session restart; neither compositor implements a session-restore
  mechanism in source. (C-26, C-27, H-20)
- D7.2 (both comparators): no source/docs evidence for repeated-action
  degradation; performance measurement is out of scope. (C-30, H-21)
- COSMIC: exact live behavior of the on-demand Workspaces overlay per output on
  a real multi-output session (overlay rendering is a separate app,
  cosmic-workspaces-epoch, not inspected for rendering semantics). (C-28, C-14)
- COSMIC: whether Pop!_OS 24.04 packaging ships a first-run config that sets
  `autotile` differently from the Rust `Default` (the shipped default file is a
  packaging artifact, not inspected). (C-03, C-33)
- Hyprland: whether v0.56.2 first-run generation reaches the Lua example config
  directly or via the legacy stub; install/run behavior is not determinable from
  source. (H-02, H-22)
- Hyprland: wiki pages are maintained as "latest git", not version-pinned to
  v0.56.2; wiki claims are snapshot-dated and cross-checked against source.
- D9.3 (COSMIC): the overview drag-to-split code path is source-established
  (C-37), but the observable drop result on a real session, and whether the
  shipped user-facing documentation describes split-on-drop (versus
  drag-to-stack / rearrange), is not fully established; official System76
  documentation describes drag-to-place with visual landing hints. The PD cell
  rests on the shipped source surface at 81cd5fd, not on runtime observation.
- D9.3 (Hyprland): target-directed drag re-tiling is source-established
  (H-26); the exact on-screen outcome with the shipped example config defaults
  (`precise_mouse_move=false`, `smart_split=false`) is a runtime behavior not
  established from source.
- J9/J10 runtime severity in the target segment for both comparators: cell-level
  ability is established from source (sections 3A, 4A); the daily-workflow
  severity that rubric 9.1 requires for the TS Decision Rule scoping is
  unit-05's application (and a safe unit-04 observation candidate, U04-12),
  not established here.

### 5.4 Unit-04 validation candidates (state-changing or live-session; behind the plan gate)

| ID | Precise unresolved claim | Why source evidence is insufficient |
|---|---|---|
| U04-7 | On a live COSMIC multi-output session, does the Workspaces overlay (Super+w) show each output's workspace strip with the active workspace indicated, updating on output changes? | The overlay app (cosmic-workspaces-epoch) rendering and live update behavior are not determinable statically; requires session observation. |
| U04-8 | On a live COSMIC session, do the dynamic-workspace edge cases behave as coded (`ensure_last_empty` keeping the active/trailing empty workspace, auto-removing others) with no lost windows? | Deterministic in source; end-to-end outcome on a real session needs observation. |
| U04-9 | On a live Hyprland multi-monitor session, does directional `movewindow`/`movefocus` cross monitor boundaries exactly as the focal-point logic implies (window lands on the other monitor's active workspace)? | Source establishes the mechanism; the observable outcome is runtime. |
| U04-10 | On a live Hyprland session, does a new monitor default to the next available workspace ID and does disconnect/reconnect restore the remembered workspace with windows intact? | Source establishes the code path; end-to-end outcome needs observation. |
| U04-11 | Does a fresh Pop!_OS 24.04 COSMIC session ship `autotile` enabled (packaging default config) or off (Rust `Default`)? | Packaging-default file is an artifact not present in the source tree; requires inspecting the shipped config on a live system. |
| U04-12 | What is the observed behavior of the COSMIC overview drag-to-split and Hyprland mouse-drag re-tile on a live session, and what is the observed daily-workflow friction of the J9/J10 target-segment workflow on either comparator? | Cell-level ability is established from source (sections 3A, 4A); the observable drop/tile outcome and the daily-workflow severity that rubric 9.1 needs for the TS Decision Rule scoping are runtime/observation questions for a safe unit-04 check. |

## 6. Evidence Record / Citation Register

Rules (rubric section 10): one record per claim; source type is
source-doc / source-code / official-doc / issue-tracker / packaging / unknown;
records C-01..C-33, H-01..H-23, X-05..X-08 retrieved 2026-08-09;
records C-34..C-41, H-24..H-28, B-01..B-09, X-09..X-10 retrieved or verified
2026-08-10 (attempt-02); version = pinned tag/commit. All attempt-02 structural
source reads used the local clones pinned in section 1.1.

### 6.1 COSMIC

| ID | Claim summary | Type | Source | Version / snapshot |
|---|---|---|---|---|
| C-01 | Epoch 1.5.0 tag identity and release date (2026-07-29, jackpot51); maintenance release listing cosmic-comp bug fixes and translations, no tiling/workspace feature changes | official-doc | https://github.com/pop-os/cosmic-epoch/releases/tag/epoch-1.5.0 | tag epoch-1.5.0, commit 0ce7ec3 |
| C-02 | Submodule pins at the tag: cosmic-comp 81cd5fd, cosmic-workspaces-epoch 8faab4c, cosmic-settings 7287257, cosmic-panel d6699ff, cosmic-session b5ef6c0, cosmic-settings-daemon e37160f (source clones used for all C-03..C-32 reads) | source-code | https://github.com/pop-os/cosmic-epoch.git `git ls-tree` tag epoch-1.5.0 | tag epoch-1.5.0 |
| C-03 | `CosmicCompConfig` default: `autotile=false`, `autotile_behavior=TileBehavior::Global`, `active_hint=true`, `focus_follows_cursor=false`, `cursor_follows_focus=false`, `focus_follows_cursor_delay=250` | source-code | cosmic-comp/cosmic-comp-config/src/lib.rs | commit 81cd5fd |
| C-04 | `WorkspaceConfig` default: `workspace_mode=OutputBound`, `workspace_layout=Vertical`, `workspace_wraparound=true` | source-code | cosmic-comp/cosmic-comp-config/src/workspace.rs | commit 81cd5fd |
| C-05 | `Workspaces` holds `sets: IndexMap<Output, WorkspaceSet>`; each `WorkspaceSet` has its own `workspaces`, `sticky_layer`, `active` index, `group` handle, `output` | source-code | cosmic-comp/src/shell/mod.rs (~822-848) | commit 81cd5fd |
| C-06 | `Workspace` is output-bound (`output` field) with `tiling_layer`, `floating_layer`, `fullscreen_surfaces`, `pinned`, `id/name`, `focus_stack`, and `output_stack` history; `can_auto_remove` = empty && no activation token && not pinned | source-code | cosmic-comp/src/shell/workspace.rs | commit 81cd5fd |
| C-07 | Dynamic lifecycle: `add_empty_workspace`, `ensure_last_empty` (auto-remove empty non-active non-trailing), `update_workspace_idxs`, `activate(idx, delta)` with animation, `post_remove_workspace` | source-code | cosmic-comp/src/shell/mod.rs (616-720) | commit 81cd5fd |
| C-08 | `Workspaces::add_output`: new set created (or `backup_set` reused); workspaces that `prefers_output` moved from other sets; pinned workspaces restored on first output; empty workspace added | source-code | cosmic-comp/src/shell/mod.rs (851-919) | commit 81cd5fd |
| C-09 | `Workspaces::remove_output`: workspaces migrated to first remaining output (empty ones auto-removed), sticky/minimized merged, active reassigned; last output -> `backup_set` | source-code | cosmic-comp/src/shell/mod.rs (921-1013) | commit 81cd5fd |
| C-10 | `migrate_workspace(from,to,handle)`: explicit user workspace-to-output move; no-op in `Global` mode | source-code | cosmic-comp/src/shell/mod.rs (1016-1045) | commit 81cd5fd |
| C-11 | `move_workspace(handle,other,after)`: reorder workspace before/after another within a set; indices renumbered | source-code | cosmic-comp/src/shell/mod.rs (1048+) | commit 81cd5fd |
| C-12 | `persist()` writes `pinned_workspaces` to cosmic-config; invoked on workspace Pin/Unpin protocol requests | source-code | cosmic-comp/src/shell/mod.rs (1495-1508); cosmic-comp/src/wayland/handlers/workspace.rs (70-73) | commit 81cd5fd |
| C-13 | `PinnedWorkspace` persists `OutputMatch{name,edid}`, `tiling_enabled`, `id`, `name`; restored on first output add | source-code | cosmic-comp/src/shell/workspace.rs (418-471); cosmic_comp_config/workspace.rs | commit 81cd5fd |
| C-14 | Shipped default keybindings (Focus/move/workspace/output/move-to-workspace/tiling actions, Super+arrows/hjkl, Super+Shift+direction, Super+Ctrl+direction, Super+Alt output, Super+Shift+Alt move-to-output, Super+y toggle tiling, Super+g float, Super+s stacking, Super+x swap, Super+F11 fullscreen, Super+w workspaces overlay) | source-code (shipped data) | cosmic-comp/data/keybindings.ron | commit 81cd5fd |
| C-15 | `Action::Focus`: `next_focus`; on `FocusResult::None`, maps direction to `Previous/NextWorkspace` (horizontal layout) or `SwitchOutput`; records previous workspace for return | source-code | cosmic-comp/src/input/actions.rs (730-793) | commit 81cd5fd |
| C-16 | `Action::Move`: `move_current_element`; `MoveResult::MoveFurther` maps to `MoveToPrevious/NextWorkspace` or `MoveToOutput`; `ShiftFocus` refocuses | source-code | cosmic-comp/src/input/actions.rs (795-863) | commit 81cd5fd |
| C-17 | `Action::SwitchOutput(direction)`: activates the target output's active workspace and focuses its last-focused window | source-code | cosmic-comp/src/input/actions.rs (523-587) | commit 81cd5fd |
| C-18 | `Action::MoveToOutput/SendToOutput(direction)`: `move_current` to next output (Move follows focus, Send does not) | source-code | cosmic-comp/src/input/actions.rs (599-658) | commit 81cd5fd |
| C-19 | `Action::MigrateWorkspaceToOutput(direction)`: moves the active workspace to the next output | source-code | cosmic-comp/src/input/actions.rs (670-694) | commit 81cd5fd |
| C-20 | Tiling layout: binary split tree; `map_to_tree` inserts new windows as sibling splits by direction/geometry; `move_current_node` reflows, creates groups, swaps; `next_focus` directional focus; `drop_window` re-tiles on drop | source-code | cosmic-comp/src/shell/layout/tiling/mod.rs (548-617, 1507-1833) | commit 81cd5fd |
| C-21 | `toggle_stacking`/`toggle_stacking_focused`: convert node to stack, merge windows, move in/out of stack (`StackMoveResult`) | source-code | cosmic-comp/src/shell/layout/tiling/mod.rs (2132-2253) | commit 81cd5fd |
| C-22 | `is_dialog` (Wayland parented windows, X11 override-redirect/modal/special types, fixed-size windows) and `TilingExceptions` regex set; shipped `tiling-exceptions.ron` defaults | source-code | cosmic-comp/src/shell/layout/mod.rs (17-89); cosmic-comp/data/tiling-exceptions.ron | commit 81cd5fd |
| C-23 | Window map path: fullscreen first; dialog/exception/untiled to `floating_layer`; else `tiling_layer.map`; new windows over a focused stack added to it | source-code | cosmic-comp/src/shell/mod.rs (2890-2953) | commit 81cd5fd |
| C-24 | `map_fullscreen`/`remove_fullscreen_at` and `FullscreenRestoreState` (tiling/floating/sticky/stack) restore prior state on exit | source-code | cosmic-comp/src/shell/workspace.rs (250-292, 1249-1372) | commit 81cd5fd |
| C-25 | Per-set `sticky_layer`; `ToggleSticky` action; sticky windows persist across workspace switches on an output | source-code | cosmic-comp/src/shell/mod.rs (361-372, 486-503); input/actions.rs (1012-1014) | commit 81cd5fd |
| C-26 | Session socket `Message` carries only `SetEnv`; no window session-restore mechanism in cosmic-comp | source-code | cosmic-comp/src/session.rs (22-26) | commit 81cd5fd |
| C-27 | `cosmic-session`: systemd session manager (start/restart/stop via D-Bus); no window restore logic | source-code | cosmic-session/src/main.rs, comp.rs | commit b5ef6c0 |
| C-28 | Settings pages: Workspaces page (workspace mode/layout/wraparound, `show_workspace_name`/`show_workspace_number` for `com.system76.CosmicWorkspaces`), Tiling shortcuts page (ToggleTiling/ToggleStacking/ToggleWindowFloating/ToggleOrientation/Orientation/SwapWindow), Window Management page (focus-follows-cursor, edge snap, active hint) | source-code | cosmic-settings/cosmic-settings/src/pages/desktop/workspaces.rs, pages/desktop/window_management.rs, pages/input/keyboard/shortcuts/tiling.rs | commit 7287257 |
| C-29 | `Action::ToggleTiling`: Global mode toggles `autotile` (persisted via `config.set`); PerWorkspace mode toggles the active workspace; applied live via `update_autotile`/`apply_tile_change` | source-code | cosmic-comp/src/input/actions.rs (971-1001); shell/mod.rs (1462-1493); config/mod.rs (858-880) | commit 81cd5fd |
| C-30 | Smoothness/source-supported cues: `ANIMATION_DURATION=200ms`, `GESTURE_MAX_LENGTH=150`, spring physics on gesture end; Epoch README describes the desktop as offering "performance, efficiency" | source-code + official-doc | cosmic-comp/src/shell/mod.rs (120-121, 334-344); cosmic-epoch README.md | commit 81cd5fd / tag epoch-1.5.0 |
| C-31 | README install path: COSMIC Epoch 1 ships in Pop!_OS 24.04 (ISO or rolling packaging); 22.04 unsupported | official-doc | https://github.com/pop-os/cosmic-epoch README.md (tag epoch-1.5.0) | tag epoch-1.5.0 |
| C-32 | cosmic-comp Makefile installs `data/keybindings.ron` to `com.system76.CosmicSettings.Shortcuts/v1/defaults` and `data/tiling-exceptions.ron` to WindowRules defaults | source-code | cosmic-comp/Makefile | commit 81cd5fd |
| C-33 | Arch package `cosmic-comp 1:1.5.0` on the extra repository | packaging | https://archlinux.org/packages/extra/x86_64/cosmic-comp/json/ | 1:1.5.0 |
| C-34 | Automatic binary-tree insertion: `map_to_tree` inserts a new window as a root, as a sibling split of a given node (axis from the target window's geometry when `w>h` -> Vertical else Horizontal), or with an explicit direction; a given direction maps Left/Right -> Vertical, Up/Down -> Horizontal with the new window made first/second sibling | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs (548-616) | commit 81cd5fd (retrieved 2026-08-10) |
| C-35 | Keyboard orientation controls: shipped keybinding `(modifiers:[Super], key:"o"): ToggleOrientation`; `Action::ToggleOrientation`/`Action::Orientation` update the active workspace's tiling orientation (`update_orientation`); the `Orientation` action enum is Horizontal/Vertical | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/data/keybindings.ron (83); https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/input/actions.rs (944-958); https://github.com/pop-os/cosmic-settings-daemon/blob/e37160f14d1e7ee428f973cd2848b4e95f83dfe1/config/src/shortcuts/action.rs (78, 128-129, 268-271) | commit 81cd5fd / commit e37160f (retrieved 2026-08-10) |
| C-36 | No keyboard preselection: the complete `shortcuts::Action` enum (Close..ZoomOut, ~150 variants) and the complete shipped `keybindings.ron` (1-128) contain no preselect, direct-insertion, or split action; the only window-placement actions are Move (current window), SwapWindow, and the overview drag | source-code | https://github.com/pop-os/cosmic-settings-daemon/blob/e37160f14d1e7ee428f973cd2848b4e95f83dfe1/config/src/shortcuts/action.rs (8-151); https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/data/keybindings.ron (1-128) | commit e37160f / commit 81cd5fd (retrieved 2026-08-10) |
| C-37 | Overview/pointer drag-to-split: dragging a tiled window (pointer move grab) enters the overview (`grab.is_tiling_grab()` -> `set_overview_mode`, shell/mod.rs 3959-3961); `update_pointer_position` computes `TargetZone::WindowSplit(window_id, direction)` from the cursor half over a window and adds a `DropZone` placeholder (tiling/mod.rs 3373-3410, 3660-3691, 3804-3831); on release the move-grab path calls `tiling_layer.drop_window`, which splits the target window in the chosen direction to make room (moving.rs 815-847; tiling/mod.rs 2666-2769) | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/grabs/moving.rs (815-847); https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs (3373-3410, 3660-3691, 3804-3831, 2666-2769); https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/mod.rs (3959-3961) | commit 81cd5fd (retrieved 2026-08-10) |
| C-38 | Live-tree versus saved-topology/persistence: the tiling tree is a live-window tree - `unmap` captures an in-memory `RestoreTilingState` (parent/sibling/orientation/idx/sizes) for minimize/remap within the session; `unmap_internal` removes the leaf and flattens a group when it empties (regions merge by construction); no tree serialization exists (full-tree search of cosmic-comp) | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs (343-346, 438-546, 1305-1351, 1414-1478) | commit 81cd5fd (retrieved 2026-08-10) |
| C-39 | Automatic placement: `map_internal` inserts a new window as a sibling split of the last-active (focused) node in the tree (`last_active_window` from the seat focus stack), or as root when the tree is empty; direction is None on the automatic map path | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs (396-435); https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/mod.rs (2952) | commit 81cd5fd (retrieved 2026-08-10) |
| C-40 | Per-output structural scope (D4.8): each `Workspace` owns its own `TilingLayout` binary tree (workspace.rs ~106, ~391-398); in the default `OutputBound` mode each output carries its own `WorkspaceSet`, so live-tree scope is per output per workspace, consistent with D4.1 | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/workspace.rs (106, 391-398); https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/mod.rs (C-05) | commit 81cd5fd (retrieved 2026-08-10) |
| C-41 | Cross-output structural re-insertion (D4.9): `move_tree` moves a window to another workspace's tree by inserting it as a sibling split of the target tree's focused node (or root), with the given direction when present; no authored position exists to preserve | source-code | https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs (645-757) | commit 81cd5fd (retrieved 2026-08-10) |

### 6.2 Hyprland

| ID | Claim summary | Type | Source | Version / snapshot |
|---|---|---|---|---|
| H-01 | v0.56.2 tag identity and release date (2026-08-05, vaxerski); patch release backporting fixes (fullscreen, monitor-rule, hit-test, config) | official-doc | https://github.com/hyprwm/Hyprland/releases/tag/v0.56.2 | commit efb5099 |
| H-02 | First-run config generation writes `EXAMPLE_CONFIG` stub ("This config is a STUB... Use the default lua config from example/hyprland.lua"); creates config dir | source-code | src/config/legacy/ConfigManager.cpp (2096-2131); src/config/legacy/DefaultConfig.hpp | v0.56.2 |
| H-03 | Shipped reference config `example/hyprland.lua`: dwindle default, monitors auto, animations on with springs/beziers, binds (Super+1-10 workspace, Super+Shift+1-10 move-to-workspace, Super+arrows movefocus, Super+V float, Super+P pseudo, Super+J togglesplit, Super+S special, Super+scroll e+/e-, Super+LMB/RMB drag/resize), window rules | official-doc + source-code | https://github.com/hyprwm/Hyprland/blob/v0.56.2/example/hyprland.lua | v0.56.2 |
| H-04 | Workspace model: `CWorkspace(id, monitor, name, special, isEmpty)`; `m_monitor` binding; `CMonitor::m_activeWorkspace`; monitor-relative workspace selectors | source-code | src/desktop/Workspace.cpp (29-45, 120-155); src/output/Monitor.hpp (75) | v0.56.2 |
| H-05 | Workspaces created on demand: `resolveWorkspaceForChange` creates a workspace if absent; `create` honors `getBoundMonitorForWS`; `previous`, `e+1`, named workspaces | source-code | src/config/shared/actions/ConfigActions.cpp (997-1045); src/state/WorkspaceState.cpp (58-79) | v0.56.2 |
| H-06 | Workspace rule fields: `m_monitor`, `m_isPersistent`, `m_isDefault`, `m_onCreatedEmptyRunCmd`, `m_defaultName`, `m_layout` | source-code | src/config/shared/workspace/WorkspaceRule.hpp | v0.56.2 |
| H-07 | `moveWorkspaceToMonitor`: moves workspace and its windows; plug-gap creates/assigns the next workspace on the old monitor (ID 1 upward, skipping bound IDs); pinned windows stay | source-code | src/state/WorkspacePlacementController.cpp (239-380) | v0.56.2 |
| H-08 | `ensurePersistentWorkspacesPresent` and `ensureWorkspacesOnAssignedMonitors`: per-monitor binding and persistence from `workspace=` rules | source-code | src/state/WorkspacePlacementController.cpp (35-149) | v0.56.2 |
| H-09 | Hotplug: disconnect -> `rememberWorkspaceForMonitor`, workspaces moved to backup monitor, `m_lastMonitor` recorded; reconnect -> RETURNING/RECOVERY workspaces moved back, remembered workspace re-activated, `setupDefaultWS` assigns next available ID or the rule target | source-code | src/output/Monitor.cpp (316-390, 415-498, 1290-1330) | v0.56.2 |
| H-10 | `swapActiveWorkspaces`: swap workspaces between two monitors, repositioning their windows | source-code | src/state/WorkspacePlacementController.cpp (151-237) | v0.56.2 |
| H-11 | `Actions::moveFocus`: `inDirection` over all windows; same-monitor hidden-workspace windows excluded; other-monitor windows eligible unless `window_direction_monitor_fallback` false | source-code | src/config/shared/actions/ConfigActions.cpp (368-455); src/desktop/state/WindowQuery.cpp (23-170) | v0.56.2 |
| H-12 | Defaults: `binds:window_direction_monitor_fallback=true`, `binds:movefocus_cycles_fullscreen=false`, `general:no_focus_fallback=false` | source-code | src/config/values/ConfigValues.cpp (180, 534-538) | v0.56.2 |
| H-13 | `Actions::moveInDirection` -> `g_layoutManager->moveInDirection`; dwindle `moveTargetInDirection` assigns the target to the focal monitor's active workspace when the focal point is off-monitor | source-code | src/config/shared/actions/ConfigActions.cpp (477-491); src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp (556-608) | v0.56.2 |
| H-14 | `swapInDirection` and `swapWith` swap windows/layout targets | source-code | src/config/shared/actions/ConfigActions.cpp (493-532) | v0.56.2 |
| H-15 | `Actions::changeWorkspace`: switches the focused monitor's active workspace; if the workspace lives on another monitor, focuses that monitor; `workspace_back_and_forth`, `previous_per_monitor`, relative/range/named selectors | source-code | src/config/shared/actions/ConfigActions.cpp (934-1052) | v0.56.2 |
| H-16 | Workspace retention: workspaces persist after creation; no empty-workspace auto-removal path found in workspace state/source | source-code | src/state/WorkspaceState.cpp; full-tree search | v0.56.2 |
| H-17 | Groups: `group:insert_after_current=true`, `group:groupbar:enabled=true` defaults; groupbar renders per-group tabs | source-code | src/config/values/ConfigValues.cpp (415-445) | v0.56.2 |
| H-18 | Fullscreen: `FullscreenController`, layout-managed fullscreen modes; v0.56.2 backports fullscreen focus-order and rendering fixes | source-code | src/managers/fullscreen/; H-01 | v0.56.2 |
| H-19 | Window rules: `hl.window_rule` match by class/title/workspace with float/move/workspace/no_focus/suppress_event properties | official-doc + source-code | example/hyprland.lua (317-355); wiki.hypr.land/Configuring/Basics/Window-Rules (snapshot) | v0.56.2 / wiki snapshot 2026-08-09 |
| H-20 | No session-restore implementation in source (no xdg-session-management handler; no restore code in Workspace/Config paths) | source-code | full-tree search of src/ | v0.56.2 |
| H-21 | Smoothness: animations enabled by default in the example config (spring `easy`, beziers, per-leaf `hl.animation`); wiki Performance page documents the project's performance focus | source-code + official-doc | example/hyprland.lua (130-161); wiki.hypr.land (Performance, snapshot) | v0.56.2 / wiki snapshot 2026-08-09 |
| H-22 | Lua config era: "Since Hyprland 0.55, hyprlang is deprecated in favor of lua" (wiki note) | official-doc | wiki.hypr.land/Configuring/Basics/Workspace-Rules (snapshot) | wiki snapshot 2026-08-09 |
| H-23 | Dispatchers list: `workspace`, `renameworkspace`, `movetoworkspace(silent)`, `movefocus`, `movewindow`, `swapwindow`, `focusmonitor`, `movecursortocorner`, `workspaceopt`, `movecurrentworkspacetomonitor`, `focusworkspaceoncurrentmonitor`, `moveworkspacetomonitor`, `togglespecialworkspace`, `togglegroup`, `changegroupactive`, `pin`, `submap`, `togglefloating`, `fullscreen`, `pseudo`, `swapactiveworkspaces`, `cyclenext`, `layoutmsg`; no workspace-removal or reorder dispatcher | source-code | src/managers/KeybindManager.cpp (45-110) | v0.56.2 |
| H-24 | `layoutmsg preselect`: DwindleAlgorithm `layoutMsg` handles `togglesplit`/`swapsplit`/`rotatesplit`/`movetoroot`/`preselect`/`splitratio`; `preselect <l/r/u/t/d>` sets `m_overrideDirection` (used in `addTarget` ~160-179 to force split direction/position on the next window; `dwindle:permanent_direction_override` persists it); `layoutmsg` is a registered dispatcher. Wiki documents preselect as "A one-time override for the split direction. (valid for the next window to be opened, only works on tiled windows)" and `permanent_direction_override` | source-code + official-doc | https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp (674-746); src/managers/KeybindManager.cpp (88); https://wiki.hypr.land/Configuring/Layouts/Dwindle-Layout/ (latest-git snapshot, last modified 2026-08-09) | v0.56.2 / wiki snapshot 2026-08-10 |
| H-25 | Dwindle insertion/orientation: `addTarget` picks the insertion target (`OPENINGON`) - window under cursor (when `use_active_for_splits=false`), focused window (when true, default), or closest node to a focal point - and the new window splits it; split direction follows the preselect override, or cursor position relative to the target (smart_split / precise_mouse_move / wasDraggingWindow branches), or parent geometry; defaults `force_split=0`, `smart_split=false`, `precise_mouse_move=false`, `use_active_for_splits=true`; wiki quirk "Dwindle splits are NOT PERMANENT" | source-code + official-doc | https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp (65-258); src/config/values/ConfigValues.cpp (658-673); https://wiki.hypr.land/Configuring/Layouts/Dwindle-Layout/ | v0.56.2 / wiki snapshot 2026-08-10 |
| H-26 | Drag controller target-directed split: `bindm`/`window.drag` mouse bind is shipped in the example config (`hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })`, example/hyprland.lua 290; `hlWindowDrag` -> `dsp_mouseDrag`, LuaBindingsDispatchers.cpp 1067-1070); on drag end for a tiled window the drag controller re-tiles it (`setTargetGeom`/`changeFloatingMode`, DragController.cpp 275-285) via `movedTarget(target, focalPoint)` (DwindleAlgorithm.cpp 260-264, 600) -> `addTarget` re-inserts it splitting the node closest to the cursor with cursor-derived direction (DwindleAlgorithm.cpp 96-103, 180-227); wiki documents `precise_mouse_move` ("bindm movewindow will drop the window more precisely depending on where your mouse is") and `smart_split` | source-code + official-doc | https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/layout/supplementary/DragController.cpp; src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp; example/hyprland.lua (290); https://wiki.hypr.land/Configuring/Layouts/Dwindle-Layout/ | v0.56.2 / wiki snapshot 2026-08-10 |
| H-27 | Live tree / persistence / empty-state: `SDwindleNodeData` is a binary tree node (leaf `pTarget` = window, `isNode` for internal splits; DwindleAlgorithm.hpp 8-22); `onWindowRemovedTiling` removes the node and promotes the sibling, collapsing the parent by construction (DwindleAlgorithm.cpp 266-308); no dwindle serialization exists (full-tree search); workspace `persistent` rules persist workspace existence, not tree structure (H-06) | source-code | https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.hpp (8-22); src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp (266-308) | v0.56.2 (retrieved 2026-08-10) |
| H-28 | Per-workspace tree scope (D4.8): each `CWorkspace` creates its own `CSpace` and sets an algorithm provider (`createAlgorithmForWorkspace`), so each workspace owns its own dwindle tree; workspaces are bound to one monitor (H-04) and a monitor shows one active workspace | source-code | https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/desktop/Workspace.cpp (60-61) | v0.56.2 (retrieved 2026-08-10) |

### 6.3 Composition and version notes

| ID | Claim summary | Type | Source |
|---|---|---|---|
| X-05 | COSMIC rubric 3.3 baseline ("tiling enabled as shipped") vs source default `autotile=false`; resolved in unit-04/attempt-01: the source default is ONE enablement/configuration friction scored in J1 coherence only (D6.1 = MF, Super+y enable, C-14/C-29), not tiling-workflow friction and not double-counted in other J1 cells | composition | C-03, C-14, C-29 |
| X-06 | Hyprland baseline config decision (U6 resolved): shipped `example/hyprland.lua` plus documented `movewindow`/`swapwindow` binds required by J3/J5; not an optional component | composition | H-02, H-03, H-23 |
| X-07 | Hyprland wiki is "latest git", not version-pinned to v0.56.2; wiki claims snapshot-dated and cross-checked against source | composition | H-22 |
| X-08 | COSMIC and Hyprland both lack compositor-side session restore; D1.6 UK for both (unit-04 candidate only for observation) | composition | C-26, C-27, H-20 |
| X-09 | Live-tree versus saved-topology distinction (section 4C.1): COSMIC and Hyprland maintain live-window binary trees (no authored or persisted topology; no empty-region authoring); bspwm 0.9.12 documents receptacles + preselection and `wm --dump-state`/`--load-state` persistent saved topology; generated automatic layouts (Krohnkite engines, Hyprland master/monocle, bspwm automatic schemes) are scheme-computed geometry, not authored structure | composition | C-34, C-36, C-38, H-24, H-25, H-27, B-02..B-07 |
| X-10 | Source-supported combination model (section 4C.2): a prospective integrated Plasma product could borrow COSMIC's shipped-surface + overview drag-to-split (D9.3), Hyprland's `layoutmsg preselect` keyboard-directed insertion (D9.2), and bspwm's authored persistent topology model (receptacles/preselection/dump-load, D9.1/D9.4/D9.5/D9.6 reference); no single reference delivers the full combination coherently; NOT a unit-05 product conclusion | composition | C-37, C-39, H-24, H-26, B-03..B-06 |

### 6.4 bspwm (bounded structural reference, rubric section 2.3)

| ID | Claim summary | Type | Source | Version / snapshot |
|---|---|---|---|---|
| B-01 | Tag 0.9.12 identity at commit c5cf7d3; man page sources `doc/bspwm.1.asciidoc` and rendered `doc/bspc.1` at the tag | official-doc | https://github.com/baskerville/bspwm/releases/tag/0.9.12 ; https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc ; https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspc.1 | tag 0.9.12, commit c5cf7d3 (retrieved 2026-08-10) |
| B-02 | bspwm "doesn't handle any keyboard or pointer inputs: a third party program (e.g. *sxhkd*) is needed in order to translate keyboard and pointer events to *bspc* invocations"; represents windows as leaves of a full binary tree | official-doc | https://github.com/baskerville/bspwm/blob/0.9.12/README.md | tag 0.9.12 (retrieved 2026-08-10) |
| B-03 | Receptacles: "A leaf node that doesn't hold any window is called a receptacle. ... A receptacle can be inserted on a node, preselected and killed. Receptacles can therefore be used to build a tree whose leaves are receptacles."; `bspc node -i`/`--insert-receptacle` inserts an empty receptacle leaf; `make_node(XCB_NONE)` + `insert_receptacle` | source-doc + source-code | https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc (Receptacles ~394); src/tree.c (464-473) | tag 0.9.12 (retrieved 2026-08-10) |
| B-04 | Preselection / manual insertion mode: `bspc node -p DIR|cancel` and `-o RATIO`; "A node with a preselected area is said to be in 'manual insertion mode'"; `presel_dir`/`presel_ratio`/`cancel_presel` | source-doc + source-code | https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc (430-434); src/tree.c (215-260) | tag 0.9.12 (retrieved 2026-08-10) |
| B-05 | Automatic insertion schemes: `automatic_scheme` = `longest_side`/`alternate`/`spiral`, `initial_polarity` = `first_child`/`second_child`; `insert_node` splits a preselected node per preselect direction/ratio and replaces a receptacle with the new node | source-doc + source-code | https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc (716); src/tree.c (291-430) | tag 0.9.12 (retrieved 2026-08-10) |
| B-06 | Persistent saved topology: `bspc wm -d`/`--dump-state` dumps the current world state; `bspc wm -l`/`--load-state <file>` loads a world state; `examples/receptacles` (`extract_canvas` replaces each window leaf with a receptacle, `induce_rules` emits commands to re-place windows in the matching receptacles) documents storing and recreating layouts | source-doc + source-code | https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc (600-603); https://github.com/baskerville/bspwm/blob/0.9.12/examples/receptacles/README.md | tag 0.9.12 (retrieved 2026-08-10) |
| B-07 | Removal/collapse: `unmanage_window` -> `remove_node` -> `unlink_node` unlinks the leaf and promotes the sibling subtree (with `removal_adjustment` per scheme), so a window-leaf close collapses its branch; receptacles are the explicit retention mechanism (`kill_node` treats `IS_RECEPTACLE` separately) | source-code | https://github.com/baskerville/bspwm/blob/0.9.12/src/window.c (237-252); src/tree.c (1337-1474) | tag 0.9.12 (retrieved 2026-08-10) |
| B-08 | Default sxhkdrc keyboard preselect: `super + ctrl + {h,j,k,l}` -> `bspc node -p {west,south,north,east}`, `super + ctrl + {1-9}` -> `bspc node -o 0.{1-9}`, `super + ctrl + space` -> `bspc node -p cancel`, `super + y` -> `bspc node newest.marked.local -n newest.!automatic.local`; the shipped file contains no pointer bindings | source-code (shipped data) | https://github.com/baskerville/bspwm/blob/0.9.12/examples/sxhkdrc (86-108) | tag 0.9.12 (retrieved 2026-08-10) |
| B-09 | Pointer actions: `pointer_modifier` + button1/2/3 = move / resize-side / resize-corner; `pointer_action<n>` accepts `move`/`resize_side`/`resize_corner`/`focus`/`none`; no preselect or drag-to-split pointer action exists. Together with B-02/B-08 this resolves U11 as an explicit negative (evidenced absence): bspwm provides no pointer-directed drag-to-split placement, classified D9.3 = CB reference | source-doc | https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc (748-757) | tag 0.9.12 (retrieved 2026-08-10) |

## 7. Verification Against plan.md unit-03 Acceptance

plan.md reopened `unit-03` verification clause (`## Work Units` table, unit-03
row): "Current source/docs support every full-comparator claim;
COSMIC/Hyprland and bspwm structural evidence cover each required element or an
explicit unknown; semantic differences and the bspwm scope boundary are
recorded."

| Clause element | This report |
|---|---|
| Current source/docs support every full-comparator claim | Every cell in sections 3-4A carries evidence IDs from the register (section 6), each pinned to a tag/commit or dated snapshot; J1-J8 / D4.1-D4.7 records retrieved 2026-08-09, attempt-02 structural records (C-34..C-41, H-24..H-28, X-09..X-10) retrieved or verified 2026-08-10 from the pinned clones; claims derive from source code, official release notes, shipped config data, or the wiki (snapshot-dated, cross-checked against source) |
| COSMIC/Hyprland and bspwm structural evidence cover each required element or an explicit unknown | J9/J10 matrices (section 3) and the D9 matrix (section 4A) classify every D9.1-D9.6 cell for COSMIC and Hyprland; D4.8-D4.11 are recorded out of scope for authored structure with their underlying model (section 4); the bounded bspwm reference matrix (section 4B) covers every D9.1-D9.6 element (D9.3 = CB reference, an explicit negative established from B-02/B-08/B-09, U11 resolved) under rubric section 2.3 scope |
| Semantic differences and the bspwm scope boundary are recorded | COSMIC output-bound vs Hyprland global-ID workspace models (D4.1); COSMIC dynamic auto-remove vs Hyprland persist-only workspace lifecycle (D1.2/D1.3); COSMIC focus fall-through vs Hyprland query-based focus (D3.1/D4.2); COSMIC on-demand overlay vs Hyprland no-indication (D4.5); and the structural-model distinctions - COSMIC/Hyprland live-window trees, bspwm receptacles/preselection + dump/load persistent topology, and generated automatic layouts (section 4C.1) - recorded as distinct semantics with per-comparator classifications. The bspwm scope boundary is stated in section 1.1, section 4B, and section 4C |
| Unavailable evidence is explicit | D1.6 (session restore) and D7.2 (degradation) are UK for both with exact missing evidence; U04-7..U04-12 list runtime/version-ambiguous claims requiring unit-04 observation; every D9.1-D9.6 cell has a classification or explicit UK with a direct record; D4.8-D4.11 are recorded out of scope for authored structure per the rubric preamble with their underlying structural-state model recorded; the bspwm D9.3 cell is an explicit negative (CB reference) established from B-02/B-08/B-09 with U11 resolved - not UK and not a failure-by-silence; no UK cell is converted into a failure claim |

Additional plan constraints honored: no live-session interaction or state change
of any kind (no install, no config write/read, no compositor run, no output or
window change); no edits outside this report's scope (no separate
`bspwm-structural-reference.md` was created; the bounded reference is recorded
within this report); no `sustained-workload-validation` contact; no commit.

## 8. Risks and Notes

- The rubric's COSMIC baseline assumption ("tiling enabled as shipped", rubric
  3.3) is contradicted by the source default `autotile=false` (C-03). Resolved
  in unit-04/attempt-01 per the accepted scoring correction: J1 D6.1 = MF (one
  enablement/configuration friction, the Super+y toggle), J1 D2.1/D6.2/D7.1/
  D8.5 stay PD (no double counting), and COSMIC J1 status is MF (D6.1). unit-05
  must not re-count this cost in other cells. Attempt-02 retains this scoring
  exactly as-is and adds no new J1 cell.
- Hyprland's D1.4 (reorder) and D1.3 (removal) are classified CB because no
  documented affordance can complete those workflows in v0.56.2 (rubric section
  8). If unit-05 treats the ID-based workspace model as an equivalent documented
  model for the rubric's reorder criterion, D1.4 could be reconsidered as PD;
  that is a rubric-interpretation decision, not an evidence change.
  The CB classification is retained under the accepted rubric.
- Hyprland D4.5/D5.1 MF rests on the absence of a shipped indicator; a third
  party bar is excluded per rubric section 4. This is a structural absence
  (compositor ships no UI), evidenced from source, not documentation silence.
- The COSMIC source default `autotile=false` is settled (C-03); whether
  Pop!_OS 24.04 packaging ships a first-run config that overrides it (U04-11)
  and Hyprland first-run config routing remain packaging artifacts that only a
  live install can settle. The J1 D6.1 MF scored here rests on the source
  default, which is the evidence-backed baseline claim.
- D9.1/D9.2/D9.4/D9.5/D9.6 for COSMIC and D9.1/D9.4/D9.5/D9.6 for Hyprland are
  classified CB from source (sections 3, 4A). Under rubric 9.1 a TS journey CB
  elevates the opportunity from narrow to strong only when the evidence shows
  the failure occurs in the target segment's documented normal daily workflow
  and is not rescued by a documented step. The cell-level facts are established
  here; the daily-workflow severity is unit-05's Decision Rule application and
  may not be assumed from this report. A safe unit-04 observation (candidate
  U04-12) could close the remaining runtime question if separately authorized.
- D9.2 is the single positive structural differentiation: Hyprland satisfies
  keyboard-directed insertion (`layoutmsg preselect`, wiki-documented) while
  COSMIC has no preselect affordance in its complete action/shortcut surface.
  D9.3 (pointer drag-to-split) is source-evidenced for both (COSMIC overview
  drag; Hyprland mouse-drag re-tile), but the observable drop outcomes are
  runtime behaviors (U04-12).
- The bspwm reference (section 4B) is bounded to structural authoring and
  direct placement per rubric sections 2.3/3.5. Its D9.3 cell is CB (reference),
  an explicit negative established from B-02/B-08/B-09: bspwm handles no
  pointer input and its documented pointer actions are move/resize/focus only,
  and the shipped sxhkdrc has no pointer preselect/split binding (U11 resolved
  as an evidenced absence, not documentation silence); a third-party sxhkd
  pointer configuration is outside the pinned reference. No bspwm cell
  supports any desktop-wide, multi-output, installation, workspace, indication,
  or broad lifecycle claim; unit-05 must not extend it.
- D4.8-D4.11 are recorded out of scope for authored structure for both
  comparators (rubric D4 preamble); the underlying per-output/per-workspace
  live-tree model facts are recorded per cell and must not be re-scored as
  authored-structure capability in unit-05.
- All unit-04 candidates are observations requiring a safe environment and the
  plan safety gate; none were performed.
