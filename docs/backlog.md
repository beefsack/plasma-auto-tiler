# Backlog

Only meaningful pending or active work is listed.

- P0 | Workspace-send reliability (next dogfooding blocker) | LNq6hA confirms
  a pre-ack timeout: mover and one geometry echo consumed, plan geometry index
  1 still pending and mismatched. Follow never ran; the user saw the window
  move 3->2 while 3 stayed visible with a border for the hidden window. Identify
  why that geometry did not converge; hidden-window delivery is unproven, and
  the capture does not time the later manual visit against timeout. No behavior
  fix is established. Keep WwQ9G6 pre-ack loss and earlier committed-but-invisible
  failures distinct. Restore follow/focus and usability without attributing the
  initiating loss to user shutdown or assuming border causation.
  [timeout record](changes/archive/workspace-send-timeout-observation.md)
  [earlier record](changes/archive/workspace-send-visible-follow-boundary.md)
- P1 | Non-visible workspace tiling investigation | User observes deferred
  retiling until visiting a workspace, leaving stale panel previews. Source
  confirms normal observation/reconciliation covers the active output's current
  desktop; the separate send transaction does write hidden-target geometry.
  Select startup and window-open/move hidden-domain adoption/reconciliation
  without changing visibility or focus before implementing broader activation.
  Its causal connection to the send blocker remains unproven.
- P1 | Remaining workspace-send uncertainty recovery | Diagnose ordinary send
  defects first; any new recovery semantics remain a separate product decision.
  Proven pre-dispatch and well-formed request rejection paths are reusable. Sent request/lost callback,
  malformed reply, request timeout, owner loss, and other transport ambiguity
  can leave Rust pending; partial native mutation plus ack/verify timeout can
  also be uncertain. Selecting discard/reseed or another generation/protocol
  recovery remains a material decision; no blind reset, replay, or topology
  reconstruction is selected.
- P1 | Temporary active-group highlight live gate | Named-log diagnosis found
  retained-focus lookup and missing completed-geometry refresh defects; both are
  corrected and statically verified. Restart the foreground dev session and
  recheck the separate group outline while holding Meta. Setter submission does
  not prove effect receipt or rendering. User-owned evidence remains for native
  transport, modifier delivery, fullscreen suppression, rendering, and cost.
  [record](changes/archive/active-group-highlight-held-refresh.md)
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
  Choose nearest from already-available geometry without added history tracking,
  otherwise use the surviving primary. Reconnection keeps the active window
  visible/focused without restoring view history. Product choices are resolved;
  session-local implementation and live acceptance remain pending.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Work-area change projection live gate | Static code projects one retained
  existing domain through resolution, scaling, and work-area changes without the
  client-drift park policy. User must run the exact gate, including fullscreen
  isolation and restoration. [investigation](changes/reliability-condition-investigation.md)
- P1 | Wake transport recovery implementation | Retain layouts if the Planner
  survives sleep. After confirmed Planner loss, automatically establish a fresh
  in-memory session from current windows using near-layout fitting with normal
  tiling fallback. Never replay interrupted commands or accept stale replies.
  Implementation and live acceptance remain pending; uncertain-send recovery
  remains a separate, unselected protocol change.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | All settings live application (launch blocker) | Before launch, every
  user-facing setting must apply live, including tiling, workspace, shortcut,
  and effect settings. Verify running behavior reflects saved settings without
  requiring a tiler reload. The interim reload approach does not satisfy this.
  [investigation](changes/reliability-condition-investigation.md)
- P2 | Interim runtime configuration reload | Implement and verify deliberate
  tiler reload after saving tiling settings, with clear reload-required UI and
  existing live border updates retained. Prevent silent stale configuration.
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
- P2 | Placement-aware startup adoption implementation | Product choices are
  resolved: try simple best-effort near-layout fitting at initial adoption,
  falling back to normal deterministic tiling if no valid fit is produced.
  Preserve existing exception behavior and avoid exhaustive search or
  special-case complexity. Implementation is pending.
  [proposal](changes/placement-aware-startup-adoption.md)
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
