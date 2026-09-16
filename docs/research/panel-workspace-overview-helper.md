# Panel And Workspace-Overview Helper

Status: research complete on 2026-09-17. Decision support only. It selects no
workspace authority, tiling control, settings owner, toolkit, package format,
adapter, IPC topology, or implementation work. No live Plasma, DBus, panel,
configuration, compositor, or manual test occurred.

This record answers the request for a tiling-WM-style panel, chiefly a workspace
overview. It follows the current [workspace decision](../decisions.md#window-and-workspace-behavior),
[tray boundary](../decisions.md#tray), [cross-platform feasibility](cross-platform-support/feasibility.md),
and [profile support research](reference-wm-profile-support.md). Panels and
workspaces remain first-class product requirements under `VISION.md`; a panel
must not become a second workspace or layout authority.

## Recommendation

**Proposal, not selected:** interpret "workspace overview" first as a compact,
persistent, clickable workspace strip, not a thumbnail renderer or a full-screen
shell replacement. On Plasma, start with the stock Pager on a user-selected
existing panel. It is the smallest useful, additive setup helper: it preserves
the task manager, clock, tray, and all existing applets.

The stock Pager is a **native-desktop pager**, not a faithful view of this
project's logical workspaces. It is useful as an opt-in Plasma convenience, but
must be named and previewed that way. A logical workspace strip is a separate
future scope because the current canonical mapping is session-local inside the
KWin workspace adapter and has no widget-facing state or command contract.

| Meaning | Plasma surface | Assessment |
| --- | --- | --- |
| Compact workspace strip | `org.kde.plasma.pager` | Recommended smallest helper scope. Displays desktop cells, window rectangles/icons, and supports native desktop selection and drag/drop. It is schematic, not live thumbnails. |
| Miniature previews | Pager window geometry; task-manager hover thumbnails are a separate compositor feature | Do not require capture or thumbnail rendering for numeric/text workspace state. No first-party live-preview pager widget was verified for Wayland. |
| Full-screen overview | KWin Overview / Desktop Grid | Keep native. Overview is a modal search/window view, not a panel configuration. Do not replace or rebind it. |

## Plasma Facts And Mapping Boundary

The Plasma 6.7.4 default panel ships a Pager between the launcher and icon task
manager. Pager's plugin ID is `org.kde.plasma.pager`; it has a related activity
mode, `org.kde.plasma.activitypager`. Its model enumerates KWin virtual desktops,
tracks the current desktop, and scales task geometry into each cell. Clicks
change the selected native desktop; dragging can send a window to a native
desktop. `showOnlyCurrentScreen` filters displayed windows by screen geometry;
it does not create a per-output desktop namespace.

KWin's public scripting surface exposes one global desktop pool through
`workspace.desktops`, with per-screen current-desktop getters/setters. The
project instead keeps a session-local mapping from logical `(output, workspace)`
domains to backing KWin desktop IDs in `WorkspaceNativeAdapter`
([`kwin/src/workspace-native.ts`](../../kwin/src/workspace-native.ts)). Its
`per-output-local` and `global-unique` modes assign distinct backing desktops
per output; `shared` deliberately maps the same backing desktop to all outputs.
The adapter also owns trailing empty desktop lifecycle and disconnected-output
displacement/return.

Consequences:

| Project mode | What stock Pager shows | Fit for a logical workspace strip |
| --- | --- | --- |
| `per-output-local` | The whole global backing-desktop pool on each panel, including desktops assigned to other outputs and trailing empties. | Incorrect. Logical position 1 on one output is not Pager cell 1 globally. |
| `global-unique` | The whole global pool, while the adapter may exchange visible backing desktops between outputs. | Incorrect as a stable per-output logical index. |
| `shared` | The same global pool selected on every output, including lifecycle extras. | Closest, but still not guaranteed to be the logical list. |

Pager clicks are compositor-native desktop changes, not calls to
`selectLogical()` or the planned workspace-send route. They must not be
presented as the project's numbered workspace navigation. Renaming KWin desktops
to imitate logical labels would couple a user-visible Plasma setting to the
project's session lifecycle and is not proposed.

Therefore a future exact logical widget needs a separately approved, bounded
contract that provides a canonical snapshot and selection command for the
current output. The current code exposes neither. The contract must define
output identity, logical order, selected state, availability, and hotplug
behavior without making the widget authoritative. It must not be inferred from
Pager cells, the tray snapshot, or private adapter fields.

## Proposed Plasma Helper UX

**Proposal, not selected. First host target:** Plasma Desktop and KWin 6.7.4,
the repository's source-pinned baseline. Pin the exact `plasma-desktop` build
and Pager configuration schema again before implementation; this research does
not claim compatibility with other Plasma releases.

1. `Preview` enumerates panels and their applets, then asks the user to choose
   one existing panel. It displays the panel location/screen and that one new
   stock native-desktop Pager will be added. It makes no change.
2. `Apply` adds one fresh `org.kde.plasma.pager` applet to that exact panel,
   using the stock widget's default configuration and an explicit applet index.
   It does not replace, move, configure, or remove the task manager, clock,
   system tray, launcher, an existing Pager, or any other applet.
3. `Revert` removes only the exact applet created by this Apply. A new dedicated
   panel is an opt-in alternative, never the default; it is wholly helper-owned
   and Revert removes only that exact panel.

Plasma's supported scripting model supplies panel enumeration/creation,
`Containment.addWidget`, widget lookup/removal/order, and applet configuration
access through the Plasma shell. KWin script code cannot directly configure the
Plasma shell; a helper would need its own bounded Plasma scripting invocation.
The actual Pager setting keys are intentionally not listed here: configure no
non-default Pager key until the target tag's `main.xml` is source-verified.

### Ownership, Idempotence, And User Edits

The safe default is mutable, explicit user action rather than declaratively
merging arbitrary `plasma-org.kde.plasma.desktop-appletsrc` state through Nix or
Home Manager. Current Nix/Home Manager delivery deliberately does not own user
`kwinrc` authority, and no supported general-purpose merge/reconciliation model
for a user's customized Plasma panels is established here.

The future helper needs a minimal ownership record containing only its schema
version and the exact created panel/applet IDs, target panel ID, and created
applet index. This is restoration metadata, not telemetry or a general desktop
state ledger. Without it, uninstall cannot distinguish a helper-created Pager
from a pre-existing user Pager. It must never restore a whole appletsrc backup:
that would overwrite legitimate user edits made after Apply.

| Case | Required behavior |
| --- | --- |
| Re-run after successful Apply | Locate the exact owned resource and report it as already applied; create nothing else. |
| Existing Pager or customized panel | Leave it untouched. Add a new Pager only after the selected-panel preview. |
| Multiple panels/outputs | Require an explicit target panel. Do not infer a primary panel or replicate across outputs. |
| User moves/configures the owned Pager | Preserve the edit. Revert removes only the owned applet, not surrounding order or configuration. |
| Resource missing or ID/type mismatch | Fail closed and offer no broad cleanup. |
| Upgrade | Read the minimal record, migrate only its own schema, and preserve current user-owned panel state. |
| Uninstall | Offer Revert first. If unavailable or ambiguous, leave the resource and report its exact identity. |

The stock Pager needs no new project runtime dependency beyond the selected
Plasma Desktop installation. A helper package, if later selected, would need a
version-pinned Plasma scripting route and a delivery decision. A custom logical
plasmoid would additionally need a Plasma 6 applet KPackage and an approved
canonical workspace contract. Neither package channel is selected here.

## Host Options

The panel is presentation plus optional native command dispatch. It never owns
workspace membership, layout topology, focus history, window movement, or
thumbnail capture. A click can issue one host-native workspace selection only
after that host's command ownership and Revert behavior are selected.

| Host baseline | Practical native surface | Workspace-state fit | Helper recommendation and limit |
| --- | --- | --- | --- |
| Plasma 6.7.4 | Existing panel plus `org.kde.plasma.pager`; KWin Overview/Desktop Grid | Pager is global native-desktop state, not the project's multi-output logical model. | Proposed first helper: additive stock Pager with an explicit native-mapping warning. Defer exact logical widget and custom overview. |
| GNOME 49-51 docs range | Native Activities/Overview and dynamic workspace selector; optional thin `PanelMenu` indicator | Native workspaces are global. | Prefer native Overview/indicator. A project extension is version-coupled and must not replace overview/task switching. |
| PaperWM v50.0.1 | Its workspace name, top bar, and position bar | PaperWM owns GNOME workspace policy and tiling presentation. | Do not install/co-enable another tiler, workspace, panel, or gesture surface. PaperWM enable/disable changes settings and keybindings with its own restoration path. |
| Hyprland v0.56.2 with a pinned Waybar | Waybar `hyprland/workspaces` via compositor IPC | Native workspace state, including active, visible, urgent, empty, persistent, special, and per-output presentation. | Ship a separate Waybar include and CSS fragment only after pinning Waybar and IPC compatibility. Do not merge arbitrary JSONC/CSS or treat the bar as layout authority. |
| bspwm 0.9.12 with a pinned Polybar | Polybar `internal/bspwm` or upstream lemonbar report consumer | bspwm desktop/monitor report exposes focused, occupied, urgent, and empty state. | X11-only. Click/scroll invokes `bspc desktop -f`; it is a command writer, never a competing tree authority. Keyboard bindings remain external `sxhkd`; pointer bindings are bspwm settings. |
| Windows | Notification-area companion; retain Task View/taskbar/Alt-Tab | Public virtual desktop lifecycle/switch API is insufficient for a portable logical strip. | A tray companion can show selected native or later managed state, not modify the taskbar or replace Task View. Managed logical workspaces need their own recovery/shell prototype. |
| macOS | `NSStatusItem`; retain Dock, Command-Tab, Mission Control, and Spaces | Public APIs do not select/create Spaces or move arbitrary windows across them. | A menu-bar companion is feasible; it cannot be a Spaces controller. Offscreen-managed logical workspaces remain a separate prototype with Dock/task-switcher/recovery costs. |

For Hyprland, the v0.56.2 first-run configuration is editable Lua example
configuration, not a universal keymap. Waybar's current workspace module reads
IPC and dispatches native workspace commands on click/scroll; `all-outputs`,
`move-to-monitor`, persistent workspaces, and special-workspace display change
the apparent scope. Pin the Waybar release and its IPC behavior before any
claim. For bspwm, the upstream `sxhkdrc` is only an example; bspwm itself has no
keyboard catalog. These profile facts support an algorithm-plus-shortcut profile,
not a panel-selected profile or backend.

## Integrated Roadmap

This is a proposed dependency order, not a change to active decisions.

| Order | Product slice | Current state and dependency |
| --- | --- | --- |
| 1 | Finish KWin launch blockers and pending current-host acceptance | All settings must apply live before launch. The gap-only reload is static-complete but partial; `workspaceMode` and `shortcutProfile` are startup-consumed, while `tilingAlgorithm`, `automaticSplitTarget`, and `dropOutlinePreview` remain unconsumed. Startup near-strip fitting, fresh-session recovery after confirmed Planner loss, and disconnect/reconnect lifecycle are offline-complete with live acceptance pending. |
| 2 | Stabilize capability and settings semantics | Define one capability-facing setting contract with validation, runtime effect, live-apply result, host capability, shortcut conflict, and permission state. Do this before new host settings or profile UI; it must not choose a shared UI toolkit or transport. |
| 3 | Decide workspace presentation model per host | Keep native workspaces for reduced first ports unless an approved journey needs portable numbered send/per-output mapping. Only then prototype managed logical workspaces and their visibility, task-switcher, fullscreen, hotplug, quit, crash, and relaunch behavior. Panel state follows this decision; it cannot make it. |
| 4 | Choose one portable behavior profile | A post-MVP profile includes its own versioned algorithm and matching shortcuts. Hyprland needs a selected layout; bspwm needs binary/receptacle semantics; PaperWM needs columns and viewport state. No profile/backend is selected. |
| 5 | Prove one native host adapter | After selecting host/version/profile, run its bounded normal-window capability prototype and choose one layout authority. Then add native overlays/input subject to host permissions and fullscreen/game suppression. The KWin group-outline diagnostic is delivered; visual no-outline diagnosis remains parked for a user new session/status capture. Meta-held is selected; no automatic one-second highlight is selected. |
| 6 | Package native host fronts | Package/version-pin the selected adapter, native settings front, permissions, shortcut conflict UX, and reversible enable/disable behavior. Windows/macOS reduced native-workspace paths, GNOME extension artifacts, and Qt/web alternatives remain proposals, not shared delivery decisions. |
| 7 | Add the panel helper | First apply the narrow Plasma native Pager route if still desired. Add a custom logical strip only after its canonical workspace contract and click ownership exist. Reconsider a custom overview only if native overview/task-switching fails an approved journey. |

The existing tray remains status and Settings only. It is not the panel helper,
does not issue workspace commands, and has separate watcher, packaging, login,
and update/rollback live gates. A future panel click route is a proposal, not an
expansion of that tray boundary.

## Decisions For The User

1. Is the first desired result the proposed native-desktop Pager convenience, or
   is a faithful per-output logical workspace strip required from the start?
2. May a future panel issue native workspace-selection commands, or is it
   display-only plus Settings? If commands are allowed, what exact Apply/Revert
   ownership is acceptable?
3. Is an explicitly selected existing Plasma panel acceptable as the default
   target, with an opt-in dedicated helper-owned panel only when requested?
4. Should panel implementation wait for the all-settings-live launch blocker,
   while its contract may be specified in parallel, or be prioritized directly
   after that blocker?
5. For later ports, are reduced native workspace semantics acceptable, or does a
   user journey require managed logical workspaces despite recovery and native
   shell tradeoffs?
6. Which single profile/host/version should follow Plasma: a portable policy
   profile, native integration, or one only after a bounded capability prototype?

## Sources And Unknowns

All web sources below were accessed on 2026-09-17. Plasma claims are pinned to
Plasma Desktop/KWin `v6.7.4` where source is cited; the package version actually
installed by a future helper must still be checked.

- KDE, [Plasma scripting](https://develop.kde.org/docs/plasma/scripting/),
  [scripting API](https://develop.kde.org/docs/plasma/scripting/api/), and
  [scripting examples](https://develop.kde.org/docs/plasma/scripting/examples/)
  - panel, containment, widget, configuration, and shell-script surfaces.
- KDE, [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/) -
  global desktop pool and per-screen current-desktop surface; documentation is
  generated for KWin 6.0, so target-tag source remains the compatibility check.
- KDE GitHub mirrors, [Pager applet](https://github.com/KDE/plasma-desktop/tree/v6.7.4/applets/pager),
  [default panel layout](https://github.com/KDE/plasma-desktop/blob/v6.7.4/layout-templates/org.kde.plasma.desktop.defaultPanel/contents/layout.js),
  and [KWin Overview](https://github.com/KDE/kwin/tree/v6.7.4/src/plugins/overview).
- Project static source, [`workspace-native.ts`](../../kwin/src/workspace-native.ts)
  and [`plan-adapter-entry.ts`](../../kwin/src/plan-adapter-entry.ts) - selected
  workspace mapping, numbered routes, and absence of a widget-facing contract.
- [Cross-platform feasibility](cross-platform-support/feasibility.md) - public
  workspace, settings, packaging, and managed-workspace limits for Windows,
  macOS, and GNOME.
- [Profile support](reference-wm-profile-support.md) - Hyprland `v0.56.2`,
  bspwm `0.9.12`, PaperWM `v50.0.1`, and their panel/authority boundaries.
- Waybar, [Hyprland workspaces module](https://github.com/Alexays/Waybar/blob/master/man/waybar-hyprland-workspaces.5.scd),
  and Polybar, [bspwm module](https://github.com/polybar/polybar/wiki/Module:-bspwm)
  - ecosystem documentation only; exact versions are unknown until selected.

Open implementation facts: Pager's target-tag configuration keys and multi-output
runtime behavior; Plasma shell locking and panel-ID behavior; Wayland thumbnail
availability; Waybar and Polybar release pins; GNOME Shell/Mutter major support;
Windows virtual-desktop and MSIX probes; and macOS Space, Dock, fullscreen, and
Accessibility behavior. None is resolved by this record.
