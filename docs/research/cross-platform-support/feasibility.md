# Windows, macOS, And GNOME Support Feasibility

Status: research complete on 2026-09-17. This is decision support only. It
does not approve a port, a shared IPC/FFI topology, a workspace model, a panel,
a settings toolkit, package formats, or native implementation work.

## Scope And Evidence

This review uses the current KWin product boundary in `docs/decisions.md`,
the product requirements in `VISION.md`, and the portable-core boundary in
`changes/archive/shared-rust-core-architecture.md`. The baseline is not a
claim of complete KWin runtime parity: active-group rendering and several
live gates remain pending, and all user-facing settings must apply live before
launch (`docs/backlog.md`).

Classifications used below:

- **Supported**: public documented OS or desktop extension surface.
- **Version-coupled**: an in-process Shell/compositor API or binary surface
  whose compatibility must be pinned and tested per host release.
- **Restricted**: documented security, focus, package, or system-key boundary.
- **Observed**: representative upstream implementation evidence, not a
  platform guarantee.
- **Inference**: a conclusion from the preceding facts. It needs a bounded
  prototype before it becomes a product capability claim.

All public source links were checked on 2026-09-17. Platform release support is
not selected. GNOME API observations cover the 49-51 documentation/porting
range only; a future port must pin exact supported Shell and Mutter releases.

## Summary Answer

### Can all features be fully supported?

No. A useful tiler can support normal, user-session desktop windows on all
three targets, but literal parity with the KWin baseline is not supportable on
public APIs:

- Windows has event and geometry APIs, but foreground activation is conditional,
  UIPI blocks lower-integrity control, and public virtual-desktop APIs do not
  enumerate, create, switch, or delete desktops.
- macOS Accessibility permits best-effort normal-window control after user
  consent, but public APIs do not enumerate or select Spaces or move arbitrary
  windows between them. Some AX attributes and notifications are application
  specific and may refuse.
- GNOME Wayland exposes no external-client window-management authority. An
  in-process GNOME Shell extension can act through `Meta.*`, but that surface is
  release-coupled, its workspaces are global rather than KWin's per-output
  logical sets, and private Shell overview hooks churn.

Therefore "all features" must mean a declared portable subset plus visible
per-platform capability differences, not exact geometry, workspace, shortcut,
overlay, focus, or recovery equivalence. Unsupported operations must refuse
with a reason rather than emulate authority through private APIs, process
injection, SIP weakening, or hidden-window tricks.

### Most sensible implementation path

**Proposal, not selected:** preserve the approved boundary: Rust owns the
ordered N-ary tree, shares, versioned policy, and logical intent; each host
owns observation, identity, permissions, geometry projection, actuation,
focus, overlays, shortcuts, lifecycle, UI, and package delivery. Do not turn
the current KWin D-Bus route into a universal transport by assumption.

The sensible first scope on each host is the public, normal-window subset:

| Host | First practical scope | Deliberately outside that scope |
| --- | --- | --- |
| Windows | Win32 desktop windows on the current native virtual desktop; WinEvent observation, DPI-aware `SetWindowPos` projection, explicit non-`Win` fallback shortcuts, and transparent outline windows. | Elevated/system/protected windows, forced foreground focus, internal virtual-desktop COM, and app-owned workspace hiding. |
| macOS | One currently visible native Space; Accessibility plus AX notifications, normal-window geometry, permission-aware shortcuts, and self-drawn outline panels. | Private CGS/SkyLight APIs, Dock automation, SIP changes, App Store sandbox delivery for a full tiler, and synthetic cross-Space control. |
| GNOME | Thin, pinned GNOME Shell extension with `Meta.*` actuation and Shell-actor outlines, paired with a separate Rust engine only after a host contract is proven. Use native global workspaces. | An unprivileged external Wayland tiler, private overview/Alt-Tab replacement, and per-output workspace emulation. |

This is not a mandate to start with one host or to ship any of these scopes.
It defines the smallest evidence-bearing path if a later user decision selects
a host.

### Is a custom workspace implementation or custom panel/overview required?

No, and these are separate decisions.

- A custom workspace model is not required for normal tiling, native workspace
  switching, or an active/group outline. Prefer native workspaces where they
  can represent the selected semantics because task switching, thumbnails,
  fullscreen transitions, restoration, and crash recovery remain native.
- A custom model is only a possible response to an approved semantic gap. On
  Windows it would need unsafe hide/show emulation because public virtual
  desktops are too narrow. On macOS it would need hide/show or offscreen
  emulation because Spaces are not publicly controllable. On GNOME it would be
  needed only to emulate KWin's per-output modes over GNOME's global list.
  Those routes risk hidden orphan windows after a crash and divergence from
  Task View/Mission Control/Overview, task switchers, Dock/taskbar, and
  fullscreen behavior. They are not sensible default substitutes for native
  workspaces.
- A custom panel is not required by a custom workspace model, and a custom
  overview is not required by either. Native taskbar/Dock/overview surfaces can
  remain the primary user interface. A small native indicator is optional only
  if a selected capability needs state the host does not show. A full panel or
  overview replacement is a separate high-churn product with its own
  accessibility, ordering, hotplug, and packaging work.

The later panel-helper research should treat this document as the cross-host
constraint: do not make a panel helper the workspace authority or a prerequisite
for basic tiling. It should separately assess any host-native indicator and
overview integration.

### User-friendly packaging and settings

**Proposal, not selected:** use native, signed host delivery and native
permission onboarding; share settings semantics and validation, not necessarily
the settings widget. A common schema should identify each setting's runtime
effect, host capability, default shortcut, conflict state, and whether it
applies live. This directly avoids carrying the current KWin startup-only and
unconsumed-setting problem into another host. The existing all-settings-live
launch blocker remains KWin work and is not changed here.

| Host | User-facing delivery proposal | Settings proposal |
| --- | --- | --- |
| Windows | Prefer a signed MSIX/App Installer plus winget only if a prototype confirms the required interactive desktop, startup, and hotkey surface. Otherwise use a signed MSI/EXE published through winget. Do not install a Windows service for desktop control. | A conventional desktop settings application with explicit elevation, shortcut conflict, and unsupported-window status. Retain shared validation/model only; no toolkit is selected. |
| macOS | A non-sandboxed, Developer ID-signed, hardened-runtime, notarized `.app` in a DMG or PKG, optionally distributed through Homebrew Cask. The Mac App Store sandbox is not a delivery path for the full Accessibility/event-control scope. | Native AppKit/SwiftUI, a shared toolkit, and a web surface remain alternatives. Native permission status and direct Privacy & Security links are required whichever UI is chosen. |
| GNOME | A version-matched Shell-extension archive through extensions.gnome.org plus distro packages for the extension and any Rust companion. Flatpak can package a companion but cannot grant it Shell authority, so cannot be the extension delivery mechanism. | `Adw.PreferencesWindow` plus GSettings is the native extension route. A shared schema with thin KCM/Adwaita/desktop frontends is the smallest consistency candidate; no global UI framework is selected. |

## Feature Matrix

Legend: **P** = practical for the normal-window subset; **L** = limited or
version-coupled; **N** = not supportable on the stated public path. "KWin" is
the selected product direction, not an assertion that every live gate has
passed.

| Feature | KWin baseline | Windows | macOS | GNOME |
| --- | --- | --- | --- | --- |
| Enumerate and observe other apps | In-process KWin adapter. | P for desktop top-level windows via `EnumWindows` and WinEvent; UWP framing and protected/system surfaces are limited. | L via AX plus Quartz lists after Accessibility consent; app-specific AX can refuse. | L only in a Shell extension through `Meta.*`; N for an external Wayland client. |
| Tiling geometry and reflow | Direct geometry adapter, non-atomic. | P with `SetWindowPos`/`DeferWindowPos`; account for DWM visible bounds and DPI. | L with AX position/size setters; no atomic batch and applications can clamp/refuse. | L with `Meta.Window.move_resize_frame`; WM hints and release churn apply. |
| Focus and directional navigation | Engine policy plus native activation. | L: `SetForegroundWindow` is deliberately restricted. | L: AX raise/focus is per-window best effort. | L: `activate_with_workspace` is available in extension context; no-steal guard remains necessary. |
| Elevated, sandboxed, system, protected windows | Native eligibility policy. | L: UIPI blocks lower-integrity control; do not elevate the whole tiler as a workaround. | L: AX setters may be non-settable or reject protected/system windows. | L: Shell has authority but shell, lock, parental-control, and special surfaces must be excluded. |
| Keyboard focus/move/resize | KGlobalAccel catalog with explicit collision handling. | L: `RegisterHotKey` conflicts and many `Win` chords are reserved; low-level interception is a separate consent/risk choice. | L: reserved Command/Space/mission-control chords and Secure Input prevent exact defaults. | L: `Main.wm.addKeybinding` can require explicit GSettings override and reliable restore; `Super` conflicts with shell bindings. |
| Localized shortcuts and conflict UX | Initial US-only policy; localization deferred. | L: virtual keys need layout-aware display and registration tests. | L: key equivalents and event taps require per-layout validation. | L: XKB keycode/keysym handling and native binding overrides require a per-layout matrix. |
| Active-window border | Native KWin effect, currently OpenGL-gated. | P for normal windows with a click-through transparent overlay. | L with a nonactivating transparent `NSPanel`; fullscreen-space ordering is not fully documented. | L with non-reactive Shell actors; version-coupled with Shell scene APIs. |
| Active split-group outline | Engine resolves immediate split-group bounds; KWin native effect renders a separate outline. | L: draw group-union outline overlays, suppress for restricted/fullscreen/minimized targets. | L: draw self-owned outline panels; no below-window compositor route. | L: Shell actors can render outlines, but there is no native group object and z-order must be tested. |
| Overlay z-order, click-through, scale, outputs | KWin effect-specific and live-gated. | P for normal composited desktop through layered, no-activate tool windows; exclusive fullscreen must be skipped. | L: documented panel flags permit click-through/all-Spaces behavior; above-fullscreen behavior needs proof. | L: Shell actor ordering competes with overview/OSD and changes by Shell release. |
| Float, sticky, maximize, fullscreen | Explicit engine exceptions and isolation. | L for ordinary window state; fullscreen is an app cover state, not compositor authority. | L: AX state availability differs by app; fullscreen detection/actuation is heuristic. | L through `Meta.Window`; use release-pinned maximize APIs and suppress effects for fullscreen. |
| Pointer drag/resize, cancellation, final geometry | Native drag oracle supplies cancellation. | L: WinEvent move-size lifecycle plus final DWM readback; cancellation is adapter-inferred. | L: AX notifications plus global mouse observation; final/cancel is inferred. | L: grab begin/end plus final rectangle; Wayland may suppress mid-grab notifications. |
| Output hotplug and work-area/DPI | Session-local domain relocation policy. | P observation through display messages and monitor APIs; monitor handles become invalid on changes. | P observation through display callbacks and screen parameter changes; AX reflow remains best effort. | L via monitor signals/logical monitors; extension must reproject and retest per release. |
| Native workspace create/switch/send | KWin backing-desktop mapping implements three selected modes. | L: public API identifies/moves windows but lacks desktop enumeration, switch, and lifecycle. | N for cross-Space control on public APIs; only observe active-Space change. | L for a global dynamic workspace list; N for native per-output-local semantics. |
| Per-output/global/shared modes | Selected KWin modes. | N on public virtual-desktop APIs. | N on public Spaces APIs. | N natively; only global workspaces, with optional app-owned emulation carrying major UX cost. |
| Hidden-domain and background reflow without steal | Selected and statically proven on KWin. | L: native hidden virtual desktops cannot be fully enumerated; app hiding is unsafe. | N: public Spaces cannot be enumerated/targeted; single-Space scope only. | L for native global workspaces if extension never activates/raises during reconcile. |
| Taskbar/Dock/Alt-Tab/overview | Plasma Pager/Overview remain native; panel helper is optional. | L for native Task View awareness only; no public taskbar/Alt-Tab replacement control. | L for Dock/Command-Tab/Mission Control coexistence; no public Spaces UI control. | L for native Overview/dash; extension overrides are private and high churn. |
| Settings and live configuration | QWidget KCM owner; live application remains a launch blocker. | P for a host app, subject to selected package/UI. | P for a signed host app with TCC-aware onboarding. | P/L through separate-process extension preferences and GSettings. |
| Tray/panel | Rust StatusNotifierItem, optional and not core authority. | P for a notification-area/tray companion where available; not workspace authority. | L: menu-bar status item is native, but no taskbar replacement implication. | P/L: `PanelMenu` indicator is extension-owned; no custom panel required. |

## Platform Evidence And Boundaries

### Windows

**Supported public path.** `SetWinEventHook` exposes out-of-context events for
window creation, destruction, foreground, location, and interactive
move/resize. `SetWindowPos` and `DeferWindowPos` move, size, and order ordinary
top-level windows. `GetWindowRect` may include invisible borders, while
`DWMWA_EXTENDED_FRAME_BOUNDS` supplies visible bounds but is not DPI adjusted;
the adapter must model the distinction. Per-monitor DPI and monitor-change
messages are public surfaces.

**Restricted.** `SetForegroundWindow` has documented foreground-lock conditions;
a failed focus command is divergence, not a retry candidate. UIPI prevents a
medium-integrity process from controlling higher-integrity windows. `RegisterHotKey`
fails on conflicts and documents Windows-key reservations. The public
`IVirtualDesktopManager` exposes current-desktop membership and a move method,
not the full workspace lifecycle. Treat reverse-engineered
`IVirtualDesktopManagerInternal` contracts as unsupported even though tilers
use them.

**Overlay and packaging.** A layered, transparent, no-activate tool window can
draw an outline without screen capture. It must hide for exclusive/fullscreen,
minimized, cloaked, inaccessible, and removed targets, track per-monitor DPI,
and verify click-through. MSIX requires signing; its update constraints and
interactive-desktop suitability need a packaging proof. winget supports MSIX,
MSI, and EXE installers, so installer format can remain a capability decision.

**Observed comparison.** PowerToys FancyZones uses WinEvent hooks and per-monitor
overlay work areas; komorebi delegates hotkeys to a separate component; FancyWM
documents fallback work around internal virtual-desktop API churn. These show
practical patterns, not a permission to rely on internal APIs or their licenses.

### macOS

**Supported public path.** After Accessibility consent, AX application and window
elements provide window enumeration, position/size setters where attributes are
settable, raise/focus actions, and per-process AX notifications. Quartz window
lists supplement identity and bounds. `NSEvent` global monitors are observe-only;
event taps and global key observation have separate TCC implications. Display
configuration callbacks and `NSScreen` support output/scale observation.

**Restricted.** Accessibility does not force attributes that an application,
system UI, or protected surface refuses. Secure Event Input stops global keyboard
observation. Public AppKit only notifies that the active Space changed; it does
not expose a supported Space selection, lifecycle, or arbitrary window transfer.
CGS/SkyLight APIs, Dock Mission Control automation, and yabai's SIP-dependent
scripting addition are outside the public path.

**Overlay and packaging.** A transparent, mouse-ignoring, nonactivating `NSPanel`
can render vector outlines and needs no Screen Recording permission because it
does not read pixels. `canJoinAllSpaces` and fullscreen-auxiliary collection
behavior are documented, but guaranteed ordering above every fullscreen Space is
not. Skip fullscreen/minimized targets until an owned-host proof establishes
safe behavior. Full functionality needs a non-sandboxed Developer ID app with
Hardened Runtime and notarization; App Store sandboxing conflicts with arbitrary
window control and synthetic input constraints.

**Observed comparison.** Rectangle intentionally does not promise cross-Space
window movement; Amethyst works within native Spaces; AeroSpace emulates
workspaces by hiding windows; yabai obtains broader control through a
SIP-dependent scripting addition. These are evidence of the tradeoff, not
acceptable bypass routes.

### GNOME

**Supported public path is in-process.** Wayland intentionally does not grant a
normal client global window or input control, and Mutter does not implement the
foreign-toplevel management protocols needed to build a separate tiler. A GNOME
Shell extension can use `Meta.Window`, `Meta.Workspace`, monitor signals, and
`Main.wm.addKeybinding` to observe and manage windows. That is a GNOME
Shell/Mutter extension API surface, not a stable external desktop protocol.

**Version-coupled boundary.** Extensions declare supported `shell-version`s and
must update for each major. GNOME 49 changed geometry and maximize APIs;
subsequent porting guides remove old Clutter/Shell helpers. `Meta.Window` writes
can be clamped by client size hints. During a Wayland grab, movement signals may
be suppressed, so final geometry must be confirmed at grab end. This makes the
adapter viable but requires a per-major compatibility and performance matrix.

**Workspaces, overlays, and delivery.** GNOME's native workspaces are a global,
ordered dynamic list, with `workspaces-only-on-primary` behavior rather than
KWin's three output modes. Shell actors can draw non-reactive active and group
outlines, but overview, OSD, and actor ordering need host-specific validation.
The extension should remain thin because heavy GJS work blocks the Shell main
loop; extensions.gnome.org and distro packages require strict enable/disable
cleanup and per-version artifacts. A Flatpak companion is portal-limited and
cannot replace the Shell extension's authority.

**Observed comparison.** Pop Shell, Forge, Tiling Assistant, and PaperWM show
`Meta.*` tiling, focus hints, grab workarounds, GSettings shortcut handling, and
native workspace integration. They also demonstrate recurring GNOME-major port
work. They are comparison sources only.

## Workspace And Overview Alternatives

| Alternative | Benefits | Costs and boundary | Research assessment |
| --- | --- | --- | --- |
| Native workspaces plus native overview/task switcher | Preserves user expectations, taskbar/Dock/Alt-Tab thumbnails, fullscreen, session restore, accessibility, and crash recovery. | Cannot represent every KWin mode on Windows, macOS, or GNOME. | **Preferred proposal** for first host scopes. |
| Adapter-owned logical mapping over native workspaces | Can expose a portable numbering model where native movement exists. | Windows public APIs cannot fully manage desktops; macOS cannot control Spaces; GNOME mapping fights global workspace assumptions. | Do not choose before a host-specific proof and explicit product decision. |
| App-owned hide/show or offscreen workspaces | Can synthesize logical sets without native workspace APIs. | Hidden orphan windows after crash, task-switcher/overview/Dock divergence, focus theft, fullscreen/minimize edge cases, and recovery state. | **Not recommended** as a default or a first implementation. |
| Custom companion indicator | Can show selected engine state without replacing the host. | Must stay read-only/optional and follow host panel lifecycle. | Potential later enhancement, separate from workspace authority. |
| Custom taskbar or overview | Can present exact product semantics. | Reimplements high-value native behavior and, on GNOME, depends on private Shell UI. | **Not required**; defer until native UX demonstrably cannot meet an approved requirement. |

The later compositor-profile research should use the same rule: policy profiles
may select movement and shortcut semantics, but they cannot make host workspace
authority or reserved system chords portable. The later panel-helper research
should focus on a separately selectable, non-authoritative status surface.

## Proposed Evidence-Gated Implementation Order

This order is a proposal for a future approval, not an approved queue.

1. Finish the current KWin all-settings-live launch blocker. Define a portable
   setting descriptor with validation, live-apply classification, host capability
   requirements, and conflict/permission status. Do not copy startup-only or
   unconsumed settings into another host.
2. Write one adapter capability contract for the existing Rust core. It must
   distinguish normal-window geometry, focus, shortcut, overlay, workspace,
   drag-final-state, and background-domain authority. It must not choose IPC,
   process topology, or persistence.
3. Run documentation-derived, disposable platform probes before implementation:
   Windows WinEvent/DPI/focus/UIPI/hotkey/overlay/public-virtual-desktop probes;
   macOS AX/AXObserver/TCC/Secure-Input/Space-limit/overlay probes; GNOME
   nested-session extension, version, actor, grab, preferences, and lifecycle
   probes. Each requires separate authorization and an owned test environment.
4. If a host passes its probe, implement only its normal-window, native-workspace
   adapter with final-observation verification and fail-closed exclusions. Keep
   effects, keybindings, and settings host-native.
5. Add active and immediate-split-group outlines after normal tiling/focus
   verification. Test z-order, click-through, scale, outputs, minimize,
   fullscreen/game suppression, and cleanup before claiming visual parity.
6. Add native-workspace send/background behavior only where the host can verify
   it without visibility or focus steal. Do not add a custom workspace model to
   fill a missing public API.
7. Revisit an indicator or custom overview only after an approved semantic gap
   remains with native surfaces. Package it independently and retain native
   task switching as fallback.

## Open Decisions And Blockers

- Which host, exact OS/Shell versions, and normal-window compatibility floor are
  worth supporting first?
- Is cross-platform scope allowed to expose different workspace modes, or must
  feature availability be restricted to their intersection?
- Are non-`Win`/non-reserved shortcut defaults acceptable when the COSMIC profile
  collides with the host, and what explicit conflict UX is approved?
- Is a signed MSI fallback acceptable if MSIX cannot host the needed interactive
  Windows behavior without unacceptable packaging constraints?
- Is a non-sandboxed Developer ID macOS application acceptable, or should macOS
  be reduced to a non-tiling/sandboxed scope?
- Which GNOME majors will receive separate extension artifacts, and is the
  ongoing Shell-porting commitment acceptable?
- Does any approved user journey require exact per-output-local/global-unique/
  shared workspace semantics off KWin? If yes, public Windows/macOS APIs do not
  satisfy it, and GNOME needs a separate product decision.
- Is a full custom overview or panel ever required, rather than an optional
  indicator alongside native host UI? No evidence here selects either.

## Sources

### Windows - documented public APIs

- Microsoft, [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook) and [event constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants) - window lifecycle, foreground, and move/resize events.
- Microsoft, [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos), [DeferWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-deferwindowpos), and [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) - geometry and foreground restrictions.
- Microsoft, [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect) and [DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute) - invisible resize borders and extended frame bounds.
- Microsoft, [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) - conflict behavior and Windows-key reservation.
- Microsoft, [IVirtualDesktopManager](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager) - narrow public virtual-desktop surface.
- Microsoft, [User Interface Privilege Isolation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview), [per-monitor DPI](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows), [MSIX signing](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide), and [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) - permission, scaling, and delivery constraints.
- Observed comparison: PowerToys [FancyZones design](https://github.com/microsoft/PowerToys/blob/86115a54/doc/devdocs/modules/fancyzones.md) at commit `86115a54`; [komorebi](https://github.com/LGUG2Z/komorebi/tree/e0709f02bfae4e503bf4640f58ee75ecbbfdbb97) at commit `e0709f02bfae4e503bf4640f58ee75ecbbfdbb97`; [FancyWM releases](https://github.com/FancyWM/fancywm/releases). Accessed 2026-09-17.

### macOS - documented public APIs

- Apple, [Accessibility trust](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted), [AXObserver](https://developer.apple.com/documentation/applicationservices/axobserver), and [Accessibility notifications](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Accessibility/cocoaAXNotifications/cocoaAXnotifications.html) - consent and per-process observation.
- Apple, [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)), [global event monitors](https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:)), and [Secure Event Input](https://developer.apple.com/library/archive/technotes/tn2150/_index.html) - observation boundaries.
- Apple, [NSPanel](https://developer.apple.com/documentation/appkit/nspanel), [window collection behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces), and [display reconfiguration](https://developer.apple.com/documentation/coregraphics/cgdisplayregisterreconfigurationcallback(_:_:)) - overlay and output surfaces.
- Apple, [Developer ID](https://developer.apple.com/developer-id/) and [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) - non-App-Store delivery.
- Observed comparison: [Rectangle FAQ](https://github.com/rxhanson/Rectangle/), [Amethyst](https://github.com/ianyh/Amethyst/), [AeroSpace workspace guide](https://nikitabobko.github.io/AeroSpace/guide) at commit `0431b6b4cfe8ec9afa6cac72f08777b667f00efc`, [yabai](https://github.com/asmvik/yabai/), and [Hammerspoon Spaces source](https://github.com/Hammerspoon/hammerspoon/blob/master/extensions/spaces/spaces.lua). Accessed 2026-09-17. These sources distinguish public-API practice from private/Dock/SIP-dependent routes.

### GNOME - version-coupled extension and public protocol sources

- GNOME, [GJS extension overview](https://gjs.guide/extensions/), [updates and breakage](https://gjs.guide/extensions/overview/updates-and-breakage.html), and [GNOME 49 porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-49.html) - extension lifecycle and major-version API change evidence.
- GNOME Mutter API, [`Meta.Window`](https://mutter.gnome.org/meta/class.Window.html) and [`Meta.Workspace`](https://mutter.gnome.org/meta/class.Workspace.html) - extension-context window/workspace methods. These are version-coupled documentation, not an external Wayland protocol guarantee.
- GNOME Help, [workspace behavior](https://help.gnome.org/users/gnome-help/stable/shell-workspaces.html.en) - native dynamic/global workspace user model.
- wayland.app, [foreign toplevel list](https://wayland.app/protocols/ext-foreign-toplevel-list-v1) and [foreign toplevel management](https://wayland.app/protocols/zwlr-foreign-toplevel-management-v1) compositor support tables - Mutter non-implementation as of access date. Confirm against the selected Mutter release before any implementation.
- GNOME Extensions, [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and [best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html) - package lifecycle and review boundary.
- Observed comparison: [Pop Shell](https://github.com/pop-os/shell/tree/7898b65c20735057faf0797f8ed056704ca55f0d) at commit `7898b65c20735057faf0797f8ed056704ca55f0d`, [Forge](https://github.com/forge-ext/forge), [Tiling Assistant](https://github.com/ubuntu/Tiling-Assistant/tree/f9dffa21edc96e0413fc52c9f03d44a04f96c44b) at commit `f9dffa21edc96e0413fc52c9f03d44a04f96c44b`, and [PaperWM](https://github.com/paperwm/PaperWM). Accessed 2026-09-17; do not infer an API guarantee or reuse permission from these projects.

## Handoff

- **Compositor-profile research:** retain policy profiles as tree and shortcut
  semantics. Add host capability declarations rather than assuming each profile
  can use the same modifier, workspace, focus, or drag semantics.
- **Panel-helper research:** native panel/indicator integration is optional and
  cannot supply missing workspace authority. Assess status/permission/conflict
  indication separately from a full workspace overview or taskbar replacement.
- **Future adapter research:** pin an exact host version and run only the
  proposed bounded prototype for that host. Do not treat the comparison projects
  or undocumented/private routes as a support commitment.
