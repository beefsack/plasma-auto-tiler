# Multi-output workspaces and shortcuts

Approval proposal. Research-only for the reference-WM and KWin-capability
sections; no live KWin/Plasma testing was authorized and none was performed.
Every KWin-targeted behaviour is labelled by its evidence class:
`native` (documented KWin 6.7 scripting API), `script-emulated` (achievable
only through script-maintained state over the documented API), or `blocked`
(no documented scripting path). Reference-WM claims cite primary sources.

## Primary source list

| Tag | Source |
|---|---|
| [KWin-API] | KWin scripting API, https://develop.kde.org/docs/plasma/kwin/api/ (KWin::WorkspaceWrapper, KWin::VirtualDesktop, KWin::Output, KWin::Window) |
| [KWin-src] | KWin pinned v6.7.3 workspace wrapper subset, `kwin/src/kwin-globals.d.ts` |
| [B1] | bspwm(1) man page, https://raw.githubusercontent.com/baskerville/bspwm/master/doc/bspwm.1.asciidoc |
| [H-Disp] | Hyprland Dispatchers, https://wiki.hypr.land/Configuring/Basics/Dispatchers/ |
| [H-WS] | Hyprland Workspace Rules, https://wiki.hypr.land/Configuring/Basics/Workspace-Rules/ |
| [C-KR] | cosmic-comp default keybindings, https://raw.githubusercontent.com/pop-os/cosmic-comp/master/data/keybindings.ron |

## A. Purpose and non-goals

Purpose:

- Extend the single-output workspace and shortcut model shipped in commit
  `d6467e8` ("feat(workspaces): add dynamic desktop bindings") to a three-mode
  multi-output workspace model, defaulting to per-output-local.
- Guarantee an arrow + HJKL alias for every directional action so that
  reference-WM migrants (bspwm/Hyprland/COSMIC) get both sets.
- Target reference-WM migrants; overriding Plasma default shortcuts is
  explicitly acceptable where a reference-WM idiom conflicts.

Non-goals:

- No C++/effect work. A native helper is considered only if a required
  capability is `blocked` in scripting; this proposal identifies none that
  strictly require one (see G).
- No groups/stacks implementation in this change; only a reserved shortcut.
- No desktop rename/order persistence, no stable-output-identity work beyond
  the deterministic session mapping in E.
- No live mutation, registration change, or implementation in this change.

## B. Terminology

- `physical output ID`: the session-local `Output` object identity, read as the
  four scriptable properties `name`, `manufacturer`, `model`, `serialNumber`
  ([KWin-API] Output read-only properties; [KWin-src] 101-107). There is no
  stable identity across restart or hotplug: `Output.uuid` is neither a
  Q_PROPERTY nor Q_INVOKABLE and is not scriptable ([KWin-src] 10-13).
- `active output`: the output of the currently focused window
  (`Window.output`, "the output where the window center is on", [KWin-API]);
  when no window is focused, `workspace.activeScreen` (read-only [KWin-API]).
- `logical workspace number`: the key the user presses (1..9, plus 0 for
  append). It is mapped to a `KWin desktop object` per mode.
- `KWin desktop object`: a `KWin::VirtualDesktop` identified by its `id`
  string ([KWin-API]). `workspace.desktops` is a single global list; there is
  no per-output desktop list and no desktop-to-output ownership in the
  scripting API. Each output independently points at one current desktop of
  that global list.
- `ownership / session persistence`: a desktop the script created this session
  (`ownedDesktopIds`, `controller.ts:854`) is owned session-only; no
  identity survives restart, and pre-existing desktops are never owned or
  removed.

## C. Shortcut table

Reference: [C-KR] is the primary shipped-default reference because COSMIC is
the only one of the three that ships enforced arrow + HJKL defaults; [H-Disp]
and [B1] supply the command/idiom equivalents. "Current" is the shipped
`d6467e8` registration, not the uncommitted keyboard prototype. "Proposed" is
this change.

Directional actions must expose equivalent arrow and HJKL aliases (binding
decision). `H/J/K/L` map to left/down/up/right, matching COSMIC.

| Action | Current (d6467e8) | Proposed | Reference |
|---|---|---|---|
| Focus left/down/up/right (HJKL) | Meta+H/J/K; Meta+Alt+Ctrl+L | Meta+H/J/K/L | [C-KR] Super+h/j/k/l |
| Focus left/down/up/right (arrows) | Meta+Left/Down/Up/Right | Meta+Left/Down/Up/Right | [C-KR] Super+arrows |
| Move/swap left/down/up/right (HJKL) | Meta+Shift+H/J/K/L | Meta+Shift+H/J/K/L | [C-KR] Super+Shift+h/j/k/l; [H-Disp] move direction; [B1] node -s |
| Move/swap left/down/up/right (arrows) | Meta+Shift+Left/Down/Up/Right | Meta+Shift+Left/Down/Up/Right | [C-KR] Super+Shift+arrows |
| Resize left/down/up/right (HJKL) | (none) | Meta+Ctrl+H/J/K/L | [B1] node -z top/left/bottom/right; [H-Disp] resizeactive |
| Resize left/down/up/right (arrows) | (none) | Meta+Ctrl+Left/Down/Up/Right | [C-KR] Super+R/Super+Shift+R as the idiom; arrows for parity |
| Workspace 1..9 (select) | Meta+1..9 | Meta+1..9 | [C-KR] Super+1..9 Workspace(N); [H-Disp] workspace |
| Workspace 0 (append/focus trailing empty) | Meta+0 | Meta+0 | per-mode append/focus (D); registers as `plasma-auto-tiler-workspace-0` |
| Move window to workspace 1..9 | Meta+Shift+1..9 | Meta+Shift+1..9 | [C-KR] Super+Shift+1..9 MoveToWorkspace(N); [H-Disp] movetoworkspace |
| Move window to workspace 0 (move-append) | Meta+Shift+0 | Meta+Shift+0 | current moveActiveToWorkspace(0) |
| Previous/next workspace | (none) | Component requirement: unbound, not registered | [C-KR] Super+Ctrl+arrows PreviousWorkspace/NextWorkspace; needs a workspace-mode unit |
| Float/tile toggle | Meta+G | Meta+G | [C-KR] Super+g ToggleWindowFloating |
| Sticky toggle | Meta+Shift+G | Meta+Shift+G | current; sticky = pinned across all desktops |
| Maximize | Meta+M | Meta+M | [C-KR] Super+m Maximize |
| Fullscreen | (none) | Component requirement: unbound, not registered | [C-KR] Super+F11 Fullscreen; needs a KWin capability component |
| Groups/stack toggle | (none) | Component requirement: Meta+S reserved, unbound, not registered | [C-KR] Super+s ToggleStacking; [H-Disp] togglegroup; needs a stacking component |
| Insert next window (directional) | Meta+Alt+arrows | unchanged | current armKeyboardInsertion |
| Presets columns/rows/grid/dwindle | Meta+Alt+1..4 | unchanged | current applyPreset |

Notes:

- The shipped focus bindings are already Meta+H/J/K, but the right binding is
  the anomalous Meta+Alt+Ctrl+L. This change makes the family consistently Meta
  (COSMIC parity). The shipped move HJKL bindings already equal the proposed
  Meta+Shift family. The remaining implemented bindings (resize mode, maximize,
  workspace select/move) are additive; fullscreen, previous/next workspace, and
  groups are component requirements only (never implemented or registered).
- "Move/swap" is one directional action: it assigns into an empty target leaf
  and swaps with the occupant of an occupied target (current
  `moveActiveWindow`/`swapToOccupiedTarget`, controller.ts:1391-1490). Hyprland
  splits `movewindow` from `swapwindow` [H-Disp]; COSMIC collapses both into
  Super+Shift+direction [C-KR]. This change keeps one move/swap action and does
  not add a separate pure-swap action.
- Shipped d6467e8 has no keyboard split resize. The uncommitted prototype adds
  only HJKL aliases; this proposal requires both HJKL and arrow aliases.
- Fullscreen (Meta+F11), previous/next workspace, and groups/stack toggle are
  catalogued as component requirements only: they are not implemented and never
  registered as false equivalents in any profile. They need a KWin capability,
  an external Plasma component, or a workspace-mode unit (see C table and the
  catalog `component-requirement` classification).
- `Meta+0` (stable ID `plasma-auto-tiler-workspace-0`) is registered in every
  mode and in every profile unless an exact in-profile conflict exists. It
  focuses or creates the mode-defined trailing empty: on the active output
  only for `per-output-local` and `global-unique`, and synchronized across all
  connected outputs for `shared`. Repeated invocation while the target is
  already the trailing empty is idempotent, and once occupied automatic
  reconciliation creates exactly one replacement trailing empty. There is no
  hard workspace-count bound. Registration is KWin-local and stays subject to
  the collision limitation in G.
- `Meta+Shift+0` remains in scope independently as move-to-newly-appended-and-
  follow. It is separately registered and handled from `Meta+0`.

## D. Workspace mode semantics

Default mode is `per-output-local` (binding decision). Mode selection via the
script configuration key `workspaceMode` (`readConfig("workspaceMode",
"per-output-local")`, [KWin-API] Global readConfig), one of
`per-output-local` | `global-unique` | `shared`.

Common to all modes:

- `active-output selection`: `activeWindow.output` when a window is focused,
  else `workspace.activeScreen`.
- `navigation` and `move-follow` operate on the active output's current desktop.
- `window state`: a window belongs to one or more desktops via the read-write
  `Window.desktops` list ([KWin-API]); empty list means all desktops, and
  `Window.onAllDesktops` is the sticky write. Sticky windows remain visible on
  every output regardless of that output's current desktop.
- Trailing-empty maintenance remains automatic in the mode-defined scope; it
  may create or retain the one required trailing empty workspace during
  reconciliation. `Meta+0` focuses the mode-defined trailing empty, creating it
  when absent, and is idempotent when the target is already trailing empty.
- `Meta+Shift+0` appends one workspace in the mode-defined scope when needed,
  moves the active eligible window there, and follows it; see per-mode.
- `floating`: workspace selection never retile, resize, maximize, or otherwise
  changes a floating window's state. A non-sticky floating window moves between
  workspaces by the same single-desktop membership write and move-follow rule as
  a tiled window.
- `sticky`: a sticky window remains visible on its assigned physical output on
  every desktop, has no workspace-local membership, and is refused by
  move-to-workspace. Selecting a workspace never changes its state or output.
- `fullscreen` and `maximized`: selecting or navigating workspaces never changes
  either state. Move-to-workspace is refused, preserving the shipped safety
  rule. Output transfer is never implicit in a workspace command.

### D1. per-output-local (default)

- Each output owns an independent ordered set of logical workspaces. Logical
  workspace `n` on output X is a distinct global desktop from logical workspace
  `n` on output Y. With one output this degenerates to today's model (the
  output's local set is the whole global list), so single-output behaviour is
  unchanged by migration.
- `local/global mapping`: the script keeps an ordered map
  `outputKey -> VirtualDesktop[]`; logical number `n` resolves to the nth entry
  of the active output's list. `outputKey` is the physical output ID in B.
- `navigation Meta+n`: `setCurrentDesktopForScreen(mapped[n], activeOutput)`
  ([KWin-API] function). Absent `n` is a no-op (never creates), matching current
  `navigateWorkspace` (controller.ts:5990-5994).
- `trailing empty`: reconciliation retains one trailing empty desktop per
  output, creating an owned desktop on that output's list when necessary.
- `Meta+0`: focus the active output's owned trailing empty desktop, creating
  and recording one if reconciliation has not yet done so. It is idempotent
  when the active output is already trailing empty.
- `move-append Meta+Shift+0`: resolve the trailing empty desktop for the active
  output, creating and recording one if reconciliation has not yet done so;
  write the eligible active window's single membership and follow it.
- `trailing empty`: per-output reconciliation. Cleanup may remove only owned,
  empty, non-current, non-visible-on-any-output desktops (extends current
  `cleanupDesktops`, controller.ts:6412-6512, with a per-output scope). The
  trailing-most occupied workspace is never removed.
- `move-follow Meta+Shift+n`: write `window.desktops = [mapped[n]]` (single
   membership, [KWin-API] Window.desktops) and follow to that desktop on the
   window's output. Sticky/fullscreen/maximized moves are refused exactly as
   today (controller.ts:6211-6270).

### D2. global-unique

- Desktops are global and each carries an arbitrary global number
  (`x11DesktopNumber`, read-only [KWin-API]). Each output has an independent
  current desktop (native KWin model).
- `assignment`: the active output's ordered assigned subset is the ordered list
  of global desktops currently assigned to that output, ordered by
  `x11DesktopNumber` ascending.
- `navigation Meta+n`: resolve the nth desktop of the active output's ordered
  subset, then `setCurrentDesktopForScreen` on the active output. When the
  target is already shown on another output, follow Hyprland's
  `focusworkspaceoncurrentmonitor` ("focuses the requested workspace on the
  current monitor, swapping the current workspace to a different monitor if
  necessary", [H-Disp]) - the desktop moves to the active output.
- `trailing empty`: each assigned subset retains one trailing empty desktop.
- `Meta+0`: focus the active output's assigned trailing empty desktop, creating
  and assigning one when absent. It is idempotent when the active output is
  already trailing empty.
- `move-append Meta+Shift+0`: create and assign one new global desktop only
  when no trailing empty exists, then move-follow the eligible active window.
- `move-follow Meta+Shift+n`: resolve the nth entry of the active output's
   assigned subset, give the active non-sticky/non-fullscreen/non-maximized
   window single membership in that desktop, and switch the active output to
   it. If the target was visible on a different output, first apply the
   navigation swap rule above.
- `trailing empty and cleanup`: each output's assigned subset retains one
   trailing empty desktop. Cleanup removes only a script-owned desktop that is
   empty, non-current, invisible on every output, and no longer assigned to any
   output. Pre-existing desktops are never removed.

### D3. shared

- One logical workspace set synchronized across every output. Logical number
  `n` maps to a single global desktop.
- `navigation Meta+n`: set every output's current desktop to that desktop by
  iterating `setCurrentDesktopForScreen(target, output)` over
  `workspace.screens` ([KWin-API]); all outputs show the same logical workspace.
- `trailing empty`: the shared set retains one trailing empty desktop.
- `Meta+0`: focus the shared trailing empty desktop, creating it when absent,
  and synchronize all outputs to it. It is idempotent when the shared set is
  already trailing empty.
- `move-append Meta+Shift+0`: create one shared desktop only when no trailing
  empty exists, move the eligible active window to it, and switch all outputs
  to it.
- `move-follow Meta+Shift+n`: give the active non-sticky/non-fullscreen/
  non-maximized window single membership in the shared target, then switch all
  outputs to it. The existing active window's output determines which window is
  moved; the destination is not output-specific.
- `trailing empty and cleanup`: the shared set retains one trailing empty
  desktop. Cleanup removes only a script-owned desktop that is empty and not
  current on any output. Pre-existing desktops are never removed.

## E. Stable-output persistence and hotplug collisions

- Output identity is session-local (B). The script rebuilds its per-output
  mapping on `screensChanged()` ([KWin-API] signal) and on restart by
  re-enumerating `workspace.screens` + `workspace.desktops`.
- `hotplug`: on `screensChanged`, outputs are matched by the ordered tuple
   (`manufacturer`, `model`, `serialNumber`, `name`). A surviving output keeps
   its mapping (desktops remain in the global list); a removed output's
   still-empty owned desktops are candidates for cleanup; a new output gets a
   fresh local set containing one newly-created desktop. It never adopts a
   pre-existing desktop merely because that desktop is currently visible.
- `collision`: two outputs with an identical tuple are indistinguishable by the
  scriptable API. Deterministic fallback is first-seen assignment order (the
  order `workspace.screens` returns), which is stable within a session but not
  across a plug/replug reorder. This is a documented limitation, not an error.
- `rename`: identity is the `id` string, never the name, so a desktop rename
  (read-write `VirtualDesktop.name`, [KWin-API]) or a
  `x11DesktopNumberChanged`/`desktopsChanged` reorder does not break the
  mapping. The mapping is keyed by id and ordered by explicit list position,
  not by `x11DesktopNumber` (same rule as current `orderedDesktops`,
  controller.ts:391).
- `session persistence`: script-owned desktops are session-only. KWin itself
  persists pre-existing desktops across restart; the per-output local mapping is
  rebuilt, so a per-output-local layout is not itself persisted across restart
  without additional config persistence (out of scope).

## F. Dynamic lifecycle

- `desktopsChanged` -> per-output reconciliation + deferred-intent drain
   (extends `handleDesktopsChanged`, controller.ts:5974-5979).
- `screensChanged` -> rebuild the output map, then reconcile per output.
- `currentDesktopChanged(previous, current, output)` -> re-resolve the active
  scope for the affected output (extends `handleScopeChange`,
  controller.ts:3168, wired at controller.ts:936-937); the `output` argument of
  the signal is authoritative for which output switched ([KWin-API] signal).
- `move-append` deferral: reuse the existing `workspaceMutationDeferred` and
   pending-intent machinery (controller.ts:6082-6114), now keyed by the active
   output. `Meta+0` append/focus and `Meta+Shift+0` move-append share this
   bounded drain; `Meta+0` focuses or creates the mode-defined trailing empty.
- `global-unique state`: maintain `outputKey -> VirtualDesktop.id[]` for the
  assigned ordered subset, plus `desktopId -> outputKey` as its inverse. An
  assignment is script state, not a KWin desktop property. A desktop visible on
  an output remains assigned to that output until an explicit navigation swap,
  hotplug reconciliation, or cleanup changes the map.
- `shared state`: maintain one ordered `VirtualDesktop.id[]`; no output owns a
  desktop. All `currentDesktopForScreen` values are reconciled to its selected
  entry after every shared navigation or move-follow operation.

## G. KWin component feasibility

Evidence class per capability, from [KWin-API] (official docs) first and
[KWin-src] (pinned wrapper) second. No C++ internals are claimed as scripting
API.

| Capability | Class | Evidence |
|---|---|---|
| Enumerate outputs | native | `workspace.screens`, `activeScreen` read-only [KWin-API] |
| Global desktop list read | native | `workspace.desktops` QList<VirtualDesktop*> [KWin-API] |
| Desktop identity / number / name | native | `VirtualDesktop.id`, `x11DesktopNumber` (read-only), `name` (read-write) [KWin-API] |
| Per-output current desktop read | native | `currentDesktopForScreen(output)` [KWin-API]; used at controller.ts:4596 |
| Per-output current desktop write | native | `setCurrentDesktopForScreen(desktop, output)` [KWin-API]; [KWin-src] 273-276 |
| Global (active-screen) current desktop read/write | native | `currentDesktop` read-write, "current virtual desktop on the active screen" [KWin-API]; [KWin-src] 257-261 |
| Desktop create / remove | native | `createDesktop(position, name)`, `removeDesktop(desktop)` [KWin-API] |
| Window multiple-desktop membership read/write | native | `Window.desktops` read-write (empty = all desktops) [KWin-API]; written via `writeWindowDesktops` boundary.ts:365-375 |
| Window output read | native | `Window.output` read-only [KWin-API] |
| Move window to another output | native | `sendClientToScreen(client, output)` [KWin-API] |
| Desktop/output change signals | native | `currentDesktopChanged(prev, cur, output)` (carries output), `desktopsChanged`, `screensChanged` [KWin-API] |
| Stable output identity across restart/hotplug | blocked | `Output.uuid` not scriptable [KWin-src] 10-13; only name/manufacturer/model/serialNumber |
| Per-output desktop list / desktop-to-output ownership | blocked | single global `desktops` list only; no per-output list in [KWin-API] |
| Independent per-output current desktop | native | `setCurrentDesktopForScreen` is independent per output |

Mode feasibility:

- `global-unique` (D2): `native`. Global desktops with independent per-output
  current are the native KWin model; only the logical-number -> desktop
  assignment is script-maintained.
- `shared` (D3): `native`. One global list; "synchronize" is iterating
  `setCurrentDesktopForScreen` over every output.
- `per-output-local` (D1, default): `script-emulated`. Independent per-output
  current desktops are native, but per-output desktop *sets* are not: KWin has
  one global list, so "output X's logical workspace n is a distinct desktop from
  output Y's logical workspace n" is realized by allocating distinct global
  desktops per output and maintaining an `outputKey -> [id]` map. Consequences
  and limitations (specified, not hidden):
  - N outputs x M logical workspaces cost N*M global desktops, all visible in
    Plasma's pager/overview as separate desktops. This is inherent to the
    global-list model and is the primary cost of mode A.
  - Append, trailing-empty, and cleanup reconcile per output over the global
    list; no desktop is ever owned by a removed output (see E).
  - A native helper is NOT required for mode A; it is emulation over documented
    calls, not a blocked capability.

`blocked` items that would require a native helper only if their scope were
widened: stable output identity across restart/hotplug (E), and per-output
desktop ownership as a KWin-internal concept. Neither is required by this
proposal; both are handled by deterministic session mapping and are listed as
limitations, not blockers.

## H. Acceptance and static test matrix

Deterministic, two outputs (call them `E` = external, serial A, and `L` =
laptop, serial B), mode `per-output-local`. A unit test drives the environment
seam with fake outputs/desktops; no live host is required.

1. Two outputs, mode A: `E` owns logical [1,2], `L` owns logical [1,2,3]; the
   two "logical 1" desktops are distinct global ids.
2. Meta+2 with focus on a window on `E` calls `setCurrentDesktopForScreen` with
   `E`'s second desktop; `L`'s current desktop is unchanged.
3. Reconciliation with no trailing empty on `E` creates exactly one owned
   desktop, appends it to `E`'s ordered list, and leaves `L` unchanged. A second
   reconciliation creates no duplicate.
4. `Meta+0` registers as `plasma-auto-tiler-workspace-0` in every mode; on `E`
   it focuses or creates `E`'s trailing empty only, and a repeat invocation
   while the target is already trailing empty creates no desktop.
5. Meta+Shift+0 with focus on an eligible window on `E` moves it to `E`'s
   existing trailing empty desktop and follows; if none exists, it creates one
   only once. `L` remains unchanged.
6. Meta+Shift+3 with focus on a window on `L` writes that window's
   `desktops = [L.logical[2]]` and follows.
7. Sticky/maximized/fullscreen window: Meta+Shift+n, including Meta+Shift+0,
   is refused with the existing
   diagnostics (controller.ts:6211-6226); no write occurs.
8. Hotplug: remove `E`; `E`'s owned empty desktops become cleanup candidates;
   `L`'s mapping and current desktop are unchanged. Replug an identical-tuple
   output; it is matched by first-seen order and gets a fresh one-desktop set.
9. Desktop rename/reorder: changing `name` or reordering does not change the
   mapping (keyed by id, not name/number).
10. Mode `shared`: Meta+2 sets `E` and `L` to the same desktop id.
11. Mode `global-unique`: Meta+2 on `E` sets `E` to the 2nd desktop of `E`'s
    ordered assigned subset.
12. Mode `global-unique`: `E` owns global desktops [1,2,4] and `L` owns
    [3,5,6]. Meta+3 on `E` selects global desktop 4; Meta+2 on `L` selects
    global desktop 5.
13. Mode `shared`: both `E` and `L` show logical workspace 1; Meta+2 changes
    both to the single logical workspace 2.
14. Profile fixtures: the selected `cosmic` catalog is the default and each
    catalog exactly equals its pinned upstream fixture except rows explicitly
    classified as compatibility aliases, deferred, or component requirements. A
    deterministic validator rejects duplicate active sequences within one
    profile and reports the conflicting action IDs; component-requirement rows
    are never active sequences (they never register or resolve).
15. Profile registration: each alias uses a distinct shortcut ID; user-customized
    KGlobalAccel rows survive reload and profile switching; Meta+0 registers in
    every profile as `plasma-auto-tiler-workspace-0` unless an exact in-profile
    conflict exists, and no unimplemented `fullscreen`, `previous-workspace*`,
    `next-workspace*`, or `group-toggle` row registers in any profile. The
    aggregate registration gate is only evidence of attempted registration,
    never evidence that a colliding Plasma global is activated.
16. Global migration boundary: static tests distinguish script-local catalog
    registration from the separately gated installer/KCM migration. No v1 test
    claims a KWin script displaced or reassigned a Plasma global shortcut.

User exact examples:

- Example 1 (mode A): two monitors, external shows browser on logical 1 and
  editor on logical 2; laptop shows terminals on its logical 1 and chat on its
  logical 2. Meta+1 then Meta+2 on the external cycles its own two workspaces
  without touching the laptop.
- Example 2 (append/focus): automatic reconciliation maintains a fresh empty
  workspace "3" on the laptop only; Meta+0 focuses it, Meta+Shift+0 moves the
  focused window there, and once occupied reconciliation creates exactly one
  replacement trailing empty on the laptop.

## I. Migration from shipped d6467e8 and dirty prototype

Shipped behaviour (d6467e8, "feat(workspaces): add dynamic desktop bindings"):

- Meta+1..9 = `navigateWorkspace(index)` over the global positional desktop list
  (controller.ts:5983-5998); Meta+Shift+1..9 = move to that positional desktop;
  Meta+0 = append/focus trailing empty; Meta+Shift+0 = move-append
  (controller.ts:6009-6270).
- Directional focus = Meta+H/J/K, Meta+Alt+Ctrl+L, and Meta+arrows; move =
  Meta+Shift+HJKL and Meta+Shift+arrows; no keyboard split resize registration
  exists (controller.ts:965-1059).

Changes:

- Workspace navigation moves from global-positional to per-output-local
  (mode A default). Single-output behaviour is unchanged; only the
  multi-output meaning changes.
- Register Meta+0 as `plasma-auto-tiler-workspace-0` with a per-mode
  append/focus handler and no hard workspace-count bound. Automatic
  trailing-empty maintenance remains; Meta+Shift+0 remains move-append and
  follow.
- Replace the blended registrations with selected-profile catalog entries. Keep
  dirty prototype action code only where it implements an approved selected
  profile action; no removal occurs merely during planning.
- COSMIC resize is its exact Meta+R / Meta+Shift+R mode. Do not retain invented
  Meta+Ctrl resize bindings as COSMIC defaults. Directional resize aliases are
  separately classified and only permitted when they do not displace an exact
  profile row.
- The current Meta+arrow, Meta+Shift+arrow, Meta+Alt+arrow, Meta+Ctrl+arrow,
  Meta+L, and Meta+Alt+K collisions must be catalogued. They remain shadowed on
  stock Plasma until the gated migration component exists; they must not be
  silently presented as working overrides.

## J. Deferred intent and staged delivery

`per-output-local` ships as the default by the binding user decision. Its N*M
global-desktop pager/overview visibility cost is an accepted limitation, not an
open decision (G).

- Combined directional move/swap is resolved: retain one action, as specified
  in C. Do not add a separate pure-swap binding in this change.
- `Meta+0` append/focus is restored and registered in every mode as
  `plasma-auto-tiler-workspace-0` with the per-mode semantics in D. It has no
  hard workspace-count bound.
- The first deliverable is a truthful script-local profile layer with `cosmic`
  selected by default, complete pinned fixtures, collision validation, action
  implementations within the controller boundary, and KWin-local registration.
  It does not claim Plasma-global conflict takeover.
- The second deliverable is a separately approved installer/KCM migration and
  rollback component. Until it exists, any profile row colliding with Plasma is
  an explicit activation limitation, not fulfilled 100% default-keybinding
  support. Full 100% selected-profile support is accepted only after this stage
  has exact fixture and live migration evidence.
