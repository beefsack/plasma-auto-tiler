# Current Decisions

Only active, user-approved product and project choices are recorded here.
Historical implementation detail is recoverable in Git history.

## Architecture Direction

User-approved 2026-09-24 from the
[architecture review](research/architecture-review/review.md). Entries
elsewhere in this file that conflict remain accurate for shipped code until
the corresponding item ships; each such entry names its replacement.

- Target shape (review section 6): a portable `tiler-core` Engine with
  world/domain state behind a `LayoutPolicy` seam; `tiler-protocol` as a thin
  codec; a Linux service crate; the KWin script as observer and actuator; the
  native effect as renderer. Host-synchronous paths may stay in the adapter
  where moving them would change latency or failure behavior.
- Workspaces: the current KWin logical-workspace implementation is the
  "native workspaces" mode of a future per-platform choice between native and
  project-managed workspaces. Moving the workspace model and remaining
  portable policy to core is deferred until a non-KWin host needs it.
- Initial maximize (AR9, shipped): the effect seeds each observed window from
  committed `window()->maximizeMode()`; native transitions then update it.
  The script epoch handoff and its endpoints are retired.
- Effect Rust build (AR10, shipped): CMake invokes Cargo to build the workspace
  `tiler-kwin-effect-ffi` staticlib, using serde for strict JSON parsing and
  `tiler-core` validation gates. The bare-`rustc` build and hand-written JSON
  parser are retired. Rust keeps group visibility and drag verdict policy;
  the POD-only C ABI and panic containment remain.
- Size hints (AR12, shipped offline): observed min/max hints guide minimum-aware
  projection and evidence-backed clamp acceptance without drift/park. Per the
  Orchestrator's option (1) decision applying the user-approved AR12 text,
  overconstrained members are not reasserted; R4 verifies their client-held
  geometry while keeping identity, membership, and other geometry exact.
- Size caps (AR16, shipped offline): the 64-window and 16-domain count caps are
  retired. The codec rejects requests above 1 MiB; the KWin adapter mirrors
  this bound before dispatch. Separate reply, native/FFI, and field bounds remain.
- Settings (AR15, shipped offline): tiling settings (`workspaceMode`,
  `shortcutProfile`, gaps) are configured from the KWin script's own Configure
  page, backed by a small host-built native script KCM. Saving changed gaps
  requests KWin reconfigure and the running controller re-reads validated gaps
  for debounced retained resync; the request alone does not confirm application.
  `workspaceMode` and `shortcutProfile` remain startup-only and the page states
  that a session restart is required. The effect KCM keeps border and explicit
  shortcut overrides only. Storage remains in the same `kwinrc` group. The
  script KPackage needs the host-built native KCM companion for its Configure
  page; the effect need not be enabled. Live acceptance remains pending.
- Threat model (AR13, shipped offline): processes of the same user are trusted.
  The tray has no KWin executable allowlist or `/proc`/pidfd/inode binding;
  it runs single-instance by owning its D-Bus name with `DoNotQueue` and
  accepts snapshots only from the current `org.kde.KWin` owner. Home Manager
  delivers it through XDG autostart; dev and dogfood launch it on demand with
  `cargo run -p plasma-auto-tiler -- tray`. The Planner same-UID caller check
  remains. Live login and watcher acceptance remain pending.
- Testing investment: build test fixtures that are sensible and valuable for
  the change at hand; avoid extensive custom harnesses that constrain later
  development.
- Native integration boundary (user, 2026-09-24): the native layer provides
  capabilities the project needs, with the smallest reliable native footprint.
  Keep as much logic and policy as possible in or near the Rust core, but use
  native integration where needed; do not exclude capabilities such as input
  by category. Existing specific implementation choices stand until changed.

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
- Approved 2026-09-21: hide the active-window border for fullscreen or any
  native maximize axis, matching the adapter's nonzero maximize collapse. The
  public KWin maximize transition signals update the border before and after
  geometry changes. The user manually accepted active-border suppression on
  2026-09-21 and additionally requires the Meta-held group outline to hide
  while maximized: neither outline may be visible.
- Effect observation seeds every window on load and addition from its committed
  native maximize mode; any maximize axis or fullscreen suppresses both
  outlines. Native transition signals remain authoritative. Orchestrator
  decision applying the user-approved AR9: a Wayland maximize configure not
  yet acknowledged leaves the window rendered normal, so the committed normal
  seed reflects that geometry; acknowledgement emits the observed maximize
  signal. Requested mode could hide a normally rendered border indefinitely
  if the client never acknowledges. No polling, timers, or geometry heuristics.
- Approved 2026-09-21: the Slice 1 drag oracle is folded into the surviving
  `plasma-auto-tiler-active-border` effect plugin (one exported effect hosting
  active border, group overlay, and drag oracle); no second
  `plasma-auto-tiler-drag-oracle` effect, factory, metadata, or KCM entry remains.
- The outline never clips, reshapes, or changes window textures. Plasma 6.5+
  decoration-driven rounded corners remain the selected corner solution.
- The shipped border uses two effect-owned automatic-lifetime
  `KWin::OutlinedBorderItem`s (active border and temporary group outline),
  without texture changes or clipping. The native integration boundary above
  governs further capabilities, including input, rather than a category ban.

## Native Integration Boundary

- User decision (2026-09-24): keep OS/DE-agnostic logic and policy in or near
  the Rust core wherever possible. Supply needed OS/DE capabilities through
  the smallest reliable native integration; no capability, including input,
  is excluded merely for being native.

- The shipped drag oracle uses a C++/moc KWin-effect shim and POD-only C ABI.
  Rust owns verdict policy; no Qt or KWin type crosses the ABI, and every Rust
  callback catches panics before returning to KWin. The unified effect also
  observes the configured modifier-resize press through a passive InputEventSpy:
  it matches the same window and identity at drag start within a bounded age,
  then consumes that single-use evidence with the final geometry at finish.
  The script owns KWin-thirds grabbed-edge classification and resize routing.
- The drag oracle retains a separate read-only session D-Bus endpoint for its
  last verdict, hosted in the same active-border effect plugin. The KWin script
  pulls it after interactive drag finish; the effect never pushes a verdict
  into the script. The reply carries optional matched press position and
  binding atomically with final geometry, cancellation, and correlation.
  AR8 closed on 2026-09-24 at the user's request with the shipped integration
  kept, following the Lead's recommendation; this selects no endpoint rewrite.
- Orchestrator interpretation of the 2026-09-24 user decision: reliability is
  part of the test for any needed native capability. Private KWin APIs are not
  categorically forbidden, but their ABI churn weighs against their use. Put
  portable policy in Rust where possible and keep native integration as small
  and reliable as the capability permits.

## Settings And Distribution

- The script Configure page owns `workspaceMode`, `shortcutProfile`, and both
  gaps through a native script KCM; the effect-scoped KCM retains border and
  shortcut-override settings. Existing script groups, keys, values, and
  defaults remain unchanged. Saving changed gaps queues the existing KWin
  reconfigure path automatically; the controller re-reads gaps on
  `Options.configChanged` and requests a debounced retained `update-gaps`.
  The queued D-Bus send is unconfirmed, and a session restart guarantees pickup
  if it cannot converge. Startup-read `shortcutProfile`/`workspaceMode` still
  require session restart. The ineffective `tilingAlgorithm`,
  `automaticSplitTarget`, and `dropOutlinePreview` controls remain removed;
  existing values are neither read nor rewritten. Shortcut re-registration
  remains unselected: the pinned scripting surface offers no unregister
  operation, and foreign records change only through explicit effect KCM
  Apply/Revert. Existing live border updates remain live. Before launch, every
  user-facing setting must apply live; this remains a mandatory launch blocker.
  User exceptions (2026-09-25): `workspaceMode` stays startup-only for MVP and
  the Configure page states the restart requirement clearly; `shortcutProfile`
  is hidden until distinct profiles exist (post-MVP).
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
  file running `plasma-auto-tiler tray` and the on-demand Planner D-Bus/systemd
  activation metadata. Neither
  writes user `kwinrc` authority.
- Flake source filesets are explicit for the KWin script, native effect/KCM,
  and tray package; build trees, generated artifacts, and unrelated repository
  files are excluded.
- Development iteration uses the packaged baseline plus a namespaced,
  reversible, user-local dogfood override as the smallest selected boundary.
  It must not coexist with a Nix-managed copy of the same KWin plugin IDs, must
   preserve exact normal-path restoration, and must not mutate system or
   unrelated state.
- Dev native delivery uses an explicit one-time `just dev-native-setup` (and
  matching `just dev-native-remove`) for this checkout's
  `target/kwin-native-effect-stage` via the project-owned
  `plasma-workspace/env` script, with robust quoting and exact-content
  ownership only; no `kwinrc` writes and no durable receipt state. The dogfood
  effect path and this dev path share the exact
  `plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh` path and cannot
  coexist there. `just dev`
  preflights both effects before startup, transiently loads only
  invocation-owned effects with KWin owner guards (preserving preloaded ones
  in reverse-order teardown), and promises no hot reload; unload verification
  never proves the library is unmapped.
- Approved 2026-09-20, durable for native development: the current-system
  host KWin derivation is the native development authority.
  `scripts/nix-host-kwin-build.sh` resolves
  `/run/current-system/sw/bin/kwin_wayland` to its exact derivation and
  matching `dev` output, explicitly realizes that exact output, and builds
  inside `nix develop <host-drv>` with explicit `/nix/store` Cargo and rustc
  injected and `-DKWin_DIR=<resolved-dev>/lib/cmake/KWin`;
  legacy pinned CMake dirs never drive or leak. `just build-native-effect`
  and dogfood `effect-install` route through that builder with
  identity-keyed build dirs and fail closed on missing provenance. The former
  shared `e554fab72f81915600f3f449b786fd9af40439a5` dev pin remains only
  portable/interim compatibility, no longer native authority.

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
  so the default has no idle Planner process cost. Set it false to omit both
  the descriptor package and user unit.
- The unit uses `Restart=no`: Planner name loss terminates the old Planner
  session and any in-flight KWin transaction, and cannot form a systemd
  restart/rebind loop. A subsequent idle command may request a fresh D-Bus
  activation. User-manager session teardown stops the service; D-Bus
  connection/name loss also ends the Planner without durable recovery state.
- Selected 2026-09-16: on CONFIRMED Planner
  loss, establish one bounded fresh Planner session automatically. This
  on-demand activation is distinct from a systemd restart loop. It starts from
  current eligible windows only, with no durable layout snapshot or journal
  and no inference of the old session's internal history. The old in-flight
  transaction remains terminal with old-generation replies rejected; this does
  not replay interrupted commands, recover uncertain native mutation, apply
  stale old-session replies, or resolve parked workspace-send partial recovery,
  and stays unavailable while a workspace send blocks Plan. Normal Plan
  transport pins a unique owner via strict `NameHasOwner` plus one bounded
  `StartServiceByName(..., 0)` accepting only `PrimaryOwner`/`AlreadyOwner`
  then `GetNameOwner`; ambiguous terminals may run one bounded identity probe
  and only absence or a changed owner recovers. A failed recovery stays
  bounded without loops.
  If the Planner survives sleep, retain its current in-memory layouts rather
  than rebuild them.
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
- On authorization failure, `DescribePlan` returns the fixed bounded in-band
  JSON rejection `outcome:"rejected", kind:"unauthorized"` so KWin records
  `result=rejected`.
- `DescribePlan` is the sole shipped automatic-tiling route. Its approved lifecycle
  includes ordered N-ary `cosmic_v1` admission/removal, same-output send,
  restored backing-desktop/numbered workspace routes, bounded reconciliation,
  and the selected initial first-startup fitting direction below. General
  existing-window adoption remains unselected.
  Before launch, this and every other user-facing setting must apply live; that
  is a mandatory launch blocker, and the gap-only reload does not satisfy it.
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
  normal deterministic seed/reflow. The same attempt is selected for a
  post-CONFIRMED-loss fresh session only, from CURRENT eligible windows.
  Fresh-loss fitting may change grouping and does not reconstruct the old
  topology. It selects no
  park/unmanaged fallback or broader activation lifecycle. Existing floating,
  sticky, fullscreen, maximize, and configured-gap behavior remains
  authoritative; preserving it at the current eligibility or pure input boundary
  is implementation work, not an unselected product behavior.

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
- A session boundary is a required evidence boundary for claims
  about session-delivered packages.
- Deleting or restoring preserved candidates, containers, or host artifacts
  needs explicit user authorization plus exact path and identity or hash
  verification.
- The Custom Tile acceptance harness is an accepted static, current-session
  read-only preflight. It strictly diagnoses KWin and KGlobalAccel ownership and
  fails closed on stale state, collisions, drift, or provenance ambiguity; it
  performs no lifecycle or mutation. Its rollback and journal contract is for a
  later authorized run only.
- The inert checkout carrier does not change the `authoritative_ready` verdict:
  current public KWin APIs provide no direct evaluated-memory source proof for
  the checkout controller, so `authoritative_ready` remains false.
- No preflight readiness phase authorizes a Custom Tile lifecycle, live journey,
  or user physical or manual action on its own; `journey_ready` and
  `authoritative_ready` remain false until the applicable acceptance gates are
  established; carrier setup is limited to its bounded operational binding.
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
  processes and Rust-path IPC must emit bounded, structured, correlated lifecycle
  and terminal logs to their existing visible KWin console, stdout, or
  stderr/journal sinks. `just dev verbose` keeps those summaries while
  `just dev trace` opt-in enables redacted high-volume per-window, hook, and
  bounded structural request/reply detail, never raw native D-Bus payloads.
  Future troubleshooting checks those logs first. The shared
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

- Approved 2026-09-16: background tiling is supported at startup and on window
  open or move for non-visible workspaces, without switching visibility or
  stealing focus. Existing floating, sticky, fullscreen, maximize, and
  configured-gap rules remain authoritative, with Rust retaining structural
  ownership and the native adapter retaining observation and actuation.
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
  `shortcut-dispatch-shadowed` until the user applies the exact reversible KCM
  override. Explicit normal and sticky float toggles retain the exact toggled
  window: the adapter never actuates Rust survivor-focus bookkeeping and
  performs at most one synchronous native focus retention with stale/failure
  safety and no timer, retry, desktop switch, or later-focus fighting.
  `Meta+Shift+G` toggles sticky floating: tiled members float first,
  then set `Window.onAllDesktops=true` without changing current visibility or
  focus. KWin represents all-desktops as an empty membership list; sticky-off
  assigns the current desktop, restores prior floating placement there, or for
  prior tiled members fresh-admits there rather than restoring an old slot. The
  native write has one exact-reference `desktopsChanged` echo fence, with no
  retry, timeout, fallback, or polling. Approved 2026-09-21: an eligible normal
  window already native-sticky with an empty desktop list and no same-runtime
  origin is adopted as a sticky float with prior-float semantics only; sticky-off
  leaves it a normal float on the then-current desktop with preserved geometry
  and focus, and a later ordinary float toggle tiles it. Known tiled origins
  keep fresh admission and known float origins stay float.
- Intentional normal and sticky floating request KWin's public `keepAbove=true`.
  KWin owns the normal keep-above/keep-below exclusive transition. The adapter
  records the prior pair and restores a project-cleared `keepBelow` (or prior
  `keepAbove=false`) before unfloat, fresh tiled admission, or controller
  disable; a pre-existing keep-above setting remains untouched. A missing,
  refused, or unverifiable native write fails the transition without a retry.
- The selected fresh-admission behavior follows `pop-os/cosmic-comp`
  `81cd5fdbaa41c3973369ae85bccf829137836e20` source content:
  `data/keybindings.ron:83-92` binds Super+G to `ToggleWindowFloating`;
  `src/shell/workspace.rs:1485-1498` unmaps a tiled window to floating and
  maps a floating window back through `tiling_layer.map`; and
  `src/shell/layout/tiling/mod.rs:396-435` routes that map through
  `map_to_tree`. The supplied checkout has no Git metadata, so the exact commit
  identity could not be independently verified there.
- Maximize (`Meta+M`) is workspace-local. Fullscreen (`Meta+F11`) is separate:
  the focused observed window toggles KWin's public `Window.fullScreen`
  property, while KWin keeps cover-and-restore ownership. The member retains
  its tree allocation, receives no geometry write while fullscreen, and
  restores that allocation on exit.
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
  delivery diagnostic until the user applies the exact reversible KCM override.
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
- USER-APPROVED recoverability, 2026-09-21: "log and continue rather than hard
  fail." A failed native geometry operation or client geometry discrepancy is
  an operation failure, not a permanently disabled window or domain. Later
  valid commands and fresh observations remain usable while the adapter retains
  confirmed canonical topology where available. Bounded reconciliation may park
  only further automatic reflow after repeated mismatch; it never blocks a
  later explicit command, retries indefinitely, fabricates acknowledgement,
   applies stale geometry, or recovers uncertain cross-output transfers.
   Authorization, malformed-input, owner, correlation, and stale-scope fences
   remain fail-closed.
   Detailed uncertain-transaction recovery remains pending. Any future design
    must preserve safe handling of later valid commands without treating the
    uncertain transaction as success, replaying it, resetting topology, or
    weakening those fences.
- USER-APPROVED incremental direction, 2026-09-25, replacing the 2026-09-23
  entry below: full AR11 and AR4 are parked. Add bounded post-actuation send
  resolution to the existing send pending model, then batch simultaneous
  admissions into one plan; both open to later refinement. Scope and the
  lessons behind it: [proposal](changes/incremental-send-recovery-and-admission-batching.md).
  Until those ship, the send/R4 pending entries below describe current code.
- SUPERSEDED 2026-09-25 (parked, retained for reference) - USER-APPROVED
  transaction-model direction, 2026-09-23: adopt architecture
  review 7.8, prototyped on workspace send first. Host observations own window
  existence, domain and flags; the engine owns layout within those facts.
  Prefer bounded convergence to observed truth over never reporting success
  before verification. Observations must be complete for their declared scope:
  a window elsewhere changed domain, absence from the entire observed world
  means closed, and an unexpired expectation protects a window in transit.
  Fence plans and replies to a monotonic observation sequence, retain the
  existing same-UID, owner, generation and correlation fences, and never replay
  commands, blindly reset topology, loop indefinitely or permanently disable
  a window/domain. Expiry uses the existing deadline and a specified outcome;
  a failed send re-admits to source with `diag: expectation-expired`. Keep
  prompt one-shot switch/focus on fresh native proof of the mover's exact
  arrival without waiting for unrelated layout settling, preserve unrelated
  focus and in-flight workspace retention, and distinguish dispatch,
  acceptance, completion and uncertainty in correlated logs. This is an
  approved direction, **not shipped behavior**: the existing send/R4 pending
  status, cancellation and verified-success entries below still describe the
  current code; their send-specific clauses are superseded only when the
  replacement actually ships. AR4 is deferred behind AR11.
- USER-APPROVED pending-transaction status, 2026-09-22: the existing
  same-UID-authorized `DescribePlan` route exposes only
  `send-to-workspace-status` and `directional-move-status` for an exact pending
  transaction. With the normal owner, generation, correlation, revision,
  domain, bounds, and complete-observation fences, the read-only replies are
  `post-unacked`, `post-acked`, `unresolved`, `stale`, `diverged`, or
  `no-pending-unknown`. They expose no native/window data beyond the caller's
  correlation and a retained pending base revision. `no-pending-unknown` never
  means committed or safe to unblock. Status cannot acknowledge, verify,
  clear, rebind, advance, write native state, release adapter blocks, retain
  pre-observation, keep receipts, cancel, settle, retry, discard, reseed, or
  recover. Exact pre-state and lost-commit classification remain unselected.
- USER-APPROVED pre-actuation cancellation, 2026-09-22: one automatic bounded
  cancellation attempt may withdraw a workspace-send or directional R4 pending
  transaction only before its KWin flight has bound a plan or dispatched a
  geometry, membership, or follow setter. The same-UID KWin caller attests
  zero dispatch for its exact generation, flight, and correlation; Rust treats
  that as a trusted protocol input, not native-history proof. Before the fresh
  pre-state observation, KWin arms cancellation so old replies, timers, echo
  completion, setters, and new commands remain inert until the cancellation
  reply. Rust retains a bounded normalized dispatch-time pre-image and original
  request revision only for the pending lifetime, and requires those plus exact
  owner, generation, correlation, route scope, `PendingUnacked`, and no
  divergence. Success clears only that pending/reconciler slot and staged desired
  state, preserving canonical topology, focus, shares, exceptions, revision,
  and unrelated domains; it replies `cancelled`, never success for the original
  transaction. Any cancellation failure or ineligible state follows existing
  terminal behavior unchanged. Status remains read-only. Acked, post-actuation,
  unresolved, stale, diverged, absent, and lost-commit cases remain fenced;
   this selects no settlement, receipt, replay, rollback write, reset, reseed,
   polling, or retry loop.
- Approved correlated pending observability, 2026-09-22: authorized Planner
  `DescribePlan` status/cancel requests and replies emit bounded normal-level
  `plasma-auto-tiler:plan-summary` records on Planner stderr; opt-in trace adds
  only a bounded structural request/reply shape. Workspace send uses the
  existing `plasma-auto-tiler:route-diag` schema and directional R4 retains its
  `plasma-auto-tiler:plan:cmd` prefix while adding component, route, stage,
  correlation, generation, known revision, event, outcome, and original cause
  for cancellation lifecycle and subsequent dispatch. Successful cancellation
  records the validated reply before local release. Fixed uncorrelated Planner
  early-exit summaries cover busy, closed, oversize, and unauthorized without
  parsing rejected input. Records use only bounded/allowlisted values and
  exclude native/window identity, geometry, domains, owners, payloads, and
  foreign error text. Logging is best-effort. The R4 direct-`diverged` skip is
  a correction enforcing the already selected no-divergence cancellation fence;
  no new recovery or retry behavior is selected. This slice does not claim
  observability for other routes.
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
  domain, reusing it for `Meta+0` and `Meta+Shift+0` before creating one. Once
   invisible on every output, an empty non-final managed backing desktop may be
   removed. Management includes preexisting desktops adopted into the current
   logical mapping; it is distinct from lifetime ownership, so disable/teardown
   never treats an adopted desktop as disposable. The literal native-order trailing
   empty is retained. Every live local or global-unique output domain, and the
   shared domain, keeps at least two logical workspaces. Unmapped desktops remain
   outside management.
  Occupied (including floating, fullscreen, and maximized), visible,
  transaction-pinned, displaced, and unmapped desktops remain protected; sticky
  all-desktops windows do not occupy every backing desktop. Mapping and output
  identity are session-local. The initial disconnected-output policy preserves its displaced
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
  Destination among multiple surviving outputs uses the nearest surviving
  monitor from geometry already available while handling disconnect, with no
  added historical state. If that would require old output geometry/history or
  an extra tracking mechanism, use the current primary surviving monitor; if
  that is not identifiable, use existing available output ordering as the
  deterministic fallback. Availability and lifetime of removed-output geometry
  are implementation source-check details, not a claim that nearest is always
  feasible. The current adapter does not retain removed geometry so it falls
  back to primary/ordering and never uses post-disconnect window frame
  geometry as a proxy. This destination choice is distinct from the selected displacement
  association required for automatic workspace return. On original-output
  reconnect, if the active window is in a returning workspace, show that
  workspace on the reconnected monitor and retain focus on that window. If the
  active window remains on a surviving output, preserve its view and focus with
  no focus stealing. Other workspace selection follows ordinary behavior, with
  no prior-view tracking or new state/history. The initial scope is
  session-local with no restart-persistent mapping or return guarantee.
- `Meta+1..9` select an existing 1-based logical workspace without creation.
  `Meta+Shift+1..9` send only the focused tiled window to an existing
  same-output workspace through the Rust `MoveToWorkspace` route. `0` reuses or
  creates the trailing empty target. A confirmed native mover transfer is a
  user-visible partial success: after the mover desktop setter returns, one
  fresh stable-id observation must prove the original flight's mover is absent
  from its pinned source and present in its exact target, with source/target
  output, domains, bounds, target availability, owner, generation, and flight
  still valid. That one proof switches to the target and focuses the mover
  promptly, without waiting for unrelated source or target geometry echoes,
  Rust acknowledgement, verification, or commit. Setter returns and signal
  delivery alone are not proof. Stale, ambiguous, missing, no-op, wrong-target,
  owner, scope, and hook failures do not follow; switch or focus refusal is
  reported without retry or fabricated rollback. The complete geometry and
  membership observation remains the sole ack/verify/commit gate. A later exact
  commit never follows twice; if no earlier fresh membership proof exists, its
  exact observation may make the one follow. Native map/focus confirmation does
  not claim rendered visibility. A post-plan uncertain terminal result keeps
  Plan blocked rather than adopting the visible but uncommitted target domain;
  only a committed send requests the normal Plan resync. KWin geometry and
  membership are non-atomic and asynchronous: waiting for whole-layout
  settlement before this confirmed native follow can strand the user after the
  move, so unrelated layout settling must not gate it. The standard US shifted aliases `Meta+!`
  through `Meta+)` are registered alongside the digit sends; registration
  preserves foreign shortcut records and does not establish physical delivery.
- USER VISUAL/MANUAL acceptance: "The issue appears to be fixed, I spam moved a window between many workspaces and it never failed. ... reinforces ... graceful handling ... actually feel really good even when spamming." This accepts move/follow usability and repeated same-session use across many workspaces. The supplied `/run/user/1000/plasma-auto-tiler-dev.E2E0QJ.log` is NOT ANALYZED and supplies no machine protocol, rendered-visibility, latency, recovery, or native-cause claim. The durable product preference is graceful, unsurprising handling of confirmed partial successes and responsiveness during rapid use; it does not authorize ignored errors, retries, queue resets, or an architecture or uncertain-recovery change.
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

- Approved 2026-09-21: clear Grid View's `Meta+G` and Krohnkite Monocle's
  `Meta+M` through reversible Apply/Revert overrides. The user grants standing
  authorization, until revoked, to clear other exact project-required shortcut
  conflicts. Each action must have an exact identified conflict and recorded
  preimage for restoration. This does not authorize relocation chords, broad
  shortcut deletion, unverified actions, changes to ownership/readback
  requirements, or startup mutation.
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
- Table row 4 is `kwin/plasma-auto-tiler-toggle-float` taking `Meta+G` by
  clearing `kwin/Grid View` from exact preimage `Meta+G`. Row 5 is
  `kwin/plasma-auto-tiler-toggle-maximize` taking `Meta+M` by clearing
  `kwin/KrohnkiteMonocleLayout` from exact preimage `Meta+M`. New five-row
  journals record all preimages; existing three-row journals remain strictly
  resumable and revertible without claiming the two new rows.
- The private project journal records each resolution kind and exact prior keys.
- The project journal is host-independent at
  `~/.config/plasma-auto-tiler/shortcut-override-journalrc`, shared by every
  KCM host. The single explicit legacy source is the known kcmshell6-host
  journal at `~/.config/kcmshell6/shortcut-override-journalrc`; it migrates by
   exact copy (undo history preserved) after safety and validity checks, and
   fails closed when unsafe, malformed, or foreign. A safe canonical journal
   wins over legacy; directory scans are never
  used. Migration runs only after an already-confirmed mutation operation
  (Apply, Force Apply, Finish Apply, Revert, Restore), immediately before
  reconciliation; opening, refreshing, previewing, or cancelling never
  writes config. A clear row already at its postimage (empty) is normal idempotent
  state and applies without force; any other unexpected value still refuses.
- Confirmed Force Apply is approved only for exact compiled clear-row foreign
  mismatches: preview lists each row with its found value, proposed clear, and
  paired project assignment/chord from the compiled table. Force revalidates
  the complete confirmed managed live image, journal image, and owner before
  any write (stale snapshots abort with zero writes), adopts exactly the
  confirmed actuals as journal preimages for those rows only, and Revert
  restores the adopted values. Force never accepts arbitrary actions or keys
  and never bypasses store, journal, ownership, or transport/parsing checks.
- Shortcut operations emit bounded structured diagnostics on
  `plasmaautotiler.shortcut` (operation, stage, outcome, allowlisted
  identity, key images, schema, phase, journal selector only). Query with
   `journalctl --user --no-pager -g "plasmaautotiler.shortcut op="`.
   Operational warnings and info are enabled by default; the logging rule adds
   debug-only records. Logging never affects behavior.

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
- Future tiling profiles are required after MVP when adding a new tiling type,
  such as Hyprland. A selectable profile/type covers both its tiling
  behavior/algorithm and matching shortcuts; it is not an optional cosmetic
  shortcut preset. COSMIC remains current, while future behavior uses its own
  versioned policy mode sharing the portable engine. This selects no immediate
  Hyprland implementation, native compositor backend, exact parity/mode/
  version/config switching details, coupled-only versus independently
  overridable shortcut UI, or hot-switch semantics. Keyboard-layout
  localization remains separate and initial US-keyboard support is unchanged.
- COSMIC geometry parity, established 2026-09-13, closed 2026-09-16: the raw default theme gaps
  are `(outer, inner) = (0, 8)`, but source leaf-edge insets make the rendered
  work-area edge margin 8px. Native KCM-owned `innerGap` and `outerGap` default
  to `(8, 8)` for that effective edge margin and sibling spacing;
  `outerGap` is not the raw COSMIC theme outer value. Source N-ary pixel-size
  rounding differs: over 8px, COSMIC allocates `[3,3,2]` while the portable
  share projector allocates `[2,2,4]`. Both conserve width and return `[4,4]`
  after removal; no visual consequence or cumulative resize drift is
  established. Retain shares without claiming exact COSMIC parity. Revisit only
  for a reproduced N-ary/deep-layout visual discrepancy or a required
  source-exact fixture that fails under shares. No pixel-authority migration,
  projector correction, numerical-policy change, or code/test work is selected.
- COSMIC send-to-workspace is a portable same-output, distinct-workspace
  lifecycle operation. It moves only the focused tiled window, recursively
  collapses its source tree, and focuses it in the target. A validated
  per-domain last-active leaf supplies COSMIC target admission; its absence
  uses target `map_to_tree` root/output-geometry fallback. Empty targets are a
  lone root. Approved 2026-09-20: exhausted default-Vertical
  `Meta+Left`/`Meta+Right` R4 movement is the selected product behavior across
  a horizontally adjacent output into that output's currently selected logical
  workspace. Local R1/R2/R3 wins first; Up/Down, wrapping, and workspace
  cycling remain excluded. Rust models target remembered-leaf/root insertion
  and retains the existing owner, generation, revision, correlation,
  single-pending, acknowledgement, verification, visibility, exception, and
  fail-closed target fences. The active `DescribePlan` route delivers the
  corresponding exhausted horizontal focus transfer with no layout or
  membership writes. R4 uses KWin 6.7.5 public
  `workspace.sendClientToScreen(window, output)` and exact desktop assignment,
  but native writes initiate only: output, membership, geometry, and focus
  readback fence the accepted acknowledgement and verified commit. The
  transient pair is retained only through that transaction and then split back
  into canonical per-domain sessions. Timeout, stale scope, wrong output,
  failed write, identity loss, or partial proof terminate without replay or
  commit. No live KWin output-switch acceptance is claimed.
- The portable world Engine owns independent per-domain Sessions, outer gaps,
  seeding, relocation, and the existing workspace/R4 pending pair state behind
  typed events and replies. Do not merge per-domain revisions, fingerprints,
  divergence, pending scope, or node identities into one permanent Session.
  Keep transient pair assembly/split until AR11 selects a transaction model;
  this architecture change does not select new transaction semantics.
- A KWin fork or patch is rejected. The project must operate within existing
  KDE/Plasma/KWin. The Rust-engine/direct-geometry direction above is the
  selected replacement architecture; the bounded adapter remains active only
  until its individual replacement paths are promoted.
- Grouped/tabbed windows remain deferred pending compositor-owned KWin support
  and a live multi-window Custom Tile stability proof. No tab or stack carrier,
  controls, or bindings are selected.
- Active-group highlighting: Meta-held observation is the user-approved
  selected lifetime. One-second accepted/applied open/move/close behavior is
  an alternative fallback only if Meta-held proves unavailable or impractical,
  never automatic when Meta is not held. `I permit the modifier observation.`
  The shipped route observes passive public `EffectsHandler::mouseChanged(...)`.
  No public initial modifiers snapshot is asserted; `startMousePolling` is
  stale documentation (no such API exists). KWin Script workspace exposes
  only cursor position, so Script alone cannot observe Meta hold. Additional
  native input capability follows the Native Integration Boundary.
- On a recognized Meta press, show the current valid active immediate group;
  while held update/clear it on qualifying tiling/focus/domain changes; clear
  on Meta release. First visibility does not require a tiling mutation. Only
  if Meta-held proves unavailable or impractical, show about one second after
  accepted/applied opening, moving, or closing tiling changes only; never
  automatically when Meta is not held. Focus, resize, and general geometry
  never start the timer. Qualifying tiling changes during hold update the
  current visual without starting the timer; focus/domain changes during hold
  may update or clear valid state but never start a timed flash. Fullscreen or
  any native maximize axis hides both the group visual and active border,
  including while Meta is held. Rust owns the group visibility policy.
- Held-before-first-public-signal source limitation: minimal state and no
  polling. Last modifier state is unknown until the first public
  `mouseChanged`; do not assume Meta held. The effect remains hidden for that
  missed initial-held edge.
- Renderer: the active `OutlinedBorderItem` is a negative-z child of its
  target `EffectWindow::windowItem()`; KWin's public `Item::setParentItem()`
  and `mapFromScene()` keep its geometry window-local. The target texture and
  later-stacked windows therefore occlude it through the normal item-tree and
  workspace stacking passes. The temporary group outline remains a
  screen-wide overlay because it is not tied to one window. No custom
  scene/rendering mechanism is selected. COSMIC renders group backdrops through
  its compositor-owned `BackdropShader` render-element path (source-content
  comparison only, no parity claim).
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
  fail closed without a watcher. The bridge is outbound state-snapshot based,
  reconnecting, idempotent, with no KWin executable allowlist, and has no
  shell, input, or helper-to-KWin action route. The KCM remains the settings
  owner.
- Snapshot publication requires the sender's unique D-Bus name to equal the
  current `org.kde.KWin` name owner. Owner loss or replacement clears the old
  snapshot; the tray remains available for the new owner's snapshot.
- The static bridge includes freshness and ordering/generation checks,
  idempotent notifications, and bounded watcher retry.
- Home Manager autostart uses the immutable store tray binary with the `tray`
  command; `TryExec` points to that same binary. Dev and dogfood start the
  worktree binary on demand. A second instance exits successfully when the
  D-Bus name is taken. The tray stops if its own name or connection is lost,
  or at session teardown; it does not restart automatically after a crash.
  Name acquisition/loss, owner transitions and changed or refused snapshots
  emit bounded, redacted diagnostics on stderr. The queryable autostart sink
  is best-effort native journald submission alongside retained stderr,
  queried with `journalctl --user -g "plasma-auto-tiler:route-diag component=tray-endpoint"`.
- The tray MVP provides basic status and Settings only. It has no direct tiling
  controls and no expansion of the helper boundary.
- No KWin snapshot authority is claimed from tray live runs. Tray live runs
  claim no visual panel behavior, no watcher-ordering/login-autostart delivery,
  no native ABI/plugin load, no baseline-restoration proof, and no KWin Script1
  identity or cleanup.
- The repaired candidate claimed no panel visual behavior or session boundary.
  No KWin-origin authoritative snapshot, watcher-ordering/login-autostart, or
  update/rollback generation claim is made from tray live runs.

## Production Interactive Edge Drag

- Production interactive drag share adjustment uses drop intent (user,
  2026-09-24). The script captures a fallback grabbed-edge classification from
  the pointer and starting frame at drag start; a matching native press in the
  later verdict takes precedence for KWin-thirds classification. No reliable
  KWin-reported grabbed-edge signal is available in the shipped route. Retile
  from the oracle's final window edge on each grabbed side, ignoring other edge
  changes from rounding, size increments, or a self-resizing client; corner
  drags use both axes. A cancelled verdict makes no resize plan; a moved verdict
  with no usable grabbed edge, no movement on grabbed edges, or lost identity
  does not route a resize. The strict opposite-edge-fixed rule is superseded.
- User accepted the Orchestrator's follow-up recommendations (2026-09-24): a
  completed pointer drag may resize an inactive tiled window without changing
  active, focused or remembered focus; keyboard resize and other operations
  retain their focus rules. On adapter or Planner rejection, converge to the
  retained layout with one bounded, drag-correlated reconcile, without retry
  or loop. Without a matching native modifier-resize press, a start well
  inside the window follows KWin's exact thirds (including its center
  branch); starts at the frame edge retain the nearest-edge and corner-zone
  rule.
- User-approved 2026-09-24: the unified native effect passively observes
  the configured modifier-resize button press without grabbing or consuming
  input. The passive input spy captures a candidate press first; the effect
  matches it to the same window and identity at drag start and carries it
  atomically with the final-geometry verdict. At reply, the script validates
  the finish identity and resize start before a usable press selects KWin
  6.7.5 thirds regardless of the 64 px interior gate; absent/unusable press
  evidence falls back to the Started-pointer classifier, with a bounded
  fallback log. The effective binding is read from KWin when public options
  are available; only an unavailable binding source uses and logs the KWin
  source default. The unified effect and existing oracle endpoint retain
  their identities.
- User-approved interim move-drop rule, 2026-09-24: a tiled window moved
  interactively suppresses ordinary reconcile during the gesture, then
  converges to its retained layout on drop through one correlated, coalesced
  restore marker, with no failed-dispatch retry. Floating moves remain
  native-only. Drag-and-drop reorganisation is a separate later backlog item.
- The drag oracle hosted in the disabled-by-default unified
  `plasma-auto-tiler-active-border` native effect records final drag geometry;
  after that effect's explicit enable, the production script pulls its
  read-only session D-Bus verdict. A non-cancelled resize can route grabbed
  edges through `pointer-resize` shares; a tiled move instead restores its
  retained layout on drop, while a floating move stays native-only. A
  cancelled or no-change verdict makes no pointer-resize plan. No stock-KWin
  parity or atomic native geometry-write claim is selected. AR8 closed on
  2026-09-24 at the user's request with the shipped oracle integration kept,
  following the Lead's recommendation; trace-only measurement remains for
  drag diagnosis.

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
  The pilot remained disabled by default and had no session boundary, config,
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
