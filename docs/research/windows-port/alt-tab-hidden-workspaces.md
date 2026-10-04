# Alt+Tab and taskbar presence for hidden managed workspaces

Research only. No product design selected, no code or host settings changed.
Checked 2026-10-04. No live probe was performed. Documentation, pinned source,
upstream reports and inference are distinguished below.

## Pins

Pins: ours local `0df451e5`; GlazeWM
`5709ad0a3c7c386bbc3e38166a865ffc12937515`; komorebi
`e0709f02bfae4e503bf4640f58ee75ecbbfdbb97`. Immutable pattern:
`https://github.com/<org>/<repo>/blob/<pin>/<path>#Lx-Ly`.

**Finding:** no supported public API was established for keeping arbitrary
`SW_HIDE`-hidden foreign windows in native Alt+Tab. Parking is a public-API
candidate that preserves visibility. Private ApplicationView cloak has upstream
evidence of cross-workspace Alt+Tab, but is outside the current API constraint.

## Shell filtering background

- Classic Alt+Tab rule (Raymond Chen, with "implementation detail, can
  change at any time" warning): for each visible window, walk to the root
  owner, then down the visible last-active-popup chain; list only if the
  walk returns to it. `WS_EX_TOOLWINDOW` counts as invisible;
  `WS_EX_APPWINDOW` counts as ownerless:
  [Which windows appear in the Alt+Tab list?](https://devblogs.microsoft.com/oldnewthing/20071008-00/?p=24863).
  Direct claim: `SW_HIDE` (`IsWindowVisible` false) fails the first test.
- Cloaking (Chen 2020): the shell can cloak a window so Win32 visibility
  probes still read visible while the user sees nothing. Windows on a
  non-current virtual desktop are cloaked this way; enumerators must add an
  explicit `DwmGetWindowAttribute(DWMWA_CLOAKED)` check:
  [How can I detect that my window has been suppressed?](https://devblogs.microsoft.com/oldnewthing/20200302-00/?p=103507).
  Cloak keeps `IsWindowVisible` true; `DWMWA_CLOAKED` reasons
  (`APP`/`SHELL`/`INHERITED`) are documented
  ([DWMWINDOWATTRIBUTE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)).
  Cloak alone does not prove Alt+Tab exclusion: native off-desktop windows
  can be listed, and Glaze's upstream report below describes global Alt+Tab.
- Taskbar membership is controllable per-HWND via public
  `ITaskbarList::DeleteTab` / `AddTab`:
  [DeleteTab](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-itaskbarlist-deletetab).
  The documented purpose is taskbar membership, not a hidden-window Alt+Tab
  inclusion contract. Glaze reports suggest interaction with Alt+Tab listing.
- Foreground switches desktop (Chen 2017): "When a window becomes
  foreground, the system switches to the virtual desktop that the window
  belongs to"; the "do not switch" guidance constrains application requests,
  not the shell's own Alt+Tab/taskbar activation path:
  [current virtual desktop?](https://devblogs.microsoft.com/oldnewthing/20171002-00/?p=97116).
- Win11 Settings > System > Multitasking > Desktops exposes taskbar and
  Alt+Tab "show all open windows" choices: all desktops / only current desktop
  ([MS support](https://support.microsoft.com/en-us/windows/experience/configure-multiple-desktops-in-windows));
  these govern native desktop membership. They do not reveal our `SW_HIDE`
  windows or represent managed-workspace membership (architectural inference).

## Options at a glance

Ordinary eligible top-level windows are assumed; app-specific shell filtering
can still apply. Complexity includes activation and recovery, not just API calls.

| Option | Status | Alt+Tab / taskbar | Recovery and complexity |
| --- | --- | --- | --- |
| Keep `SW_HIDE` | Public | Omitted / omitted | Existing identity-safe ledger and watcher; no added work |
| `DWMWA_CLOAK` | Public; foreign writes reported denied | Neither shell result established for this path | Uncloak/preimage recovery needed; small setter, blocked applicability |
| Native virtual desktops | Public manager has limited surface | Both governed by native all/current settings | Task View remains usable after crash; large model/lifecycle change |
| Off-screen parking | Public geometry | Both expected to remain listed (inference) | Restore original geometry with identity fencing; medium complexity |
| Private ApplicationView cloak | Undocumented COM | Global Alt+Tab reported; taskbar retained unless explicitly removed | Uncloak + taskbar restoration; medium/high complexity and OS drift |

## Option 1: retain ShowWindow(SW_HIDE)

Official. `SW_HIDE`: "Hides the window and activates another window":
[ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow).
Ours posts `ShowWindowAsync` with pumped `IsWindowVisible` readback:
`crates/tiler-windows/src/product_hide.rs:617-651`. Shell effect: window
leaves Alt+Tab and the taskbar. Recovery is the strongest in-tree story
(identity-gated ledger, stop file, watcher; `product_hide.rs:1-14,38-73`).
Public API only; zero added complexity. No shell selection of an omitted window
is available; workspace navigation remains the reveal path.

## Option 2: public DwmSetWindowAttribute(DWMWA_CLOAK)

Fully documented API value: "Cloaks the window such that it is not visible
to the user. The window is still composed by DWM":
[DWMWINDOWATTRIBUTE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute),
[DwmSetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmsetwindowattribute).
The docs state no foreign-HWND restriction. The restriction is an upstream
code-comment report, not a doc: komorebi notes `E_ACCESSDENIED` for foreign
HWNDs and uses private cloak instead:
[window.rs:279-283](https://github.com/LGUG2Z/komorebi/blob/e0709f02bfae4e503bf4640f58ee75ecbbfdbb97/komorebi/src/window.rs#L279-L283).
Treat this as an owner-app mechanism, not an established foreign-window solution.
Own-window success would not prove foreign-window applicability. Alt+Tab/taskbar
listing and activation for this public app-cloak path remain TBD. Recovery would
need verified uncloak and prior-state preservation, not `ShowWindow` alone.

## Option 3: public IVirtualDesktopManager (native desktops as workspaces)

Official but narrow: exactly `GetWindowDesktopId`,
`IsWindowOnCurrentVirtualDesktop`, `MoveWindowToDesktop` via
`CLSID_VirtualDesktopManager`:
[IVirtualDesktopManager](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager).
No create/enumerate/switch methods in this public interface. Its intended scope
is an app moving auxiliary windows to follow its main window,
"specifically not to let a program grab all of the user's windows and
scatter them across all their virtual desktops":
[Virtual desktops are an end-user feature](https://devblogs.microsoft.com/oldnewthing/20201123-00/?p=104476).
That is own-app design guidance, not an explicit access-check specification:
[MoveWindowToDesktop](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ivirtualdesktopmanager-movewindowtodesktop)
does not document a foreign-HWND rejection rule. Foreign-window success is not
established here; do not treat the public manager as a general WM API.
Native Alt+Tab/taskbar filtering, Settings toggles, and Task View then work
natively, with foreground activation switching desktops (Chen 2017 above).
Cost: workspace lifecycle ceded to Explorer; crash residue is windows on a
non-current native desktop (Task View recoverable). Stop-time restoration would
need original desktop IDs and handle deleted desktops. Native desktop topology
and user-driven changes complicate our per-output workspace model. Public APIs
do not supply the complete managed-workspace lifecycle.

## Option 4: off-screen parking (Glaze PlaceInCorner shape)

Official plain-`SetWindowPos` geometry, no hiding API. Glaze parks hidden
windows at a monitor corner with a 1px sliver:
[platform_sync.rs:351-385](https://github.com/glzr-io/glazewm/blob/5709ad0a3c7c386bbc3e38166a865ffc12937515/packages/wm/src/commands/general/platform_sync.rs#L351-L385)
(opt-in on Windows via `hide_method: 'place_in_corner'`, macOS default).
By the Chen visible-window rule it stays listed in Alt+Tab and the taskbar
in principle (visible, uncloaked; inference, untested) - so it meets the
inclusion goal, at the price of not hiding. Foreign foreground is not
definitionally "pull": Glaze switches managed workspace on focus of a
hidden-workspace window (option 5 citation), so a parked-window foreground
can likewise switch. A future implementation must choose switch versus pull;
neither is forced by parking. A sliver stays clickable; fully off-screen parking
risks app/shell repositioning. Crash recovery needs a durable original-geometry
ledger, monitor/DPI changes, maximize/restore handling and parked-window detection.

## Option 5: private IApplicationView::SetCloak (Glaze/komorebi shape)

Private/undocumented `IApplicationView::set_cloak(1, 2/0)`, not public DWM cloak:
[Glaze native_window.rs:466-491](https://github.com/glzr-io/glazewm/blob/5709ad0a3c7c386bbc3e38166a865ffc12937515/packages/wm-platform/src/platform_impl/windows/native_window.rs#L466-L491),
[komorebi COM](https://github.com/LGUG2Z/komorebi/blob/e0709f02bfae4e503bf4640f58ee75ecbbfdbb97/komorebi/src/com/mod.rs#L67-L100).
Both default to cloak (prior comparison, section 1). Glaze
pairs cloak with `DeleteTab`/`AddTab` unless `show_all_in_taskbar: true`
([taskbar methods](https://github.com/glzr-io/glazewm/blob/5709ad0a3c7c386bbc3e38166a865ffc12937515/packages/wm-platform/src/platform_impl/windows/native_window.rs#L511-L529),
[config gate](https://github.com/glzr-io/glazewm/blob/5709ad0a3c7c386bbc3e38166a865ffc12937515/packages/wm/src/commands/general/platform_sync.rs#L316-L332));
komorebi has no `DeleteTab` pairing (targeted search at pin), so retaining
taskbar entries is expected. [PR #792](https://github.com/glzr-io/glazewm/pull/792)
reports taskbar retention, not Alt+Tab behavior.

Alt+Tab evidence: [Glaze discussion #830](https://github.com/glzr-io/glazewm/discussions/830)
initially reports current-workspace-only listing; its final reply reports
`show_all_in_taskbar: true` enables global Alt+Tab. Version/config are incompletely
specified and this is a user report, not a current-PC test or Microsoft contract.
komorebi's reconciliation code explicitly anticipates Alt+Tab to hidden windows;
that supports the intended integration, not proof every cloaked window is listed.
Inactive-workspace foreground reaction is switch in both references:
Glaze switches to the focused window's workspace when a hidden-workspace
window is force-shown:
[handle_window_focused.rs:71-82](https://github.com/glzr-io/glazewm/blob/5709ad0a3c7c386bbc3e38166a865ffc12937515/packages/wm/src/events/handle_window_focused.rs#L71-L82).
komorebi reconciles on Show/Uncloak via `needs_reconciliation` /
`perform_reconciliation` ("When there was an `alt-tab` to a hidden window"):
[event path](https://github.com/LGUG2Z/komorebi/blob/e0709f02bfae4e503bf4640f58ee75ecbbfdbb97/komorebi/src/process_event.rs#L483-L498),
[reconciliation](https://github.com/LGUG2Z/komorebi/blob/e0709f02bfae4e503bf4640f58ee75ecbbfdbb97/komorebi/src/process_event.rs#L936-L1048).
These preserve workspace membership instead of pulling the selected window.
Recovery needs identity-safe uncloak and restoration of any removed taskbar tabs;
the current SW_HIDE watcher would need extension. COM interface/flag drift and
app compatibility are additional costs; adoption needs a separate API decision.

## KDE parity evidence

Task Switcher docs: Virtual Desktops filter offers Current / All other;
unchecked means unfiltered (the effective "all"):
[Task Switcher](https://docs.kde.org/stable_kf6/en/kwin/kcontrol/kwintabbox/index.html).
[TabBox accept](https://github.com/KDE/kwin/blob/0be32096d8af3fa47eecfa585a938f91c3a27f3a/src/tabbox/tabbox.cpp#L1039-L1046)
calls `Workspace::activateWindow`; its
[desktop policy](https://github.com/KDE/kwin/blob/0be32096d8af3fa47eecfa585a938f91c3a27f3a/src/activation.cpp#L294-L313)
switches to the target desktop, brings the window to the current desktop, or
does neither. [Default](https://github.com/KDE/kwin/blob/0be32096d8af3fa47eecfa585a938f91c3a27f3a/src/options.h#L833-L835)
is switch, not pull. This source pin is not a claim about the user's installed
version/settings. Task Manager desktop filtering is separate
([Plasma Tasks](https://userbase.kde.org/Plasma/Tasks)).

Our KDE adapter uses native desktop navigation
([workspace-native.ts](../../../kwin/src/workspace-native.ts), `writeCurrent`),
so native KWin filtering/activation policies apply. Windows managed workspaces
currently cannot offer that native switcher parity. `R-WS-07` in
[reference outcomes](../../spec/reference-outcomes.md) records the gap and the
unselected Windows switch-versus-pull behavior.

## Anti-cheat implications

All public options avoid adding private shell COM; none supplies an anti-cheat
compatibility guarantee. Parking changes game geometry; native desktop switches
and hiding/cloaking can affect presentation/focus. Private cloak adds unsupported
shell integration and version risk, not evidence of a ban or process injection.
No game/anti-cheat testing was performed. Existing fullscreen/protected-window
scope constraints remain relevant (prior comparison, section 7).

## Recommendation (not a design)

Retain `SW_HIDE` and its omission for now (recommendation only). There is no simple
documented mechanism to reinsert hidden foreign windows into native
Alt+Tab: public cloak has an upstream-reported foreign-window access barrier;
the native-desktop model has public-API lifecycle gaps; private cloak requires
changing the API constraint. If demand justifies a future option, first evaluate
public parking on disposable windows and use KDE's default switch-to-workspace
as the parity candidate. Select no mechanism or activation policy in this survey.

## Known uncertainties (explicit)

- Current-PC listing/selection under private cloak + taskbar retention, public
  app-cloak shell behavior, parking races, and foreign `MoveWindowToDesktop`
  enforcement are untested. Native all-desktops filtering is documented, but
  the settings journey was not exercised here. These gaps do not block the
  recommendation to retain the existing mechanism.

## Sources (audit trail, minimal)

Official docs inline (`ShowWindow`, `DwmSetWindowAttribute`,
`DWMWINDOWATTRIBUTE`, `IVirtualDesktopManager`, `DeleteTab`, MS multitasking
page, KDE TabBox). Chen 2007 / 2020 cloak / 2017 foreground-switch / 2020
scope-limit posts. Pinned Glaze (`native_window.rs`, `platform_sync.rs`,
`handle_window_focused.rs`) and komorebi (`process_event.rs`, `window.rs`,
`core/mod.rs`, `com/mod.rs`). Upstream reports: Glaze #830, Glaze PR #792,
komorebi `E_ACCESSDENIED` comment. Ours: `product_hide.rs`, `workspace-native.ts`.
Related: [reference WM comparison](reference-wm-comparison.md), sections 1/5/7/12.
