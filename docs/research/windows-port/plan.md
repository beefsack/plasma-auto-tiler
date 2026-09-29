# Windows port: decision plan

Status: research proposal, 2026-09-29. Builds on
[cross-platform feasibility](../cross-platform-support/feasibility.md) and the
[portable-policy audit](../cross-platform-core/extraction.md). `VISION.md`
requires tiling, groups, borders, shortcuts and workspaces, with no impact on
fullscreen gaming. Existing KWin decisions remain in `docs/decisions.md`.
This plan recommends Windows choices; none has been approved or tested live.
The matching [macOS plan](../macos-port/plan.md) compares host constraints;
the [core extraction audit](../cross-platform-core/extraction.md) now includes
a three-host capability and sharing comparison.

**Recommendation [I: W1-W6]:** start on Windows 11 x64 with one per-user Rust
process. Prove geometry, shortcuts and game exclusion on real Windows. Build
per-monitor logical workspaces if a reversible hide/reveal prototype passes
taskbar, Alt+Tab and crash recovery. Do not require private virtual-desktop
or shell-cloaking APIs for release.

## Evidence key and baseline correction

The earlier feasibility study is a useful starting point; its Windows scope
needs a first-class workspace gate, and Win+L needs a separate policy choice.

- **V**: documented vendor API or checked license. **O**: upstream issue or
  implementation, not a Windows guarantee. **I**: proposal or unverified
  behavior. Source keys are listed below; checked 2026-09-29.
- [V: W5,W6; O: U1] The 2026-09-17 study correctly left cross-process
  `DWMWA_CLOAK` open and identified the public virtual-desktop limit.
  Managed workspaces still need shell and recovery proof.
- [I: `VISION.md:15`, `docs/decisions.md:689-727`] Its native-current-desktop
  scope is a good prototype but does not deliver per-output workspaces.
  KDE's Lock Session relocation does not by itself prove Win+L can be
  relocated; see the policy options below.
- [V: W21] Windows 10 Home/Pro support ended 2025-10-14. Windows 11 is the
  proposed release floor; Windows 10 is an optional compatibility experiment.

## Development and iteration

Use a Windows VM for fast, reversible iteration and physical Windows for
games and final visual acceptance. Desktop Window Manager (DWM) is Windows'
compositor; its behavior in a virtual GPU is not a physical-GPU guarantee.
User Account Control (UAC) prompts switch to a separate secure desktop.

| Route | Use and limits | Decision |
| --- | --- | --- |
| Windows machine or dual boot | Real DWM, Explorer, UAC, games, sleep, mixed-DPI and driver paths; dual boot interrupts the NixOS edit loop [I: W1,W7]. | **Required acceptance host**; a separate Windows box with remote file transfer is preferable to repeated reboot [I]. |
| Local KVM/QEMU VM | Fast disposable snapshots and real Windows guest API; virtual GPU/RDP/display-driver path may differ from physical game/overlay behavior [I: W7]. GPU passthrough improves representativeness but costs hardware/host isolation; no equivalence claimed [I]. | Main interactive integration lab, physical Windows for game/frame-time sign-off. |
| NixOS cross-build | `cargo xwin build --target x86_64-pc-windows-msvc` uses MSVC-compatible SDK/import libs with clang/linker tooling [V: W7]; evaluate `x86_64-pc-windows-gnu`/mingw only as fallback, especially when native dependencies differ [I]. | Keep Nix `devenv.nix` unchanged until an approved build spike identifies dependencies. Pin Windows target/tool versions in CI; never install host dependencies ad hoc (`AGENTS.md`). |
| Wine | Useful for launch/protocol smoke; Wine's LL hook and shell implementation is not Windows Explorer, secure desktop, Snap, DWM or anti-cheat [O: W8; I]. | No behavior acceptance. |
| GitHub Windows runner | Compile, test, lint, package; hosted runner is not a logged-in interactive DWM/game acceptance environment [V: W9; O: W9]. | Gate source/release builds on a pinned `windows-2025` or `windows-2022` image, not `windows-latest`; self-hosted interactive VM for optional regression matrix [I]. |

**Iteration loop [I: W7,W9,W20]:** edit and test core on NixOS with
`cargo test -p tiler-core -p tiler-protocol`, then cross-build or build on the
Windows VM. A proposed Windows-only `just win-dev` action asks the running
tiler to restore windows and exit, waits, deploys the artifact, starts it,
checks readiness/tray registration and prints the log path. `just win-dev
trace` adds bounded event detail; `just win-dev stop` restores visibility and
owned border changes. Reject replacement if restore is uncertain. Keep the
existing Linux `just dev` path independent. Release CI builds/tests a locked
tagged source, signs its artifact and smoke-tests install/update in a fresh
VM; physical hardware supplies game and accessibility acceptance.

## Process, authority and lifecycle

Run one Rust executable in each user's interactive session, not a Windows
service. Services run in noninteractive Session 0, where they cannot manage
the user's window handles (HWNDs) [V: W1,W2].

- [I: W2,W3; `docs/decisions.md:50-58`] The executable hosts event listeners,
  `tiler-core`, window control, recovery state, tray and an on-demand settings
  window. Add a separate input thread only if interception tests require it.
  KWin's planner/script/effect/tray responsibilities need no matching Windows
  processes or D-Bus/JSON hop. Use `tiler-protocol` for external IPC only.
- [V: W4] User Interface Privilege Isolation (UIPI) restricts lower-integrity
  processes from sending certain messages to higher-integrity processes.
  Integrity level (IL) is Windows' low/medium/high process trust level; an
  ordinary user app normally runs at medium IL. Test each window operation
  separately rather than treating UIPI as a blanket geometry ban.

| Concern | Proposed behavior and evidence |
| --- | --- |
| Login | [V/I: W10,W11,W19] Choose a per-user logon-triggered scheduled task without elevation; compare delayed `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, Startup folder and packaged MSIX startup. | Enable startup only by user choice. |
| Single instance / restart | Single instance *per session/user*, via named per-user mutex plus same-user ACL/lockfile; avoid global-name squatting. New CLI invocation talks to the running owner, or exits; never assumes an abandoned mutex restores windows [V: W10; I]. `RegisterApplicationRestart` does not guarantee unattended crash restart (runtime/consent conditions); compare scheduled task restart and a lightweight per-user launcher against the risk of restart loops. Always reconcile from current complete observations [V: W10; I]. |
| Lock, switch, RDP, sleep | `WTSRegisterSessionNotification`/`WM_WTSSESSION_CHANGE`, `WM_POWERBROADCAST`, display topology/DPI messages; stop writes/overlays during lock, UAC secure desktop and inactive/RDP session, invalidate monitor handles, replay no setter, enumerate fresh and rebind on unlock/resume [V: W10,W14; I]. Detect Explorer `TaskbarCreated`, re-add tray and reconcile work areas [V: W13]. |
| Elevation and IPC | Stay medium integrity. UIPI/foreground constraints mean elevated, system, UAC and protected windows are an explicitly unmanaged class until per-operation geometry/hook proof; never auto-elevate or use UIAccess as an assumed workaround [V: W4,W15; I]. Same-user trust follows `docs/decisions.md:118-125`; if a CLI/updater/settings sidecar is needed, use a session-local named pipe with user-scoped security descriptor, owner identity and request bounds/correlation, no open network port. Do not use `WM_COPYDATA` across IL as the primary transport [V: W4; I]. |

## Window control and eligibility

Start with ordinary same-integrity windows. Every move needs a fresh native
readback: an API call returning success is not proof that the app accepted
the requested rectangle.

- [V: W2,W16-W18] `EnumWindows` and out-of-context `SetWinEventHook` observe
  creation, foreground, location and move/size lifecycle. The hook thread
  needs a message loop. Shell hooks supplement but do not replace complete
  enumeration; UI Automation can supply role/bounds for difficult apps.
- [I: W2] Coalesce our own move events, enumerate afresh after missed events,
  Explorer restarts and resume, and keep UI Automation off the hot path.
- [V: W2,W16] `SetWindowPos` and `DeferWindowPos` batch window moves, but do
  not acknowledge client acceptance. Use `SWP_NOACTIVATE|SWP_NOZORDER` for
  geometry, then read back and reconcile app-enforced minimum/maximum sizes.
  `SetForegroundWindow` can refuse a focus request.
- [V: W16] Set Per Monitor v2 dots-per-inch (DPI) awareness in the manifest.
  `GetWindowRect` includes invisible resize borders and can be DPI-virtualized;
  DWM's `DWMWA_EXTENDED_FRAME_BOUNDS` gives visible bounds without DPI
  adjustment. Convert the desired visible rectangle to each app's outer
  window rectangle and remeasure after scale/output changes.
- [I: W4,W5,W16; `docs/decisions.md:551-583`] Classify owned dialogs,
  Universal Windows Platform (UWP) frames, cloaked, minimized, elevated and
  protected windows before tiling. Keep already-tiled fullscreen/maximized
  allocations, and do not classify an output-sized rectangle as fullscreen
  solely by its dimensions.

## Shortcuts and host-setting conflicts

Many Win-key shortcuts can be overridden, but there are two distinct routes:
`RegisterHotKey` tries to register a chord, while `WH_KEYBOARD_LL` can suppress
the key event before it reaches ordinary consumers. `MOD_WIN` is documented as
reserved, so neither route guarantees a particular shell chord [V: W3].

- [V: W3; O: U11] AutoHotkey documents overriding native Win+E/Win+R.
  Bare `#key::` uses `RegisterHotKey` when possible; `#UseHook` or `$`
  explicitly selects its keyboard hook. Thus AutoHotkey bindings alone do
  **not** prove that `WH_KEYBOARD_LL` was used for Win+D, Win+Tab or Win+number.
- [V: W3; O: U11] A low-level hook runs on the installer's message-loop
  thread and may be silently removed after a timeout. AutoHotkey documents
  sending a harmless "menu mask key" before Win release to avoid opening
  Start. This is an implementation precedent, not a promise on our builds.
- [I: W3,U11] Offer configurable non-Win defaults first, with opt-in Win-key
  takeover where verified. Keep the hook fast and disabled in game mode.

Secure attention sequence (SAS) means Ctrl+Alt+Del's Winlogon-controlled
security path; an ordinary keyboard hook cannot replace it [V: W12].

| Chord | Documented / observed capability | Windows product position |
| --- | --- | --- |
| Win+Arrow | [V: W3; O: U3] OS Snap shortcut; FancyZones has an explicit override. | Opt-in after measuring Snap coexistence. |
| Win+Shift+Arrow | [V: W12; O: U3] Left/Right move between monitors; Up/Down stretch or restore. FancyZones deliberately leaves the monitor-move chords intact. | Probe hook takeover per direction; different default. |
| Win+D | [V: W12; O: U11] OS Show Desktop; AutoHotkey supports overriding built-in Win hotkeys generally. A verified hook-based `#d::` result is still missing. | Observed-overridable class; test actual method and shell suppression. |
| Win+Tab | [V: W12; O: U11] OS Task View; AutoHotkey's documented generic Win-key override applies, but no per-chord hook guarantee was found. | Same: probe `#Tab::` with and without forced hook. |
| Win+1..9 | [V: W12; O: U11] OS taskbar activation; generic override precedent, not a verified `#1::` hook result. | Same: probe each digit and taskbar result. |
| Win+L | [V: W12; O: U12] Lock path persists despite ordinary AutoHotkey interception. Enabling the **per-user lock-disabling policy** can free the chord, but removes other locking paths too. | Two explicit options below; default preserves locking. |
| Win+Z, Win+G, Ctrl+Alt+Del | [V: W3,W12] Snap layouts, Game Bar, secure attention respectively. | Avoid by default; do not promise SAS takeover. |
| Other user chords | [V: W3] `RegisterHotKey` reports collisions rather than transferring ownership. | Configurable non-Win default, e.g. `Alt+H/J/K/L` after conflict testing. |

**Win+L policy choice.** Windows maps "Remove Lock Computer" to
`HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System`, value
`DisableLockWorkstation=1` (DWORD). This is a *user-scoped* policy, not an
administrator-only HKLM
change [V: W12]. Normal HKCU writes need no elevation when the key's access
control list allows `KEY_SET_VALUE`; organizational policy can deny or
overwrite the value [V: W30]. Windows documents that enabling it prevents
workstation locking, including the Ctrl+Alt+Del Lock route [V: W12].

| Option | Consequence | Recommendation |
| --- | --- | --- |
| Keep lock policy unset; bind focus-right elsewhere | [V: W12] Win+L remains a reliable user lock action. | Default. |
| User explicitly opts into Win+L; set policy to 1 only after snapshot/readback | [V: W12; O: U12] Policy prevents locking; community reports say the Ctrl+Alt+Del Lock entry disappears and `LockWorkStation()` may also fail. Simply moving lock to another chord is **not established**. | Offer only if a reversible VM proof finds a functioning replacement lock and a reliable restore path. |

The policy documentation does not specify whether a registry write takes
effect without logoff or whether `LockWorkStation()` still works. Community
reports differ on refresh timing and report that the API can fail while the
policy is set [O: U12]. Test the policy, both locking paths and hook delivery
before/after writing it. Revert by removing only our owned value (or restoring
the exact prior value), read back, and re-test actual locking. If a policy
controller overwrites it or the old state cannot be proved, leave it alone
and show the conflict. This is closer to KDE's explicit Fix/Revert than a
silent shortcut reassignment, but carries a broader loss of lock access
[I: `docs/decisions.md:96-117,749-836`].

[I: W3,U11; `docs/decisions.md:96-117`] Test AutoHotkey-style menu masking,
key-down/up and Start behavior without logging raw keystrokes. Snap Assist
and layouts can compete with dragging as well as hotkeys; settings should
show current conflicts and explicit Fix/Revert, never change global Snap at
install/startup. Preserve a preimage for any setting we actually change;
uninstall restores only an unchanged project-owned override. Keep elevated
foreground windows unmanaged until hook, geometry and focus are tested
separately [I: W4].

## Dynamic workspace choice

Native Windows virtual desktops cannot supply independent workspaces on two
monitors through the documented API. A managed visibility layer is the
candidate, contingent on crash and task-switcher behavior.

| Approach | Capability / shell cost | Recommendation |
| --- | --- | --- |
| Native virtual desktops | Public `IVirtualDesktopManager` only Get ID, Is current, Move HWND to *known* desktop GUID; no create/list/select/remove, and native selection is global, not independently per monitor [V: W5; I]. Task View/taskbar and crash restoration stay Windows-owned [I]. | Interoperate with native desktop *current-visible* windows; no native-only parity claim. |
| `IVirtualDesktopManagerInternal`, VirtualDesktopAccessor, `winvd` | Undocumented COM interfaces/IIDs and method signatures have changed across builds; VirtualDesktopAccessor documents build-specific support, wrappers cannot make a private ABI stable [O: U6]. | Do not build release workspace authority on them. Could benchmark in throwaway spike only. |
| Project-managed, own logical `(monitor,workspace)` domains | Supports per-output-local/global-unique/shared, numbered trailing empty and background plans using existing core domains [O: `crates/tiler-core/src/session/world.rs:31-75`; I]. Visibility and focus/recovery become our responsibility; Alt+Tab/taskbar/Task View are not defined as a third-party workspace protocol [V: W6; I]. | Preferred target if a reversible visibility strategy passes gate; otherwise pause full workspace release rather than silently remove first-class behavior. |

**Visibility mechanics:** a hidden window is not a minimized window.

- [V: W6; O: U1,U2,U4] `ShowWindow(SW_HIDE/SW_SHOWNA)` is public, but may
  affect taskbar/Alt+Tab or be reversed by the app. Minimize changes the app's
  state; offscreen parking leaves a window mapped. komorebi uses private
  `IApplicationView::SetCloak` for foreign windows. The documented
  `DWMWA_CLOAK` setter has no documented cross-process authority; an external
  repro reports `E_ACCESSDENIED`.
- [I: W6] Prototype `ShowWindow` first, comparing other methods only to learn
  their shell behavior. A switch hides the owned inactive set, reveals the
  target without activation, observes focus and reconciles. Explicit quit,
  update and uninstall restore only project-hidden windows.
- [I] Before hiding, atomically record the owner, version and bounded window
  identities. On restart, verify process/session identity before revealing:
  an HWND can be reused. Keep a recovery command and visible failure status.
  No process can re-show windows after a crash until something relaunches it.
- [I] Gate adoption on two-monitor switching, taskbar/Alt+Tab/Task View,
  accessibility, fullscreen, pinned windows and forced-process-loss tests.

## Border, underlay and drop preview

An independently stacked window can draw a real group underlay. The leading
candidate is a non-topmost layered window inserted immediately **behind**
the group's lowest member, rather than a topmost fill drawn over the group.

| Surface | Option and limitation | Recommended order |
| --- | --- | --- |
| Active border | `DWMWA_BORDER_COLOR` Win11 build 22000+ is native but fixed by system frame geometry/thickness and foreign-HWND setter behavior must be probed; restore `DWMWA_COLOR_DEFAULT` on release [V: W6; I]. GlazeWM uses this attribute [O: U2]. | Spike first, adopt only if visibility/ownership and exact restore pass; configurable gap/width/radius needs own overlay [I]. |
| Configurable active outline / drag fill | [V: W6,W16; O: U1,U3] Own layered click-through `WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE` window; PowerToys uses per-monitor preview windows and komorebi uses separate border windows. | Place active outline above its target but below owned dialogs when possible; preview exists only during drag. Test focus/input and stacking. |
| Group **underlay** | [V: W2,W31; I] `SetWindowPos(underlay, lowest_member, ..., SWP_NOACTIVATE|SWP_NOMOVE|SWP_NOSIZE|SWP_NOOWNERZORDER)` inserts the underlay *after* (behind) that member in Z order. If group members occupy a contiguous non-topmost block, it is behind them and above lower non-group windows. | Leading candidate. Recheck membership and Z order on foreground/reorder events; measure lag, topmost and modal failure modes. |
| Per-window child / DirectComposition | Child of a foreign HWND, compositor injection or reparenting changes app ownership/input and is outside supported first path; DirectComposition can improve owned-layer rendering but adds complexity [V: W6; I]. | Do not use to bypass window-manager boundary. |

**Z-order failure cases:** placement is only as stable as the current stack.

- [V: W2,W31] Topmost windows stay above normal windows; owned popups must
  stay above their owner. `GetWindow(GW_HWNDNEXT)` can inspect what is below
  a group member, but Microsoft warns against an unbounded walk when HWNDs
  disappear mid-enumeration.
- [O: U1,U13] komorebi supports multiple border Z-order modes and repositions
  borders on events. A popup-overdraw report shows the cost of permanently
  topmost borders.
- [I] Bound and validate the walk, find the lowest eligible group member,
  insert the underlay beneath it and verify the resulting order. Recheck on
  foreground, reorder, show/hide and drag; skip redundant moves. Foreign
  windows can interleave members. Suppress the underlay if mixed topmost/
  owned members or occlusion prevent a correct view; never reorder apps to
  make the underlay visible. Place the active ring *above its target* and
  below its owned dialog when possible, rather than at the group's bottom.

**Game gate:** hide visuals and stop tiling writes while a game owns the
monitor. Measure residual work rather than assuming zero overhead.

- [V: W22] `SHQueryUserNotificationState` distinguishes exclusive Direct3D
  fullscreen from broader busy/presentation states, but it is a notification
  hint and sends no fullscreen-start event.
- [I: W3,W22] Cross-check foreground, monitor bounds and exclusions; test
  exclusive, borderless and fullscreen-optimized games plus Game Bar and
  anti-cheat. Measure input latency, frame time, CPU and geometry calls;
  disable hooks/overlays if their residual impact is measurable.

## UI, language and native feel

Users will notice a tiler that repaints unaffected apps, leaves a border
over dialogs or steals focus more than one that lacks animated moves. Favor
exact geometry and quiet, event-driven visuals.

- [V: W23,W24; I] `windows-rs` exposes Win32, DWM and Component Object Model
  (COM) APIs to Rust. Start with Rust for the tiler, Win32 tray and settings.
  WinUI 3 offers Fluent/Mica but adds Windows App SDK integration; WPF would
  require a C#/.NET settings process. Use either for a measured control or
  accessibility gap, not as a prerequisite for tiling.
- [V: W13,W25,W26; I] `winit` provides a window loop, not native controls;
  `egui` is non-native in appearance and needs Narrator/contrast checks.
  Slint has attribution/commercial licensing choices. Audit `tray-icon` for
  Explorer restart, menu keyboard use and notification icon version 4;
  `Shell_NotifyIcon` directly is another small Rust integration path.
- [V: W6,W13,W26; I] Use a keyboard-accessible notification-area menu and
  re-add its icon on Explorer's `TaskbarCreated`. Settings should follow
  Windows 11 spacing, system accent and optional Mica backdrop, with dark,
  light, contrast and reduced-motion support. Display confirmed state, not
  merely queued commands. Localize labels later; retain stable action IDs.

**Observed sources of jank:**

- [O: U14] komorebi users reported JetBrains IDEs flickering on *other*
  windows' events. Its `54c58be` fix compares both window and border
  rectangles before calling `SetWindowPos`. Skip no-op setters and measure
  repaint behavior across apps, not just the focused window.
- [O: U13,U14] A GlazeWM 3.10.1 report describes the same JetBrains symptom;
  no-op `SetWindowPos` is the reporter's hypothesis, not a proven GlazeWM
  cause. GlazeWM also merged a delayed border-color reapply for flicker.
  komorebi reported borders painted over Save dialogs and border lag with
  animation enabled. These are concrete focus/visual defects, not evidence
  that Windows itself animates every move.
- [O: U15] A komorebi user reported a Firefox title update pulling focus
  back to its monitor. A GlazeWM user reported workspace switches when an
  inactive Files window took focus after a download; their proposed fix was
  still an open PR. Do not switch workspace merely because a hidden app
  emits a foreground-like event. Check actual foreground and user intent.
- [I: W2,U13,U14] Test focus changes, window creation, resizing, native
  dialogs and optional animations for flicker, lag, redraw and unintended
  activation. `SWP_NOACTIVATE` prevents our overlay move from activating it;
  it cannot prevent another app or the shell from restacking windows.

**Windows move animations [V: W2,W6,W32]:** plain `SetWindowPos` specifies
geometry, not an animation curve. `AnimateWindow` is a separate API, while
Snap/minimize/maximize can have shell/DWM transitions. The per-HWND
`DWMWA_TRANSITIONS_FORCEDISABLED` attribute takes a BOOL: TRUE disables DWM
transitions and FALSE enables them. Documentation does not show that ordinary
`SetWindowPos` moves animate, that this attribute stops Snap, or that it
can safely be set on a foreign app's HWND. Do not blanket-disable it.
Compare video and readbacks on an owned window, then test foreign-HWND
permission and exact restoration before considering an opt-in override.
If the previous value cannot be read, do not change a foreign HWND [I].

## Packaging, signing, updates and observability

Prefer per-user installation and an update path that restores hidden windows
before replacing the process. Packaging must not create a second tiler owner.

| Path | Fit | Recommendation |
| --- | --- | --- |
| MSIX + App Installer / Store | Signed package identity, per-user registration, startup-task extension and update channel; packaging/runtime/extension behavior needs a proof [V: W19,W20]. Store-submitted MSIX is signed by Microsoft [V: W20]. | Investigate after host and startup proof; do not assume classic Run/installer hooks work identically. |
| WiX MSI / Inno Setup EXE | Conventional per-user or machine installer, explicit startup/revert and repair, but no automatic update built in [V: W19; O: U8]. | Signed per-user installer is preferred; compare WiX enterprise MSI vs simpler Inno EXE after updater proof [I]. |
| Portable zip | Fast dev and manually started trial, no guaranteed login, uninstall, host-setting cleanup or updater [I]. | Provide a signed portable channel only with restore/stop CLI and clear owner precedence [I]. |

[V: W27] Velopack has a Rust client and HTTP update/packaging flow. Its
`vpk` CLI needs .NET SDK 8 on the Windows release runner, not the NixOS dev
shell. [I] Test update with a running owner, hidden-window restore, rollback
and signing order before choosing it. Compare `winget`-driven/manual upgrades
and MSIX App Installer. Publish signed GitHub releases and a `winget`
manifest; Scoop/Chocolatey may carry community-maintained packages [V: W28].
Keep Windows CI independent of Nix/KDE delivery. Pin source/tools, record
hashes and signing identity, and check unsigned payload determinism separately
from timestamped signed packages [I].

[V: W20] Azure Artifact Signing (formerly Trusted Signing) costs about
US$9.99/month at the basic tier and limits individual eligibility by region.
Organization-validated certificates run roughly US$150-300/year plus hardware
key storage; extended validation costs more and no longer immediately clears
SmartScreen. Microsoft signs Store-submitted MSIX packages. [I] Check the
owner's eligibility before buying signing, and keep publisher identity stable
across EXE, installer and update metadata.

[I: `docs/principles.md:50-66`, W29] Write bounded structured `tracing`
summaries under `%LOCALAPPDATA%\plasma-auto-tiler\logs`; enable redacted
event detail with `trace`. Correlate command, observation, setter, readback
and recovery; distinguish dispatch, acceptance, application and uncertainty.
Exclude titles, app content, raw HWND/process IDs, executable paths and
payloads from ordinary logs. Logging failure must not stop tiling. Event
Tracing for Windows (ETW) can later support performance diagnosis; Event Log
provider registration adds installation work. Use no code injection, kernel
driver, network listener, raw keystroke log or elevated helper by default;
scope any named pipe to the same user [V: W4].

## Upstream lessons and licensing

Upstream projects demonstrate practical techniques and failure modes, not
Windows guarantees. Their checked licenses constrain code reuse.

| Project | Evidence and transferable lesson | License / reuse |
| --- | --- | --- |
| komorebi (Rust) | [O: U1,U13,U14] `komorebi/src/window.rs` supports hide/minimize/private cloak and recovery; `komorebi/src/border_manager/mod.rs` defines top/non-topmost/bottom modes, while `border.rs` follows location changes. Its flicker and popup issues are instructive. | [V: U1,U6] Komorebi License 2.0.0 restricts derivative redistribution. Study only; independently licensed MIT `VirtualDesktopAccessor` code needs separate provenance. |
| GlazeWM (Rust) | `packages/wm-platform/src/native_window.rs` calls DWM border color; workspace/overlay methods expose Win11 1px limits and hide tradeoffs [U2]. | GPL-3.0 project: study, do not copy into a differently licensed binary without a deliberate license decision [U2]. |
| PowerToys FancyZones | WinEvent-backed per-monitor zone overlay and explicit Snap override; not automatic split-tree authority [U3]. | MIT, reuse possible with notice and independent fit assessment [U3]. |
| Whim | MIT C# plugin/workspace architecture; README explicitly avoids native desktops for per-monitor workspaces [U4]. | MIT, conceptual/data reuse with notice; not a Rust engine drop-in [U4]. |
| workspacer | MIT C# workspace/window filters and hide behavior [U5]. | MIT, reuse possible with notice; hide/reveal is not Windows virtual-desktop parity [U5]. |
| bug.n | AutoHotkey tiler/bar and shortcut patterns [U9]. | GPL-3.0, study only absent license change [U9]. |
| Seelen UI | Rust/Tauri custom desktop UI and workspace behavior; a larger replacement-shell direction than this tiler [U10]. | AGPL-3.0, study only absent license change [U10]. |

[I: W23,W25,U7] Check this repository's outbound license and the exact
third-party revision before reusing any code. `windows-rs`, `winit` and
`tray-icon` are candidates, not selected dependencies.

## Recommended architecture at a glance

One non-elevated Rust process owns desktop control. Native Windows APIs are
called in its adapter; no KWin processes or effect library are transplanted.

- [I] **Processes:** tiler, observer, actuator, visuals, tray and settings
  window share one user-session process. An installer/updater runs separately
  only while replacing binaries; an optional CLI uses a same-user named pipe.
- [I] **Crates:** retain `tiler-core` as layout authority. Use
  `tiler-protocol` only for external versioned messages. A proposed
  `tiler-windows` crate/binary owns Windows events, physical pixels, window
  visibility, input and shell lifecycle. Follow the
  [extraction audit](../cross-platform-core/extraction.md) for shared policy.
- [I] **Languages/dependencies:** Rust and `windows`/`windows-sys`, with
  `tracing`; evaluate `tray-icon` and Velopack behind their proof gates.
  C#/C++ is a contingency for a demonstrated settings/accessibility gap.
  Build Windows 11 x64 with the MSVC toolchain first.

## Phased roadmap (qualitative)

Capability spikes come before permanent Windows adapter work. Each phase
needs a visible result, including negative results where an API refuses.

| Phase | Goal / scope | Exit evidence | Throwaway spikes first | Effort / risk |
| --- | --- | --- | --- | --- |
| 0. Host truth | Choose Windows 11 build/hardware, Dev VM and CI loop; capture benchmark of unmodified games, Snap, DPI. | Cross-compile and Windows runner produce same-version smoke binary; VM deploy/restart/log read, physical game baseline recorded. | MSVC `cargo-xwin` vs Windows-native build; QEMU virtual GPU vs passthrough; Wine launch vs real DWM. | Small-medium / medium. |
| 1. Capability probes | Establish input, visibility, geometry, z-order and game gates on disposable owned windows. | Return-value/readback matrix on two DPI monitors; observed shell, app and elevated-window behavior. | `RegisterHotKey` vs forced hook for Win+D/Tab/number/Arrow/Shift; Start menu mask; isolated VM Win+L policy write, immediate readback, Ctrl+Alt+Del Lock and `LockWorkStation()`, restore; `SetWindowPos` underlay insertion/contiguity/owned popups; DWM transitions flag on owned and foreign windows; hide/crash recovery and game overlays. | Medium / highest. |
| 2. Normal-window tiling | Windows adapter into existing Engine, foreground and hidden-domain observation, focus and recovery; separate UI from control. | Owned-app and representative real-app tiling/readback, 3-strike/evidence policy decision, sleep/hotplug/RDP/Explorer restart, no game writes. | WinEvent missed-event/reconciliation and DPI clamp; UWP/owned-modal eligibility; hook thread overload/silent removal. | Large / high. |
| 3. First-class workspaces and visuals | If visibility passes, per-monitor switch/send and recovery; active border, inserted group underlay and drop preview. | Two independent monitors, trailing empty, no focus theft, taskbar/Alt+Tab behavior accepted, crash restores windows, underlay stable under focus and dialog churn; no game impact. | Forced-kill visibility ledger; shell cloak only for comparison; underlay `GW_HWNDNEXT` verification across topmost/owned/noncontiguous windows; DirectComposition vs layered preview; no-op setter flicker. | Large / highest. |
| 4. Settings, delivery and release | Live settings, shortcut/Snap conflict Fix/Revert, tray, signing, auto-update, recovery/uninstall. | Narrator/contrast/dark/light, keyboard/tray Explorer restart, clean per-user install/update/uninstall + owned-setting restore, signed release and Windows CI gates. | Win32/tray-icon vs WinUI/Slint UI; Scheduler vs HKCU Run vs MSIX startup; Velopack atomic update/rollback; Azure signing eligibility/SmartScreen. | Medium-large / high. |

[I: W9] Test portable Rust behavior on Linux and Windows, headless contracts
on hosted CI, window/event journeys in the interactive VM and secure desktop,
fast switching, sleep, remote desktop and games on physical Windows. Hosted
CI passing does not establish fullscreen or anti-cheat behavior.

## Open user decisions

These product choices remain with the user after the disposable spikes; the
recommendations below are starting positions, not approved behavior.

| Decision | Options and consequences | Recommendation |
| --- | --- | --- |
| Windows target | Win11-only simplifies DWM native border/Mica and avoids ended Win10 Home/Pro support; Win10 needs distinct visual/fallback/test obligations [V: W6,W21]. | Win11 x64 only initially; choose exact minimum build after spike. |
| Workspace release bar | Native-current-desktop only is simpler but violates first-class per-monitor workspaces; project-managed is harder and needs a recovery/shell contract [I: W5,W6]. | Require managed per-monitor proof before calling Windows feature-complete; permit tiling-only development previews. |
| Reserved shortcuts | [V: W3,W12; O: U11] Native Win chords can be overridden in some cases. Opt-in Win+L requires a policy that may disable every lock route, unlike KDE's isolated shortcut relocation. | Non-Win defaults; offer proven Win overrides. Present Win+L policy opt-in only if replacement locking and exact revert pass. |
| Windows visual parity | [V: W2,W31; I] A non-topmost underlay inserted below the bottom member is feasible for contiguous normal groups, but ownership/topmost/restacking can break it. | Prototype true underlay first; consider reduced outline only if the user accepts measured failure cases. |
| Distribution + signing | MSIX/Store cleaner identity but startup limits to validate; signed installer + winget + optional Velopack offers classic desktop control and signing cost; portable lacks lifecycle [V: W19,W20,W27]. | Prototype per-user signed classic installer, defer selecting updater/signing purchase until proof and eligibility. |
| Elevated windows | Exclusion preserves medium-integrity boundary but not full-app parity; UIAccess/signed elevated helper adds security/maintenance cost [V: W4; I]. | Explicit unmanaged state, no elevated helper first release. |

## Risks

The leading threats are unrecoverable hidden windows and any impact on games;
policy-based Win+L and overlay stacking add separate UX risks.

| Risk | Severity / trigger | Containment and proof |
| --- | --- | --- |
| Inactive windows stranded after crash | Critical; managed hide/reveal fails | Owner-tagged recovery ledger, startup restore before normal operation, forced-kill/uninstall smoke; if unsafe, no managed-workspace release [I]. |
| Game latency/anti-cheat or fullscreen overlay | Critical; hook or HWND overlap on game | Physically measured exclusive/borderless/anti-cheat matrix, immediate event-gated disable, no overlay/writes while game active [V: W3,W22; I]. |
| Private COM API churn | High; internal desktops/shell cloak changes | Avoid as required path; build matrix only for comparison [O: U1,U6]. |
| Lost shortcuts / Start/Snap interference | High; Win chords conflict or silent LL removal | Non-Win defaults; hook matrix and recovery; explicit Fix/Revert with settings preimage [V: W3; I]. |
| Lock action disabled by Win+L policy | Critical; no remaining keyboard/API lock route | Do not enable before verifying alternate lock, readback, effect timing, policy owner and exact revert in a VM [V: W12; O: U12; I]. |
| Underlay above dialog or lost behind group | High; topmost, owned or non-contiguous members | Insert behind lowest member, walk Z order, react to reorder; suppress only the affected visual when invariant fails [V: W31; O: U13; I]. |
| DPI/client refusal/UWP/mixed IL | High; geometry/readback mismatch | Per-monitor-v2, physical frame conversion, complete observation, explicit skip with reason, app matrix [V: W4,W16; I]. |
| Explorer, sleep, RDP, fast-user switching | High; stale handles/work area | WTS/power/display/taskbar signals, fresh enumeration and controlled rebind, interactive VM/physical journey [V: W10,W13; I]. |
| Signing/update trust and supply chain | Medium-high; broken updater or SmartScreen | Locked CI, signed package and metadata, staged update rollback/recovery, channel separation [V: W20,W27; I]. |

## Sources (accessed 2026-09-29)

- W1: [Microsoft, interactive services / Session 0](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services). W2: [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos), [DeferWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-deferwindowpos), [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook).
- W3: [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey), [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), [disabling game shortcut keys](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/disabling-shortcut-keys-in-games), [Windows Snap guide](https://support.microsoft.com/en-us/windows/experience/snap-your-windows). W4: [mandatory integrity control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control), [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow), [UIAccess policy](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/user-account-control-only-elevate-uiaccess-applications-that-are-installed-in-secure-locations).
- W5: [IVirtualDesktopManager](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager). W6: [DWM window attributes](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute), [ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow), [extended styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles), [DirectComposition](https://learn.microsoft.com/en-us/windows/win32/directcomp/directcomposition-portal).
- W7: [cargo-xwin](https://github.com/rust-cross/cargo-xwin). W8: [Wine hook implementation](https://github.com/wine-mirror/wine/blob/master/server/hook.c). W9: [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Windows runner images](https://github.com/actions/runner-images), [interactive CI issue](https://github.com/actions/runner-images/issues/3180).
- W10: [WTSRegisterSessionNotification](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsregistersessionnotification), [WM_WTSSESSION_CHANGE](https://learn.microsoft.com/en-us/windows/win32/termserv/wm-wtssession-change), [power notifications](https://learn.microsoft.com/en-us/windows/win32/power/system-power-management-events), [RegisterApplicationRestart](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-registerapplicationrestart), [mutex objects](https://learn.microsoft.com/en-us/windows/win32/sync/mutex-objects), [Task Scheduler logon trigger](https://learn.microsoft.com/en-us/windows/win32/taskschd/logon-trigger-example--xml-). W11: [Run and RunOnce](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys). W12: [Winlogon](https://learn.microsoft.com/en-us/windows/win32/secauthn/winlogon), [DisableLockComputer policy](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-ctrlaltdel#disablelockcomputer), [Keyboard Filter](https://learn.microsoft.com/en-us/windows/configuration/keyboard-filter/), [Windows keyboard shortcuts](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec).
- W13: [Shell_NotifyIcon](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw), [TaskbarCreated](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar). W14: [WM_DPICHANGED](https://learn.microsoft.com/en-us/windows/win32/hidpi/wm-dpichanged). W15: [ChangeWindowMessageFilterEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-changewindowmessagefilterex). W16: [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect), [DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute), [Per Monitor v2](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows), [SetProcessDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocessdpiawarenesscontext). W17: [RegisterShellHookWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registershellhookwindow). W18: [UI Automation overview](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32).
- W19: [MSIX packaging model](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-packaging-model), [MSIX startup task](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask), [desktop StartupTask manifest](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop-startuptask), [MSI per-user context](https://learn.microsoft.com/en-us/windows/win32/msi/msiinstallperuser). W20: [Windows signing options and prices](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options). W21: [Windows 10 Home/Pro lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro). W22: [SHQueryUserNotificationState](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate), [notification-state enumeration](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state).
- W23: [Microsoft windows-rs](https://github.com/microsoft/windows-rs), [Rust for Windows](https://learn.microsoft.com/en-us/windows/dev-environment/rust/rust-for-windows). W24: [WinUI 3](https://learn.microsoft.com/en-us/windows/apps/winui/winui3/), [deploy unpackaged Windows App SDK apps](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deploy-unpackaged-apps), [WPF](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/). W25: [winit](https://github.com/rust-windowing/winit), [egui](https://github.com/emilk/egui), [Slint licenses](https://slint.dev/pricing). W26: [Mica Win32](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-mica-win32), [high contrast](https://learn.microsoft.com/en-us/windows/win32/winauto/high-contrast-parameter). W27: [Velopack Rust](https://docs.velopack.io/getting-started/rust). W28: [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/), [Scoop](https://github.com/ScoopInstaller/Scoop), [Chocolatey](https://docs.chocolatey.org/). W29: [ETW](https://learn.microsoft.com/en-us/windows/win32/etw/about-event-tracing).
- U1: [komorebi `LICENSE.md`](https://github.com/LGUG2Z/komorebi/blob/master/LICENSE.md), [window visibility implementation](https://github.com/LGUG2Z/komorebi/blob/master/komorebi/src/window.rs), [COM adapter](https://github.com/LGUG2Z/komorebi/tree/master/komorebi/src/com). U2: [GlazeWM license](https://github.com/glzr-io/GlazeWM/blob/main/LICENSE.md), [wm-platform](https://github.com/glzr-io/GlazeWM/tree/main/packages/wm-platform/src), [border limitation issue](https://github.com/glzr-io/glazewm/issues/334). U3: [PowerToys MIT license](https://github.com/microsoft/PowerToys/blob/main/LICENSE), [FancyZones design](https://github.com/microsoft/PowerToys/blob/86115a54/doc/devdocs/modules/fancyzones.md), [FancyZones shortcuts](https://learn.microsoft.com/en-us/windows/powertoys/fancyzones).
- U4: [Whim README + MIT license](https://github.com/dalyIsaac/Whim). U5: [workspacer MIT license + sources](https://github.com/workspacer/workspacer). U6: [VirtualDesktopAccessor MIT lineage / build support](https://github.com/Ciantic/VirtualDesktopAccessor), [winvd](https://crates.io/crates/winvd), [private API build-specific example](https://github.com/MScholtes/VirtualDesktop/blob/master/VirtualDesktop11-24H2.cs). U7: [tray-icon MIT/Apache license](https://github.com/tauri-apps/tray-icon). U8: [WiX](https://wixtoolset.org/), [Inno Setup](https://jrsoftware.org/isinfo.php). U9: [bug.n](https://github.com/fuhsjr00/bug.n). U10: [Seelen UI](https://github.com/eythaann/Seelen-UI).
- W30: [Registry key access control](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-key-security-and-access-rights).
- W31: [GetWindow Z-order walk](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindow), [DeferWindowPos placement](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-deferwindowpos), [foreground and reorder events](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants).
- W32: [AnimateWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-animatewindow), [LockWorkStation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-lockworkstation).
- U11: AutoHotkey v2 [Windows hotkey override](https://www.autohotkey.com/docs/v2/misc/Override.htm), [forced hook](https://www.autohotkey.com/docs/v2/lib/_UseHook.htm), [ListHotkeys implementation mode](https://www.autohotkey.com/docs/v2/lib/ListHotkeys.htm), [menu mask key](https://www.autohotkey.com/docs/v2/lib/A_MenuMaskKey.htm).
- U12: [AutoHotkey Win+L and API reports](https://www.autohotkey.com/boards/viewtopic.php?t=69537); [community immediate-effect report](https://learn.microsoft.com/en-us/answers/questions/1306201). These are observations, not Windows API guarantees.
- U13: komorebi [border Z-order implementation](https://github.com/LGUG2Z/komorebi/blob/master/komorebi/src/border_manager/mod.rs), [border positioning](https://github.com/LGUG2Z/komorebi/blob/master/komorebi/src/border_manager/border.rs), [popup-overdraw issue #971](https://github.com/LGUG2Z/komorebi/issues/971), [border tracking issue #1607](https://github.com/LGUG2Z/komorebi/issues/1607).
- U14: komorebi [JetBrains flicker #781](https://github.com/LGUG2Z/komorebi/issues/781) and [no-op position fix](https://github.com/LGUG2Z/komorebi/commit/54c58be858ebe62acb329bd96ea2d60950dfb46f); GlazeWM [JetBrains flicker #1401](https://github.com/glzr-io/glazewm/issues/1401) and [border-flicker fix #752](https://github.com/glzr-io/glazewm/pull/752).
- U15: komorebi [Firefox focus theft #1235](https://github.com/LGUG2Z/komorebi/issues/1235); GlazeWM [focus-stealing request #793](https://github.com/glzr-io/glazewm/issues/793) and [unmerged Files workspace-switch PR #1160](https://github.com/glzr-io/glazewm/pull/1160).
