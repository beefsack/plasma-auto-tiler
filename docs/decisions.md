# Current Decisions

Only active, user-approved product and project choices are recorded here.
Historical implementation detail is recoverable in Git history.

## Windows Port

User decisions 2026-09-30. These select goals and sequencing, not untested
Windows API behavior; see [Windows plan](research/windows-port/plan.md).

- Support Windows 11 x64 only initially; this can be revisited.
- Managed per-monitor workspaces are required before Windows or macOS is
  called feature-complete. Tiling-only development previews are allowed.
- User decision 2026-10-01, option A: Meta/Win shortcuts are defaults across
  platforms, matching KDE: Win+Arrow navigates focus and Win+Shift+Arrow moves
  windows. Windows takes over native Snap shortcuts by default, with a visible
  setting to turn takeover off, following KDE Apply/Revert behavior.
  Product input mechanism (user-accepted 2026-10-01 on this PC):
  `WH_KEYBOARD_LL` with `vkE8` menu-mask at Win key-up while Win held,
  consuming only approved catalog chords; `RegisterHotKey` rejected after
  all four chords returned 1409 (owner unknown) on this PC. Win+L stays
  explicit opt-in only and remains unproven. Evidence in
  [Phase 1 note](changes/windows-phase1-implementation.md).
- While a workspace is tiled, prevent Windows Snap through both keyboard and
  mouse paths (edge dragging, Snap Layouts and shake as relevant). Keyboard
  prevention belongs to the shortcut slice using the selected LL hook. User
  decision 2026-10-01: try mouse option A first in that slice, session-only
  `SPI_SETWINARRANGING FALSE` while tiling is active, with visible Apply/Revert,
  exact preimage capture/readback and conditional restoration on stop. The
  desktop-wide effect is accepted for the experiment; Windows 11 Snap Layouts
  flyout/Snap Assist coverage remains to be proven. Snap prevention does not
  block the tiling-only preview.
- Experiment with custom drawing and a real group underlay, including Task
  View and Alt+Tab behavior. Windows now uses the owned layered custom-drawing
  carrier for the filled underlay; an outline fallback remains acceptable if
  that mechanism proves unworkable.
- Windows distribution should be the most obvious and unsurprising for users.
  Store availability alongside manual installation is research scope, not a
  selected package or update channel.
- Develop directly on the Windows 11 PC, not a VM. Keep the NixOS/Linux flow
  intact; account for the PC also serving as the KDE multi-output test host.
- User decision 2026-09-30, option A: pre-1.0 track latest stable Rust and
  fix breakage. Windows uses rustup stable default with rustfmt/clippy, no
  directory override and no `rust-toolchain.toml`. Linux and existing Linux
  CI take Rust from the regularly bumped nixpkgs pin in `devenv.yaml`.
  Revisit the upgrade process at 1.0.
- Elevated (administrator) windows stay unmanaged by default: they float at
  their native position while other windows keep tiling. A future opt-in
  where the user chooses to run the tiler elevated may be considered; it is
  not a sensible default now.
- Approved route (user 2026-09-30): one normal single per-user/session
  `tiler-windows` executable with standalone stop/restore, public hide/reveal,
  owned disposable test binary, completed `RegisterHotKey` vs `WH_KEYBOARD_LL`
  comparison (hook selected, registration rejected), proof order offline then
  Sandbox clean/lifecycle then owned hide/crash-restore then physical repeat
  then physical input. Lifecycle/recovery plus input proof accepted on this
  single-display PC; Engine-driven tiling and the focus/move shortcut preview
  now have automated native evidence. Managed Windows workspaces also have
  automated native evidence (2026-10-02);
  physical shortcut acceptance remains pending. Scoped native Settings UI
  Apply/Revert proof passed on 2026-10-04; physical feel stays user-owned.
- Sandbox closed 2026-09-30 (user dismissed the WM_CLOSE close confirmation;
  no Sandbox processes remain): Phase 1-3 live proof runs on the physical
  desktop with owned disposable windows first; Sandbox is deferred to Phase 4
  clean-install/runtime plus Win+L guest-only policy. Clean runtime stays
  pending (static CRT/OS imports are supporting, not proof). Route detail stays
  in [Windows plan](research/windows-port/plan.md); preflight hashes and the
  removed `target/sandbox-preflight/` payload record stay in
  [Phase 1 note](changes/windows-phase1-implementation.md).
- Accepted baseline (user 2026-09-30, this dev PC): one Gigabyte M27Q only
  (see [runbook](windows-dev-environment.md)); Windows multi-monitor moves to the
  user's other Win11 PC. Historical KDE multi-output host assertions are unchanged.
- User decisions 2026-10-02 (Windows managed workspaces): public `SW_HIDE`
  with nonactivating reveal is approved, preferring official APIs; a simple
  same-executable watcher is approved, the user is wary of complexity so no
  added machinery. Default is per-output-local with KDE parity: Win+1..9 select
  existing workspaces only, Win+Shift+1..9 send only the focused tiled window
  and follow after verified transfer, `0` reuses or creates the trailing empty.
  E8 prime plus `AttachThreadInput` plus exact foreground readback is the
  approved focus mechanism. Session-only `SPI_SETWINARRANGING` prevention is
  approved; on Win11 build 26200 disabling via pvParam FALSE requires uiParam
  TRUE. Automation commands are welcome only as needed, not the primary route.
  Terminal is ordinary by default with no product special-case. Current CLI is
  `workspace --select N` / `workspace --send N` (existing/trailing) and opt-in tile
  `--scope-exe`/`--scope-host-child` proof fences with no default filtering.
  Recovery ledger v4 stores min/max show-state without geometry; readers accept
  v1-v3. The window-lifetime membership property is inert, remains until window
  destruction, and is distrusted/replaced on the next run.
- User decision 2026-10-02, option A (Windows minimum sizes): query fresh
  application-declared minimum track sizes and supply visible-frame physical-
  pixel hints to the existing shared minimum-aware projection. No learning;
  generic learned limits remain parked. Match KDE when infeasible: retain
  proportional allocation, flag overconstrained leaves and skip their writes;
  overlap is possible, with no fighting. Failed, timed-out or invalid native
  queries supply no hint. Keep existing refused-attempt suppression.
- macOS decisions (version floor, App Store, shortcut consent, updates, UI
  language) are deferred until macOS spiking starts.
- User direction 2026-10-03 (macOS approach): prefer the lower-level,
  lower-jank route first (yabai-style), since it may help window effects and
  clean workspaces, accepting that it may not run in locked-down
  environments. An optional higher-level public-API route (AeroSpace-style,
  e.g. off-screen parking) may be evaluated later as a configurable
  alternative. User decision 2026-10-03: default to tier 2, public plus
  private APIs with SIP left enabled (AeroSpace / yabai-without-scripting-
  addition class); no Dock injection or reduced SIP. Re-evaluate deeper
  tiers only if tier 2 cannot solve a problem well.
- User decision 2026-10-03 (dev environments): adopt a single root
  `mise.toml` for Windows and macOS toolchains (for example Rust via rustup
  stable and `just`), run from the project root; OS-specific entries stay in
  that root file rather than child directories. devenv/Nix stays the source
  on Linux/NixOS, including system libraries. Minimal `AGENTS.md` changes
  needed to allow this are approved; avoid bloat.
- Implemented dev route (2026-10-03): root `mise.toml` declares stable Rust
  via rustup with rustfmt/clippy and just/jq/gh/ripgrep on Windows/macOS;
  yq is Windows-only (the approved macOS inventory does not include it).
  Use root-run `mise trust`, `mise install` and `mise exec -- <command>`.
  Git, MSVC/SDK, Xcode/CLT and host shell bootstrap remain manual;
  installations remain user-owned. Mise selects Rust through process-local
  `RUSTUP_TOOLCHAIN`, without a persisted directory override or toolchain file.
- Provisional, to discuss (2026-10-03, dev tool versions): CLI selectors are
  `latest`, Rust is `stable`, and no `mise.lock` is committed. This keeps the
  initial route small; installs are rolling rather than reproducible pins.
- Provisional, to discuss (2026-10-03, dev environment CI): verify mise installs
  and tool/host/component smoke checks on Windows and macOS 15 arm64, retaining
  Windows Cargo gates. No exact mise/Nix equality gate: rolling selectors are
  not shared exact pins, and Linux Rust/CLIs follow the `devenv.yaml` nixpkgs
  revision. A mismatch with rolling stable is permitted by the Rust policy.
- Reference implementations cloned locally by the user (2026-10-03) under
  `~/Development`: macOS AeroSpace, yabai, Amethyst; Windows glazewm (Rust),
  komorebi; Linux cosmic-comp, Hyprland, i3, bspwm, qtile, PaperWM, xmonad.
  cosmic-comp is the user's favourite tiling UX (n-ary splits, windows
  joining and leaving splits) and is a key input to the functional spec.

### Windows settings

- Windows parity item 11 (2026-10-04): validated version-1 JSON settings persist
  in `%LOCALAPPDATA%\plasma-auto-tiler\settings.json`. Normal owners read them at
  startup and poll on the existing pump for live gaps, border/underlay, keyboard
  bindings/takeover and mouse Snap prevention. Proof owners stay isolated;
  explicit normal CLI switches remain authoritative for their settings fields.
  Malformed live files keep last-good state with degraded diagnostics.
- Apply validates and atomically saves; Revert discards unsaved edits and reloads
  the saved file, without undoing prior Apply. Close never saves. The UI separates
  saved/adopted configuration from native-effect proof; mouse prevention uses
  existing session-only preimage/readback/conditional restoration, no policy.
- Provisional, to discuss: use plain official Win32 controls through the existing
  Rust `windows-sys` dependency, with `tiler-windows settings` and
  `just --justfile windows.justfile settings`, plus the running owner's tray.
  UI instances are single per user/session; external stale edits
  trigger reload/refusal. The file store and existing-pump polling are the small
  Windows analogue of KDE's existing config/reconfigure route.
- Provisional, to discuss: default Windows border to system accent/theme on,
  with KDE configured `#2a82da` fallback, replacing the temporary yellow default.
  Configured colour wins when theme is off or no usable accent is available.
- Provisional, to discuss (updated 2026-10-04): normal startup with no settings
  file offers a native Yes=Authentic (default), No=Compatible prompt, briefly
  explaining Win+G/F11 Game Bar/Xbox implications. The owner lease precedes UI;
  atomic create-if-absent publication never replaces a file appearing during
  the prompt. Both presets remain prominently available in Settings.
  Compatible resets to the default catalog then disables 35 OS-conflicting
  physical chords, including Win+G/F11; it invents no replacement defaults.
- Per-binding Keep/Disable/Rebind is available for implemented actions, with
  separate directional letter/arrow rows and actual rebound-chord conflicts.
  Win+G/F11 explicitly show incomplete containment, Win+L keeps explicit opt-in,
  and undocumented chords do not claim conflict-free certainty.
- Provisional, to discuss: this first slice limits manual rebinds to Win plus
  the action's existing Shift arm; Alt/Ctrl and unshifted Win+L rebind targets
  refuse. Keyboard resize rows are visibly unavailable; the additional
  global-unique/shared workspace mappings await runtime implementation.
- Synthetic native UI/Apply/Revert, live geometry/border/SPI and cleanup proof
  passed; physical shortcut/Snap/Xbox and other DPI/output checks stay user-owned.
  Evidence and limitations: [Windows settings](changes/archive/windows-settings.md).

### Windows tray and first-run follow-up

- Provisional, to discuss (2026-10-04): the normal running owner owns one
  official `Shell_NotifyIconW` icon. Both clicks open its menu: optional top
  "Conflicting Windows settings...", disabled live status, current-workspace
  tiling, new-workspace Tiled/Floating default, Settings and Stop.
  Settings and the conflict row open the existing singleton UI; Stop follows
  ordinary owner teardown. Explorer may initially place the icon in overflow.
- Provisional, to discuss: an amber warning overlay and conflict row identify
  enabled effective Win+G/F11 chords with known incomplete containment, plus
  kept Win+L when runtime opt-in allows the unreliable lock override. Disable,
  rebind-away, compatible or keyboard takeover off clears the warning; other
  unproven chords do not gain a claim of proven containment from its absence.
- Workspace tiling/floating and new-workspace default controls shipped with
  the runtime below. The taskbar workspace indicator remains parked separately.
- One stable icon GUID supports graceful deletion and dead-owner cleanup under
  the existing recovery lease. TaskbarCreated revalidates a surviving icon or
  re-adds a missing one; proof owners do not create a tray or first-run prompt.
- Provisional, to discuss: the own-executable Settings control window is
  unmanaged through existing dialog gates, preserving its fixed-size controls
  under an unfiltered owner. Other applications are unaffected by that test.
- Synthetic/native live proof covers both presets, stale-choice refusal, both
  menu buttons, usable Settings/Apply, warning changes, Stop, posted
  TaskbarCreated and crash recovery. Real Explorer restart, physical input and
  other DPI/output arrangements remain user-owned. Evidence:
  [Windows tray and first run](changes/archive/windows-tray-first-run.md).

### Windows workspace tiling mode

- KDE parity (2026-10-04): each managed workspace owns a session-local tiled/
  floating flag. Startup seeds all workspaces from saved `defaultTiled=true`;
  live default changes seed only subsequently created workspaces. Overrides
  reset on owner restart and never persist. The tray shows a current-workspace
  checkbox and new-workspace default choices; Settings exposes the same default.
  There is no keyboard binding: KDE's tray action has an empty key sequence.
- Subject to the first-seen-maximized admission limitation below, floating
  preserves native frames, membership and hide/reveal while stopping
  domain tiling, directional tile navigation, group underlay and drop preview.
  Independent active border remains. Retile releases the exact shared Engine
  domain without writes, then freshly adopts observed geometry with the existing
  recursive-cut/centre-split fit. Intentional per-window float/sticky and native
  maximize/fullscreen exceptions keep their semantics; exact-lifetime float
  intent survives Engine domain release. Mode flips cancel stale gesture effects.
- Sends touching a floating workspace use project membership transfer and the
  existing verified follow path, without a two-domain Engine plan. Only the
  tiled side reconciles: source survivors before hide/follow, or destination
  fresh admission after reveal. Floating-side frames remain untouched. Sticky
  movers refuse, and intentional floats on tiled sources remain ineligible.
- Provisional, to discuss: store KDE's `defaultTiled` equivalent as
  `core.workspace.default_tiled` in the existing version-1 Windows JSON settings;
  older settings backfill true. Tray picks update only that saved field through
  the existing store; settings polling confirms runtime adoption.
- Provisional, to discuss: extend the existing exact-owner automation transport
  with `workspace --send N`, acting on fresh foreground managed focus through
  the normal send path. It is needed for automated boundary proof because normal
  owners deliberately reject injected shortcut input. Dispatch acknowledgement
  alone is not effect proof; ordinary keyboard bindings remain the user route.
- Native locked gates and scoped Notepad/Calculator/Paint synthetic/native
  effect proof pass, including both boundary sends, fresh retile, active drag
  effects and default creation/startup. Physical feel and other output/DPI
  arrangements remain user-owned. Evidence:
  [Windows workspace tiling](changes/windows-workspace-tiling.md).
- Known limitation (2026-10-04, user-authorized fallback after three failed
  corrections): first-seen maximized windows can be restored prematurely while
  their workspace is floating. The admission-clear path runs before the
  workspace-mode gate in implementation `90ee5c2`. KDE skips that clear on a
  floating domain, then restores an unslotted maximum once on tiled admission;
  previously slotted overlays skip re-clear and restore through normal tiling.
  KDE source: `kwin/src/plan-adapter.ts:4905-4909,5213-5216,5351-5418`.
  The rejected Windows candidates preserve floating geometry/membership but
  fail actual fresh tiled admission after retile because temporary Engine float
  state remains latched. All unaccepted source/test changes were discarded;
  neither those holds nor their attempted release fix are shipped. This is a
  recorded defect, not a selected behavior divergence. The change record remains
  active and matrix row R-MAX-03 records the missing parity. No further attempt
  is authorized in this unit.

## Cross-Platform Behavior

- User direction 2026-10-03: the [reference-WM outcome matrix](spec/reference-outcomes.md)
  records minimal action sequences and per-WM outcomes as the evidence source of
  truth feeding the cross-platform functional specification. Existing selections
  remain authoritative; reference outcomes become supported variants only when
  explicitly selected, with user-settable configuration where applicable.
- Provisional, to discuss (2026-10-03, matrix format): one Markdown document,
  tables by area, stable row IDs, precise starts/actions/observations, six outcome
  columns (COSMIC, Hyprland, bspwm, i3, xmonad, KDE/Windows), and variant hooks.
- Provisional, to discuss (2026-10-03, matrix evidence): compact cell citation
  keys resolve to dated user tests, pinned source file/line ranges or linked
  documentation; missing outcomes remain TBD, and tested versions are never
  inferred from later source checkouts.
- Matrix maintenance: reuse existing scenarios; for each uncovered ambiguity,
  add the shortest discriminating action sequence. Read source where confident;
  otherwise leave the outcome for the user's later test. Variant hook names are
  provisional indexing, not new product or settings commitments.
- User decision 2026-10-01: keyboard bindings and window/workspace behavior
  must be consistent across Linux, Windows and macOS so workflows transfer.
  Meta+Arrow navigates focus; Meta+Shift+Arrow moves windows. The KDE shortcut
  catalog and behavior are the reference until a shared functional
  specification exists. macOS modifier mapping is decided when macOS starts.
  Meta/Win shortcuts are defaults; Windows Snap takeover has a visible off
  setting with Apply/Revert parity. macOS modifier mapping remains deferred.
- The initial Windows tiling-only preview left geometry in place on stop/crash.
  The current Windows slice adds focus/move shortcuts and managed workspaces:
  hidden windows are revealed on stop/crash without geometry recovery. Terminal
  has ordinary application behavior, matching KDE. See
  [managed workspaces](changes/archive/windows-managed-workspaces.md).
- User decision 2026-10-03 (OS shortcut conflicts, all platforms): a
  per-binding conflict list is the model. Settings show each binding that
  conflicts with an OS/desktop shortcut and let the user keep (override),
  disable or rebind it. Quick-set presets apply in one step: "compatible"
  (avoid conflicting OS bindings) and "authentic" (stay consistent with
  tiling WMs such as COSMIC/Hyprland and override OS bindings). The preset
  choice may be offered on first run. Applies to KDE, Windows and macOS.
- Windows defaults to authentic mode, with compatible now available in Settings:
  authentic is the user's preferred mode and the harder one to implement.
  Owned-chord interception is independent of foreground/action eligibility;
  unmanaged foreground and ordinary fullscreen suspension do not release those
  shortcuts to Windows. Native actions still require the existing owner safety
  checks. This correction is offline-verified; physical suppression and Xbox-mode
  detection remain pending in [gaming coexistence](changes/windows-gaming-coexistence.md).
  Follow-up live evidence (2026-10-03) observed an Xbox-mode prompt after a
  current, hash-attributed marked F11 tap with consumed down/up and successful
  mask send. Callback consumption is not an OS-suppression acceptance signal.
  Keep the authentic catalog and documented-API constraint; a mechanism or
  architecture change, or registry/policy workaround, needs a user decision.
  Bounded continuation (2026-10-03): a later project-hook install with gaming
  components already running still produced the Xbox prompt within two seconds
  of consumed marked F11; G was withheld on first leak. Containment part (a)
  is parked, with no catalog exception selected. Microsoft's Win-key-swallowing
  hook sample explicitly excludes Game Bar hotkeys, but does not establish
  impossibility of consuming G/F11. User-applied Xbox-mode settings or accepting
  the gap are pending choices; Game Bar keyboard-disable controls remain
  unverified. Callback consumption and process-start order remain insufficient
  suppression/hook-order evidence. The unaccepted large gaming fixture draft
  was discarded under the simplicity principle; the active record owns options
  and accepted evidence.
- Coexisting with gaming is a core goal: provide some alternate access to
  OS gaming surfaces displaced by authentic bindings (Windows Game Bar,
  displaced by Win+G), and avoid behavior that anti-cheat software could
  flag as a false positive.
- User decision 2026-10-03 (Windows "Xbox mode", the Xbox full screen
  experience): when detected, pause tiling, window effects (border/underlay)
  and shortcut handling, while remembering windows and workspaces so they
  are restored when Xbox mode ends. Detection uses a documented Microsoft
  signal only, no cloak/foreground heuristics (user 2026-10-03); automatic
  pause stays unimplemented until such a signal exists.
- Alternate Game Bar access for keyboard and mouse players (a shortcut over
  a fullscreen game) is a later experiment, after parity and correctness
  work (user 2026-10-03).
- User statement 2026-10-03: default split placement is long-edge based: a
  tall target splits vertically (stacked) and a wide target horizontally
  (side by side), including windows arriving by workspace send.
- Workspace send resolves the valid remembered destination leaf, then valid
  destination focus history, before the genuine no-focus root fallback.
  Minimum hints influence the projected target rectangle and final allocation;
  they do not search alternative axes or targets for feasibility. The shared
  Engine applies this on KDE and Windows. See
  [send-axis evidence](changes/archive/windows-send-split-axis.md).
- Provisional, to discuss (2026-10-03, Windows placement dogfood): fresh startup
  preserves clean/tolerance-valid recursive-cut adoption, but declines any fit
  requiring centre splits to the existing deterministic sequential long-edge
  seed. Minimum-infeasible clean fits use the same fallback. This supersedes
  the overlapping centre-fit default below on KDE and Windows together; no
  topology search or guaranteed balanced 2x2 is selected. Clean previously
  tiled 2x2/nested layouts retain their fit and identity order.
- Provisional, to discuss (2026-10-03, Windows infeasible minimums): writable
  admitted windows are placed at the proportional tile's origin with each
  native extent at least its declared minimum, rather than skipped while their
  tile space is reserved. Equality/readback/refusal use that effective target.
  This supersedes Windows' 2026-10-02 overconstrained skip decision; KDE's
  current adapter still skips such writes. Oversized windows may overlap
  siblings or extend beyond the work area when the sequential seed cannot fit;
  no alternative-axis search, floating fallback or global optimizer is selected.
  Evidence: [placement correctness](changes/archive/windows-placement-correctness.md).
- Provisional, to discuss (2026-10-03, retained Windows overlay minimums):
  tiled maximized/fullscreen members retain their last-known declared minimum
  hints, bound to the member's lifetime token and canonical slot, until normal
  fresh queries resume. This keeps minimum-bound sibling allocations stable;
  floating/born-slotless, minimized and cloaked rows do not reuse hints.
  A successful asynchronous Win+M restore dispatch arms a two-second bounded
  completion wake on the existing 100ms pump. It reconciles once restore is
  observed, preserving dispatch/gesture/suspend gates and single-attempt toggles.

## Cross-Platform Core

- User decision 2026-09-30: portable core extraction is the immediate priority
  and precedes Windows implementation. Do it under KDE first, with KWin
  fixtures and applicable live checks establishing no regressions. Windows
  visibility evidence must inform the later workspace-model shape. The
  KDE-first phase stops before the logical workspace model (user
  2026-09-30); its core shape is refined during Windows spiking, then
  extracted with matching KWin fixtures.
- User decision 2026-09-30: the KDE-first extraction ends at K1 (visual
  policy in `tiler-core::visual`). K2 settings/action intent and K3
  difference classification stay in the KWin script, because sharing them
  needs a new JS-to-Rust route; they are revisited when the Windows port
  needs a shared contract. Next: Windows spikes.

## Architecture Direction

User-approved 2026-09-24 from the
[architecture review](research/architecture-review/review.md). Entries
elsewhere in this file that conflict remain accurate for shipped code until
the corresponding item ships; each such entry names its replacement.

- Observed-membership convergence (user decision 2026-09-25; Orchestrator scope
  2026-09-25; step-2 go-ahead 2026-09-25; steps 1-2 shipped offline, live
  acceptance pending; evidence in
  [observation-convergence](changes/archive/observation-convergence.md)):
  each complete per-domain observation controls portable membership and
  floating state before ordinary Engine operations. One Session convergence
  preserves surviving topology, removes absent members, normally admits
  newcomers and adopts floating transitions; the requested operation then runs
  at the converged revision. No sequence, world index, fingerprint extension,
  tombstone, retention marker, or wholesale reseed is added. Only the existing
  wire `floating` and advisory `fit_excluded` are in scope; sticky/all-desktops
  uses KWin's existing floating mapping, while fullscreen and maximized members
  keep their tiled allocations as native overlays. KWin carries current
  post-removal observations and quarantines incomplete foreground frames.
  Automatic foreground and hidden tiling send complete observations through
  `reconcile`; the applied membership baseline and public admit/remove wire
  commands are retired. Fresh observations keep deterministic fitting and
  admission placement. Step-2 relocation rule (Orchestrator): a unique
  same-workspace source relocates only when the new observation shares a
  retained tiled or floating-exception id; disjoint and ambiguous sources seed
  fresh. Exact overlapping relocation retains its skew/rollback fence. Step 3
  retired the former pending-pair fresh-domain delay and send/R4 verification
  protocol.
- Robust difference reconciliation (user decision 2026-09-28; phase 1
  offline-verified): KWin compares complete foreground and hidden observations
  against applied evidence through one event-driven classifier. Existing signals,
  commands and terminal flights wake fresh observation; no idle polling. The
  script retains its overlay slots, hidden sticky multi-home exception,
  initial-fullscreen hold, explicit hidden empty and unreadable-domain fences,
  echo/interactive suppression, send/R4 force and single-flight follow. Existing
  Rust `reconcile`/`update-gaps` handles changes; the interim three-strike
  acceptance remains. Phase 2 waits for user testing of phase 1: learn size
  limits only from settled repeatable evidence, replan neighbours around learned
  limits only, and leave native maximum behavior unchanged. Scope is KWin script
  and Rust tiling; native effect unchanged. Added complexity must deliver more
  value than it costs. Offline evidence in
  [robust-difference-reconciliation](changes/archive/robust-difference-reconciliation.md).
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
  overconstrained members are not reasserted; R4 exempts their client-held
  geometry from native writes while fencing identity and membership.
- Size caps (AR16, shipped offline): the 64-window and 16-domain count caps are
  retired. The codec rejects requests above 1 MiB; the KWin adapter mirrors
  this bound before dispatch. Separate reply, native/FFI, and field bounds remain.
- Workspace send (step 3, user decision 2026-09-25, shipped offline; live
  acceptance pending): Engine immediately commits planned topology after
  complete source/target observation; KWin writes native geometry then
  membership, follows on fresh exact arrival, and forces complete
  source/target reconciliation on every terminal flight. Per the
  Orchestrator's portable-flag scope, both send observations retain flagged
  source/target survivors; only `floating` and `fit_excluded` cross the wire,
  while fullscreen/maximized remain local retained-tile overlays. A flag-only
  change in either domain stales the reply before native writes. No pending
  transaction, native verified-success claim, Plan block, or setter replay.
- Settings (AR15, unified offline; user decision 2026-09-28, option B): one
  settings page combines border, explicit shortcut overrides, tiling gaps and
  `workspaceMode`. Saving changed gaps requests KWin reconfigure and the
  running controller re-reads validated gaps for debounced retained
  `update-gaps`; the request alone does not confirm application.
  `workspaceMode` remains startup-only with a session-restart note. Per the
  user's 2026-09-25 decision, `shortcutProfile` is hidden until distinct
  profiles exist post-MVP; its saved value and startup read remain untouched.
  Storage remains in the existing `kwinrc` groups. The script KPackage still
  needs the host-built native KCM companion for Configure; the effect need not
  be enabled. Gap Save live re-spacing and unified-page acceptance confirmed
  live by the user (2026-09-29).
- Host setting conflicts (user decision 2026-09-29; offline implementation,
  Fix confirmed live 2026-09-29, Revert/tray-indicator acceptance pending):
  the unified settings page reads `kwinrc [Windows]` `ElectricBorderTiling`,
  `ElectricBorderMaximize`, and `ElectricBorders` on open, showing current
  values with short explanations. The boolean rows are always visible: Fix
  writes `false` when on; Revert removes the local key
  when off so the KDE 6.7.5 default `true` takes effect. The `ElectricBorders`
  row appears only when nonzero: its sole Fix removes the local key so default
  `0` takes effect. No prior-value journal or change ownership is tracked.
  Explicit KConfig changes send KWin reconfigure and read back effective
  config; a failed write or send is shown/logged, and a queued send does not
  prove that the running compositor applied the value.
  Startup and ordinary settings Save never change these host keys. Existing
  shortcut Apply/Force/Revert remains the sole key-binding correction flow.
  User decision 2026-09-29, option A: host conflicts add a warning overlay to
  the tray icon and a top menu row, "Conflicting KDE settings...", opening the
  existing unified Settings page. Left-click keeps opening the tray menu, and
  snapshot loss keeps its separate NeedsAttention status. No notification or
  direct Settings-on-icon-click. The user wants uninstall to restore defaults
  for our overridden host settings; the route-specific mechanism without
  tracking is still unselected, and no
  uninstall reset is implemented. Stateless uninstall would also reset a
  user-made value that equals our fix value.
- Threat model (AR13, shipped offline): processes of the same user are trusted.
  The tray has no KWin executable allowlist or `/proc`/pidfd/inode binding;
  it runs single-instance by owning its D-Bus name with `DoNotQueue` and
  accepts snapshots only from the current `org.kde.KWin` owner. Home Manager
  delivers it through a graphical-session systemd user unit; dev and dogfood
  launch it on demand with `cargo run -p plasma-auto-tiler -- tray`. The
  Planner same-UID caller check remains. Live login and watcher acceptance
  remain pending.
- Tray workspace behavior (user 2026-09-29, offline implementation;
  floating/tiled toggle confirmed live 2026-09-29, default change and
  cross-boundary send pending): clicking the tray icon opens its menu with
  current workspace tiling, new-workspace behavior Tiled/Floating, and
  Settings for the existing unified page. The existing disabled status row
  may remain. The keyless KWin script action is invoked by the tray through
  KGlobalAccel; invoking it does not confirm application, so the menu reflects
  fresh KWin-owned snapshots. The tray writes only `defaultTiled` (Tiled by
  default) in `kwinrc [Script-plasma-auto-tiler-kwin]` and requests KWin
  reconfigure;
  only a running KWin reread/snapshot confirms its live value. All existing
  workspaces take the saved default at new-session startup, while a live
  default change applies only to subsequently discovered workspaces.
  Orchestrator defaults approved by the user: per-workspace overrides are
  session-only in the KWin backing-desktop mapping and reset on script reload;
  shared mode toggles the backing workspace across outputs. Floating leaves
  native windows in place and stops domain tiling/underlay management; the
  active border stays independent. An explicit no-write Planner domain release
  precedes fresh recursive-cut/centre-split adoption on retiling. Sends across
  a floating boundary move native desktop membership without a Rust two-domain
  tiling plan; only the tiled side reflows. No per-workspace history persists.
  Evidence and residual live steps: [tray workspace toggle](changes/archive/tray-workspace-toggle.md).
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
  2026-09-21 and additionally requires the Meta-held group visual to hide
  while maximized: neither visual may be visible.
- User decision 2026-09-29: hide the native active border when the active
  window is an applet popup (`EffectWindow::isAppletPopup()`), restoring it on
  ordinary focus. This is a first step; tighten other window-type exclusions
  only if live use shows a need. KRunner is out of scope for now.
- Effect observation seeds every window on load and addition from its committed
  native maximize mode; any maximize axis or fullscreen suppresses both
  visuals, and native transition signals remain authoritative (Orchestrator
  decision applying user-approved AR9: an unacknowledged Wayland maximize
  configure still renders normal, so the committed normal seed reflects that
  geometry; acknowledgement emits the observed maximize signal. Requested mode
  is never guessed; no polling, timers, or geometry heuristics).
- Approved 2026-09-21: the Slice 1 drag oracle is folded into the surviving
  `plasma-auto-tiler-active-border` effect plugin (one exported effect hosting
  active border, group overlay, and drag oracle); no second
  `plasma-auto-tiler-drag-oracle` effect, factory, metadata, or KCM entry remains.
- The outline never clips, reshapes, or changes window textures. Plasma 6.5+
  decoration-driven rounded corners remain the selected corner solution.
- The active border retains one effect-owned automatic-lifetime
  `KWin::OutlinedBorderItem`, without texture changes or clipping. User decision
  2026-09-28: replace the temporary Meta-held group outline with a filled
  underlay beneath its windows, extending beyond the border outer edge by a
  configurable size defaulting to the current border width. Colour (including
  alpha) is configurable; Orchestrator default `#40808080` (translucent grey).
  The drop-target preview colour also becomes configurable with alpha, retaining
  its `#402a82da` default. All new keys live in the existing effect group and
  hot-apply through effect reconfigure; existing keys/defaults are unchanged.

### Windows active border

- Orchestrator decision 2026-10-02: default-on owned per-pixel-alpha layered,
  click-through, nonactivating tool-window surface. Do not mutate foreign
  window attributes. `DWMWA_BORDER_COLOR` controls colour only and cannot
  provide KDE's configurable thickness/gap; the visible-frame thickness
  attribute is Get-only. Use `tiler-core::visual` policy, KDE defaults
  (width 3.0, gap/radius 0.0) and target-DPI rounding. The border follows
  eligible active windows independently of tiling/floating membership, within
  the adapter's scope/identity fences, with maximize/fullscreen/minimize,
  hidden-workspace and targeted shell suppression.
- Place the surface immediately below the fresh target in the target's
  topmost/normal band, matching KWin's target-parented outline at Z=-1.
  Reconcile actual visibility, geometry and z-order even when cached drawing
  inputs are unchanged. DWM shadows can tint the composed ring; do not claim
  that DIB RGB equals final screen RGB. Owned-surface creation, alpha drawing,
   placement, hiding and teardown also carry the Windows group underlay below.
- Theme mapping selected for user review: KDE uses the active Selection
  background from `KColorScheme` (desktop highlight). Windows uses the official
  [`DwmGetColorizationColor`](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetcolorizationcolor)
  system colourization/accent analogue, with the core availability/positive-
   alpha gate and configured fallback. The owned window flags a
   requery on `WM_DWMCOLORIZATIONCOLORCHANGED` or `WM_SETTINGCHANGE`; repaint
   only if the resolved colour changes. Provisional, to discuss (settings slice,
   2026-10-04): default theme/accent on with configured `#2a82da` fallback,
   superseding the temporary 2026-10-02 yellow/theme-off development default.
   `--active-border-theme` selects accent;
   `--no-active-border-theme` selects configured colour.
   `--no-active-border` disables the surface.
- Scoped machine evidence on Windows 11 build 26200, one 2560x1440 display at
  DPI 120, covers composed owned-ring pixels, focus, real directional/workspace
  routes, synthetic move/resize, suppression/restore, ordinary approved apps,
  shell journeys, off and graceful/crash cleanup. Physical display/input,
  other DPI/output arrangements and topmost/style variants remain bounded
  follow-up checks. Evidence and limitations:
   `changes/archive/windows-active-border.md`.

### Windows group underlay

- User decision 2026-10-02, accepted for now: implement stages A/B of
  `changes/group-underlay-move-trigger.md` on Windows. Show for Win+Shift hold
  (both required, either order, extra modifiers allowed) OR a matching focused
  native title-bar interactive move. Win alone and resize alone do not trigger;
  the chord independently works during resize. End/cancel/removal clears the
  move arm; held chord is independent. The trigger is hard-coded with shared
  portable policy in `tiler-core::visual`; KDE's current Meta-held behaviour
  is unchanged. Win+drag movement itself belongs to parity item 7, which can
  supply the same move arm later.
- Use an enabled-by-default filled, premultiplied-alpha, layered click-through
  nonactivating tool window on the active-border carrier. KDE defaults:
  `#40808080`, extension -1 follows border width; explicit extension 0..32
  logical pixels matches the KDE settings range. CLI mirrors only enable,
  colour and extension: `--no-group-underlay`, `--group-underlay-color #aarrggbb`,
  `--group-underlay-extension N`. No foreign-window attributes are changed.
- Query the focused tiled window's immediate-parent group through Engine
  `ActiveGroup` and the shared resolver/description, using the actual eligible
  managed foreground. Render the union of Engine-projected source rectangles,
  expanded by gap, border width and resolved extension, even while the live
  dragged frame moves. Hide unavailable/root-leaf/floating, minimised, maximised
  and fullscreen subjects. Existing pending/drag-residue gates fail closed;
  Win32 interactive movement pauses reconciliation without adding core residue.
- Anchor beneath the lowest visible, nonminimised/noncloaked managed member and
  the visible active-border surface, matching KDE underlay Z=-2 versus border
  Z=-1. Recheck actual surface geometry/visibility/stacking at refresh even when
  cached inputs match; repair above-anchor displacement. Sample chord levels
  at the existing 100ms pump and wake on transitions, without a new input hook.
  Move/resize classification samples bounded `WM_NCHITTEST` at START delivery;
  timeout, unknown/custom-client hit zones and keyboard-only moves do not
  trigger the move arm. The chord remains available.
- C is parked under the authorized simplicity checkpoint: a distinct unfocused
  dragged subject needs new Engine resolution and invalidation lifetime.
  Never substitute that subject into `focused_window`, which persists retained
  focus. Native activation from an unfocused title bar remains a physical check;
  a future movement producer should reassess the need for C.
- Scoped synthetic evidence on Windows 11 build 26200, DPI 120, covers chord
  combinations/releases, projected footprint and native stacking, alpha blend,
  title-bar move/drop/cancel, brief chord handoff, resize exclusion, maximise,
  root leaf, off and graceful/crash cleanup. Physical feel, sustained chord
  across a complete move, fullscreen/custom-frame/topmost cases and other
  output/DPI arrangements remain follow-up checks. Evidence:
  `changes/archive/windows-group-underlay.md`.

### Windows mouse movement

- Orchestrator decision 2026-10-04, provisional, to discuss: Windows item 7
  ships title-bar drag first; Win+drag follows. Each accepted producer is its
  own committed unit before item 8 preview. The failed native SC_MOVE/non-client
  initiation experiments select no product behavior. Investigate one bounded
  project-driven Win+left movement path using the existing input and identity
  gates and shared Engine drop geometry; retain KDE binding/placement parity.
- Provisional, to discuss: the project-driven Win+left tiled gesture keeps the
  real window at its source allocation while tracking the pointer; release
  places through the shared Engine, and item 8 supplies the moving target-slot
  preview. Native title-bar movement still follows the pointer. This selects
  no native-loop injection or floating-window modifier-move implementation.
- Provisional, to discuss: an unfocused Windows project-drag subject keeps the
  current native foreground during the stationary hold and activates through
  existing identity-gated focus authority on a valid drop. Focused gestures feed
  the movement underlay A/B arm; distinct unfocused-subject underlay C remains
  parked. The exact KDE focus-timing comparison remains user-testable.
- Windows item8 target preview: separate owned filled layered surface above
  windows, click-through/nonactivating and absent from taskbar/Alt+Tab; KDE blue
  `#2A82DA` at alpha64. Native title movement and project Win movement share
  Engine DragPreview/DragDrop with fresh complete size hints and exact carried
  32px/80px group-edge prior. Source token/domain/revision is frozen at START;
  cancellation, invalidation, self/centre/outside refusal, Finish and teardown
  clear the surface. Physical resize/float exclusion journeys remain user checks;
  deterministic policy/frame gates cover their no-preview rule. Evidence:
  `changes/archive/windows-mouse-drag.md`.

### Windows maximise

- Windows parity item 3 (2026-10-03): Win+M matches the KDE catalog's Meta+M.
  Native maximize and the shortcut use the same retained-tile overlay behavior:
  keep membership, tree position and shares, skip native geometry writes while
  maximized, and restore the current Engine allocation on unmaximize. Siblings
  keep their layout. Maximize never suspends the whole workspace. Both active
  border and group underlay remain suppressed while maximized.
- Match current KDE code, without selecting the deferred COSMIC navigation
  policy: directional focus can leave or enter a maximized member; directional
  movement and pointer operations refuse a maximized subject. Win+Arrow remains
  focus, never native Snap. Workspace send/follow, select-away hiding and return
  preserve maximize; follow and remembered focus include verified maximized
  members. Geometry eligibility remains separate from focus eligibility.
- First non-fullscreen, otherwise-eligible maximized admission without a tile
  slot makes one native restore attempt, with scope, identity and proof fences;
  it never automatically retries. Retained slots are exempt. Fullscreen wins
  over maximize. Use official `ShowWindowAsync(SW_MAXIMIZE)` and
  `GetWindowPlacement`/`SetWindowPlacement` with `SW_SHOWNOACTIVATE` and
  `WPF_ASYNCWINDOWPLACEMENT` for nonactivating restore. Dispatch is distinct
  from observed completion. Stop/crash preserve frames and maximize state;
  existing identity-safe recovery reveals hidden members.
- User-accepted 2026-10-03: each discrete Win+M down makes one native toggle
  attempt; held repeats are consumed without dispatch and there is no persistent
  attempted-state map. KDE's current map can refuse a later identical toggle
  after a successful shortcut maximize followed by native restore. Windows live
  proof reproduced that refusal in the initial implementation; the discrete
  rule fixes it without retries or pending-state machinery. KDE is unchanged.
- Scoped synthetic proof covers owned helpers and Notepad/Calculator/Paint,
  retained slots, focus, populated/trailing sends, held-underlay suppression and
  graceful/crash recovery. Physical maximize-button/input/feel and other
  output/DPI arrangements remain user-owned; native system-command and
  double-click paths are machine-proven. Evidence:
  [Windows maximise](changes/archive/windows-maximise.md).

### Windows fullscreen

- Windows parity item 4 (2026-10-03): Win+F11 matches KDE Meta+F11. Managed
  fullscreen retains membership, tree position and shares; native geometry
  writes pause for that member, siblings keep their allocations, and exit
  restores the current Engine allocation. Fullscreen precedes maximize and
  suppresses both active border and group underlay. Unmanaged fullscreen
  foreground retains the existing workspace suspension behavior.
- Directional focus can leave or enter a verified managed fullscreen member.
  Directional movement, pointer operations, maximize and workspace send refuse
  a fullscreen subject, matching the current KDE wrappers. Workspace selection
  hides/reveals fullscreen members without restoring their frames.
- First-seen otherwise-eligible fullscreen windows without a retained slot
  remain slotless Engine floating exceptions until their first native exit.
  They still occupy a workspace and participate in hide/reveal and close
  cleanup. A later fullscreen transition retains an existing tile slot.
- Accepted for now (user 2026-10-03; a later spike may explore better UX
  for app-owned fullscreen): Windows has no generic official fullscreen setter.
  Win+F11 uses official Win32 style/frame APIs for borderless monitor coverage,
  storing only the cleared frame-style bits and prior maximize state as inert
  native window properties. Exit preserves unrelated app style changes.
  App-owned fullscreen without that preimage refuses the project toggle;
  never synthesize app F11 or guess a restoration state. Stop/crash preserve
  frames and properties; the properties die with the native window. A new
  owner applies the first-seen fullscreen hold before any later explicit exit.
- User-accepted 2026-10-03: one attempt per discrete Win+F11 down; held repeats
  are consumed without another dispatch, matching the Windows maximize rule.
  Failed effects retain any usable preimage for a later explicit press;
  there is no automatic toggle retry or persistent attempted-state map.
- Scoped synthetic evidence covers project entry/exit and exact retained slot,
  stable siblings, immediate foreground retention, visual suppression, born
  hold/hide/return/native release/close and graceful frame preservation.
  Follow-up also observes one toggle for held repeats. Exact-identity Explorer
  restart cleared activation refusal, but shell takeover recurred and its purpose
  remains unidentified. Ownerless helper move now independently reproduces DWM
  cloak 0->2; unexpected maximize attribution remains open. Full focus/refusal/
  held-underlay, retained workspace, crash/restart and approved-app fullscreen
  journeys remain unaccepted/user-owned. Shipment is scoped, not full acceptance.
  Physical input/display and other output/DPI arrangements remain user-owned.
- Cloaked foreground is invisible to the compositor, even with a monitor-covering
  frame: a fresh official DWM cloak read excludes it from the fullscreen veto.
  Invalid/unreadable foreground facts remain fail-closed; real uncloaked unmanaged
  fullscreen still suspends. Do not blanket-exclude ApplicationFrameWindow or
  Explorer from foreground safety based on an unidentified shell surface.
  Evidence and limitations: [Windows fullscreen](changes/archive/windows-fullscreen.md).

### Windows float

- Windows parity item 5 (2026-10-03): Win+G matches KDE Meta+G. Intentional
  floats leave the shared Engine tree and siblings reflow. The first float
  uses the Engine's centered 60% work-area fallback; subsequent floats reuse
  retained geometry. Unfloat carries the live frame and uses ordinary
  admission placement/axis, never a remembered tile slot. Both directions
  retain the exact toggled focus; fullscreen/maximized targets refuse.
- Directional focus/move and tiled pointer operations refuse a floating
  subject; floats are excluded from directional targets. Native moving and
  resizing remain free and never implicitly unfloat. Workspace send refuses
  a focused float, while selection hides/reveals floating occupants with
  geometry intact. The active border is independent of float membership and
  group underlay is hidden for floats. Born-fullscreen holds remain distinct
  from intentional float actuation.
- Official Win32 topmost is the keep-above analogue; there is no keep-below
  analogue. Record the original band, verify effects, and restore only a
  project-raised band on unfloat/graceful stop. A pre-existing topmost band
  is not cleared. Target effects retain existing scope, proof and native
  lifetime fences. Evaluate ToggleFloat on a local Engine clone and commit
  after target effects verify; failed effects do not strand float membership.
  Preserve band preimages even when later frame readback is unavailable.
- Float membership/geometry history is runtime-local and resets on restart,
  matching KDE; no float persistence or new recovery ledger is introduced.
  Stop/crash leave geometry in place. User-accepted 2026-10-03: a crash can
  leave the project-raised topmost band; restart treats the current band as
  native state, rather than inferring an old preimage. Graceful stop restores
  the verified runtime preimage. One attempt per discrete Win+G down; held
  repeats are consumed without dispatch or automatic effect retries.
- Native gates and independent review pass. Live float acceptance remains
  open: Explorer restart cleared activation refusal and the cloak-aware veto
  fixes invisible-cover suspension. A separate ownerless helper move reproduces
  DWM cloak 0->2, preventing admission; fixtures now fail that environment
  precondition before launching an owner. Machine evidence proves activation,
  precondition detection and cleanup, not float behavior. All float/helper/
  ordinary-app and crash/restart rows, physical input/display/feel and other
  output/DPI arrangements remain user-owned. See
  [Windows float](changes/archive/windows-float.md).

### Windows sticky float

- Windows parity item 6 (2026-10-03): Win+Shift+G matches KDE Meta+Shift+G.
  Sticky-on from tiled uses the existing Engine float placement and sibling
  reflow; sticky-on from an ordinary float preserves its live frame. Sticky
  floats stay visible across every managed workspace of their output, never
  take workspace `SW_HIDE`, and do not occupy a backing workspace for
  trailing-empty cleanup. This is managed-workspace stickiness, not Windows
  virtual-desktop membership.
- Win+Shift+G sticky-off honors the same-runtime origin: a formerly tiled
  window fresh-admits on the current workspace; a formerly floating window
  stays a normal float there. Win+G on either sticky origin clears sticky and
  tiles on the current workspace. Both retain exact toggle focus. Fullscreen
  and maximized targets refuse. Directional focus/move/resize and workspace
  send exclude sticky subjects; tile navigation excludes their slotless
  floating exceptions. Active border stays independent, group underlay stays
  suppressed, and native pointer movement/resizing remains free.
- Reuse float keep-above/topmost preimages, retained frames, native identity
  and scope fences. Sticky native markers use a separate window-lifetime
  property; every marker effect is held-process and lifetime-tag verified.
  No recovery-ledger or file persistence is added. Graceful stop restores
  project-raised topmost and leaves frames in place; the existing provisional
  float crash-topmost policy also applies.
- Accepted for now (user 2026-10-03; may be improved later): stop/crash
  leaves the sticky marker on surviving
  windows. The next owner consumes it into a normal float on the current
  managed workspace, preserving the live frame and discarding prior tiled/
  float origin. The next Win+G tiles. This simple Windows restart analogue
  avoids preserving all-workspace visibility across owner lifetimes; KDE's
  native-sticky adoption behavior is unchanged.
- Native gates and independent review pass. Scoped live helper evidence proves
  both origins, select visibility, current-workspace sticky-off, Win+G clearing,
  focus refusal, border presence and graceful restart adoption. Ownerless move
  cloak stayed 0; the public virtual-desktop check placed the probe on the
  current desktop with the same ID as foreground (not a desktop-count proof).
  Crash/watcher, held-underlay, broader overlay/refusal/send/close journeys,
  physical ordinary-app input/display/feel and other output/DPI checks remain
  user-owned. Receipt status remains partial. See
  [Windows sticky float](changes/archive/windows-sticky-float.md).

## Native Integration Boundary

- User decision (2026-09-24; governing statement under Architecture Direction):
  keep OS/DE-agnostic logic and policy in or near the Rust core wherever
  possible. Supply needed OS/DE capabilities through the smallest reliable
  native integration; no capability, including input, is excluded merely for
  being native. Reliability is part of the test for any needed native
  capability (Orchestrator interpretation): private KWin APIs are not
  categorically forbidden, but their ABI churn weighs against their use.

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

## Settings And Distribution

- User decision 2026-09-28, option B: merge all user-facing settings into one
  page for UX. Orchestrator decision applying option B: tray Settings, KWin
  Scripts Configure, and Desktop Effects Configure each open that same page;
  retain both installed KCM identifiers and namespace entries with one shared
  page implementation and two thin plugin factories. Existing script and effect
  groups, keys, values, and defaults remain unchanged. Saving changed gaps
  queues the existing KWin reconfigure path
  automatically; the queued send is unconfirmed, so the controller re-reads
  gaps on `Options.configChanged` and requests a debounced retained
  `update-gaps`, and a session restart guarantees pickup if it cannot converge.
  Changing `workspaceMode` on the page still requires a session restart. The
  ineffective `tilingAlgorithm`, `automaticSplitTarget`, and `dropOutlinePreview`
  controls remain removed; existing values are neither read nor rewritten.
  Shortcut re-registration remains unselected: the pinned scripting surface
  offers no unregister operation, and foreign records change only through
  explicit settings-page Apply/Force/Revert. Existing live border updates remain
  live.
  Before launch, every user-facing setting must apply live; this remains a
  mandatory launch blocker. User exceptions (2026-09-25): `workspaceMode`
  stays startup-only for MVP and the Configure page states the restart
  requirement clearly; `shortcutProfile` is hidden until distinct profiles
  exist (post-MVP). Lead implementation choice: preserve the existing script
  startup read (and its unchanged single COSMIC-style catalog); the unified KCM
  does not read, modify, migrate, delete, or create any saved `kwinrc`
  `shortcutProfile` value.
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
  Manager owns user-session delivery: the optional tray systemd user unit
  running the immutable `plasma-auto-tiler tray` and the on-demand Planner
  D-Bus/systemd activation metadata. Neither writes user `kwinrc` authority.
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
  shared `e554fab72f81915600f3f449b786fd9af40439a5` dev pin is only
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
- KWin restart with a surviving Planner (user decision 2026-09-28, option A):
  keep the fixed script generation `plan-1` and retained topology for domains
  sharing any observed window ID. KWin 6.7.5 constructs fresh per-window
  `internalId` UUIDs after restart; a complete nonempty reconcile with no
  shared IDs fresh-adopts that domain instead of rebuilding in arbitrary ID
  order. An empty observation retains normal retirement/revision semantics;
  a mismatched owner or generation still rejects rather than replacing the
  retained session. Other domains and the Planner binding remain intact.
- Selected 2026-09-16: on CONFIRMED Planner loss, establish one bounded fresh
  Planner session automatically. This on-demand activation is distinct from a
  systemd restart loop. It starts from current eligible windows only, with no
  durable layout snapshot or journal and no inference of the old session's
  internal history. The old in-flight transaction remains terminal with
  old-generation replies rejected; this does not replay interrupted commands,
  recover uncertain native mutation, apply stale old-session replies, or infer
  commit for an unresolved workspace send. Normal Plan transport pins a unique owner via
  strict `NameHasOwner` plus one bounded `StartServiceByName(..., 0)`
  accepting only `PrimaryOwner`/`AlreadyOwner` then `GetNameOwner`; ambiguous
  terminals may run one bounded identity probe and only absence or a changed
  owner recovers. A failed recovery stays bounded without loops.
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
  historical-layout reconstruction remains unselected; complete observed
  membership is now incrementally adopted into retained domains as described
  under Architecture Direction. Before launch, this and every other
  user-facing setting must apply live; that is a mandatory launch blocker, and
  the gap-only reload does not satisfy it.
- Approved 2026-09-16: when the first startup domain has no usable retained
  session, Rust may use a versioned, best-effort near-layout fitting heuristic
  to minimize unnecessary initial window movement. It must be simple,
  comprehensible, and deterministic, with Rust retaining structural inference
  and KWin TS retaining native observation. This selects neither exact
  recognition nor historical-topology reconstruction, global optimization,
  exhaustive search, broad edge-case handling, retained-topology rewrite,
  historical-topology recovery, general existing-window adoption, or default
  promotion. At INITIAL adoption, it attempts one straightforward deterministic
  near-layout fit; if no valid supported layout results, it uses the existing
  normal deterministic seed/reflow. The same attempt is selected for a
  post-CONFIRMED-loss fresh session only, from CURRENT eligible windows.
  Fresh-loss fitting may change grouping and does not reconstruct the old
  topology. It selects no park/unmanaged fallback or broader activation
  lifecycle. Existing floating, sticky, fullscreen, maximize, and
  configured-gap behavior remains authoritative; preserving it at the current
  eligibility or pure input boundary is implementation work, not an unselected
  product behavior.
  User decision 2026-09-29: replace the flat near-strip fit with one simple
  deterministic recursive-cut fit to preserve nested layouts and screen order
  across tiler restarts, independent of focus; do not chase rare complex
  cases. Orchestrator defaults approved by the user: try horizontal then
  vertical cut axes, collect all viable cuts into ordered N-ary children,
  derive shares from observed child spans, recurse on the orthogonal axis,
  and allow each window to cross a cut by at most the greater of configured
  inner gap and 3% of the relevant work-area dimension. If any multi-window
  piece cannot split, fall back to the existing normal seed/reflow. Existing
  fit exclusions, lifecycle and canonical configured-gap projection remain
  unchanged; a flat strip is just a one-level fit. This still selects no
  exhaustive search or historical topology reconstruction.
  User decision 2026-09-29, option B: eligible free-positioned overlapping
  windows also receive a near-position fit instead of declining to the normal
  seed spiral. Keep it simple, with no complex edge-case handling. Orchestrator
  defaults: prefer existing tolerance-valid cuts; if a multi-window piece has
  none on either axis, binary-split at the largest adjacent gap between sorted
  window centres, choosing the axis with the larger gap (horizontal tie).
  Child shares use each side's largest observed member span on that axis; recurse
  normally. If both centre gaps are zero, decline the whole fit and keep the
  existing seed fallback. The correlated adoption-fit summary counts centre
  splits. Cleanly tiled layouts retain their current fit and exception rules.

## Live KWin/Plasma Boundary

- Reversible, project-scoped live host tests may run under the reviewed
  repository protocol. They must be namespaced, fail closed, and provide exact
  restoration; if exact restoration cannot be verified, stop and leave the
  residue for user action.
- The user grants standing authorization, until revoked, to read and mutate the
  existing KWin session for project-scoped testing. This authorization does
  not broaden the live/manual boundaries below or select material product,
  security, or architecture decisions. Every action remains bounded to exact
  identified project resources with a recorded baseline and exact restoration;
  no broad cleanup, window closure, system path, dotfile, NixOS, Home Manager,
  sudo, session-boundary, irreversible, unrelated-host action, or preserved
  residue handling is authorized. Stop on ownership, parser, diagnostic,
  baseline, source, or restoration ambiguity. This covers project builds;
  native-effect staging/removal; the project's `plasma-workspace/env` script
  and same-name legacy migration; KWin `/Effects` load/unload and read-only
  queries; KWin script install, enable, disable, and reconfigure; bounded
  `/Scripting` load/unload; project tray-helper lifecycle, session-D-Bus
  operations, and journal/status reads; and disposable project-owned Custom
  Tile tests when exact restoration is verified.
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
  the checkout controller, so `authoritative_ready` remains false. No
  preflight readiness phase authorizes a Custom Tile lifecycle, live journey,
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
  processes and Rust-path IPC must emit bounded, structured, correlated
  lifecycle and terminal logs to their existing visible KWin console, stdout,
  or stderr/journal sinks. `just dev verbose` keeps those summaries while
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
  identify heuristically, modify, or delete it. No stale POC2/POC3 harness
  or checkpoint retry is authorized; recovery requires explicit user
  authorization and exact identity or hash verification. After the resource-order
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
  with `float-refused-fullscreen` and `float-refused-maximize`. User decision
  2026-09-28, option A: unfloat uses exactly the new-window admission
  placement rule (focused leaf's projected rect, otherwise domain bounds),
  with no remembered-origin slot; COSMIC's `toggle_floating_window` maps
  through `tiling_layer.map(window, focus_stack)` as for a new window, and
  sway's `container_set_floating` likewise re-tiles by ordinary placement.
  The controller registers `Meta+G` without changing Grid View's record.
  KGlobalAccel permits
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
  User decision 2026-09-25, option A: `Meta+G` on a sticky window uses the
  existing sticky-off path to clear all-desktops, restores the project's
  keep-above state, and returns to tiling regardless of whether the sticky
  window was previously tiled, an ordinary float, or adopted with unknown
  origin. `Meta+Shift+G` sticky-off still honors the previous floating origin
  as described above.
  Orchestrator clarification applying option A, 2026-09-25: `Meta+G` tiles on
  the workspace where it is pressed, where native sticky-off leaves the
  window, even if its former tile belonged to another workspace. A subsequent
  `Meta+G` on a plain floating window must still tile it; moving or resizing
  a float alone never tiles it.
- Intentional normal and sticky floating request KWin's public `keepAbove=true`.
  KWin owns the normal keep-above/keep-below exclusive transition. The adapter
  records the prior pair and restores a project-cleared `keepBelow` (or prior
  `keepAbove=false`) before unfloat, fresh tiled admission, or controller
  disable; a pre-existing keep-above setting remains untouched. A missing,
  refused, or unverifiable native write fails the transition without a retry.
- Maximize (`Meta+M`) is workspace-local. Fullscreen (`Meta+F11`) is separate:
  the focused observed window toggles KWin's public `Window.fullScreen`
  property, while KWin keeps cover-and-restore ownership. The member retains
  its tree allocation, receives no geometry write while fullscreen, and
  restores that allocation on exit. User decision option 2 (2026-09-26): a
  window first observed by the KWin adapter as fullscreen instead stays out
  of the tree while initially fullscreen, so siblings occupy all tile space.
  Its first non-fullscreen observation receives normal fresh admission; any
  later fullscreen retains its tile as above. This includes startup and hidden
  domains. KWin carries the initial hold as a planner-only floating exception,
  never intentional native floating; a window still maximized on first exit
  receives the existing one-shot admission-time maximize clear. Borderless
  output-sized windows are not inferred to be fullscreen.
- Maximize isolation mirrors fullscreen, authorized 2026-09-14. A nonzero KWin
  `maximizeMode` (1 vertical, 2 horizontal, 3 full) is collapsed to one adapter
  boolean; no horizontal or vertical maximize concept enters the Rust engine or
  its protocol, and no Rust protocol/session state is added for maximize. A
  maximized member keeps its observed identity, leaf/tree position, and share,
  receives no geometry write, and on unmaximize is restored to its exact
  retained allocation. Fullscreen takes precedence when a window is both
  fullscreen and maximized: fullscreen refusal tokens and the `skip-fullscreen`
  disposition win over maximize. User decision I (2026-09-26): a normal window
  without a connectable `maximizedChanged` remains tiled; log once and use
  fresh `maximizeMode` reads on later observations. An unseen native change
  remains unknown until a subsequent observation.
- Admission-time maximize clearing is a deliberate, user-approved KWin-native
  deviation from cosmic-comp parity, authorized 2026-09-14. For a non-fullscreen
  window first observed without a retained tiled slot, the adapter calls KWin
  `Window.setMaximize(false, false)` once before admission, then tiles the
  restored window normally. It never retries the write. A later maximize of a
  retained member keeps the existing isolation behavior: the leaf/share remain,
  geometry writes are skipped, and unmaximize restores the retained allocation.
  Fullscreen remains untouched and takes precedence. KWin session-restored
  maximized applications therefore tile on admission while preserving the
  selected post-admission behavior.
- `Meta+M` toggles KWin maximize through `Window.setMaximize(bool, bool)`, never
  `maximizeMode`. Fullscreen refuses first. Post-admission maximize retains its
  tile slot and skips geometry writes; unmaximize restores its retained
  allocation. The action has its own exact-reference `maximizedChanged` fence,
  so a deliberate post-admission maximize is never affected by admission-time
  clearing. Current read-only enumeration found `kwin/KrohnkiteMonocleLayout`
  on `Meta+M`; registration preserves that record and emits the shadowed-
  delivery diagnostic until the user applies the exact reversible KCM override.
- H/V maximize is deliberately not modeled in the engine. Maximize is a
  recorded overlay state over the original layer, not a distinct topology or
  managed layer, so the engine carries no horizontal/vertical maximize concept.
- Complete automatic per-domain observations, not an applied membership
  baseline, drive `reconcile` for foreground and hidden tiling. The Engine
  converges departures, arrivals, and floating transitions before projecting
  surviving topology; explicit complete hidden empties may retire a domain.
  KWin retains only applied per-window geometry/domain/flag evidence for
  overlays, first-admission maximize, drag fallback, drift and reply checks,
  never as membership authority. Incomplete foreground frames and unreadable
  hidden domains cannot establish a departure. Changed gaps use one bounded
  fresh same-domain `update-gaps` retry only after an exact correlated gap
  mismatch; unrelated/malformed refusals do not retry. The redundant
  post-convergence ID-set checks for ordinary retained reconcile and
  update-gaps are gone; relocated but previously unconverged sources still
  require exact membership and atomic rollback. Other operation and reply
  fences remain where needed for changed scope or uncertain state.
- User decision D, option 2 (2026-09-26): on existing topology-change
  signals, a successfully validated complete desktop-ID or output-name list
  proves a drag-restore marker's workspace or output removed if absent from
  that list. Settle each such drag `outcome=unavailable plan=none` and drop
  its marker; a failed or malformed list proves nothing for that axis. No
  timer, count cap, inferred per-window departure or fabricated applied plan.
  Ordinary later observations remain usable.
- USER-APPROVED recoverability, 2026-09-21: "log and continue rather than hard
  fail." A failed native geometry operation or client geometry discrepancy is
  an operation failure, not a permanently disabled window or domain. Later
  valid commands and fresh observations remain usable while the adapter retains
  confirmed canonical topology where available. User decision A (2026-09-26,
  interim): after three bounded reassertions, automatic reconciliation accepts
  each exact client-held rectangle as per-window applied geometry evidence
  without disabling the domain; other or later drift still reconciles. This
  does not fabricate a native write or change canonical Rust topology. The
  retained allocation owns topology over same-scope client drift: strict
  `DescribePlan {"op":"reconcile"}` never derives sibling shares from a
  client's actual rectangle. Three attempts are a KWin anti-fighting policy,
  not a COSMIC threshold or KWin acknowledgement. Learned
  size limits and neighbour replans are deferred. Later explicit commands
  remain usable; no infinite retries, fabricated acknowledgement, stale
  geometry or uncertain cross-output transfer recovery is authorized.
  Authorization, malformed-input, owner, correlation, and stale-scope fences
  remain fail-closed. Send/R4 uncertainty now uses the 2026-09-25
  step-3 observation convergence below. Future
  recovery must preserve later valid commands without fabricating success,
  replaying setters, resetting topology, or weakening those fences. User
  decision G (2026-09-26): a stale pre-write snapshot replans the same
  command once against a fresh complete observation under identity,
  correlation, owner and scope fences. A second staleness logs, drops and
  converges; never replay after any setter has run.
- USER-APPROVED observation-convergence step 3, decided 2026-09-25:
  complete per-domain observations are authoritative for membership and portable
  flags, retaining survivor topology. The user authorized retiring send/R4
  transactions. Rust converges complete source and target observations, then
  synchronously commits the planned send or exhausted horizontal R4 topology
  into canonical per-domain sessions, returning both-domain geometry and the
  native assignment. No pair survives the call and no send/R4 pending
  ack/verify/status/cancel/abandon remains. The retired scope is the cross-call
  public transaction protocol only; the synchronous in-call
  propose/acknowledge/verify commit is unchanged. KWin keeps a short flight-local
  source/target pin, including a newly allocated trailing target, and separate
  unanswered-request and arrival deadlines. Owner/generation/correlation/flight/
  snapshot fences discard stale replies before any setter. Send writes geometry
  then desktop membership; R4 writes output, desktop membership and geometry,
  exempting overconstrained members. R4's mid-transfer fence also checks
  non-mover flags before later setters and follow. Follow once on fresh exact target arrival,
  switching before focus without waiting for unrelated geometry; no retry or
  setter replay on failure. Every terminal flight forces complete both-domain
  Plan reconciliation even when applied evidence matches, quarantines unreadable
  domains and never uses `blocksPlan`. No wire ack or native verified-success is
  emitted for send/R4. Current Rust+KWin behavior is offline-verified only; no
  live verification claimed. See `changes/archive/observation-convergence.md`.
- Permissive admission, authorized 2026-09-14: an observed normal window's
  incoming frame rectangle never decides whether it may join a tiled domain.
  Admission assigns a new complete geometry for every member and may reflow
  existing members. In particular, an older out-of-work-area window must not
  prevent a later window from tiling or create a restart-persistent admission
  deadlock. User Resilience direction, 2026-09-29: valid observed frame rectangles
  outside the work area are host drift for retained commands, directional
  commands, and workspace-send target observations too; they must not reject
  the complete snapshot. Canonical projection and KWin's existing bounded
  per-window drift handling converge them. Malformed rectangles, domain
  homing, and reply geometry remain validated. Offline verified in
  [mid-drag-workspace-recovery](changes/archive/mid-drag-workspace-recovery.md);
  live acceptance pending.
- Mid-drag workspace change (Orchestrator default, 2026-09-29): a native
  same-output workspace send while Meta drag is held supersedes the Started
  workspace's drop target. Ignore that stale drop and let complete source and
  destination observations reflow/admit the mover normally. Lead implementation
  choice: compare the mover's fresh native workspace with Started, not the
  pointer-projected destination; a legitimate pointer-based cross-domain drag
  remains available. Lead correction after the user's live repro, 2026-09-29:
  the refused drop's existing restore reconcile binds to the freshly observed
  destination containing the mover, rather than waiting for the Started
  source to become visible. The source still reflows through send settlement.
  Confirmed live by the user (laptop, 2026-09-29); see
  [mid-drag-destination-recovery](changes/archive/mid-drag-destination-recovery.md).
- `workspaceMode` supports `per-output-local`, `global-unique`, and `shared`
  through a session-local, project-owned KWin backing-desktop mapping. KWin's
  global virtual-desktop pool is not a native COSMIC workspace-set mapping.
  `per-output-local` and `global-unique` assign distinct backing desktops to
  output domains; `shared` selects the same backing desktop on every output.
  Keeps one structurally trailing empty backing desktop per relevant domain,
  reused for `Meta+0` and `Meta+Shift+0` before creating one; an empty
  non-final managed backing desktop is removable once invisible on every
  output. The literal native-order trailing empty is retained. Management
  includes adopted preexisting desktops, distinct from lifetime ownership, so
  disable/teardown never disposes an adopted desktop. Every live
  local/global-unique output domain, and the shared domain, keeps at least
  two logical workspaces. Unmapped desktops remain outside management.
  Occupied (including floating, fullscreen, and maximized), visible,
  flight-pinned, displaced, and unmapped desktops remain protected; sticky
  all-desktops windows do not occupy every backing desktop. Mapping and output
  identity are session-local. Initial disconnected-output policy: displaced
  layout preserved in separate workspace(s), never merged into a new
  top-level split of remaining visible layout. Active-focus survivor choice:
  disconnected-monitor active window shows its relocated workspace with focus
  retained; surviving-monitor active window preserves current visible
  workspace and focus with displaced workspaces reachable by normal
  switching; no active window preserves surviving monitor view. On
  reconnection, displaced workspaces return automatically to their original
  monitor with then-current contents/layout, not a saved snapshot (split
  edits, closed/new windows reflected). Relocation is the unit: an
  explicitly moved-out window stays at its destination, never individually
  pulled back, while a window moved into a displaced workspace returns with
  it. User-configurable handling is deferred. Multiple-survivor destination:
  nearest surviving monitor from already-available disconnect-time geometry,
  no added history; fallback current primary surviving monitor then existing
  output ordering; retains no removed geometry and never uses post-disconnect
  frame geometry as proxy; distinct from the displacement association for
  automatic return. Reconnect focus: active window in a returning workspace
  shows that workspace on the reconnected monitor with focus retained;
  active window on a surviving output preserves view/focus with no stealing;
  other selection ordinary, no prior-view tracking or new state/history.
  Initial scope session-local, no restart-persistent mapping or return
  guarantee.
- `Meta+1..9` select an existing 1-based logical workspace without creation.
  `Meta+Shift+1..9` send only the focused tiled window to an existing
  same-output workspace through the Rust `MoveToWorkspace` route. `0` reuses or
  creates the trailing empty target. Step 3 (current, USER decision
  2026-09-25, offline only, no live verification claimed): per the step-3
  rule above, under its pin, separate deadlines, and
  owner/generation/correlation/flight/snapshot fences; send specifics only:
  pin includes a newly allocated trailing target until dispatch/follow
  observation finishes; native order source/target geometry then mover
  desktop setter; exact follow is one fresh
  mover-absent-from-source/present-in-target proof, switch-before-focus
  without waiting unrelated geometry, no retry/replay/fabricated rollback;
  setter returns and signal delivery alone are not proof; stale, ambiguous,
  missing, no-op, wrong-target, owner, scope, and hook failures do not
  follow; unrelated async layout settling never gates confirmed follow. KWin
  geometry and membership are non-atomic and asynchronous. The standard US
  shifted aliases `Meta+!`
  through `Meta+)` are registered alongside the digit sends; registration
  preserves foreign shortcut records and does not establish physical delivery.
- USER VISUAL/MANUAL acceptance (rapid multi-workspace move/follow use): accepted for move/follow usability and repeated same-session use across many workspaces. The supplied dev log was not analyzed and supplies no machine protocol, rendered-visibility, latency, recovery, or native-cause claim. The durable product preference is graceful, unsurprising handling of confirmed partial successes and responsiveness during rapid use; it does not authorize ignored errors, retries, queue resets, or an architecture or uncertain-recovery change.

## Shortcuts

- USER rule 2026-09-28: every HJKL directional shortcut has an arrow-key
  alias. Grow (resize outwards) uses `Meta+Alt+Left/Down/Up/Right` alongside
  `Meta+Alt+H/J/K/L`; the removed Custom Tile controller's legacy `insert-*`
  reservation on those arrow chords is retired. Plasma 6.7.5 defaults those
  chords to `kwin/Switch Window Left/Down/Up/Right`. Orchestrator decision
  2026-09-28 under the standing 2026-09-21 approval: clear those four stock
  bindings through the existing reversible KCM Apply/Force/Revert override;
  do not relocate them. Project directional focus supersedes stock switching.
- USER decision 2026-09-28: project `Meta+Left/Down/Up/Right` focus and
  `Meta+Shift+Left/Right` move supersede the KWin 6.7.5 defaults for
  `kwin/Window Quick Tile Left/Bottom/Top/Right` and
  `kwin/Window to Previous/Next Screen`. Clear those six exact bindings
  through reversible KCM Apply/Force/Revert, without relocation.
- Approved 2026-09-21, standing until revoked: clear Grid View's `Meta+G`
  and Krohnkite Monocle's `Meta+M` through reversible Apply/Revert overrides,
  plus other exact project-required shortcut conflicts. The "recorded preimage"
  and "does not authorize relocation chords" limitations are superseded by the
  current Force/Revert contract below (durable cleared-ID list; Lock Session
  `Meta+L` to `Meta+Esc` relocation). No broad shortcut deletion, unverified
  actions, ownership/readback changes, or startup mutation.
- The initial release supports standard US keyboards and preserves hardcoded
  shifted aliases. Layout detection, omission, opt-in configuration, migration,
  and KGlobalAccel reconciliation are deferred.
- Non-conflicting project shortcuts register by default. Conflicting
  Plasma-global shortcuts change only through explicit KCM Apply, Force Apply,
  and Revert. Installation/startup never mutate global shortcuts. Ordinary
  settings Save never mutates shortcuts. The fifteen project-required chords are
  `Meta+L` (focus-right, relocating `ksmserver/Lock Session` `Meta+L` to
  `Meta+Esc`), `Meta+Alt+K`, `Meta+Alt+L`, `Meta+G`, `Meta+M`, and
  `Meta+Alt+Left/Down/Up/Right` (grow arrows, clearing the corresponding
  `kwin/Switch Window Left/Down/Up/Right` defaults), plus
  `Meta+Left/Down/Up/Right` (focus arrows, clearing the corresponding
  `kwin/Window Quick Tile Left/Bottom/Top/Right` defaults) and
  `Meta+Shift+Left/Right` (move arrows, clearing `kwin/Window to
  Previous/Next Screen`). The sole
  approved target-occupant exception is `Meta+Esc`: System Monitor
  `org.kde.plasma-systemmonitor.desktop` / `_launch` may hold it and is
  displaced without rebinding System Monitor itself; it is never writable by
  the override. No other foreign occupier is authorized, and no per-component
  `cleanUp()` path exists.
- Current Force/Revert contract, Orchestrator decision 2026-09-26 applying the
  user's 2026-09-26 Delivery 2 direction (see
  `changes/archive/multi-output-failures.md`): Force may clear ANY holder of a
  project-required chord after listing and confirmation, not only exact
  compiled foreign rows. The preview lists every active holder with its found
  keys, the exact required keys removed, and the unrelated keys kept,
  including unknown and legacy project-owned (`kwin/plasma-auto-tiler-*`)
  IDs; project actions, Lock Session, and the authorized System Monitor
  `Meta+Esc` holder are exempt. A holder claiming a chord with no required key
  in its active list (e.g. a `.desktop`-declared default) blocks Force until
  unbound manually. Confirmed Force revalidates owner, project/lock live
  images, and the full holder snapshot against fresh state before persist;
  stale confirmations there fail closed with zero writes, including zero
  cleared-list writes. After persist, each holder is re-read immediately
  before its foreign setter and aborts on active drift with zero further
  KGlobalAccel writes; the persisted union is retained as an
  interruption-safe superset, so Revert may restore an action never cleared.
  Minimal durable cleared component/action ID list (IDs only, no cosmetic
  labels; Components+Actions in config; union by ID) at
  `~/.config/plasma-auto-tiler/shortcut-clearedrc` is union-persisted
  BEFORE clearing and emptied only after successful Revert, so an
  interrupted Force stays revertible. Force preview transient labels are
  never persisted. Stateless Revert was rejected: it would alter
  never-cleared actions, activate default-only holders, and miss custom
  holders (Simplicity/Resilience: smallest state that is actually correct).
- Revert restores KDE defaults for every non-project ID in the cleared
  list via `defaultShortcutKeys`/`setForeignShortcutKeys`: each persisted
  ID is resolved to its fresh current tuple from `readAll` to supply the
  current friendly labels (empty allowed) for the 4-field actionId (no
  2-field daemon assumption); the full default key set replaces the
  active set, so custom cleared bindings are lost, as the user accepted
  2026-09-26. Project-owned IDs (`kwin/plasma-auto-tiler-*`, current and
  legacy) stay cleared. Absent or duplicate IDs fail closed without
  writing unrelated actions and retain the list for retry; other partial
  Revert failure likewise retains the list for a later resume; an empty
  list is a no-op success. Existing journal files
  (`shortcut-override-journalrc`, including the kcmshell6 legacy path) are
  ignored and untouched; no migration, Finish Apply, or Restore path
  remains.
- Shortcut operations emit bounded structured diagnostics on
  `plasmaautotiler.shortcut` (operation, stage, outcome, allowlisted
  identity, key images, cleared count/writes only; foreign occupants
  redacted). Query with
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
- Production uses the single `DescribePlan` engine with direct geometry and no
  Custom Tile topology authority or Legacy fallback. Disposable Custom Tile
  acceptance remains a separately gated test; tabs, stacks, shared tiles, and
  compositor group behavior remain unselected.
- Grouping here means nested split-tree structure and placement. `H[H[1 2] 3]`
  is distinct from `H[1 H[2 3]]`; tabs, stacked/shared groups, and compositor
  group behavior are excluded.
- Lifecycle foundation, authorized 2026-09-09: portable `cosmic_v1` lifecycle
  plans carry policy version 1. Step 3 replaced send/R4 pending acknowledgement
  with immediate planned-topology commit and complete observation convergence;
  other lifecycle operation contracts remain independent. Logical domains are
  keyed by the opaque `(output, workspace)` pair, so one logical output may
  retain independent workspace trees without inventing native workspace
  semantics. Source-evidenced `cosmic_v1` semantics govern focused-cell binary
  admission, physical-axis selection, equal new splits, proportional
  ordered-N-ary share adaptation, physical-pixel resize, and drag zones.
  The portable split-tree representation fails closed for COSMIC
  center stack drops because stacks are unselected and compositor-owned.
  Recursive collapse is retained. On a focused tiled removal, `cosmic_v1`
  removes the leaf from its source-domain MRU focus stack and selects that
  stack's remaining top; an unfocused removal preserves focus. Send with
  `direction=None` leaves focus in the source rather than focusing the target.
  The portable tiled model clears focus when no source tiled stack entry
  remains. Floating and sticky exceptions and fullscreen/maximize tile overlays
  follow the current Window And Workspace Behavior rules.
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
- COSMIC geometry parity, established 2026-09-13, closed 2026-09-16:
  Native KCM-owned `innerGap` and `outerGap` default to `(8, 8)` for the
  effective 8px work-area edge margin and sibling spacing; `outerGap` is not
  the raw COSMIC theme outer value. Retain shares without claiming exact
  COSMIC parity. Revisit only for a reproduced N-ary/deep-layout visual
  discrepancy or a required source-exact fixture that fails under shares. No
  pixel-authority migration, projector correction, numerical-policy change, or
  code/test work is selected.
- COSMIC send-to-workspace is a portable same-output, distinct-workspace
  lifecycle operation. It moves only the focused tiled window, recursively
  collapses its source tree, and focuses it in the target. A validated
  per-domain last-active leaf supplies COSMIC target admission; its absence
  uses target `map_to_tree` root/output-geometry fallback. Empty targets are a
  lone root. Approved 2026-09-20, updated by USER step-3 decision 2026-09-25 (current, offline only, no live verification claimed): exhausted default-Vertical
  `Meta+Left`/`Meta+Right` R4 movement is the selected product behavior across
  a horizontally adjacent output into that output's currently selected logical
  workspace. Local R1/R2/R3 wins first; Up/Down, wrapping, and workspace
  cycling remain excluded. Rust converges complete source plus target observations, then synchronously commits the planned R4 topology into the canonical per-domain sessions and returns both-domain geometry plus the native assignment; no pair survives the call. Rust retains target remembered-leaf/root insertion and the existing owner, generation, revision, correlation,
  single-flight, visibility, exception, and
  fail-closed target fences, with no acknowledgement, verification, pending, status, cancel, or abandon. The active `DescribePlan` route delivers the
  corresponding exhausted horizontal focus transfer with no layout or
  membership writes. R4 uses KWin 6.7.5 public
  `workspace.sendClientToScreen(window, output)` and exact desktop assignment,
  with native write order output, then desktop membership, then source/target geometry (respecting overconstrained members). KWin keeps a short flight-local source/target pin with separate unanswered-request and arrival deadlines, stale-reply discard before any setter, prompt follow once on fresh exact mover-on-target proof, forced complete both-domain reconcile even on equal applied evidence with unreadable quarantine, and no `blocksPlan`. Timeout, stale scope, wrong output,
  failed write, identity loss, or partial proof converge on the next complete observations without replay, phantom, or verified-success claim.
- The portable world Engine owns independent per-domain Sessions, outer gaps,
  seeding, and relocation behind
  typed events and replies. Do not merge per-domain revisions, fingerprints,
  divergence, or node identities into one permanent Session.
  Send/R4 assemble a transient canonical pair only for the synchronous planned-topology commit; no workspace/R4 pending pair state remains.
- A KWin fork or patch is rejected. The project must operate within existing
  KDE/Plasma/KWin. The Rust-engine/direct-geometry direction above is the
  selected replacement architecture; the bounded adapter remains active only
  until its individual replacement paths are promoted.
- Grouped/tabbed windows remain deferred pending compositor-owned KWin support
  and a live multi-window Custom Tile stability proof. No tab or stack carrier,
  controls, or bindings are selected.
- Active-group highlighting: Meta-held observation is the user-approved
  selected lifetime. One-second accepted/applied open/move/close behavior is
  a fallback only if Meta-held proves unavailable or impractical,
  never automatic when Meta is not held. The shipped route observes passive
  public `EffectsHandler::mouseChanged(...)`. KWin Script workspace exposes
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
  workspace stacking passes. User decision 2026-09-28: the temporary group
  visual is a filled underlay beneath the group's windows, not an outline.
  Orchestrator decision applying the user's requirement: use public stacking
  order to parent its `ImageItem` below the lowest painted group member and
  re-anchor on stacking, membership, or visibility changes. The child inherits
  its window's slide translation; being below the windows alone does not cause
  the slide. The underlay spans the engine-projected union expanded by border
  gap + border width + configured extension (unset means current border width).
  Where the extension overlaps a non-group window stacked below the anchor, it
  may paint over that window's edge (accepted by the Orchestrator). No custom
  scene/rendering mechanism is selected.
- Active-group highlighting is statically delivered. Rust resolves the focused
  leaf's immediate parent split group and recursively projected members from
  its retained focused-domain tree; the script forwards their validated window
  IDs with engine union bounds and bounded identity to the renderer. Per
  Orchestrator authorization, the member IDs occupy one additional field in
  the existing `SetGroupHighlight` payload (no raw ID logging), and the setter
  limit matches the existing 64 KiB Planner reply bound with a plain native
  member list. Rust also owns native-effect
  payload parsing/validation, stream order, focus/visibility policy, and POD
  state through a panic-contained byte/POD ABI. C++ extracts the accepted IDs
  and owns the QObject/D-Bus boundary, native stacking/signal observation,
  scene parenting and repaint shim. The active border stays an outline.
- The approved writable bridge is an effect-owned session D-Bus endpoint,
  `org.plasmaautotiler.ActiveBorder` at
  `/org/plasmaautotiler/ActiveBorder` with interface
  `org.plasmaautotiler.ActiveBorder1`: bounded `SetGroupHighlight(QString)`
  and `ClearGroupHighlight()`. It is not a `/Effects` method. Its offline
  contract is verified; KWin Script demarshalling, service ownership, modifier
  delivery, rendering, and performance remain live-unverified.
- User decision R/S, option 2 (2026-09-26): if the native group-highlight or
  drag-oracle D-Bus endpoint fails to register at construction, retry on the
  effect's existing window-activation and reconfigure events, with no timer or
  polling. Require both name and object registration before advertising the
  endpoint; roll back only registrations acquired by a partial attempt. When
  input redirection was absent at construction, install the passive oracle
  press spy on those same events. Log unavailability and recovery once per
  endpoint or spy; neither failure disables the other endpoint.

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
  stay alive without a watcher or after watcher loss and register whenever a
  live-confirmed watcher owner appears. Transient registration failure remains
  retryable; registration is reported only after confirmation. The bridge is
  outbound state-snapshot based,
  reconnecting, idempotent, with no KWin executable allowlist, and has no
  shell, input, or helper-to-KWin action route. Its Settings action opens the
  unified page also available from both KWin Configure entries.
- Snapshot publication requires the sender's unique D-Bus name to equal the
  current `org.kde.KWin` name owner. Owner loss or replacement clears the old
  snapshot; the tray remains available for the new owner's snapshot.
- The static bridge includes freshness and ordering/generation checks,
  idempotent notifications, and bounded watcher retry.
- Tray ordering (user decision C4 option 2, 2026-09-27): reject and log a
  same-generation strictly lower-revision complete snapshot without clearing
  or refreshing the trusted snapshot or entering conflict state. The matching
  equal-revision heartbeat may refresh it. An equal-revision different-content
  snapshot still revokes trust; owner and generation fences remain in force.
- Tray status (user decision 2026-09-28, option 2, for now): the production
  KWin publisher reports `enabled=true`; a fresh authenticated snapshot shows
  Active, while a missing or stale snapshot shows NeedsAttention. No
  readiness-bound status.
- Tray host-conflict indicator (user decision 2026-09-29, option A; offline,
  live acceptance pending): KDE `OverlayIconName=dialog-warning` indicates
  effective `kwinrc [Windows]` conflicts without changing SNI Status. The top
  "Conflicting KDE settings..." menu row uses the normal Settings launch
  action; icon click still opens the menu. The tray directly checks the
  three settings-page keys against their KDE defaults and fixed values. It
  rereads the user's `kwinrc` at startup and on a changed file mtime during
  the existing watchdog, so Fix/Revert and user-file edits appear without a tray
  restart, and logs one normal-level line only when the conflict state changes.
- Tray delivery (user decision 2026-09-28, option 2): Home Manager installs a
  systemd user unit wanted by and bound to `graphical-session.target`, using
  the immutable store tray binary with `Restart=on-failure`, replacing XDG
  autostart. No project supervisor. Foreground `just dev` starts
  and owns a worktree tray, includes its stderr diagnostics in the labeled dev
  trace, and stops only its verified instance at teardown. An already-owned
  tray name is logged and preserved. Dogfood starts its worktree tray on
  demand. A second instance exits successfully when the D-Bus name is taken.
  The tray stops if its own name or connection is lost, or at session teardown;
  the unit restarts failures but not a successful duplicate-name exit or a
  graphical-session stop.
  Name acquisition/loss, owner transitions and changed or refused snapshots
  emit bounded, redacted diagnostics on stderr. The user unit captures stderr
  in the journal, queried with
  `journalctl --user -g "plasma-auto-tiler:route-diag component=tray-endpoint"`;
  dev logs and on-demand terminal runs retain their own stderr sinks.
  Dev worktree tray builds bake the absolute `kcmshell6` path when available;
  without it, the tray still builds and Settings reports unavailable. Settings
  launch outcomes emit fixed, redacted tray diagnostics.
- The tray retains the unified Settings path and the workspace tiling controls
  selected above; host-conflict warning is separate from tiling status.
- Tray live runs claim no KWin snapshot authority, panel visual behavior,
  session boundary, watcher-ordering/login/systemd delivery, native
  ABI/plugin load, baseline-restoration proof, KWin Script1 identity or
  cleanup, or update/rollback generation. Full evidence is in
  `changes/archive/tray-carrier.md` and
  `changes/archive/tray-managed-live-acceptance.md`.

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
  input, matching it to the same window and identity at drag start and
  carrying it atomically with the final-geometry verdict. A usable press
  selects KWin 6.7.5 thirds regardless of the 64 px interior gate;
  absent/unusable press evidence falls back to the Started-pointer
  classifier, with a bounded fallback log. The effective binding is read
  from KWin when public options are available; only an unavailable binding
  source uses and logs the KWin source default. The unified effect and
  existing oracle endpoint retain their identities.
- User decision 2026-09-27, option A (shipped offline, live check pending):
  tiled move drops use the existing Rust core drop resolver as-is through the
  synchronous `drag-drop` Plan route (window edge split, group edge
  first/last or wrap, group interior insert; center or unresolved snaps back
  through the existing restore marker). Finish pointer capture and single-flight
  dispatch remain; the 2026-09-27 cross-output and preview decisions below
  replace option A's cross-domain refusal and no-preview restrictions.
- User decisions 2026-09-27 (shipped offline, live check pending): a
  tiled move to another output joins that output's tiling AT THE DROP POINT
  through the same destination-domain core resolver, removing source-domain
  membership. Do not snap back to the source, admit at ordinary placement or
  let a source-scoped restore marker fight the placement. During a tiled move,
  a separate native-effect filled translucent target-slot rectangle appears
  above windows, hidden for center/snap-back targets and cleared at drop,
  cancellation or refusal. Its lifetime is independent of the Meta-held group
  outline. Orchestrator choices: carry the existing exact 80px sticky group-edge
  hover prior across preview samples into drop and derive preview from fresh
  complete observations with size hints using the same resolver. The default
  preview fill is #2A82DA at alpha 64. Orchestrator clarification: destination
  means the output under the pointer at Finish even if KWin's native mover
  output still names the source. If needed, send the mover to that output
  before planned geometry and verify current destination membership using
  existing observation/reconciliation; no new arrival timer or retry. Offline
  verification and the remaining-size rationale are in
  `changes/archive/cross-output-drag-preview.md`.
- The drag oracle hosted in the disabled-by-default unified
  `plasma-auto-tiler-active-border` native effect records final drag geometry;
  after that effect's explicit enable, the production script pulls its
  read-only session D-Bus verdict. Resize and move verdicts route as ruled
  above, while a floating move stays native-only; a cancelled or no-change
  verdict makes no plan. No stock-KWin
  parity or atomic native geometry-write claim is selected. AR8 closed on
  2026-09-24 at the user's request with the shipped oracle integration kept,
  following the Lead's recommendation; trace-only measurement remains for
  drag diagnosis.

## Deferred Scope

- The current KWin adapter uses one session-D-Bus `DescribePlan` route to a
  pinned unique Planner owner, with same-UID caller checks. This does not
  select a generic cross-platform IPC abstraction or prove the initially
  resolved same-UID Planner binary against a hostile same-UID owner.
- Rust is the selected engine language and owns the durable portable model:
  platform-neutral deterministic core for logical tiling, ordered split-tree
  grouping, navigation, movement policy, capability-gated plans, and
  reconciliation. Platform adapters retain native window/output/workspace
  observation, identity, permissions, geometry/focus actuation, event
  ordering, acknowledgement, recovery, effects, UI, and delivery authority.
  The core promises no uniform workspace, group, atomicity, or geometry
  semantics where public platform APIs cannot provide them; unsupported paths
  fail closed. The migration starts incrementally through opt-in, shadow, and
  diagnostic modes and claims no stock-KWin parity, atomic geometry,
  Windows/macOS delivery, IPC/service/FFI topology, runtime, or packaging
  model. A KWin fork or patch remains rejected.
- Durable validation prioritizes product-shaped Rust unit/integration/property
  coverage and focused adapter contracts over lifecycle automation for
  assertion count. KWin direct geometry remains sequential and non-atomic:
  the adapter is signal-driven, minimizes visible intermediate frames, and
  records applied-versus-acknowledged divergence without claiming atomicity.
- Retain JavaScript for discrete window add/remove management. Group behavior,
  inactive borders, Steam-specific handling, and complete keyboard-layout
  support remain deferred.
