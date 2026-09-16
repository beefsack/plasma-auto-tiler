# Current Decisions

Only active, user-approved product and project choices are recorded here.
Historical implementation detail is recoverable in Git history.

## Native Active Border

- The active-window border is an MVP requirement. Use an experimental,
  disabled-by-default, OpenGL-only native C++ KWin effect
  for the active-window border. Colour, width, outline radius, and gap are
  configurable; `UseThemeColor` in `Effect-plasma-auto-tiler-active-border`
  defaults true, migration-free: enabled retains theme highlight with
  configured fallback, disabled selects configured colour unconditionally.
  The native QWidget KCM controls it through the existing hot-apply/repaint
  path.
- Nix delivery and exact host KWin ABI/session discovery are required for
  runtime delivery; neither is an optional enhancement. Runtime acceptance
  remains unproven.
- After rebuild/new session, the user manually observed only: the active-window
  border was enabled, visible, and followed the active window; width hot-applied;
  and `Use theme highlight color when available` override/theme behavior worked
  and is manually accepted. This is user visual/manual evidence, not
  automated/protocol/KWin-source evidence.
- The outline never clips, reshapes, or changes window textures. Plasma 6.5+
  decoration-driven rounded corners remain the selected corner solution.
- C++ is limited to platform-required public-API adapters and effects. Manual
  ownership, threads, custom shaders or GL resources, QPainter, clipping,
  texture changes, and broader scene manipulation are excluded. Input remains
  excluded except narrow passive public `EffectsHandler` modifier observation:
  `I permit the modifier observation.` This authorizes no grabs,
  interception, filters/spies, private InputRedirection, input consumption, or
  polling. The scene exception is at most two effect-owned
  automatic-lifetime `KWin::OutlinedBorderItem`s: one active border plus one
  temporary group outline.

## Native Integration Boundary

> Any OS/DE-agnostic logic belongs in the central engine where tiling currently
> resides. Logic requiring native integration with the OS/DE belongs alongside
> the native effect.

- The drag-final-geometry oracle uses the minimal C++/moc KWin-effect shim and
  POD-only C ABI required by KWin. Rust owns verdict policy; no Qt or KWin type
  crosses the ABI, and every Rust callback catches panics before returning to
  KWin.
- The drag-final-geometry oracle owns a second read-only session D-Bus endpoint
  for its last verdict. The KWin script pulls it after interactive drag finish;
  the effect never pushes a verdict into the script.

## Settings And Distribution

- One native QWidget effect-scoped KCM owns tiling, workspace, shortcut,
  outline, and border settings through the Desktop Effects entry. Existing
  script groups, keys, values, and defaults remain unchanged. The KCM's
  hot-apply and any script reload or session-restart result remain live gates.
- The core distribution remains the script KPackage for KDE Store and an
  identical GitHub Release artifact. Platform-native packages for the native
  effect and KCM are permitted; their formats and publication are unselected.
- Nix-first current-host delivery is selected. The repository flake statically
  exports `packages.default`, `packages.kwin-script`,
  `packages.native-effect`, and `packages.tray`, plus
  `lib.mkKwinScript`, `lib.mkNativeEffect`, and `lib.mkTray`. It also exports
  default NixOS and Home Manager modules. The convenience
  `packages.native-effect` is built from this flake's pinned nixpkgs input, so
  an external consumer that directly uses it must make this repository's
  `nixpkgs` input follow the host nixpkgs. The `lib.mkNativeEffect` factory
  instead uses the caller's `pkgs` and matching `kdePackages.kwin.dev`; the
  NixOS module calls that factory with its caller `pkgs`, making factory/module
  consumption host-pkgs safe. This project does not inspect or change the
  external consumer repository. The current build baseline remains `devenv.nix`.
- The native effect is not a portable prebuilt binary; every build targets the
  Nix-managed Plasma/KWin package set used for that build.
- The NixOS module owns the system KPackage/native-effect packages and writes
  only `[Plugins] plasma-auto-tiler-kwinEnabled=true` in its immutable global
  KWin profile. It does not enable the native border or mutate shortcuts. Home
  Manager owns user-session delivery: the optional immutable tray XDG autostart
  file and the on-demand Planner D-Bus/systemd activation metadata. Neither
  writes user `kwinrc` authority.
- Flake source filesets are explicit for the KWin script, native effect/KCM,
  and tray package; build trees, generated artifacts, and unrelated repository
  files are excluded.
- Development iteration uses the packaged baseline plus a namespaced,
  reversible, user-local dogfood override as the smallest selected boundary.
  It must not coexist with a Nix-managed copy of the same KWin plugin IDs, must
   preserve exact normal-path restoration, and must not mutate system or
   unrelated state.

## Linux Planner Activation

- Approved 2026-09-09: Linux/KWin delivery packages the existing
  `plasma-auto-tiler planner-service` as one session D-Bus service named
  `org.plasmaautotiler.Planner`. Its immutable package installs the exact
  D-Bus descriptor with `SystemdService=plasma-auto-tiler-planner.service`;
  Home Manager places that package in the user D-Bus discovery path and owns
  the matching user `Type=dbus` unit with exact `BusName` and immutable
  `ExecStart=<store>/bin/plasma-auto-tiler planner-service`. It has no shell,
  autostart target, durable PID/receipt state, or second Planner process mode.
- `programs.plasma-auto-tiler.planner.enable` defaults true when this Home
  Manager module is imported. The service remains inert until D-Bus activation,
  so the default has no idle Planner process cost and does not change the
  public `engineAuthorityMode=legacy` default. Set it false to omit both the
  descriptor package and user unit.
- The unit uses `Restart=no`: Planner name loss remains terminal and cannot
  form a systemd restart/rebind loop across a pending KWin transaction. A
  subsequent idle command may request a fresh D-Bus activation. User-manager
  session teardown stops the service; D-Bus connection/name loss also ends the
  Planner without durable recovery state.
- Selected Rust KWin commands first resolve the Planner name. An absent name
  makes one bounded `StartServiceByName(..., 0)` request, accepts only
  `PrimaryOwner` or `AlreadyOwner`, then resolves and pins one unique owner
  before any planner method. Activation, identity, owner, stale, loss, and
  timeout failures refuse the selected Rust route with no Legacy fallback; a
  pending plan never rebinds after a restarted owner. Session activation
   improves immutable delivery but public KWin scripting still cannot attest the
   initially resolved same-UID Planner binary.
- Planner caller authorization is a single fail-closed session-bus check:
  `org.freedesktop.DBus.GetConnectionUnixUser` for the caller's unique name
  must equal the Planner process UID. A malformed name, failed lookup, unknown
  UID, or differing UID rejects. Process executable/PID/start-tick/boot,
  systemd MainPID/parentage, wrapper-pair, cgroup, KWin-owner, and pre/post
  revalidation do not participate in caller authorization.
- On authorization failure, `DescribeFocus`, `DescribeMovement`,
  `DescribeResize`, and `DescribePointerResize` return the fixed bounded
  in-band JSON rejection `outcome:"rejected", kind:"unauthorized"` so KWin
  records `result=rejected`. `EvaluateMove`, `DescribeAdvisoryPlan`, and
  `DescribeShadowProjection` retain their D-Bus error behavior.
- `engineAuthorityMode=legacy` remains the only automatic-tiling mode. Rust is
  opt-in development-only and never falls back to Legacy. Its approved lifecycle
  is limited to ordered N-ary `cosmic_v1` admission/removal, same-output send,
  restored backing-desktop/numbered workspace routes, bounded reconciliation,
  and the selected initial first-startup fitting direction below. General
  existing-window adoption and default promotion remain unselected. KCM Apply
  persists the selection and queues an unacknowledged KWin reconfigure request,
  so a user session restart is required before relying on an authority change.
- Approved 2026-09-16: when the first startup domain has no usable retained
  session, Rust may use a versioned, best-effort near-layout fitting heuristic
  to minimize unnecessary initial window movement. It must be simple,
  comprehensible, and deterministic, with Rust retaining structural inference
  and KWin TS retaining native observation. This selects neither exact
  recognition nor historical-topology reconstruction, global optimization,
  exhaustive search, broad edge-case handling, retained-topology rewrite,
  uncertain-send recovery, general existing-window adoption, or default
  promotion. At INITIAL adoption, it attempts one straightforward deterministic
  near-layout fit; if no valid supported layout results, it uses the existing
  normal deterministic seed/reflow. It selects no park/unmanaged fallback or
  activation lifecycle. Existing floating, sticky, fullscreen, maximize, and
  configured-gap behavior remains authoritative; preserving it at the current
  eligibility or pure input boundary is implementation work, not an unselected
  product behavior.

## Live KWin/Plasma Boundary

- Reversible, project-scoped live host tests may run under the reviewed
  repository protocol. They must be namespaced, fail closed, and provide exact
  restoration; if exact restoration cannot be verified, stop and leave the
  residue for user action.
- The user grants standing authorization, until revoked, to read and mutate the
  existing KWin session for project-scoped testing. The user has revoked
  autonomous backlog progression; normal mode applies. This authorization does
  not broaden the live/manual boundaries below or select material product,
  security, or architecture decisions. Every action remains bounded to exact
  identified project resources with a recorded baseline and exact restoration;
  no broad cleanup, window closure, system path, dotfile, NixOS, Home Manager,
  sudo, session-boundary, irreversible, unrelated-host action, or preserved
  residue handling is authorized. Stop on ownership, parser, diagnostic,
  baseline, source, or restoration ambiguity.
- This covers project builds; native-effect staging/removal; the project's
  `plasma-workspace/env` script and same-name legacy migration; KWin `/Effects`
  load/unload and read-only queries; KWin script install, enable, disable, and
  reconfigure; bounded `/Scripting` load/unload; project tray-helper lifecycle,
  session-D-Bus operations, and journal/status reads; and disposable
  project-owned Custom Tile tests when exact restoration is verified.
- Physical or manual observations and every logout, login, or new-session
  boundary require user action. No `sudo`, system-path mutation,
  external-dotfiles mutation, unrelated host mutation, irreversible cleanup,
  or ambiguous-residue deletion is authorized.
- Current-host Nix integration, KWin/session load or reload, watcher ordering,
  login/autostart behavior, and update/rollback activation across Nix
  generations are pending live evidence, not passed by static evaluation or
  shell tests. A session boundary is a required evidence boundary for claims
  about session-delivered packages.
- Deleting or restoring preserved candidates, containers, or host artifacts
  needs explicit user authorization plus exact path and identity or hash
  verification.
- The Custom Tile acceptance harness is an accepted static, current-session
  read-only preflight. It strictly diagnoses KWin and KGlobalAccel ownership and
  fails closed on stale state, collisions, drift, or provenance ambiguity; it
  performs no lifecycle or mutation. Its rollback and journal contract is for a
  later authorized run only.
- `python3` was added intentionally to `devenv.nix`; the development session
  has been restarted and the committed dependency is available. The
  static carrier-only operational provenance harness is verified, but no
  successful carrier smoke occurred: bounded attempts either stopped before
  effect or were receipt-bound restored. A new smoke is blocked by two retained
  protected project runtime evidence records. Handling those records requires
  explicit user authorization under a race-safe recovery procedure; after that,
  one bounded carrier-only smoke must prove exact host baseline equality. A
  separately authorized Custom Tile journey remains a later gate.
- The inert checkout carrier establishes only operational lifecycle binding
  through its exact plugin/script identity, receipt, diagnostic, and unchanged
  KWin identity. Current public KWin APIs do not provide direct evaluated-memory
  source proof for the checkout controller, so `authoritative_ready` remains
  false; the carrier does not change that verdict.
- The preflight reports phased readiness: `setup_ready` proves only its
  read-only KWin, KGlobalAccel, shortcut, and persisted-state checks completed
  without drift; `journey_ready` and `authoritative_ready` remain false until
  the applicable acceptance gates are established. No readiness phase
  authorizes a Custom Tile lifecycle, live journey, or user physical or manual
  action on its own; carrier setup is limited to its bounded operational
  binding.
- The standing authorization currently selects only bounded read-only
  `DescribeAdvisoryPlan` host transport journeys: start and stop one uniquely
  namespaced project planner service and load, run, then unload only the exact
  standalone advisory KWin Script object. It excludes all native-window,
  focus, geometry, workspace, output, configuration, shortcut, Custom Tile,
  production-plugin lifecycle, session-boundary, manual, and physical action.
  Each journey must preserve an exact-three active-output/current-desktop
  scope without manufacturing it, pin KWin and planner ownership, use one
  in-flight correlation, and prove exact restoration. A reviewed static
  correction permits one fresh bounded retry only when earlier work stopped
  before resource creation or proved exact restoration with no ambiguous
  residue. The authorization is revoked for any restoration ambiguity,
  broader host mutation, material security/product/architecture change, or
  need for manual arrangement; stop and ask the user in those cases.
- The user subsequently authorized reversible project-scoped KWin, session
  D-Bus, and Rust Planner testing for Rust-authority diagnosis. Each attempt
  must pin exact source, owner, baseline, bounded resources, and restoration;
  it must not close windows, touch unrelated state, or inspect or alter
  preserved advisory, shadow, or nested residue. Production KWin is never
  killed. A production script may change only through a reviewed lifecycle that
  proves exact source binding and exact restoration; otherwise the route stops
  before mutation. This authorization does not broaden access to non-project
  resources.
- Before any further troubleshooting or product development, current project
  processes and Rust-path IPC must emit verbose, structured, correlated logs to
  their existing visible KWin console, stdout, or stderr/journal sinks. Future
  troubleshooting checks those logs first. The shared
  `plasma-auto-tiler:route-diag` schema must identify component, direction or
  stage, correlation, authority generation, revision, event/action, and
  outcome while excluding captions, application content, secrets, raw
  environment, native identifiers, raw D-Bus payloads, and unbounded pointer
  steps. Log failures cannot change product behavior or fail operations.
- The unidentified prior `plasma-auto-tiler-advisory-*` runtime-directory
  residue is preserved untouched. Do not search for, enumerate, inspect,
  identify heuristically, modify, or delete it. After the resource-order
  correction, the standing authorization above resumes only for fresh bounded
  attempts that stop before resource creation or prove exact restoration with
  no new ambiguity.

## Window And Workspace Behavior

- Pointer resize adjusts shared split boundaries or ratios and reflows
  neighbouring tiles.
- Intentional floating is a session-local per-window state carried by the Rust
  Session outside its tile tree. The internal `toggle-float` request floats an
  eligible active normal window and removes it from the tree; the Session
  selects the durable retained placement for a window that has floated before
  (the centered 60% work-area rectangle is only the first-time fallback), and
  unfloat is fresh planner admission, never prior-leaf restoration. Unfloat
  carries the window's live frame rect so a user moved/resized float is
  retained across float/unfloat/float. Fullscreen and maximized targets refuse
  with `float-refused-fullscreen` and `float-refused-maximize`. The controller
  registers `Meta+G` without changing Grid View's record. KGlobalAccel permits
  both active records but dispatches the lower serial holder, so startup emits
  `shortcut-dispatch-shadowed` until the user resolves that conflict in System
  Settings. `Meta+Shift+G` toggles sticky floating: tiled members float first,
  then set `Window.onAllDesktops=true`; sticky-off restores prior floating
  placement or, for prior tiled members, fresh admission rather than an old
  slot. The native write has one exact-reference `desktopsChanged` echo fence,
  with no retry, timeout, fallback, or polling.
- The selected fresh-admission behavior follows `pop-os/cosmic-comp`
  `81cd5fdbaa41c3973369ae85bccf829137836e20` source content:
  `data/keybindings.ron:83-92` binds Super+G to `ToggleWindowFloating`;
  `src/shell/workspace.rs:1485-1498` unmaps a tiled window to floating and
  maps a floating window back through `tiling_layer.map`; and
  `src/shell/layout/tiling/mod.rs:396-435` routes that map through
  `map_to_tree`. The supplied checkout has no Git metadata, so the exact commit
  identity could not be independently verified there.
- Maximize (`Meta+M`) is workspace-local. Fullscreen (`Meta+F11`) is separate:
  it is never tiled, resized, or reflowed, and preserves the tree for restore.
- Maximize isolation mirrors fullscreen, authorized 2026-09-14. A nonzero KWin
  `maximizeMode` (1 vertical, 2 horizontal, 3 full) is collapsed to one adapter
  boolean; no horizontal or vertical maximize concept enters the Rust engine or
  its protocol, and no Rust protocol/session state is added for maximize. A
  maximized member keeps its observed identity, leaf/tree position, and share,
  receives no geometry write, and on unmaximize is restored to its exact
  retained allocation. Fullscreen takes precedence when a window is both
  fullscreen and maximized: fullscreen refusal tokens and the `skip-fullscreen`
  disposition win over maximize. A missing per-window `maximizedChanged`
  attachment for any eligible observed normal window refuses fail-closed with
  the exact `plasma-auto-tiler:plan:maximize-refused-signal` token, at startup
  or when a later-added eligible window lacks the signal, unlike best-effort
  fullscreen.
- Admission-time maximize clearing is a deliberate, user-approved KWin-native
  deviation from cosmic-comp parity, authorized 2026-09-14. For a non-fullscreen
  window first observed without a retained tiled slot, the adapter calls KWin
  `Window.setMaximize(false, false)` once before admission, then tiles the
  restored window normally. It never retries the write. A later maximize of a
  retained member keeps the existing isolation behavior: the leaf/share remain,
  geometry writes are skipped, and unmaximize restores the retained allocation.
  Fullscreen remains untouched and takes precedence. This is not COSMIC parity:
  cosmic-comp `Shell::maximize_request` `src/shell/mod.rs:4393-4431` records
  `MaximizedState` with `original_layer`, retaining `ManagedLayer::Tiling` for
  a tiled window; `Workspace::unmaximize_request`
  `src/shell/workspace.rs:996-1036` returns that member to tiling ("should
  still be mapped in tiling"). The product choice makes KWin session-restored
   maximized applications tile on admission while preserving the selected
   post-admission behavior.
- `Meta+M` toggles KWin maximize through `Window.setMaximize(bool, bool)`, never
  `maximizeMode`. Fullscreen refuses first. Post-admission maximize retains its
  tile slot and skips geometry writes; unmaximize restores its retained
  allocation. The action has its own exact-reference `maximizedChanged` fence,
  so a deliberate post-admission maximize is never affected by admission-time
  clearing. Current read-only enumeration found `kwin/KrohnkiteMonocleLayout`
  on `Meta+M`; registration preserves that record and emits the shadowed-
  delivery diagnostic until the user resolves it.
- H/V maximize is deliberately not modeled in the engine. Source:
  `pop-os/cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`
  `Shell::maximize_request` `src/shell/mod.rs:4393-4431` records
  `MaximizedState { original_geometry, original_layer, original_snapped }`
  where `original_layer` retains `ManagedLayer::Tiling` for a tiled window, so
  the maximized window keeps its tiling node; `unmaximize_request`
  `src/shell/workspace.rs:996-1036` returns `ManagedLayer::Tiling` members to
  the tiling layer ("should still be mapped in tiling") and others to the
  floating layer; the `ManagedLayer` enum
  `src/shell/workspace.rs:243-248` is only
  `Fullscreen, Tiling, Floating, Sticky`, with no maximize variant. Maximize is
  a recorded overlay state over the original layer, not a distinct topology or
  managed layer, so the engine deliberately carries no horizontal/vertical
  maximize concept.
- A Plan adapter retains one membership baseline per `(output, workspace)` and
  advances that domain's baseline only after a matching `planned` reply is
  applied. A rejected, timed-out, stale, or failed membership command never
  changes the baseline used to derive later admissions or removals.
- Permissive admission, authorized 2026-09-14: an observed normal window's
  incoming frame rectangle never decides whether it may join a tiled domain.
  Admission assigns a new complete geometry for every member and may reflow
  existing members. In particular, an older out-of-work-area window must not
  prevent a later window from tiling or create a restart-persistent admission
  deadlock. Bounds validation remains mandatory for non-admission operations,
  where observed geometry is the client-drift input for the park policy and
  echo fence.
- `workspaceMode` supports `per-output-local`, `global-unique`, and `shared`
  through a session-local, project-owned KWin backing-desktop mapping. KWin's
  global virtual-desktop pool is not a native COSMIC workspace-set mapping.
  `per-output-local` and `global-unique` assign distinct backing desktops to
  output domains; `shared` selects the same backing desktop on every output.
  The adapter keeps one structurally trailing empty backing desktop per relevant
  domain, reusing it for `Meta+0` and `Meta+Shift+0` before creating one. It
  retires session-owned empties and safe preexisting extras only from the
  mapped native-order terminal empty run, retaining its first desktop and at
  least two global desktops. Occupied, current, visible, intermediate, and
  unmapped desktops remain protected. Mapping and output identity are
  session-local. The initial disconnected-output policy preserves its displaced
  layout in separate workspace(s), rather than merging it into a new top-level
  split of the remaining visible layout. If the active window was on the
  disconnected monitor, show its relocated workspace and retain focus on that
  window. If the active window was on a surviving monitor, preserve its current
  visible workspace and focus; displaced workspaces remain accessible through
  normal workspace switching. If there is no active window, preserve the
  surviving monitor view. On reconnection, displaced workspaces automatically
  return to their original monitor with their then-current contents and layout,
  not a saved snapshot: split edits, closed and new windows remain reflected.
  Workspace relocation is the unit: a window explicitly moved out stays at its
  destination and is never individually pulled back, while a window moved into
  a displaced workspace returns with it. User-configurable handling is deferred.
  Destination among multiple surviving outputs, reconnect visible-workspace and
  focus handling, identity persistence/edit handling, and special active
  floating/fullscreen/sticky handling remain unselected; live
  disconnect/reconnect behavior remains unimplemented and unverified.
- `Meta+1..9` select an existing 1-based logical workspace without creation.
  `Meta+Shift+1..9` send only the focused tiled window to an existing
  same-output workspace through the Rust `MoveToWorkspace` route. `0` reuses or
  creates the trailing empty target. A send switches to that target and focuses
  the moved window only after Rust's exact accepted acknowledgement and matching
  verified post-observation; rejected, stale, mismatched, and duplicate echoes
  do not follow. The standard US shifted aliases `Meta+!` through `Meta+)` are
  registered alongside the digit sends; registration preserves foreign shortcut
  records and does not establish physical delivery.
- A planned send that reaches its original pre-ack deadline may settle only from
  one fresh complete exact post-observation, then uses its original ack/verify
  transaction and one normal bounded deadline. It never rewrites, replays,
  polls, or creates a new plan. Late events cannot duplicate completion. A
  provably pre-dispatch failure or a well-formed request rejection other than
  `pending-exists` stays available because Rust has no retained pending; sent or
  malformed/lost request replies, request timeout, owner loss, `diverged`, and
  post-plan ack/verify uncertainty remain terminal pending an explicit recovery
  design.

## Shortcuts

- The initial release supports standard US keyboards and preserves hardcoded
  shifted aliases. Layout detection, omission, opt-in configuration, migration,
  and KGlobalAccel reconciliation are deferred.
- Non-conflicting project shortcuts register by default. Conflicting
  Plasma-global shortcuts change only through explicit KCM Apply and Revert.
  The allowlist is a closed compiled-in ordered table: each row specifies the
  project component/action and chord, foreign component/action, expected foreign
  preimage, and a `relocate` or `clear` resolution. No user-supplied or
  arbitrary row is accepted. Recovery is explicit in the KCM, Revert restores
  only bindings still owned by that override, unexpected table preimages or
  target conflicts are refused before any mutation, and installation/startup
  never mutate global shortcuts. The sole approved target-occupant exception
  is row 1's `Meta+Esc`: System Monitor
  `org.kde.plasma.systemmonitor` / `_launch` is deliberately displaced when
  Lock Session relocates there. It is recorded in row 1's compiled-in target
  exception, is not writable by the override, and no other foreign holder is
  approved.
- Table row 1 is `kwin/plasma-auto-tiler-focus-right` taking `Meta+L` from
  `ksmserver/Lock Session` by relocating `Meta+L` to `Meta+Esc`; other lock keys
  retain order, deliberately taking over System Monitor `_launch`'s declared
  `Meta+Esc` default. Row 2 is
  `kwin/plasma-auto-tiler-resize-outwards-up` taking `Meta+Alt+K` by clearing
  `KDE Keyboard Layout Switcher/Switch to Next Keyboard Layout` from exact
  preimage `Meta+Alt+K`. Row 3 is
  `kwin/plasma-auto-tiler-resize-outwards-right` taking `Meta+Alt+L` by clearing
  `KDE Keyboard Layout Switcher/Switch to Last-Used Keyboard Layout` from exact
  preimage `Meta+Alt+L`.
- KCM table override/recovery has focused static coverage; ordinary Settings
  Apply never mutates shortcuts. The private project journal records each
  resolution kind and exact prior keys. One user-run Finish Apply completed the
  three-row postimage; Revert, Restore, Lock Session physical checks, and
  physical resize checks remain unproven.

## Planner Unauthorized Reply Correlation

- Do not echo caller-supplied `correlation_id` in the fixed unauthorized reply
  from `PlannerEndpoint::describe_plan`. This preserves the same-UID caller
  authorization boundary and each adapter's strict correlation fence; distinct
  unauthorized observability is intentionally not selected.

## COSMIC Movement And Groups

- COSMIC-style tiling and directional movement are MVP. The directional path
  replaces the legacy path; there is no legacy fallback after a path is
  promoted.
- Durable direction, authorized 2026-09-07: Rust is the structural authority
  for portable deterministic topology, ordered N-ary groups and shares,
  logical workspaces and outputs, focus/navigation, movement, and
  reconciliation. Thin platform adapters own native observation, actuation,
  lifecycle, permissions, and effects. On KWin, direct geometry is the
  structural actuator; Custom Tiles are not a second topology authority.
- The existing Custom Tile runtime remains a bounded legacy behavior while
  migration slices are opt-in. A promoted replacement has no legacy fallback,
  but the whole runtime is not switched at once. Tabs, stacks, shared tiles,
  and compositor group behavior remain unselected.
- Grouping here means nested split-tree structure and placement. `H[H[1 2] 3]`
  is distinct from `H[1 H[2 3]]`; tabs, stacked/shared groups, and compositor
  group behavior are excluded.
- Lifecycle foundation, authorized 2026-09-09: portable `cosmic_v1` lifecycle
  plans carry policy version 1 and use the same single-pending acknowledgement
  and post-observation reconciliation boundary as movement. Logical domains are
  keyed by the opaque `(output, workspace)` pair, so one logical output may
  retain independent workspace trees without inventing native workspace
  semantics. Corrected source-evidenced `cosmic_v1` semantics, authorized
  2026-09-09: `pop-os/cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`
  `map_to_tree`, `Data::{new_group,add_window,remove_window}`, resize, and drag
  paths govern focused-cell binary admission, physical-axis selection, equal
  new splits, proportional ordered-N-ary share adaptation, physical-pixel
  resize, and drag zones. The prior input-bounds tie, unit-share, `1/16`,
  32px/16,384 pointer-bound, and edge-only-center-snap-back shortcuts are not
  retained. The portable split-tree representation fails closed for COSMIC
  center stack drops because stacks are unselected and compositor-owned; it
  names that source fact without emitting a false structural plan. Recursive
  collapse is source-evidenced. On a focused tiled removal, `cosmic_v1`
  removes the leaf from its source-domain MRU focus stack and selects that
  stack's remaining top; an unfocused removal preserves focus. Send with
  `direction=None` leaves focus in the source rather than focusing the target.
  The portable tiled model clears focus when no source tiled stack entry
  remains. COSMIC's mapped-element and fullscreen fallback is not represented:
  floating, fullscreen, maximized, and sticky flags remain explicit observed
  exceptions; only deferred tracking/removal is selected while tiled exception
  behavior remains fail-closed and deferred.
- Durable policy-mode direction, authorized 2026-09-09: selected policy modes
  target strong source-evidenced behavioral parity. `cosmic_v1` may deviate
  only for an explicit, reviewable infeasible platform capability; a missing
  capability fails closed. Future Hyprland and other behavior belongs in a
  separate versioned policy mode sharing the portable engine, not in an
  unnamed generic fallback or a platform adapter.
- COSMIC geometry parity, established 2026-09-13: the raw default theme gaps
  are `(outer, inner) = (0, 8)`, but source leaf-edge insets make the rendered
  work-area edge margin 8px. Native KCM-owned `innerGap` and `outerGap` default
  to `(8, 8)` for that effective edge margin and sibling spacing;
  `outerGap` is not the raw COSMIC theme outer value. Source N-ary pixel-size
  rounding remains an explicit open portability gap, not a claimed COSMIC parity
  behavior.
- COSMIC send-to-workspace is a portable same-output, distinct-workspace
  lifecycle operation. It moves only the focused tiled window, recursively
  collapses its source tree, and focuses it in the target. A validated
  per-domain last-active leaf supplies COSMIC target admission; its absence
  uses target `map_to_tree` root/output-geometry fallback. Empty targets are a
  lone root. Cross-output R4 remains deferred: the audited COSMIC boundary
  path escalates `MoveFurther` to workspace/output actions and does not
  establish the project's frozen local R4 transfer rule.
- A KWin fork or patch is rejected. The project must operate within existing
  KDE/Plasma/KWin. The Rust-engine/direct-geometry direction above is the
  selected replacement architecture; the bounded adapter remains active only
  until its individual replacement paths are promoted.
- Rust focus adapter authority, authorized 2026-09-09: the production-shaped
  KWin focus adapter is disabled by default and has no normal startup, tray,
  KCM, autostart, lifecycle, or shortcut activation route. A later reviewed
  explicit wiring route must bind one owner/generation and prove exclusive
  focus-path ownership before any native focus write; it must never run the
  legacy and Rust focus handlers for one command. Owner, service, scope,
  revision, acknowledgement, or post-observation failure disables this
  development authority fail closed. This selects no movement or geometry
  actuation.
- Grouped/tabbed windows remain deferred pending compositor-owned KWin support
  and a live multi-window Custom Tile stability proof. No tab or stack carrier,
  controls, or bindings are selected.
- Active-group highlighting: Meta-held observation is the user-approved
  selected lifetime. One-second accepted/applied open/move/close behavior is
  an alternative fallback only if Meta-held proves unavailable or impractical,
  never automatic when Meta is not held. `I permit the modifier observation.`
  This authorizes only passive public `EffectsHandler::mouseChanged(...)`
  observation (`/tmp/opencode/kwin/src/effect/effecthandler.h:901-916`,
  emits for modifier-only changes at `.cpp:229-236`; `startMousePolling` is
  stale documentation and no such API exists; only public `cursorPos` exists,
  `m_cursor.modifiers` is protected with no public input getter, so no public
  initial modifiers snapshot is asserted; checkout KWin 6.7.3 per
  `/tmp/opencode/kwin/CMakeLists.txt:5`, exact commit unverified). It
  authorizes no grabs, interception, filters/spies, private InputRedirection,
  input consumption, or polling. KWin Script workspace exposes only cursor position
  (`src/scripting/workspace_wrapper.h:149` / `.cpp:61,148`), so Script alone
  cannot observe Meta hold.
- On a recognized Meta press, show the current valid active immediate group;
  while held update/clear it on qualifying tiling/focus/domain changes; clear
  on Meta release. First visibility does not require a tiling mutation. Only
  if Meta-held proves unavailable or impractical, show about one second after
  accepted/applied opening, moving, or closing tiling changes only; never
  automatically when Meta is not held. Focus, resize, and general geometry
  never start the timer. Qualifying tiling changes during hold update the
  current visual without starting the timer; focus/domain changes during hold
  may update or clear valid state but never start a timed flash. Fullscreen
  hides the group visual while the active border retains its existing
  fullscreen/state behavior (precedent `activeborderlogic.h:31-37`).
- Held-before-first-public-signal source limitation: minimal state and no
  polling. Last modifier state is unknown until the first public
  `mouseChanged`; do not assume Meta held. The effect remains hidden for that
  missed initial-held edge.
- Renderer: a separate group outline coexists with the active border via the
  second `OutlinedBorderItem` above (multiple items technically coexist per
  `decorationitem.h:110`, `outlinedborderitem.cpp:49-98`). No simple supported
  backdrop route within selected renderer/C++ restrictions was established;
  custom scene/rendering would broaden scope, so use the user-permitted
  second-outline fallback. `Workspacescene`
  renders background then stacking windows then overlay
  (`src/scene/workspacescene.cpp:710-763`); `BackgroundEffectItem` is
  non-rendering (`backgroundeffectitem.h:17-21`); effect overlays are above
  windows, can cover unrelated windows/panels, and occlusion culls background
  before it. Below-window custom drawing/scene items needing excluded
  shader/GL/QPainter/texture or scene-restriction work remain unselected. No
  broad new scene mechanism is authorized. COSMIC `cosmic-tiling-mod.rs:5459-5535`
  renders group backdrops through its compositor-owned `BackdropShader`
  render-element path (checkout/revision unverified; source-content comparison
  only, no parity claim).
- Active-group highlighting is statically delivered. Rust resolves the focused
  leaf's immediate parent split group and recursively projected members from
  its retained focused-domain tree; the script forwards only the engine union
  bounds and bounded identity to the renderer. Rust also owns native-effect
  payload parsing/validation, stream order, focus/visibility policy, and POD
  state through a panic-contained byte/POD ABI. C++ is only the required
  QObject/D-Bus boundary, native identity/signal observation, and automatic
  outline/repaint shim. The active border remains while a second effect-owned
  `OutlinedBorderItem` renders the temporary group outline.
- The approved writable bridge is an effect-owned session D-Bus endpoint,
  `org.plasmaautotiler.ActiveBorder` at
  `/org/plasmaautotiler/ActiveBorder` with interface
  `org.plasmaautotiler.ActiveBorder1`: bounded `SetGroupHighlight(QString)`
  and `ClearGroupHighlight()`. It is not a `/Effects` method. Its source and
  offline contract are verified; KWin Script argument demarshalling, service
  ownership, modifier delivery, rendering, and performance remain
  live-unverified. Autonomous mode remains off.

## Nested Placement Affordance

- Replace the temporary outline interaction with a minimal COSMIC-like,
  deterministic nested-placement affordance. It is a placement affordance, not
  opacity or dimming behavior.
- Portable drag placement source-classifies COSMIC group edges, group interiors,
  and window zones. Group edges are 32px normally and 80px only for the exact
  prior portable `(group, edge)` hover; stale/different-edge hover is normal.
  Same-axis group edges use source-adapted ordered N-ary first/last insertion,
  perpendicular edges wrap the group, and group interiors insert after the
  source predecessor. Window left/right create horizontal before/after placement
  and top/bottom create vertical before/after placement. The COSMIC
  middle-third center is a stack drop, not a no-op; because stacks remain
  unselected/compositor-owned, the portable split-tree policy refuses it closed
  without a plan. This remains split-tree structure only, never tabs, stacks,
  shared tiles, or compositor groups.

## Tray

- Use a portable Rust StatusNotifierItem carrier with the KWin backend first;
  fail closed without a watcher. The bridge is whitelisted, outbound
  state-snapshot based, reconnecting, idempotent, and has no shell, input, or
  helper-to-KWin action route. The KCM remains the settings owner.
- Snapshot publication requires the current `org.kde.KWin` D-Bus owner and an
  exact canonical executable identity from the host current-system or
  `/usr/bin` KWin entrypoints; unlisted KWin launch paths fail closed.
- The static bridge includes freshness and ordering/generation checks,
  idempotent notifications, and bounded watcher retry. Watcher ordering,
  login, and XDG autostart behavior remain pending live evidence.
- Home Manager autostart uses the immutable store tray binary with the fixed
  `tray-managed` mode; `TryExec` remains the immutable store binary alone.
  Managed mode uses only `$XDG_RUNTIME_DIR/plasma-auto-tiler-managed` for its
  lock and PID state and never installs or mutates the dogfood helper state.
- Managed startup accepts only the current safe regular executable resolved
  under `/nix/store`, with exact PID, start-tick, path, device, inode, and
  content binding. Malformed, unowned, replaced, symlinked, wrong-mode,
  unreadable, or ambiguous state fails closed; cleanup removes only exact
  managed state. The no-argument endpoint and lifecycle commands retain the
  existing dogfood namespace and semantics.
- The helper is not required for core tiler operation. Normal lifecycle
  rollback is exact and in-process; interrupted, crash, power-loss, malformed,
  replaced, or ambiguous state fails closed. Durable recovery and automatic
  post-crash retry are not selected.
- The tray MVP provides basic status and Settings only. It has no direct tiling
  controls and no expansion of the helper boundary.
- One current-session manual start of the current-generation immutable store
  `tray-managed` binary proved only exact managed process/runtime binding under
  `$XDG_RUNTIME_DIR/plasma-auto-tiler-managed`, SNI registration with
  `unavailable` status, and one fixed Settings action with exact
  Settings-process cleanup. No KWin snapshot authority is claimed from that run.
- That run claims no visual panel behavior, no watcher-ordering/login/autostart
  delivery, no native ABI/plugin load, no baseline-restoration proof, and no
  KWin Script1 identity or cleanup.
- The pre-repair current immutable process held
  `org.plasmaautotiler.Tray/StatusNotifierItem` but timed out on every SNI
  object request, including `Peer.Ping`; Plasma could not obtain its icon,
  tooltip, menu, or activation from that process.
- One bounded disposable repaired candidate answered SNI `Peer.Ping`,
  introspection, and properties; returned valid icon-pixmap, tooltip, menu, and
  method contracts; completed one fixed Settings launch with exact resulting
  process cleanup; and terminated with exact original autostart restoration.
  It claims no panel visual behavior or session boundary.
- After rebuild/new session, the user manually observed only: the tray icon was
  visible and usable, and clicking it opened the native settings dialog. This
  is user visual/manual evidence, not automated/protocol evidence. No
  KWin-origin authoritative snapshot, watcher-ordering/login-autostart, or
  update/rollback generation claim is made.

## Production Interactive Edge Drag

- Production interactive single-edge drag share adjustment is selected and
  shipped. The disabled-by-default `plasma-auto-tiler-drag-oracle` native effect
  records final drag geometry; after its explicit one-time enable, the
  production script pulls its read-only session D-Bus verdict and routes a
  non-cancelled verdict through `pointer-resize` shares. A cancelled or
  no-change verdict makes no pointer-resize plan.
- One real-hardware KWin 6.7.4 session proved only this route in one three-window
  scope on one output: `isEffectSupported` returned true; the effect loaded and
  its endpoint answered; strict D-Bus demarshalling and pull ordering worked;
  and KWin did not crash. Twelve committed drags each logged
  `route-diag:drag-pull action=dispatch`, then
  `route-diag:drag-verdict cancelled=false correlation=drag-N reason=ok-moved`,
  then `plan:cmd=plan-1-pN kind=pointer-resize windows=3 outcome=planned-applied`.
  One Esc-cancelled drag logged
  `drag-verdict cancelled=true correlation=drag-11 reason=no-change` and no
  pointer-resize plan.
- The later one-shot echo-fence and dragged-source reassertion fixes are
  static-only. The user-reported gap loss before the source fix has not been
  visually confirmed fixed. Nothing is proven for multi-output, more than three
  windows, non-horizontal splits, or workspace/output boundaries, and this
  selects no atomicity, acknowledgement, or stock-KWin parity claim.

## Deferred Scope

- Session D-Bus is selected for the initial Rust/KWin migration transport only:
  one bounded read-only KWin snapshot request to the Rust planner and one
  advisory reply. It selects neither a generic cross-platform IPC abstraction
  nor a permanent topology for other platform adapters. The KWin client
  resolves the planner well-known name then targets the pinned unique owner;
  the Rust service verifies only that the D-Bus sender's unique name has the
  Planner's Unix UID, failing closed if the UID cannot be obtained or differs.
  Public KWin scripting exposes no service credential API, so this cannot
  prove the initially resolved same-UID planner service binary against a
  hostile same-UID owner. The reviewed standalone advisory entry, builder,
  and namespaced loader may coexist with the loaded production plugin only
  because their checked route has no topology authority, actuation, shortcuts,
  Custom Tile, controller, or production-startup path. The first host read-only
  round trip, including stale and service-loss evidence, remains unestablished.
- Rust is the selected engine language and owns the durable portable model.
  The migration starts incrementally through opt-in, shadow, and diagnostic
  modes; it does not claim stock-KWin parity, atomic geometry, or Windows/macOS
  delivery details.
- The durable direction is a platform-neutral Rust deterministic core for
  logical tiling, ordered split-tree grouping, navigation, movement policy,
  capability-gated plans, and reconciliation. Platform adapters retain native
  window/output/workspace observation, identity, permissions, geometry/focus
  actuation, event ordering, acknowledgement, recovery, effects, UI, and
  delivery authority. This selects neither an IPC/service/FFI topology nor a
  Windows/macOS runtime or packaging model. The core does not promise uniform
  workspace, group, atomicity, or geometry semantics where public platform APIs
   cannot provide them; unsupported capability paths fail closed.
- Durable validation prioritizes product-shaped Rust unit/integration/property
  coverage and focused adapter contracts. Do not add lifecycle automation just
  for assertion count; use the reviewed bounded host sequencer where useful,
  otherwise stop at the smallest user-assisted manual journey.
- KWin direct geometry remains sequential and non-atomic. The adapter must be
  signal-driven, not poll pointer resize, minimize visible intermediate frames,
  and record applied-versus-acknowledged divergence without claiming atomicity.
  A KWin fork or patch remains rejected.
- The authorized Stage 2 transport-free contract is complete: it has one
  pending plan at most, binds owner/generation/correlation/base revision plus
  complete semantic intent/operation/capability/preconditions, and commits only
  after an exact accepted acknowledgement and matching verified
  post-observation. Stale, partial, mismatched, refused, or lost adapter
  results are terminal divergence. This selects no platform adapter, runtime,
  IPC/FFI, packaging, rollback, or atomicity emulation.
- The authorized Stage 3 offline trace contract is complete: bounded redacted
  JSON v1 fixtures replay ordered request, emitted-plan, acknowledgement,
  verification, and adapter-loss events through that same planner and
  reconciler. It permits only opaque session identifiers and structural policy
  data, rejects sensitive/platform fields by schema, and locks checked-in
  fixture bytes plus independently asserted replay results. The byte lock is
  repository-fixture stability only, not a serializer-ordering or cross-platform
  byte-portability claim. It selects no recorder, adapter, runtime, live trace
  collection, IPC/FFI, packaging, or native operation.
- POC2 extends that POC only with a manually started session-D-Bus planner
  service (`org.plasmaautotiler.Planner`, `/org/plasmaautotiler/Planner`,
  `org.plasmaautotiler.Planner1`) and a separately built/manual KWin one-shot
  shadow probe. Its bounded JSON v1 contract is advisory-only. The probe reads
  one active horizontal two-leaf scope, declares only `swap-neighbor`, freshly
  revalidates native identity and preconditions, and logs only. It has no
  actuation, tray, autostart, package, KCM, persistence, shortcut, or ordinary
  KWin-startup route. Same-session planner-name spoofing remains out of scope;
  no captions, geometry, handles, or execution commands cross the boundary.
- POC2 is static-only until an exact authorized protected-runtime recovery,
  baseline, and restoration procedure permits a current-session read-only
  proof. It proves neither native actuation nor stock-KWin parity.
- POC3 was a separate, disposable, manually invoked actuation experiment. Rust
  owns a non-persistent single-output/single-workspace logical three-window
  model and emits non-atomic complete geometry/focus intents; the KWin adapter
  owns exact identity observation, eligibility, scope revalidation, sequential
  application, observed completion, divergence, and cleanup. It is disabled by
  default and refuses to coexist with the production plugin. It enrolls only
  three user-supplied public `String(Window.internalId)` values for newly
  opened disposable normal untiled windows. Its only live cleanup model is an
  explicitly selected `close-disposable` directive for those exact windows.
  It has no Custom Tile, shortcut, autostart, persistence, tray, KCM, workspace,
  output, package, or normal-startup route. Its final host evidence and limits
  are retained in [the archived record](changes/archive/poc3-disposable-rust-actuation.md).
  It establishes no KWin parity, production replacement, atomicity, configure
  acknowledgement, or hostile same-uid service-authentication claim.
- Its bounded host-only pilot used temporary production suspend/resume authority
  that was pragmatic only:
  `isScriptLoaded("plasma-auto-tiler-kwin")`, exact plugin-ID unload/reload,
  one accepted active Nix-store package/source resolution, exact KWin
  owner/PID/start-tick/canonical-executable pinning, and observable behavior.
  KWin 6.7.4 still cannot prove Script-object-to-plugin/source mapping,
  duplicate count, handler absence, or exact running-state restoration. The
  pilot remained disabled by default and had no session boundary, config,
  dotfile, rebuild, shortcut, Custom Tile, or production-delivery change.
- A host-only systemd fallback accepts only a D-Bus KWin owner whose PPid is
  exactly `plasma-kwin_wayland.service` MainPID, with matching owner/PID,
  `/proc` tick, boot ID, and Nix-store `ExecStart` identity. A readable
  `/proc/exe` must agree; cgroup `/` is insufficient by itself and no deeper
  descendant is accepted. Historical attempt detail is retained in the archived
  POC record.
- Retain JavaScript for discrete window add/remove management. Group behavior,
  inactive borders, Steam-specific handling, and complete keyboard-layout
  support remain deferred.
- Production self-resize reconciliation, authorized 2026-09-13: retained Rust
  session allocation is authoritative over same-scope client geometry drift.
  The KWin plan adapter sends strict `DescribePlan` `{ "op": "reconcile" }`,
  applies the retained projection, and never derives sibling shares from an
  actual client rectangle. It makes at most three terminal reassertion attempts
  before parking that scope; this is an explicit KWin bounded-retry policy, not
  a COSMIC threshold or KWin acknowledgement claim. Focus/fingerprint changes
  do not permit drift adoption.
