# Backlog

Only meaningful pending or active work is listed.

- P1 | Preserved host residue | Do not search for, enumerate, inspect,
  heuristically identify, modify, or clean unidentified advisory, shadow, or
  nested-test residue. Any recovery needs explicit user authorization and exact
  identity or hash verification. No stale POC2/POC3 harness or checkpoint retry
  is authorized.
- P0 | Fullscreen residual-cost live gate | Production Plan fullscreen isolation
  is static-complete. User must run the exact fullscreen gate and establish the
  gaming cost baseline. [investigation](changes/reliability-condition-investigation.md)
- P1 | Output hotplug domain lifecycle | Select and gate retire, retain, or
  reseed behavior for `(output, workspace)` state through unplug/replug.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Work-area change projection live gate | Static code projects one retained
  existing domain through resolution, scaling, and work-area changes without the
  client-drift park policy. User must run the exact gate, including fullscreen
  isolation and restoration. [investigation](changes/reliability-condition-investigation.md)
- P1 | Wake transport recovery | Select and gate bounded Planner/KWin recovery
  across suspend, wake, and Planner-name loss.
  [investigation](changes/reliability-condition-investigation.md)
- P2 | Runtime configuration coherence | Select and gate script, KCM, `kwinrc`,
  shortcut, and effect configuration behavior for a running session.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Rust-engine/direct-geometry migration live gate | Rust-mode exact-three
  focus, movement, keyboard resize, and pointer resize are static-complete behind
  disabled-by-default exclusive authority. Await a user rebuild/new session and
  one visual-jank smoke. The first host round trip, stale/service-loss refusal,
  after-snapshot equality, restoration, hostile same-UID service proof,
  atomicity, stock-KWin parity, and latency remain unproven. The halted advisory
  transport route needs a user-provided exact receipt/lifecycle record before any
  recovery.
- P1 | Dynamic workspaces | Re-enable COSMIC workspace lifecycle on the settled
  KWin virtual-desktop mapping, including owned desktop mapping, lifecycle
  observation, create/select/retire, window moves, and COSMIC policy.
  [investigation](changes/archive/cosmic-workspace-and-geometry-investigation.md)
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
- P1 | Blocked: group highlighting decision | VISION.md makes group highlights
  first-class, but `docs/decisions.md:358-360` selects no group carrier,
  controls, bindings, or shared active-border behavior pending compositor-owned
  KWin support and live multi-window Custom Tile stability. User decision is
  required before implementation; group identity, transport, rendering target,
  and membership semantics are ungrounded.
- P2 | Three-window product decision | Decide whether Rust authority remains
  restricted to exactly three eligible windows.
- P2 | Retryable bootstrap decision | Decide whether Rust may retry bootstrap
  after startup without weakening one-shot transaction fencing.
- P2 | Bootstrap ordering decision | Decide whether lexical opaque-ID ordering
  is load-bearing or replaceable without changing `H[A,V[B,C]]` seeding.
- P2 | Pixel/share parity decision | Retain `Vec<u64>` shares unless a reproduced
  N-ary/deep visual discrepancy or source-exact fixture justifies the cross-
  contract pixel-authority migration. Source N-ary pixel rounding remains an
  open portability gap.
- P2 | Snapshot-invalid capture gate | `plan:rejected kind=snapshot-invalid` was
  observed live on `admit windows=4`. Retain the paired bounded `detail` token
  in a dedicated verbose capture and distinguish it from recoverable
  `window-count-mismatch`. [record](changes/archive/snapshot-invalid-details.md)
- P2 | KWin controller silent unload | Attribute a manual controller unload only
  with before/after `isScriptLoaded`, exact `Script<ID>` introspection, and KWin
  PID/start evidence.
- P2 | PID 3568836 SIGABRT incident | The malformed inbound `QKeySequence`
  D-Bus abort is formally open: its unrelated triage has twice been falsified.
  Do not attribute it to the native effect or script without sender, method, and
  fault-stack evidence. [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- P2 | Active-border Rust port decision | Unstarted: decide whether to move
  portable active-border calculations to Rust behind a narrow C ABI while C++
  retains KWin objects, factory, moc, signals, and rendering. The drag oracle
  proves this Rust-in-effect boundary. [investigation](changes/native-effect-rust-and-group-highlighting.md)
- P2 | Rust-first drag-oracle bridge | Do not select a production effect-to-script
  transport until a synchronous bridge is proven and the C++/moc shim is
  authorized. [change](changes/rust-first-edge-drag-route.md)
- P2 | Nested disposable actuation limits | The nested POC3 route is
  offline-proven/live-unproven: client lifetime, exact-three KWin scope, and
  same-unit containment are unproven. Do not add a project-owned client or
  dependency, retry, or cleanup without fresh explicit authorization.
- P2 | Window-gap configurability | Replace fixed 8px domain gaps with a bounded
  KCM/native setting and validated KWin `readConfig` binding.
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
- P3 | `just dev` Ctrl-C exit | After clean `dev-off` teardown, Ctrl-C exits 130.
  Cosmetic only.
- P3 | Stale branches | Twelve stale branches, most at least 140 commits behind
  `main`, require explicit user authorization before deletion.
- P3 | Other compositor validation | Validate bspwm, Hyprland, and COSMIC at
  their actual runtimes. [comparison](reference-wm-comparison.md)
- P3 | Artifact publication | Publish reproducible KPackage artifacts to KDE
  Store and GitHub Release after MVP delivery dependencies complete.
  [foundations](changes/archive/delivered-foundations.md)
- P3 | Keybind profiles | Add selectable COSMIC/Hyprland-style profiles only if
  still desired. [change](changes/shortcuts.md)
