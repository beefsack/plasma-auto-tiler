# macOS port: decision plan

Status: research proposal, 2026-09-29. Compare the
[Windows plan](../windows-port/plan.md),
[public-API feasibility](../cross-platform-support/feasibility.md) and
[portable-core audit](../cross-platform-core/extraction.md). `VISION.md`
requires tiling, group visuals, shortcuts and workspaces without interfering
with fullscreen games. No macOS port, version floor or visual compromise has
been approved or tested on a Mac.

**Recommendation [I: M1-M9, U1,U6]:** use one signed, non-sandboxed, per-login
Rust application with a small native settings/menu surface. Prove Accessibility
window control and game exclusion first, then prototype project-managed
per-display workspaces by reversible offscreen parking. Do not require private
Space control or weakened System Integrity Protection (SIP). A true filled
underlay behind foreign windows is an unresolved public-API parity gate.

## Evidence key and baseline correction

The 2026-09-17 feasibility study describes a sound single-Space prototype;
first-class per-display workspaces and a *filled* underlay need separate gates.

- **V** means verified Apple documentation or checked license; **O** means
  observed upstream source/issue, not a platform guarantee; **I** means a
  proposed design or unverified behavior. Source keys below were checked
  2026-09-29. Upstream implementation claims remain O even where their
  licenses are V.
- [I: `VISION.md:15-16`, `docs/decisions.md:689-727`; O: U1] A current native
  Space is enough to test tiling, but not the project's per-output-local,
  global-unique and shared modes. Parking is a candidate, not native Spaces.
- [I: M5,U6] An above-window outline is plausible with public AppKit; drawing
  one filled surface *below specific foreign windows* is not established.
  Do not count an overlaid translucent fill as a true underlay.

## Development and iteration

A Mac is the integration and release machine. NixOS remains useful for portable
Rust work, but its desktop cannot stand in for macOS window-server behavior.

| Route | Use and limitation | Decision |
| --- | --- | --- |
| Physical Apple Silicon Mac | [V: M1] Xcode, Apple frameworks, signing and macOS window-server session; [I] real sleep, displays, animation and games. | **Required acceptance host**; remote editing from NixOS is reasonable [I]. |
| macOS virtual machine | [V: M1] The macOS Tahoe license allows up to two additional development/test instances on an Apple-branded Mac already running macOS, subject to its terms. [I] A macOS guest on the NixOS PC is not the licensed local VM route; virtual display/GPU results do not establish game behavior. | Optional disposable Mac-hosted VM for TCC, installer and crash tests; physical Mac for visuals/games. |
| Linux cross-build | [O: M2] osxcross/cross-rs require a separately supplied Apple SDK; merely adding Rust's Darwin target does not supply AppKit libraries or a linker. SDK/Xcode terms govern obtaining and using it [V: M2]. | Test pure Rust on NixOS, cross-check only with a lawfully supplied SDK; build/sign/notarize on macOS. Do not add system tools outside `devenv.nix` [I]. |
| GitHub macOS runner | [V: M3] Hosted macOS images provide Xcode and Intel/arm64 variants; arm64 runners do not provide nested virtualization. Image labels/tools change. [I] CI has no representative logged-in user, two monitors or game GPU. | Pin `macos-15` and a tested 26 image for builds/tests/signing as available; never infer AX, TCC or game acceptance from hosted CI. |

[V: M19; I] macOS 27 Golden Gate released 2026-09-14 and is the current
Apple Silicon release. Include it in physical-Mac acceptance even if hosted
runner images have not yet caught up; keep the exact CI image list pinned.

**Iteration loop [I: M1-M3,M9]:** run `cargo test -p tiler-core
-p tiler-protocol` on NixOS, sync source to the Mac, build an `.app` in a
stable location and sign each development build with the *same* identity.
Stop the old owner, restore any parked windows, replace/relaunch and inspect
permission/observation status before testing. A dev command may later automate
that sequence, but must refuse an uncertain restore. Use a separately signed
release channel; pin SDK, deployment target and runner image. This is a
proposed workflow, not an implemented command.

## Process, authority and lifecycle

Run the tiler in the user's graphical login session. A background system
daemon cannot usefully substitute for a TCC-authorized GUI client [I: M4,M9].

- [V: M4; I] Prefer `SMAppService.mainApp` registration for the signed `.app`
  on macOS 13+ with user-visible Login Items control; use an embedded login
  item only if a separate helper proves necessary. A user LaunchAgent is a
  viable single-process alternative but needs a separately owned plist and
  upgrade/removal lifecycle. Do not install both for the same owner.
- [I: M4] Run `tiler-core`, AX observation, actuation, status menu and on-demand
  settings in one process; give the AppKit main loop and AX observer run-loop
  sources their required threads. Launch registration is not a complete
  single-instance proof: guard duplicate manual launches per GUI login and
  communicate with the existing owner only through same-user local IPC if
  needed. Fast user switching means separate logins, permissions and owners;
  pause writes/visuals in an inactive session and re-enumerate on return.
- [V: M4,M10; I] Subscribe to `NSWorkspace` sleep/wake and session/Space
  changes, and display-reconfiguration callbacks. On wake or user switch,
  discard stale AX elements and display IDs, recheck permission, collect a
  complete observation and converge without replaying setters. An app that
  survives sleep retains its in-memory layout; a relaunched app adopts only
  what it can observe and safely recover.
- [I: `docs/decisions.md:1145-1160`] No transplanted KWin D-Bus planner,
  KWin effect or universal IPC hop. Keep process and recovery ownership local
  to macOS; protect commands from a future UI/CLI with bounded same-user IPC.

## Window observation, control and eligibility

Accessibility (AX) is a best-effort per-application control plane. A setter
return is not proof that the requested frame actually appeared.

- [V: M6] `AXUIElementCreateApplication(pid)` plus its window elements expose
  position, size and focus where supported. Check attribute availability and
  `AXUIElementIsAttributeSettable` before writing; check each `AXError` and
  read back final position/size. Some apps clamp to minimum dimensions,
  resize asynchronously, reject writes, or recreate AX objects [O: U1,U3].
  Keep the core's hint-aware projection, then reconcile actual dimensions
  without endless reassertion [I: `docs/decisions.md:617-641`].
- [V: M6] Create an `AXObserver` for each application PID, register
  window-created/destroyed, focused-window, moved/resized and minimized
  notifications where offered, and attach its source to a live CFRunLoop.
  Remove registrations on exit. Missing/coalesced notifications and
  `kAXErrorCannotComplete` require bounded fresh enumeration, not a fabricated
  disappearance [I]. No atomic AX multi-window move exists [I: M6].
- [V: M7; I] `CGWindowListCopyWindowInfo` supplements on-screen bounds,
  owner PID, window number, ordering and exclusion of our overlays. It is
  *not* an AX-to-WindowServer identity join contract: same PID/geometry can
  be ambiguous. `_AXUIElementGetWindow` is a private AX-to-CG-window bridge
  seen in Hammerspoon's `extensions/window/libwindow.m` [O: U7]; do not
  ship it or make its ID a core identity.
  Identity and window-title fields may be privacy-limited by OS/version;
  do not request Screen Recording just for tiling, and probe exact field
  behavior without assuming it is stable [I: M7].
- [V: M8; I] `NSWorkspace.activeSpaceDidChangeNotification` reports a change,
  not an inventory of all Spaces. Classify native fullscreen, minimized,
  hidden, modal, system, desktop and Stage Manager-staged windows separately
  where observable. Stage Manager's staged-hidden state is not reliably
  exposed to third-party tilers [O: U3]; never treat a missing AX window as
  proof of closure. Do not infer fullscreen solely from output-sized bounds.
  Native fullscreen windows reside in their own Space; leave them and their
  games untouched, retaining prior allocations for returning tiled members
  where observation allows [I].
- [I: M6,U3] App compatibility matrix: native AppKit, Electron/Chrome,
  browsers, IDEs, dialogs, minimum-size windows, non-resizable windows,
  Stage Manager and fullscreen. Compare requested vs observed frame,
  animation/flicker and focus after *other* windows move. Skip no-op AX writes.
  Hammerspoon's `extensions/window/window.lua` documents a three-step
  size-position-size frame adjustment for enhanced UI behavior [O: U7];
  compare it with plain AX writes before adopting extra setters. Client-driven
  animations are app-dependent, not Mission Control-style tile animation.

**Permission path [V: M6,M11; I]:** Transparency, Consent, and Control (TCC)
gates AX. At onboarding, explain the need, call
`AXIsProcessTrustedWithOptions` when the user requests the prompt, deep-link
to Privacy & Security > Accessibility, show actual trust/read/write state,
and allow a retry/relaunch after consent. Revocation stops all window writes
and surfaces a specific status. Neither SIP reduction nor Screen Recording
should be required for the default public-API path.

## Shortcuts and host-setting conflicts

Separate simple global hotkeys from an interception-capable event tap. Preserve
lock-screen and Secure Input behavior even when a requested chord conflicts.

- [V: M12; I] Test Carbon `RegisterEventHotKey` first for discrete actions.
  It reports registration conflicts and does not promise takeover of a
  system-owned shortcut. Carbon is legacy API; check selected-version behavior
  rather than assuming it will intercept arbitrary Command (Cmd), Control
  (Ctrl) or Option chords.
- [V: M12; I] `CGEventTapCreate` at a session tap can intercept/suppress
  events, with separate Input Monitoring/Accessibility consent behavior to
  verify per tap mode and OS; never claim AX consent grants key interception.
  The hardware-event-tap location has stricter privileges. Handle failed
  creation, disabled-by-timeout taps and Secure Event Input, which can block
  keyboard observation. No raw keystroke logging or continuous polling.
- [V: M13; I] Cmd-Space (Spotlight), Ctrl-Up (Mission Control), Cmd-Tab
  (application switching), Ctrl-Cmd-Q (Lock Screen), and other OS/app chords
  have distinct owners. User-remappable Mission Control/Spaces bindings are
  not proof of a general takeover API. Use configurable Option-based defaults
  after a real keyboard-layout/conflict test; offer only verified, explicit
  per-chord overrides with a reversible host-setting preimage. Never disable
  locking or silently replace its chord. Show conflicts and an alternative.
- [I: `docs/decisions.md:749-836`] Share the action *intent* with KDE and
  Windows, not literal Meta/Cmd keys or KDE's Force/Revert storage. Test
  shortcut behavior with Secure Input, lock screen, games, active/inactive
  user session and sleeping/waking taps before release.

## Dynamic and per-display workspaces

Public macOS APIs do not provide the KWin backing-desktop operations. To
provide independent logical workspaces on two monitors, the project must own
membership and reversible visibility, or accept a smaller feature set.

| Approach | Capability and trade-off | Position |
| --- | --- | --- |
| Native Spaces | [V: M8; O: U1,U4] Active-Space change is observable; no documented create/list/select/delete or arbitrary foreign-window transfer API. Fullscreen gets its own Space. "Displays have separate Spaces" changes monitor/fullscreen behavior; with it off, independent per-display switching is not a native guarantee [I]. | Coexist with native Spaces and Mission Control; tile only the visible ordinary Space during initial spikes [I]. |
| yabai scripting addition | [O: U2] Broader Space manipulation uses Dock injection/private SkyLight APIs and a partially disabled SIP configuration; OS updates and security posture become product dependencies. | Exclude from default release [I]. |
| AeroSpace-style logical sets | [O: U1] Move inactive AX windows to an offscreen corner with a small on-screen remainder, then restore; this does not remove them from Dock, Cmd-Tab or Mission Control. AX refusals, app re-positioning, Stage Manager, fullscreen and crash recovery remain costs [I]. | Preferred **throwaway prototype**, not a selected release contract [I]. |

[I: U1,M8] Prototype on one native Space, then two displays with "Displays
have separate Spaces" both on and off. Keep explicit logical
`(output,workspace)` membership and last confirmed native position; reveal
without focus theft, record project-owned moves before parking, and restore
only still-identifiable owned windows at quit/update/startup. A forced kill
cannot restore until a recovery process runs; test this and offer a visible
manual recovery route. Distinguish parked from minimized/hidden windows.
Confirm trailing-empty creation, numbered select/send, background plans,
hotplug displacement/reconnect, per-output-local/global-unique/shared and
native Space transitions. If safe recovery or shell behavior fails, pause
the full-workspace release rather than label single-Space tiling parity.

## Active border, group underlay and drop preview

Public AppKit can render a mouse-transparent outline and drag preview. Exact
underlay stacking behind foreign windows remains the largest visual unknown.

- [V: M5; O: U6; I] Create per-display borderless transparent `NSWindow` or
  nonactivating `NSPanel` overlays, ignore mouse events and exclude them from
  tiling. Follow focus, scale, work-area, bounds and display changes. Use
  a normal/floating level only where tested; avoid `screenSaver` level and
  `.fullScreenAuxiliary`. `canJoinAllSpaces` is available but does not grant
  reliable z-order over every fullscreen Space. Hide visuals before a game
  or other fullscreen window becomes active.
- [V: M5; I] `orderWindow:relativeTo:` orders our AppKit window at its
  window level using an AppKit `windowNumber`, which Apple distinguishes
  from the WindowServer's global number. It is not a documented way to
  position it just beneath a *specific foreign application's* window.
  A group-union fill above members covers their content; a fill below all
  normal windows may be occluded by unrelated apps. Never reorder foreign
  apps to make a visual work.
- [O: U5] JankyBorders creates/shapes border windows and orders them relative
  to target window IDs using private `SLS*`/SkyLight calls, including copying
  window level/sublevel. Its below-target border is useful evidence of the
  missing public stacking primitive, not a supported dependency.
- [I: M5,U5,U6] Render the active ring and drop target from portable geometry;
  for the Meta/Option-held group, test a *true filled underlay* under
  interleaved foreign windows, dialogs, animation proxies, Mission Control,
  Stage Manager and two monitors. If public APIs cannot meet the invariant,
  present explicit choices: accept a less faithful outline/no fill, authorize
  private APIs with maintenance risk, or hold visual parity. Do not silently
  substitute an over-app fill. The KWin projected group union remains reusable
  (`crates/tiler-core/src/active_group.rs:109-164`) [O].
- [I: `VISION.md:41-48`; V: M5] Gaming gate: when a fullscreen or game target
  is active, remove overlays and stop geometry writes, taps and high-frequency
  tracking where possible. Measure frame time, input latency, CPU/wakeups and
  overlay visibility on a physical Mac for native and borderless games; prove
  the residual cost imperceivable rather than asserting it is zero.

## Language, UI and native feel

Keep policy and as much host integration as reliable in Rust; use Swift only
where it measurably reduces AppKit/permission UI friction.

- [O: M14; I] `objc2` and its AppKit/Core Foundation framework crates cover
  Objective-C objects and run loops; `accessibility-sys` exposes raw AX FFI.
  Expect `unsafe`, ownership/thread/CFType bridging, run-loop callbacks and
  SDK-version gaps. `core-foundation`/`core-foundation-sys` are candidates,
  not a complete safe AX wrapper. Prototype one Rust-only AX/observer loop
  before choosing a Swift bridge; no mixed-language ABI just for fashion.
- [V: M15; I] SwiftUI `Settings` can give native settings controls, while
  AppKit `NSStatusItem`/`NSMenu` gives a conventional menu bar extra.
  `MenuBarExtra` is an option, not a guarantee of stable menu-only lifecycle;
  test visibility and settings opening on the chosen macOS versions. If Rust
  bindings make these unreliable, add a small Swift UI shim with a narrow,
  panic-safe Rust boundary; the core remains Rust.
- [I: M15,U3] Follow system accent/dark mode, contrast, reduced motion,
  menu keyboard access and explicit permission recovery. Respect native
  minimize/fullscreen animations and avoid redundant AX writes, focus flashes
  and overlay trails. Do not animate every tile simply to mimic the host.

## Packaging, updates, logging and security

Ship a stable app identity before asking for permanent AX consent. Upgrade
must not strand any project-parked window.

- [V: M9] Outside the Mac App Store, distribute a Developer ID-signed,
  hardened-runtime, notarized `.app`, initially in a drag-to-Applications
  DMG; staple and validate the ticket. A signed flat PKG is an option if
  installer-owned paths are necessary. Developer Program membership is
  currently US$99/year, subject to region/waiver changes. The App Store
  sandbox is not the default arbitrary-foreign-window-control route [I].
- [O: M16; I] Homebrew Cask can point to the signed DMG once its publisher,
  checksum, version and quarantine behavior are proven. Do not treat a cask
  as a signing/notarization bypass. Keep a single installed app/login owner.
- [O: M17; I] Sparkle 2 supports signed update feeds; evaluate after a
  replace-while-running test that first restores parked windows, shuts down
  the old owner, updates the app, checks signature/feed and relaunches with
  TCC permission intact. Manual DMG upgrade is a valid first release if that
  gate is not met. Uninstall should unregister the login item, remove only
  project-owned state and restore parked windows while the owner still runs.
- [V: M11; O: M11; I] TCC grant stability depends on the signed app identity;
  repeatedly launching ad-hoc-signed changing Mach-O binaries may prompt
  again. Keep bundle ID, signing identity and app path stable during dev;
  verify grant survival across rebuild/update and revocation. Do not edit the
  TCC database or assume binary changes *always* reset a Developer ID grant.
- [V: M18; I: `docs/principles.md:50-66`] Prefer unified `os_log`/`Logger`
  structured lifecycle summaries with correlation across observation,
  planning, setter, readback and recovery; opt-in bounded trace and optionally
  rotating user-exportable files if field reports need them. Exclude titles,
  content, raw process/window IDs and key events; log failure never blocks
  operation. Compare `log show` privacy/redaction with a file export on Mac.
- [I: M9,M11] No SIP changes, Dock injection, private SkyLight, Screen
  Recording, privileged helper or network listener on the recommended path.
  Request AX consent explicitly; request Input Monitoring only if an actual
  shortcut mechanism needs it. Minimize hardened-runtime entitlements, sign
  nested binaries and verify update provenance.

## Upstream lessons and licensing

These are architecture and failure precedents, not proof of our compatibility.
The linked upstream license file for each project was checked 2026-09-29.

| Project | Observed lesson | Checked license / reuse |
| --- | --- | --- |
| AeroSpace | [O: U1] Swift AX tiler; `Sources/AppBundle/tree/MacWindow.swift` parks windows offscreen with a remainder. Its guide discusses native Space constraints and separate displays. | [V: U1] MIT; reuse with notice and version-specific audit. |
| yabai | [O: U2] `doc/yabai.asciidoc` and SIP wiki describe Dock scripting addition for private Space and window operations. | [V: U2] MIT; license does not make private APIs stable. |
| Amethyst | [O: U3] AX tiler integrated with native Spaces; issues #1258/#1331 document Stage Manager visibility trouble. | [V: U3] MIT; conceptual reuse or code with notice. |
| Rectangle | [O: U4] AX snapping and shortcuts, not cross-Space movement authority. | [V: U4] MIT; code with notice if appropriate. |
| Hammerspoon | [O: U7] `extensions/spaces/spaces.lua` mixes Dock AX automation and private window/Space helpers; `extensions/window/window.lua` documents an enhanced-UI frame workaround. | [V: U7] MIT; avoid importing the private-space route. |
| JankyBorders | [O: U5] `src/border.c` and `src/misc/extern.h` use private SLS relative ordering; issue #37 covers above/below border artifacts. | [V: U5] GPL-3.0; study, do not copy into a differently licensed binary without a license decision. |
| skhd | [O: U8] Standalone hotkey daemon; does not provide window or visual authority. | [V: U8] MIT; reuse with notice if needed. |
| Paneru (Rust) | [O: U6] `src/overlay.rs` makes per-display click-through public-AppKit overlays with fullscreen exclusion. It does not sandwich a group fill. | [V: U6] MIT; reuse with notice and verify exact file revision. |

[I] Verify this repository's outbound license and file-level headers before
importing any implementation. Reference behavior is not automatically reusable
code, even when both projects happen to use Rust or Swift.

## Recommended architecture at a glance

One user-session app calls the existing Engine in-process. A macOS adapter
owns all permissions, native identity and observed outcomes.

- [I: `docs/decisions.md:50-58,1145-1160`] `tiler-core` retains layout,
  admission fit, grouping, drag policy, size-hint projection and convergence.
  An eventual `tiler-macos` binary owns AX/Quartz events, points-to-core
  coordinates, focus/geometry readback, visual windows, menu, settings,
  login/update lifecycle and workspace parking recovery.
- [I] `tiler-protocol` is needed only for a separately selected external
  CLI/helper IPC; do not inherit KWin's JSON/D-Bus process split. Share
  settings, action and visual *intent* when cross-host inputs are proven;
  keep actual overlay z-order and TCC status outside core.
- [I: M14,M15] Start Rust `objc2`/AX FFI with a native AppKit menu/settings
  spike; introduce Swift only for a demonstrated UI or framework-binding gap.
  Propose macOS 15 as the initial minimum and test 15, 26 and current 27;
  the exact supported versions/architectures are a user decision, not a
  claim that older releases cannot run the app.

## Phased roadmap (qualitative)

Disposable, signed owned-window probes precede permanent adapter development.
Every exit gate records refusals as well as successful readbacks.

| Phase | Goal / scope | Exit evidence | Throwaway spikes first | Effort / risk |
| --- | --- | --- | --- | --- |
| 0. Mac truth | [I] Set hardware, SDK, signing identity and CI matrix. | Physical Mac baseline for focus, animation, games, two displays; reproducible app build and stable TCC consent. | Rust AX/CFRunLoop binding; `SMAppService` vs LaunchAgent; ad-hoc vs stable-signed rebuild grant; Linux cross-link vs Mac build. | Medium / high. |
| 1. Capability probes | [I] Bound AX, input, Space and overlay authority with owned apps first. | Settable/error/readback matrix; secure-input/tap and hotkey collisions; fullscreen and Stage Manager classifications; measured z-order relative to foreign test windows. | `CGWindowList` identity/privacy; AXObserver loss/app quit; native/fullscreen Space; underlay sandbox of two overlapping windows and dialog; game idle/tap/overlay baseline. | Medium / highest. |
| 2. Normal tiling | [I] Use Engine on current native Space, complete observations, per-app skips and readback. | Normal windows tile across scale/min-size/animation; permission revoke/wake/fast switching/hotplug recover; no fullscreen-game writes. | Partial AX setter failure; IDE/browser minimum and animation; focused-window rebinding and Stage Manager toggles. | Large / high. |
| 3. Workspaces and visuals | [I] Only after parking/stacking gates, implement per-display logical sets, focus-safe recovery, active border, group underlay and preview. | Two-display send/switch/trailing empty/background plans, forced-kill and quit restore, Mission Control/Dock/Cmd-Tab acceptance, stable group layering; no game cost. | Corner parking vs minimize/hide shell effects; `spans-displays` on/off; native Space handoff; group z-order under interleaved foreign windows; fullscreen overlay suppression. | Large / highest. |
| 4. UX and delivery | [I] Native settings/menu, conflict and permission UX, DMG/Cask, update/uninstall. | Live settings/readback, keyboard/reduced motion, notarized install, TCC survival across update, clean login/exit, physical game and Mac CI matrix, including 27. | `NSStatusItem` vs `MenuBarExtra`; Sparkle vs manual upgrade; native Swift UI bridge only if required. | Medium-large / high. |

[I] Run pure core tests on NixOS and macOS CI; integration tests require an
interactive Mac with owned windows. Run permission, login, fullscreen and
forced-crash journeys in a disposable Mac account/VM, followed by real Mac
game/input-latency acceptance. Hosted CI cannot establish visual parity.

## Open user decisions

These recommendations are proposed choices, not approved product behavior.

| Decision | Options and consequences | Recommendation |
| --- | --- | --- |
| Host/version investment | [V: M19; I: M1-M3] Apple Silicon Mac plus Mac CI enables real AX/game proof; Linux-only development cannot establish it. macOS 15+ shortens matrix; older versions add signing/API/test paths. Current macOS 27 requires Apple Silicon. | Obtain a physical Mac; test 15, 26 and 27, choose exact floor after probe. |
| Workspace release bar | [I: M8,U1] Native single-Space scope is smaller but misses per-display features; AX parking enables them only if shell/recovery behavior is accepted. | Require a passing managed-workspace prototype for a feature-complete macOS release; allow limited research builds first. |
| True group underlay | [I: M5,U5,U6] Public outline/preview is feasible but a true below-foreign-window fill is unproven; private SLS adds OS churn, reduced fidelity needs approval, strict parity may delay release. | Prototype public stacking; if it fails, ask for an explicit fidelity/maintenance decision. |
| Shortcuts and consent | [V: M12,M13; I] Option defaults avoid system collisions; opt-in event tap may need extra Input Monitoring and cannot replace Lock or Secure Input. | Option-first defaults; explicit tested overrides; preserve lock chord. |
| Distribution and update | [V: M9; O: M16,M17; I] Signed/notarized DMG + optional Cask costs program membership; Sparkle adds safe parked-window shutdown and key/feed maintenance. | DMG/manual updates first, Sparkle only after restore/update proof. |
| Native UI mix | [O: M14; V: M15; I] All-Rust AppKit reduces language split but raises binding friction; SwiftUI shim improves native controls at ABI/build cost. | Rust AX spike first, minimal Swift/AppKit UI glue only if needed. |

## Risks

Parking recovery and fullscreen-game isolation are release-critical; group
stacking is a separate fidelity gate.

| Risk | Severity / trigger | Containment and proof |
| --- | --- | --- |
| Parked windows stranded | Critical; crash, lost identity, app moves or upgrade mid-switch [O: U1; I]. | Owned-window ledger, exact readback, launch restore, forced-kill/quit/update tests, manual recovery path; hold workspace release if unsafe [I]. |
| Gaming impact or overlay above fullscreen | Critical; active game while tap/NSPanel/AX work persists [V: M5; I]. | Event-gated suppression and physical native/borderless game frame-time/input/CPU measurement [I]. |
| AX/TCC refusal or permission loss | High; app rejects setters, user revokes consent or changes signature [V: M6,M11]. | Settable/error/readback matrix, stable signed app, explicit permission status and bounded re-enumeration [I]. |
| False foreign-window matching | High; AX/CG identity ambiguous or Stage Manager hides windows [V: M7; O: U3]. | Avoid private bridge, refuse ambiguous join, do not infer closure from missing notification [I]. |
| Underlay paints over foreign content | High; AppKit level/order cannot anchor to group [V: M5; O: U5]. | Interleaving/dialog z-order spike; no filled overlay masquerading as underlay [I]. |
| Native Space/display interaction | High; fullscreen Space, separate-Spaces toggle, hotplug [V: M8; O: U1]. | Two-monitor, native Space and reconnection matrix with focus/readback [I]. |
| Shortcut conflict or stalled event tap | High; system chord, Secure Input, tap timeout [V: M12,M13]. | Non-system defaults, consent/conflict state, tap revalidation, preserve lock and game input [I]. |
| Signing or update resets permission | High; bundle/identity change or update before restore [V: M9; O: M11,M17]. | Stable designated signature, signed feed/DMG, rebuild/update/TCC and rollback probes [I]. |

## Sources (accessed 2026-09-29)

- M1: Apple [macOS Tahoe license](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf),
  [software licenses](https://www.apple.com/legal/sla/),
  [macOS virtualization on Apple hardware](https://developer.apple.com/documentation/virtualization/installing-macos-on-a-virtual-machine).
- M2: Apple [Xcode license](https://www.apple.com/legal/sla/);
  [osxcross SDK requirements](https://github.com/tpoechtrager/osxcross),
  [cross-rs Apple target images](https://github.com/cross-rs/cross-toolchains).
- M3: GitHub [hosted runner specs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
  [macOS image inventory](https://github.com/actions/runner-images/tree/main/images/macos),
  [macOS label migration](https://github.com/actions/runner-images/issues/14167).
- M4: Apple [`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice),
  [launch agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html),
  [`NSWorkspace` wake](https://developer.apple.com/documentation/appkit/nsworkspace/didwakenotification).
- M5: Apple [`NSWindow` order](https://developer.apple.com/documentation/appkit/nswindow/order(_:relativeto:)),
  [`windowNumber` scope](https://developer.apple.com/documentation/appkit/nswindow/windownumber),
  [window levels](https://developer.apple.com/documentation/appkit/nswindow/level),
  [mouse transparency](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents),
  [all-Spaces collection behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces),
  [fullscreen auxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary).
- M6: Apple [AX trust](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted),
  [attribute settability](https://developer.apple.com/documentation/applicationservices/1459972-axuielementisattributesettable),
  [setter](https://developer.apple.com/documentation/applicationservices/1460434-axuielementsetattributevalue),
  [AXObserver](https://developer.apple.com/documentation/applicationservices/axobserver).
- M7: Apple [`CGWindowListCopyWindowInfo`](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:));
  [developer forum on differing field privacy](https://developer.apple.com/forums/thread/839069).
- M8: Apple [active Space notification](https://developer.apple.com/documentation/appkit/nsworkspace/activespacedidchangenotification),
  [display reconfiguration](https://developer.apple.com/documentation/coregraphics/cgdisplayregisterreconfigurationcallback(_:_:));
  [AeroSpace Spaces guide](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces).
- M9: Apple [Developer ID](https://developer.apple.com/developer-id/),
  [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
  [program membership](https://developer.apple.com/programs/enroll/).
- M10: Apple [`NSWorkspace` sleep](https://developer.apple.com/documentation/appkit/nsworkspace/willsleepnotification).
- M11: Apple [AX trust](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted),
  [code-signing/TCC forum report](https://developer.apple.com/forums/thread/703188);
  [dev signing experience](https://github.com/jackielii/skhd.zig/blob/main/docs/CODE_SIGNING.md).
- M12: Apple [event taps](https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)),
  [Secure Event Input](https://developer.apple.com/library/archive/technotes/tn2150/_index.html),
  [Carbon hotkey reference](https://developer.apple.com/library/archive/documentation/Carbon/Reference/Carbon_Event_Manager_Ref/Reference/reference.html).
- M13: Apple [system shortcuts](https://support.apple.com/en-us/102650).
- M14: [`objc2` framework crates](https://docs.rs/objc2/latest/objc2/),
  [`accessibility-sys`](https://docs.rs/accessibility-sys/latest/accessibility_sys/),
  [`core-foundation`](https://docs.rs/core-foundation/latest/core_foundation/).
- M15: Apple [`NSStatusItem`](https://developer.apple.com/documentation/appkit/nsstatusitem),
  [SwiftUI Settings](https://developer.apple.com/documentation/swiftui/settings),
  [`MenuBarExtra`](https://developer.apple.com/documentation/swiftui/menubarextra).
- M16: Homebrew [cask acceptance](https://docs.brew.sh/Acceptable-Casks),
  [cask cookbook](https://docs.brew.sh/Cask-Cookbook).
- M17: Sparkle [repository](https://github.com/sparkle-project/Sparkle),
  [publishing updates](https://sparkle-project.github.io/documentation/publishing/).
- M18: Apple [unified logging](https://developer.apple.com/documentation/os/logging),
  [`Logger`](https://developer.apple.com/documentation/os/logger).
- M19: Apple [macOS 27 release and security update](https://support.apple.com/en-us/149035),
  [supported Mac models](https://www.apple.com/os/macos/).
- U1: AeroSpace [MIT license](https://github.com/nikitabobko/AeroSpace/blob/main/LICENSE.txt),
  [workspace guide](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces),
  [pinned AX parking](https://github.com/nikitabobko/AeroSpace/blob/0431b6b4cfe8ec9afa6cac72f08777b667f00efc/Sources/AppBundle/tree/MacWindow.swift).
- U2: yabai [MIT license](https://github.com/asmvik/yabai/blob/master/LICENSE.txt),
  [SIP/scripting-addition guide](https://github.com/asmvik/yabai/wiki/Disabling-System-Integrity-Protection),
  [manual](https://github.com/asmvik/yabai/blob/master/doc/yabai.asciidoc).
- U3: Amethyst [MIT license](https://github.com/ianyh/Amethyst/blob/development/LICENSE.md),
  [Stage Manager issue #1258](https://github.com/ianyh/Amethyst/issues/1258),
  [Stage Manager PR #1331](https://github.com/ianyh/Amethyst/pull/1331).
- U4: Rectangle [MIT license](https://github.com/rxhanson/Rectangle/blob/main/LICENSE),
  [project and Space limits](https://github.com/rxhanson/Rectangle).
- U5: JankyBorders [GPL-3.0 license](https://github.com/FelixKratz/JankyBorders/blob/main/LICENSE),
  [`src/border.c`](https://github.com/FelixKratz/JankyBorders/blob/main/src/border.c),
  [`src/misc/extern.h`](https://github.com/FelixKratz/JankyBorders/blob/main/src/misc/extern.h),
  [above/below issue #37](https://github.com/FelixKratz/JankyBorders/issues/37).
- U6: Paneru [MIT license](https://github.com/karinushka/paneru/blob/main/LICENSE.txt),
  [`src/overlay.rs`](https://github.com/karinushka/paneru/blob/main/src/overlay.rs).
- U7: Hammerspoon [MIT license](https://github.com/Hammerspoon/hammerspoon/blob/master/LICENSE),
  [`extensions/spaces/spaces.lua`](https://github.com/Hammerspoon/hammerspoon/blob/master/extensions/spaces/spaces.lua),
  [`extensions/window/libwindow.m`](https://github.com/Hammerspoon/hammerspoon/blob/master/extensions/window/libwindow.m),
  [`extensions/window/window.lua`](https://github.com/Hammerspoon/hammerspoon/blob/master/extensions/window/window.lua).
- U8: skhd [MIT license](https://github.com/koekeishiya/skhd/blob/master/LICENSE.txt),
  [hotkey daemon](https://github.com/koekeishiya/skhd).
