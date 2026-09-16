# Backlog

Only meaningful pending or active work is listed.

- P1 | Non-visible workspace tiling live gate | Background tiling is statically
  implemented and verified: startup and window open/move adopt or reconcile
  non-foreground domains without switching desktop visibility or stealing native
  focus. User-owned live acceptance must cover hidden startup/open/move,
  multi-output domains, unchanged native focus/desktop, and the absence of any
  rendered-state claim. Graceful move-follow has separate user manual
  acceptance. [record](changes/background-tiling.md)
- P1 | Remaining workspace-send uncertainty recovery | Graceful move-follow is
  implemented and manually accepted after rapid sends across many workspaces.
  USER VISUAL/MANUAL: "The issue appears to be fixed, I spam moved a window between many workspaces and it never failed. ... reinforces ... graceful handling ... actually feel really good even when spamming." The supplied
  `/run/user/1000/plasma-auto-tiler-dev.E2E0QJ.log` is NOT ANALYZED; this is not
  machine protocol, rendered-visibility, latency, recovery, or native-cause
  evidence. Graceful, unsurprising confirmed partial success and responsiveness
  during rapid use are the durable product preference, not permission to ignore
  errors, retry, reset a queue, or change architecture.
  Recovery from genuinely uncertain layout transactions remains a separate
  product decision; the accepted run does not select new recovery semantics.
  Proven pre-dispatch and well-formed request rejection paths are reusable. Sent request/lost callback,
  malformed reply, request timeout, owner loss, and other transport ambiguity
  can leave Rust pending; partial native mutation plus ack/verify timeout can
  also be uncertain. Selecting discard/reseed or another generation/protocol
  recovery remains a material decision; no blind reset, replay, or topology
  reconstruction is selected.
- P1 | Temporary active-group highlight live gate | Named-log diagnosis found
  retained-focus lookup and missing completed-geometry refresh defects; both are
  corrected and statically verified. A read-only native status diagnostic now
  separates policy receipt, parse/focus/order outcome, Meta/focus/OpenGL gates,
  and selected outline visibility without proving composited output. Rebuild,
  stage, and start a new Plasma session before rechecking the separate outline
  while holding Meta. The user reports no visible group border. User-owned
  evidence remains for native transport, modifier delivery, fullscreen
  suppression, rendering, and cost.
  [record](changes/archive/active-group-highlight-design.md)
- P1 | Preserved host residue | Do not search for, enumerate, inspect,
  heuristically identify, modify, or clean unidentified advisory, shadow, or
  nested-test residue. Any recovery needs explicit user authorization and exact
  identity or hash verification. No stale POC2/POC3 harness or checkpoint retry
  is authorized.
- P0 | Fullscreen residual-cost live gate | Production Plan fullscreen isolation
  is static-complete. User must run the exact fullscreen gate and establish the
  gaming cost baseline. [investigation](changes/reliability-condition-investigation.md)
- P0 | Maximize-admission clear live gate | Static coverage proves the one-shot
  `Window.setMaximize(false, false)` route, its synchronous echo fence, and
  post-admission isolation. A real KWin 6.7.4 session must establish that a
  session-restored maximized application restores, tiles, and cannot form an
  application re-maximize loop. No live result is claimed.
- P1 | Float/maximize shortcut physical delivery live gate | `Meta+G` and
  `Meta+M` actions register without changing Grid View or Krohnkite records.
  Read-only enumeration found both held, so KGlobalAccel serial dispatch
  shadows them until the user resolves each in System Settings. Verify physical
  delivery after that manual resolution; `Meta+Shift+G` has no observed holder.
- P1 | Output hotplug domain lifecycle | Preserve displaced layouts as separate
  workspaces on a remaining monitor; alternative handling may be configurable
  later. Visibility follows the active window's location at disconnect; with no
  active window, preserve the surviving view. Displaced workspaces return on
  reconnect with current contents/layout; explicitly moved-out windows stay out.
  Choose nearest only when the native handling source exposes removed-output
  geometry, otherwise use the surviving primary (then deterministic ordering).
  The current adapter does not retain removed geometry so it falls back to
  primary/ordering and never uses post-disconnect window geometry as a proxy. Reconnection keeps the active window
  visible/focused without restoring view history. Offline coverage exists for
  the stated displacement/return, atomicity, and preservation pieces; live
  acceptance remains pending and no live result is claimed.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Work-area change projection live gate | Static code projects one retained
  existing domain through resolution, scaling, and work-area changes without the
  client-drift park policy. User must run the exact gate, including fullscreen
  isolation and restoration. [investigation](changes/reliability-condition-investigation.md)
- P1 | Wake transport recovery implementation | Retain layouts if the Planner
  survives sleep. After confirmed Planner loss, automatically establish a fresh
  in-memory session from current windows using near-layout fitting with normal
  tiling fallback. Never replay interrupted commands or accept stale replies.
  Static implementation is complete with offline TypeScript and Rust coverage;
  live acceptance remains pending and no live result is claimed;
  uncertain-send recovery remains a separate, unselected protocol change.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | All settings live application (launch blocker) | Before launch, every
  user-facing setting must apply live, including tiling, workspace, shortcut,
  and effect settings. Overall liveness is PARTIAL, not complete: gaps apply
  through the deliberate retained reload below and borders stay live; the
  rest is pending. `shortcutProfile`/`workspaceMode` are startup-only
  (restart applies them); `tilingAlgorithm`, `automaticSplitTarget`, and
  `dropOutlinePreview` are persisted but consumed by nothing, so neither
  reload nor restart applies them. Verify running behavior reflects saved
  settings without requiring a tiler reload. The interim reload approach
  does not satisfy this.
  [investigation](changes/reliability-condition-investigation.md)
- P2 | Interim runtime configuration reload | Static-complete with retained
  offline proof, live gate pending: deliberate gap-only tiler reload after
  saving gap settings, with clear reload/restart UI and existing live border
  updates retained. Saving gaps marks reload-required and enables Reload
  Tiler; saving only non-gap script settings marks restart-required with
  reload disabled (note: restart genuinely applies only startup-read
  `shortcutProfile`/`workspaceMode`; the unconsumed `tilingAlgorithm`,
  `automaticSplitTarget`, `dropOutlinePreview` are applied by nothing today).
  Combined saves enable reload for gaps while retaining restart-required for
  other settings. A no-pending request sends nothing. A deliberate
  reload sends one typed KWin reconfigure request reported as
  sent-but-unconfirmed or failed, never applied; a queued send never clears
  restart-required; session restart remains the
  fallback guarantee for gap pickup only where the retained route cannot
  converge. The running controller subscribes to the KWin Options
  `configChanged` signal emitted after that reconfigure reparses kwinrc, then
  re-reads validated gap configuration and requests one debounced resync that
  dispatches retained `update-gaps` for a changed gap pair (proven offline
  for inner, outer, and combined changes with topology/share/focus
  preservation; ordinary drift reconcile still refuses gaps);
  unchanged signals resync nothing and shortcuts are never re-registered
  (no unregister operation exists on the pinned KWin scripting surface, so
  re-registration is unselected and foreign records stay KCM-explicit-only).
  Startup-read settings stay startup-only; unconsumed settings stay
  unconsumed. Reload/restart-required is dialog-scoped in-memory state: dialog
  load/reopen resets it and truthful cross-reload preservation is blocked
  (no authorized persistent key, no supported runtime observation). No live
  result is claimed and the all-settings live-application launch blocker is
  unchanged.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Rust-engine/direct-geometry migration live gate | Rust-mode exact-three
  focus, movement, keyboard resize, and pointer resize are static-complete behind
  disabled-by-default exclusive authority. Await a user rebuild/new session and
  one visual-jank smoke. The first host round trip, stale/service-loss refusal,
  after-snapshot equality, restoration, hostile same-UID service proof,
  atomicity, stock-KWin parity, and latency remain unproven. The halted advisory
  transport route needs a user-provided exact receipt/lifecycle record before any
  recovery.
- P1 | Custom Tile acceptance | Perform the separately authorized manual runtime
  check with exact restoration. Drag/reflow and host acceptance remain unproven;
  do not recover stale harnesses. [change](changes/custom-tile-runtime.md)
- P1 | Nested placement visual smoke | Verify occupied-leaf whole-rectangle
  preview and nested split placement. [change](changes/archive/nested-placement-affordance.md)
- P1 | Native active-border runtime delivery | Nix host-KWin ABI/session
  discovery and runtime/config/reload/restoration acceptance remain unproven.
  Existing border/KCM observations are manual evidence only.
  [decision](decisions.md#native-active-border)
- P1 | Tray live and release acceptance | KWin-origin SNI authority, watcher
  ordering, native ABI load, install/packaging, login/autostart, and
  update/rollback remain live-unproven. [change](changes/archive/tray-carrier.md)
- P1 | External NixOS/Home Manager delivery | Validate clean external install,
  update, generation rollback, and host-matching KWin ABI. [change](changes/archive/nix-current-host-delivery.md)
- P1 | Shortcut physical and recovery checks | Verify Lock Session, Revert,
  Phase 2 resize chords, and Restore. Do not induce another interruption or add
  fault injection. [change](changes/shortcut-override.md)
- P1 | Drag-oracle post-fix proof | The later echo-fence and dragged-source
  reassertion fixes are static-only. Rebuild/new-session test committed
  left/right/up/down resizes, exact 8px gaps, one planned-applied result, and no
  immediate reconcile. Multi-output, more-than-three-window, non-horizontal,
  boundary, atomicity, and parity claims remain unproven.
  [decision](decisions.md#production-interactive-edge-drag)
- P2 | Placement-aware startup adoption live gate | Initial fresh adoption now
  statically fits a best-effort near strip: unambiguous sequential primary
  intervals in `(x, y, w, h)` / `(y, x, h, w)` order, regardless of edge
  offsets, cross-axis drift, or observed gaps, projected with the configured
  gaps as the canonical result; grids, nested, T arrangements, and exceptions
  use normal deterministic seed/reflow fallback. The Rust fit is
  transaction-bound and applies independently to foreground and background
  domains; static unit coverage only, no live claim is made. User-owned live
  acceptance remains pending.
  [record](changes/placement-aware-startup-adoption.md)
- P2 | KWin controller silent unload | Attribute a manual controller unload only
  with before/after `isScriptLoaded`, exact `Script<ID>` introspection, and KWin
  PID/start evidence.
- P2 | PID 3568836 SIGABRT incident | The malformed inbound `QKeySequence`
  D-Bus abort is formally open: its unrelated triage has twice been falsified.
  Do not attribute it to the native effect or script without sender, method, and
  fault-stack evidence. [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- P2 | Nested disposable actuation limits | The nested POC3 route is
  offline-proven/live-unproven: client lifetime, exact-three KWin scope, and
  same-unit containment are unproven. Do not add a project-owned client or
  dependency, retry, or cleanup without fresh explicit authorization.
- P2 | Configurable gaps live acceptance | Native KCM inner/outer gaps and
  validated startup binding are implemented (defaults 8, bounds 0..64). Script,
  Rust, native build, and isolated KCM persistence checks pass. User-owned
  acceptance remains for saved settings and visible gaps after reload/restart.
  [record](changes/archive/window-gap-configurability.md)
- P2 | Floor-ratio fallback | Retain it unless qualifying isolated nested proof
  establishes a safe improvement. [change](changes/floor-ratio-feasibility.md)
- P2 | Integrated Plasma feasibility | Establish a safe structural verdict; the
  unsafe nested path remains stopped. [change](changes/integrated-plasma-structural-feasibility.md)
- P2 | JavaScript workload evidence | Complete sustained-workload evidence before
  choosing a native replacement for discrete window management.
  [change](changes/js-workload.md)
- P2 | Grouped-window stability | Prove multi-window Custom Tile stability before
  selecting grouped or tabbed behavior. [change](changes/grouped-windows.md)
- P2 | Keyboard-layout support | Resolve complete keyboard-layout support after
  initial release. [change](changes/shortcuts.md)
- P2 | Multi-output workspace anti-oscillation | Verify trailing-empty behavior
  on a multi-output machine. [runbook](live-oscillation-verification.md)
- P3 | Stale branches | Twelve stale branches, most at least 140 commits behind
  `main`, require explicit user authorization before deletion.
- P3 | Other compositor validation | Validate bspwm, Hyprland, and COSMIC at
  their actual runtimes. [comparison](reference-wm-comparison.md)
- P3 | Artifact publication | Publish reproducible KPackage artifacts to KDE
  Store and GitHub Release after MVP delivery dependencies complete.
  [foundations](changes/archive/delivered-foundations.md)
- P3 | Post-MVP tiling profiles | Required when adding other tiling types such
  as Hyprland: selectable profiles must cover both the tiling behavior/algorithm
  and matching shortcuts. Deferred beyond MVP, not an optional shortcut-only
  preset feature. [change](changes/shortcuts.md)
