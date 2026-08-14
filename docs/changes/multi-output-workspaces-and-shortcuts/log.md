# Planning log

## 2026-08-14

- User-approved amendment recorded: Meta+0 is deferred and unbound in every
  mode; automatic trailing-empty maintenance remains; Meta+Shift+0 remains
  separable move-to-newly-appended-and-follow.
- Resolved decisions recorded: retain combined directional move/swap; no current
  acceptance for bounded Meta+0 behavior.
- Proposed serial plan created. Production implementation, live KWin/Plasma
  testing, commits, and pushes remain unauthorized.
- Planning evidence: `setCurrentDesktopForScreen` is declared globally but not
  exposed through the controller environment; no existing controller
  `readConfig` seam exists. The dirty keyboard prototype has conflicting Meta
  aliases, unsafe resize dual-write/rollback assumptions, and no arrow resize
  behavior tests.
- User-approved consequential profile amendment recorded: selected baselines
  are `cosmic` (default), `hyprland`, and `bspwm`; users may override the
  selection afterward; exact reference defaults supersede blended project
  bindings; Meta+0 remains deferred/unbound; Meta+Shift+0 remains in scope.
- Research checkpoint: COSMIC ships arrow and HJKL defaults; Hyprland's
  generated default ships directional arrows but not HJKL; bspwm ships no WM
  bindings and its `examples/sxhkdrc` is a canonical example baseline.
  Citations and classifications are recorded in `spec.md:C`.
- Blocked dependency recorded: KWin script `registerShortcut` cannot displace
  or reassign Plasma global shortcuts and does not report activation collisions.
  Script-local profile registration is a truthful first stage only; profile
  conflict takeover and displaced-Plasma migration require a separately
  approved installer/KCM component with snapshot and rollback semantics. No
  production code, live mutation, commit, or push was performed.
- Unit 01 accepted: added the typed `cosmic` (default), `hyprland`, and `bspwm`
  catalog model with exact/canonical-example/compatibility-alias/deferred row
  classifications, selection fallback diagnostics, duplicate validation, and
  a pure user-override precedence seam. KWin-local registration is driven by
  the selected catalog; `Meta+0` is absent and `Meta+Shift+0` remains a
  distinct catalog action. Static controller and typecheck verification passed.
- Unit 01 review correction: bspwm's arrow focus and move/swap parity rows are
  correctly classified as compatibility aliases. Its upstream arrow row is a
  floating-window nudge, not the tiled move/swap action.
- Deferred Unit 03 checkpoint: `scripts/start-test.test.sh` still parses old
  literal registrations and fails its 16 directional checks against the
  catalog-driven registration loop. It must be updated only with the Unit 03
  KWin-local registration and migration-boundary work; no lifecycle script was
  changed in Unit 01.
- Unit 02 accepted: corrected the dirty resize prototype to a one-write,
  fresh-postcondition implementation. COSMIC `Meta+R` enters outward resize
  mode and `Meta+Shift+R` enters/switches inward mode; re-entering the active
  mode exits deterministically. Registered directional focus HJKL/arrow rows
  operate the mode. bspwm canonical resize rows map directly to outward/inward
  actions. No Meta+Ctrl resize defaults, structural calls, or window-geometry
  writes were retained.
- Unit 02 static evidence: focused-tile `relativeGeometry` writes use KWin
  `CustomTile::setRelativeGeometry` sibling adjustment and its 15% floor;
  source evidence is recorded in
  `docs/changes/integrated-plasma-structural-feasibility/research/kwin-api-surface.md:153-158`.
  Static typecheck and 367 controller tests passed. Live KWin confirmation is
  intentionally unproven because no live mutation was authorized.
- Unit 02 deferred checkpoint: the committed generated bundle still predates
  source changes, so full artifact smoke cannot pass until Unit 03's approved
  registration/rebuild checkpoint. No generated file was hand-edited.
- Unit 03 accepted: catalog registration now reports deterministic catalog
  collisions and individual registration failures, while retaining stable IDs
  across script restart/reload. The controller has no Meta+0 append handler or
  registration surface; Meta+Shift+0 remains separate. The lifecycle check now
  derives directional registrations from the COSMIC catalog rather than stale
  literals, and the generated bundle was reproduced only through `npm run
  build`.
- Unit 03 migration boundary: README and controller diagnostics state that
  KWin-local registration cannot reassign or displace Plasma globals. Collision
  takeover remains gated on a separately approved installer/KCM component with
  selected-reference equivalent mapping or unassigned state, atomic snapshot,
  rollback, collision detection, and live activation evidence. No DBus,
  `kglobalshortcutsrc`, installer/KCM migration, or live-session mutation was
  added to the KWin script.
- Unit 03 verification passed: `npm run typecheck`; `npm test` (641 tests);
  `bash scripts/start-test.test.sh` (248 checks); `bash
  scripts/dogfood-install.test.sh` (108 checks); and a repeated `npm run build`
  with no generated-bundle diff. Live KWin behavior and Plasma-global collision
  activation remain unproven and outside authorization.
- Unit 04 accepted: `workspaceMode` (`per-output-local` default,
  `global-unique`, `shared`) parses via the existing `readConfig` seam with
  invalid fallback diagnostics. `setCurrentDesktopForScreen` is wired through
  `ControllerEnvironment` and the entry seam, and workspace navigation/follow
  now writes per-output on the affected output with a global fallback, so
  one-output behavior is unchanged. `currentDesktopChanged` keeps its output
  argument across the typed boundary. Deterministic session output keys derive
  from the manufacturer/model/serial/name tuple with first-seen collision
  ordering, rebuilt on start and screensChanged, and never persisted.
  Migration is non-destructive: pre-existing/user desktops are never adopted as
  owned or removed. Unit 05 dispatch is not implemented. Generated bundle
  reproduced only through `npm run build`.
- Unit 04 verification passed: `npm run typecheck`; `npm test` (652 tests, 381
  controller); `bash scripts/start-test.test.sh` (248 checks). Live KWin
  behavior and Plasma-global collision activation remain unproven and outside
  authorization.
