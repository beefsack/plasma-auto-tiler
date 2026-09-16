# Windows, macOS, And GNOME Support Feasibility

Status: research complete on 2026-09-17. This is decision support only. It
does not approve a port, a shared IPC/FFI topology, a workspace model, a panel,
a settings toolkit, package formats, or native implementation work.

## Scope And Evidence

This review uses the current KWin product boundary in
[`docs/decisions.md`](../../decisions.md), the product requirements in
[`VISION.md`](../../../VISION.md), and the portable-core boundary in
[`shared-rust-core-architecture.md`](../../changes/archive/shared-rust-core-architecture.md).
The baseline is not a
claim of complete KWin runtime parity: active-group rendering and several
live gates remain pending, and all user-facing settings must apply live before
launch ([`docs/backlog.md`](../../backlog.md)).

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

Not on a native-workspace-only public-API path. A useful tiler can support
normal, user-session desktop windows on all three targets, but literal parity
with the KWin baseline is not established by the public native-workspace APIs:

- Windows has event and geometry APIs, but foreground activation is conditional.
  UIPI documents lower-integrity message and hook restrictions, while exact
  behavior for individual geometry/read APIs is operation-specific. Its public
  virtual-desktop API does not enumerate, create, switch, or delete desktops.
- macOS Accessibility permits best-effort normal-window control after user
  consent, but public APIs do not enumerate or select Spaces or move arbitrary
  windows between them. Some AX attributes and notifications are application
  specific and may refuse.
- GNOME Wayland exposes no external-client window-management authority. An
  in-process GNOME Shell extension can act through `Meta.*`, but that surface is
  release-coupled, its workspaces are global rather than KWin's per-output
  logical sets, and private Shell overview hooks churn.

Therefore "all features" needs two separately evaluated paths: a reduced
native-workspace subset, or an adapter-owned managed logical-workspace layer.
The latter can provide more portable commands with documented normal-window
operations, but does not establish exact host-shell fidelity. Private APIs,
process injection, and SIP weakening remain outside the public path; managed
window placement is a distinct unselected alternative, not such a bypass.

### Most sensible implementation path

**Proposal, not selected:** preserve the approved boundary: Rust owns the
ordered N-ary tree, shares, versioned policy, and logical intent; each host
owns observation, identity, permissions, geometry projection, actuation,
focus, overlays, shortcuts, lifecycle, UI, and package delivery. Do not turn
the current KWin D-Bus route into a universal transport by assumption.

The sensible first scope on each host is the public, normal-window subset:

| Host | First practical scope | Deliberately outside that scope |
| --- | --- | --- |
| Windows | Win32 desktop windows on the current native virtual desktop; WinEvent observation, DPI-aware `SetWindowPos` projection, explicit non-`Win` fallback shortcuts, and transparent outline windows. | Elevated/system/protected windows, forced foreground focus, and reverse-engineered `IVirtualDesktopManagerInternal`. Managed logical workspaces require their own prototype and decision. |
| macOS | One currently visible native Space; Accessibility plus AX notifications, normal-window geometry, permission-aware shortcuts, and self-drawn outline panels. | Private CGS/SkyLight APIs, Dock automation, SIP changes, App Store sandbox delivery for a full tiler, and synthetic cross-Space control. |
| GNOME | Thin, pinned GNOME Shell extension with `Meta.*` actuation and Shell-actor outlines, paired with a separate Rust engine only after a host contract is proven. Start from native global workspaces. | An unprivileged external Wayland tiler and private overview/Alt-Tab replacement. A per-output logical mapping is a separate product/prototype choice. |

This is not a mandate to start with one host or to ship any of these scopes.
It defines the smallest evidence-bearing path if a later user decision selects
a host.

### Is a custom workspace implementation or custom panel/overview required?

Conditionally. A custom model is not required for basic tiling, native workspace
switching, or active/group outlines. It is a credible candidate if the approved
cross-platform experience requires portable numbered workspace switching, send,
and independent-monitor mappings that native Windows/macOS APIs cannot expose.
That is a product choice, not a hard public-API impossibility under every
architecture.

**Native-first proposal, not selected:** use native workspaces wherever their
semantics are sufficient. Native task switching, thumbnails, fullscreen,
restoration, and crash recovery then remain host-owned. This is the smaller
first port, but it cannot supply the full selected KWin workspace modes on
Windows or macOS.

**Managed logical-workspace alternative, not selected:** retain the engine's
logical workspace membership and make an adapter reveal only the active set of
normal windows. It can provide numbered/named workspace selection, send, an
independent active logical workspace per monitor, persistent empty logical
sets, and a panel-to-logical-workspace mapping without native workspace
creation or switching. It does not require a custom overview.

| Host | Documented primitives and observed precedent | Shell and recovery boundary |
| --- | --- | --- |
| Windows | `ShowWindow`/`SetWindowPos` can hide/show or minimize/restore normal windows, and place them at adapter-selected coordinates. `DWMWA_CLOAK` is a documented composition attribute, but cross-process use needs a probe. | Taskbar style documentation defines `WS_EX_APPWINDOW`/`WS_EX_TOOLWINDOW`, not a managed-workspace contract for third-party windows. Task View, Alt-Tab, thumbnails, fullscreen, no-focus bulk switching, and post-crash state are prototype questions. |
| macOS | AX exposes settable position, size, and minimized attributes. `AXMinimized` is Dock minimization; `NSRunningApplication.hide` is app-wide. AeroSpace at the cited source pin instead parks inactive normal windows at a monitor corner through AX frame writes, retaining a one-pixel remainder. | There is no public API to remove still-mapped third-party windows from Command-Tab, Dock, or Mission Control. Offscreen parking is observable precedent, not invisibility or native-Space equivalence. Restore-on-quit/crash and cross-launch rebinding require adapter-owned ownership and recovery choices. |
| GNOME | A Shell extension already manages a native ordered workspace list. `workspaces-only-on-primary` is a Mutter policy setting, not a requirement to create a custom model. | A per-output logical mapping is possible research scope, not necessary for the existing native policy. It must prove overview, task switcher, dynamic-workspace, and extension-lifecycle behavior before selection. |

Hide, minimize, and offscreen placement are not interchangeable. Hiding changes
mapped visibility; minimizing deliberately sends a per-window surface to the
Dock/taskbar model; offscreen placement leaves it mapped but geometrically
displaced. None is documented as a general third-party workspace protocol.
Their task-switcher effects, user recovery after a crash, and behavior for
fullscreen, dialogs, accessibility tools, and app self-restoration are therefore
**inference/prototype questions**, not reasons to rule the model out.

A managed-workspace prototype should use owned normal test windows only, one
native Space/desktop, and one then two monitors. It should verify: no focus or
visibility steal during switching; numbered switch/send and monitor-local
mapping; taskbar/Dock/Alt-Tab/Overview observations; minimize/hide/offscreen
distinctions; hotplug; explicit user quit; forced-process-loss recovery; and
relaunch behavior with and without persisted membership. It would settle a
bounded viable model, not exact host-shell fidelity.

A custom panel is not required by either workspace alternative. A small native
indicator can show adapter-owned logical state if selected. A custom overview
remains separate: it is needed only if an approved journey cannot use the host
overview/task switcher, and would carry independent accessibility, ordering,
hotplug, and packaging work.

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

### Settings And Keybinding Consistency

The current QWidget KCM is a Plasma effect configuration module, not a portable
settings application. Reusing it unchanged on Windows or macOS is not a
practical option. The reusable boundary is a shared setting definition,
validation, defaults, migration rules, capability state, and live-apply result;
each host still owns permission prompts and native shortcut registration.

| UI approach | Consistency and accessibility | Delivery and maintenance boundary |
| --- | --- | --- |
| Keep KCM plus native host fronts | Same concepts and validation, but KCM, Adwaita, AppKit/SwiftUI, and Windows controls follow their host accessibility and settings conventions. | KCM remains the KWin front; GNOME preferences run separately through `Adw.PreferencesWindow` and GSettings; macOS and Windows package their own settings surface. This duplicates presentation, not settings semantics. |
| Standalone Qt application using existing controls | Potentially closer visual/layout reuse, but the existing KCM is host-bound; embedding its controls outside Plasma is not established. Qt accessibility and permission UX still need each host's acceptance check. | One cross-platform desktop binary adds Windows installer and macOS sign/notarize work while retaining a separate GNOME extension-pref path. It needs a future extraction decision, not a presumed drop-in reuse. |
| Shared web UI in a host webview | Strong visual reuse and shared form logic, but native accessibility parity, keyboard behavior, theming, and settings-search integration are unproven. A webview does not bypass TCC, GSettings, or extension review constraints. | The host app/extension still owns signing, notarization, permissions, storage, and IPC. It is not a packaging simplification. |

**Proposal, not selected:** retain the KCM for KWin, define the portable
settings contract before any new adapter, and use native GNOME/macOS/Windows
fronts for an initial port. Reconsider a standalone Qt or web UI only if exact
visual sameness outweighs the additional accessibility and host-integration
validation. This recommends reusable behavior over a prematurely universal
dialog, not a new framework.

The same action catalog can remain consistent while literal chords differ. A
future conflict UI should show the requested chord, current host owner, whether
registration/override is available, and an explicit apply/revert choice. Example
unselected defaults are `Alt+H/J/K/L` and `Alt+Shift+H/J/K/L` on Windows when a
`Win` chord cannot register; AeroSpace's observed `Alt` and `Alt+Shift`
directional families on macOS rather than Command/Control Space-switcher
chords; and GNOME `Super+H/J/K/L` only when unclaimed, with `Super+Arrow`
override/restoration explicitly consented. `MOD_WIN` is reserved by Windows,
macOS reserves Command-Space, Control-Up, and Command-Tab, and GNOME Shell owns
many Super bindings. The current KWin US-only shortcut decision is unchanged.

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
| Elevated, sandboxed, system, protected windows | Native eligibility policy. | L: UIPI documents lower-IL message/hook restrictions; method-specific geometry/read behavior needs a probe. UIAccess has signing, secure-location, privilege, and System-IL limits. | L: AX setters may be non-settable or reject protected/system windows. | L: Shell has authority but shell, lock, parental-control, and special surfaces must be excluded. |
| Keyboard focus/move/resize | KGlobalAccel catalog with explicit collision handling. | L: `RegisterHotKey` typically fails on conflict; `MOD_WIN` and F12 are documented reserved paths. | L: Command-Space, Control-Up, Command-Tab, and Secure Input prevent exact defaults. | L: `Main.wm.addKeybinding` can require explicit GSettings override and reliable restore; `Super` conflicts with shell bindings. |
| Localized shortcuts and conflict UX | Initial US-only policy; localization deferred. | L: virtual keys need layout-aware display and registration tests. | L: key equivalents and event taps require per-layout validation. | L: XKB keycode/keysym handling and native binding overrides require a per-layout matrix. |
| Active-window border | Native KWin effect, currently OpenGL-gated. | P for normal windows with a click-through transparent overlay. | L with a nonactivating transparent `NSPanel`; fullscreen-space ordering is not fully documented. | L with non-reactive Shell actors; version-coupled with Shell scene APIs. |
| Active split-group outline | Engine resolves immediate split-group bounds; KWin native effect renders a separate outline. | L: draw group-union outline overlays, suppress for restricted/fullscreen/minimized targets. | L: draw self-owned outline panels; no below-window compositor route. | L: Shell actors can render outlines, but there is no native group object and z-order must be tested. |
| Overlay z-order, click-through, scale, outputs | KWin effect-specific and live-gated. | P for normal composited desktop through layered, no-activate tool windows; exclusive fullscreen must be skipped. | L: documented panel flags permit click-through/all-Spaces behavior; above-fullscreen behavior needs proof. | L: Shell actor ordering competes with overview/OSD and changes by Shell release. |
| Float, sticky, maximize, fullscreen | Explicit engine exceptions and isolation. | L for ordinary window state; fullscreen is an app cover state, not compositor authority. | L: AX state availability differs by app; fullscreen detection/actuation is heuristic. | L through `Meta.Window`; use release-pinned maximize APIs and suppress effects for fullscreen. |
| Pointer drag/resize, cancellation, final geometry | Native drag oracle supplies cancellation. | L: WinEvent move-size lifecycle plus final DWM readback; cancellation is adapter-inferred. | L: AX notifications plus global mouse observation; final/cancel is inferred. | L: grab begin/end plus final rectangle; Wayland may suppress mid-grab notifications. |
| Output hotplug and work-area/DPI | Session-local domain relocation policy. | P observation through display messages and monitor APIs; monitor handles become invalid on changes. | P observation through display callbacks and screen parameter changes; AX reflow remains best effort. | L via monitor signals/logical monitors; extension must reproject and retest per release. |
| Native workspace create/switch/send | KWin backing-desktop mapping implements three selected modes. | L: `MoveWindowToDesktop(HWND, desktopId)` has no documented own-process restriction, but public API lacks desktop enumeration, switch, creation, and deletion. | N for native cross-Space control found in public AppKit; active-Space change is observable. | L for a global dynamic workspace list; `workspaces-only-on-primary` is policy/configuration, not an architectural invariant. |
| Managed logical workspace mapping | Not needed for selected KWin backing-desktop implementation. | L/Observed: hide, minimize, offscreen, and possibly cloak normal windows can implement numbered sets and sends; shell and recovery effects need proof. | L/Observed: AX offscreen-corner placement has AeroSpace precedent; app hide/minimize have distinct semantics. | L/Inference: native global workspaces can remain primary; a per-output mapping is separately prototypeable. |
| Per-output/global/shared modes | Selected KWin modes. | N natively; L through a managed model if its recovery and shell behavior pass. | N natively; L through an offscreen-managed model if its constraints pass. | N for exact KWin modes natively; L for an unselected logical mapping. |
| Hidden-domain and background reflow without steal | Selected and statically proven on KWin. | L: public native-desktop lifecycle is incomplete; managed visibility changes can use no-activate forms but need proof. | N for public native Spaces; L/Observed for an active single-Space managed model. | L for native global workspaces if extension never activates/raises during reconcile. |
| Taskbar/Dock/Alt-Tab/overview | Plasma Pager/Overview remain native; panel helper is optional. | L for native Task View awareness only; no public taskbar/Alt-Tab replacement control. | L for Dock/Command-Tab/Mission Control coexistence; no public Spaces UI control. | L for native Overview/dash; extension overrides are private and high churn. |
| Settings and live configuration | QWidget KCM owner; live application remains a launch blocker. | P for a host app, subject to selected package/UI. | P for a signed host app with TCC-aware onboarding. | L through separate-process extension preferences and GSettings. |
| Tray/panel | Rust StatusNotifierItem, optional and not core authority. | P for a notification-area/tray companion where available; not workspace authority. | L: menu-bar status item is native, but no taskbar replacement implication. | L: `PanelMenu` indicator is extension-owned; no custom panel required. |

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
a failed focus command is divergence, not a retry candidate. UIPI documents
lower-privilege message and hook restrictions to higher-privilege processes;
the `EnumWindows`, `GetWindowRect`, `SetWindowPos`, `ShowWindow`, and
`SetWinEventHook` method pages do not each specify an IL result, so that behavior
must be measured per operation. UIAccess is a documented option for accessibility
software, but requires `uiAccess=true`, a trusted signature, a secure install
location, and has privilege/System-IL limits; it is not assumed as this product's
solution. `RegisterHotKey` typically fails on conflicts and documents `MOD_WIN`
and F12 reservations.

`IVirtualDesktopManager::MoveWindowToDesktop(HWND topLevelWindow, REFGUID
desktopId)` documents "the window to move" and does not state an own-process
restriction. It can therefore be researched for normal third-party top-level
windows subject to actual integrity/HRESULT behavior. The same public interface
only exposes Get/Is/Move: it lacks desktop enumeration, create, switch, and
delete. `IVirtualDesktopManagerInternal` remains reverse-engineered and
unsupported.

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
observation. As of this access date, public AppKit documentation exposes an
active-Space-change notification but no Space selection, lifecycle, or arbitrary
window-transfer API was found. CGS/SkyLight APIs, Dock Mission Control
automation, and yabai's SIP-dependent scripting addition are observed private
routes outside the public path.

**Overlay and packaging.** A transparent, mouse-ignoring, nonactivating `NSPanel`
can render vector outlines and needs no Screen Recording permission because it
does not read pixels. `canJoinAllSpaces` and fullscreen-auxiliary collection
behavior are documented, but guaranteed ordering above every fullscreen Space is
not. Skip fullscreen/minimized targets until an owned-host proof establishes
safe behavior. Full functionality needs a non-sandboxed Developer ID app with
Hardened Runtime and notarization; App Store sandboxing conflicts with arbitrary
window control and synthetic input constraints. Accessibility is needed for AX
control and global `NSEvent` key monitoring; an interception-capable event tap
has its own Input Monitoring path. Screen Recording belongs only to an actual
pixel capture/stream feature. `CGWindowList` title/owner-field privacy behavior
is undocumented, so no fixed permission is claimed for an identity/title-only
feature.

**Observed comparison.** Rectangle intentionally does not promise cross-Space
window movement; Amethyst works within native Spaces; AeroSpace implements its
logical workspaces by AX offscreen-corner placement, not generic app/window
hiding; yabai obtains broader control through a SIP-dependent scripting addition.
These are evidence of alternatives and tradeoffs, not an API guarantee or a
selection.

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
ordered dynamic list rather than KWin's three output modes. The
`workspaces-only-on-primary` setting is a Mutter workspace-display policy, not a
requirement to create a custom model. Shell actors can draw non-reactive active
and group outlines, but overview, OSD, and actor ordering need host-specific
validation.
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
| Adapter-owned logical mapping over native workspaces | Can expose portable numbering, send, independent monitor mappings, and panel state where native lifecycle APIs are absent. | Must own membership, reveal/park policy, focus protection, crash recovery, and possibly durable recovery state. Native shell presentation may diverge. | **Credible unselected alternative**; prototype before a product choice. |
| Managed hide/minimize/offscreen windows | Synthesizes logical sets without native workspace creation. Public normal-window primitives exist, and AeroSpace supplies an offscreen-placement precedent. | Task-switcher/overview/Dock behavior, focus, fullscreen/minimize, user exit, power loss, and rebind-after-relaunch are host-specific and partly inference. | **Neither selected nor rejected.** Compare it directly with native-first scope. |
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
6. Compare native-workspace send/background behavior with the managed logical
   workspace prototype on the selected host. Select neither until normal-window
   recovery, shell integration, and no-steal behavior are measured.
7. Revisit an indicator or custom overview only after an approved semantic gap
   remains. Package it independently and retain native task switching as fallback.

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
  shared workspace semantics off KWin? If yes, choose between reduced native
  semantics and a managed logical-workspace prototype; neither is selected.
- What managed visibility policy, ownership record, restoration trigger, and
  persistent recovery behavior are acceptable after crash, logout, or relaunch?
- Is a full custom overview or panel ever required, rather than an optional
  indicator alongside native host UI? No evidence here selects either.

## Sources

### Windows - documented public APIs

- Microsoft, [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook) and [event constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants) - window lifecycle, foreground, and move/resize events.
- Microsoft, [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos), [DeferWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-deferwindowpos), and [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) - geometry and foreground restrictions.
- Microsoft, [ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow) - documented hide/show and minimize/restore primitives.
- Microsoft, [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect) and [DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute) - invisible resize borders and extended frame bounds.
- Microsoft, [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) and [SetWindowsHookEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw) - conflict, reserved-key, global-hook, and Windows 11 journal-hook boundaries.
- Microsoft, [IVirtualDesktopManager](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager) and [MoveWindowToDesktop](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ivirtualdesktopmanager-movewindowtodesktop) - the public Get/Is/Move surface and `HWND topLevelWindow` signature.
- Microsoft, [UIAccess secure-location policy](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/user-account-control-only-elevate-uiaccess-applications-that-are-installed-in-secure-locations) and [ChangeWindowMessageFilterEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-changewindowmessagefilterex) - documented UIPI, UIAccess, signature, secure-location, and message-filter boundaries.
- Microsoft, [extended window styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles), [taskbar buttons](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar), and [`DWMWINDOWATTRIBUTE`](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute) - taskbar style and cloak facts, not a managed-workspace guarantee.
- Microsoft, [per-monitor DPI](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows), [MSIX signing](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide), and [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) - scaling and delivery constraints.
- Observed comparison: PowerToys [FancyZones design](https://github.com/microsoft/PowerToys/blob/86115a54/doc/devdocs/modules/fancyzones.md) at commit `86115a54`; [komorebi](https://github.com/LGUG2Z/komorebi/tree/e0709f02bfae4e503bf4640f58ee75ecbbfdbb97) at commit `e0709f02bfae4e503bf4640f58ee75ecbbfdbb97`; [FancyWM releases](https://github.com/FancyWM/fancywm/releases), unpinned discovery reference. Accessed 2026-09-17.

### macOS - documented public APIs

- Apple, [Accessibility trust](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted), [AXUIElementIsAttributeSettable](https://developer.apple.com/documentation/applicationservices/1459972-axuielementisattributesettable), [AXUIElementSetAttributeValue](https://developer.apple.com/documentation/applicationservices/1460434-axuielementsetattributevalue), [AXObserver](https://developer.apple.com/documentation/applicationservices/axobserver), and [Accessibility notifications](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Accessibility/cocoaAXNotifications/cocoaAXnotifications.html) - consent, writable-attribute checks, and per-process observation.
- Apple, [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)), [global event monitors](https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:)), [Secure Event Input](https://developer.apple.com/library/archive/technotes/tn2150/_index.html), and [active-Space change](https://developer.apple.com/documentation/appkit/nsworkspace/activespacedidchangenotification) - observation boundaries. `CGWindowList` title/owner-key privacy gating is undocumented; request Screen Recording only for an actual pixel-capture feature.
- Apple, [NSPanel](https://developer.apple.com/documentation/appkit/nspanel), [window collection behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces), [fullscreen auxiliary windows](https://developer.apple.com/library/archive/documentation/General/Conceptual/MOSXAppProgrammingGuide/FullScreenApp/FullScreenApp.html), and [display reconfiguration](https://developer.apple.com/documentation/coregraphics/cgdisplayregisterreconfigurationcallback(_:_:)) - overlay and output surfaces.
- Apple, [Developer ID](https://developer.apple.com/developer-id/), [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [SwiftUI Settings](https://developer.apple.com/documentation/swiftui/settings), and [system shortcuts](https://support.apple.com/en-us/102650) - non-App-Store delivery, native settings, and literal-chord collision examples.
- Observed comparison: [Rectangle FAQ](https://github.com/rxhanson/Rectangle/), [Amethyst](https://github.com/ianyh/Amethyst/), [AeroSpace workspace guide](https://nikitabobko.github.io/AeroSpace/guide#emulation-of-virtual-workspaces) accessed 2026-09-17 plus pinned [offscreen implementation](https://raw.githubusercontent.com/nikitabobko/AeroSpace/0431b6b4cfe8ec9afa6cac72f08777b667f00efc/Sources/AppBundle/tree/MacWindow.swift) at `0431b6b4cfe8ec9afa6cac72f08777b667f00efc`, [yabai](https://github.com/asmvik/yabai/), and [Hammerspoon Spaces source](https://github.com/Hammerspoon/hammerspoon/blob/master/extensions/spaces/spaces.lua). These sources distinguish public-API practice from private/Dock/SIP-dependent routes.

### GNOME - version-coupled extension and public protocol sources

- GNOME, [GJS extension overview](https://gjs.guide/extensions/), [updates and breakage](https://gjs.guide/extensions/overview/updates-and-breakage.html), and [GNOME 49 porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-49.html) - extension lifecycle and major-version API change evidence.
- GNOME Mutter API, [`Meta.Window`](https://mutter.gnome.org/meta/class.Window.html) and [`Meta.Workspace`](https://mutter.gnome.org/meta/class.Workspace.html) - extension-context window/workspace methods. These are version-coupled documentation, not an external Wayland protocol guarantee.
- GNOME Help, [workspace behavior](https://help.gnome.org/users/gnome-help/stable/shell-workspaces.html.en) and the Mutter [`org.gnome.mutter` schema at tag 51.0](https://github.com/GNOME/mutter/blob/51.0/data/org.gnome.mutter.gschema.xml.in) - native dynamic/global workspace user model and workspace-display policy. Confirm the selected tag's schema before implementation.
- wayland.app, [foreign toplevel list](https://wayland.app/protocols/ext-foreign-toplevel-list-v1) and [foreign toplevel management](https://wayland.app/protocols/zwlr-foreign-toplevel-management-v1) compositor support tables - Mutter non-implementation as of access date. Confirm against the selected Mutter release before any implementation.
- GNOME Extensions, [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and [best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html) - package lifecycle and review boundary.
- Observed comparison: [Pop Shell](https://github.com/pop-os/shell/tree/7898b65c20735057faf0797f8ed056704ca55f0d) at commit `7898b65c20735057faf0797f8ed056704ca55f0d`, [Forge](https://github.com/forge-ext/forge), [Tiling Assistant](https://github.com/ubuntu/Tiling-Assistant/tree/f9dffa21edc96e0413fc52c9f03d44a04f96c44b) at commit `f9dffa21edc96e0413fc52c9f03d44a04f96c44b`, and [PaperWM](https://github.com/paperwm/PaperWM). Accessed 2026-09-17; do not infer an API guarantee or reuse permission from these projects.

## Handoff

- **Compositor-profile research:** retain policy profiles as tree and shortcut
  semantics. Add host capability declarations rather than assuming each profile
  can use the same modifier, workspace, focus, or drag semantics.
- **Panel-helper research:** native panel/indicator integration is optional and
  is not itself workspace authority. Assess status/permission/conflict indication
  for either native or selected managed workspace state separately from a full
  workspace overview or taskbar replacement.
- **Future adapter research:** pin an exact host version and run only the
  proposed bounded prototype for that host. Do not treat the comparison projects
  or undocumented/private routes as a support commitment.
