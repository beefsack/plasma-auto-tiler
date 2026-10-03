# Auto-tiling prior-art catalogue

## Types and scope

- **Compositor-native tilers**: the WM/compositor itself tiles, including X11
  WMs. Inputs to our cross-platform functional specification.
- **Host-integrated tilers**: add automatic tiling over a desktop's existing WM.
  Inputs to our host-integration mechanisms.
- Selected established projects and relevant emerging projects, checked
  2026-10-03. Manual snap/zone-only tools are excluded. Quiet/experimental
  candidates are labelled; recent pushes alone do not establish maintenance.
- Source/docs inspection only, no runtime or comparative latency evidence.
  Unknown means not established by the inspected material. This is an index,
  not a dependency recommendation or a new product decision.

Detailed research: [WM behavior comparison](../reference-wm-comparison.md),
[Hyprland/bspwm/PaperWM profiles](reference-wm-profile-support.md), and
[macOS mechanisms](macos-port/prior-art.md). The macOS survey's older public-AX
recommendation is superseded by the tier-2 direction in
[the backlog](../backlog.md#open-work).

## Algorithm families

| Family | Model | Representative projects |
| --- | --- | --- |
| Tree/container | Ordered horizontal/vertical containers, optionally tabs/stacks | COSMIC (N-ary), i3/Sway, AeroSpace, GlazeWM, FancyWM |
| BSP/dynamic tree | Recursively split an occupied rectangle, usually binary | bspwm, yabai, Hyprland Dwindle, Polonium |
| Master-stack/dynamic layout | Recompute a workspace from a selected layout function | dwm, xmonad, qtile MonadTall, Amethyst, Krohnkite, awesome |
| Scrollable | Columns/rows extend beyond a viewport; opening need not resize peers | niri, PaperWM, Karousel, Paneru |
| Grid/region | Automatically assign windows to configured cells/regions | Grid-Tiling-Kwin, Tiling Shell, komorebi Grid |
| Mosaic/packing | Pack preferred sizes into available regions, with overflow policy | MosaicWM |

Families overlap. Tabbed stacks are not N-ary splits; scrolling columns are not
ordinary on-screen split trees. A multi-layout WM can implement several families.

## Windows - host-integrated

- **[GlazeWM](https://github.com/glzr-io/glazewm)**: i3-like split-container
  auto-tiling; tree/container. Rust, Win32 observation/geometry; hide/show and
  DWM-cloak paths; `WH_KEYBOARD_LL` input. Own per-monitor workspaces rather than
  Windows virtual desktops (native desktops are a visibility filter).
  GPL-3.0 (only/later not established here). Local `glazewm`; quiet default
  branch, also has a macOS backend below. Sources: `packages/wm/src/commands/container/` and
  `packages/wm-platform/src/platform_impl/windows/{native_window,keyboard_hook}.rs`.
- **[komorebi](https://github.com/LGUG2Z/komorebi)**: automatic BSP, columns,
  rows, master/stack, grid and scrolling layouts; multi-family. Rust/Win32;
  `ShowWindowAsync(SW_HIDE)` path verified, not asserted as the only hiding mode.
  External `whkd`/AutoHotkey shortcuts. Own per-monitor workspaces with native
  virtual-desktop awareness. Custom Komorebi License 2.0.0 (personal-use
  permitted purpose; separate commercial terms), not MIT. Local `komorebi`.
  Sources: `komorebi-layouts/src/default_layout.rs`, `komorebi/src/windows_api.rs`,
  `README.md`, `LICENSE.md`.
- **[FancyWM](https://github.com/FancyWM/fancywm)**: new windows flow into nested
  horizontal/vertical/stack panels; tree/container, with dialog/minimum-size
  floating. C#/Win32, low-level keyboard/mouse hooks; native Windows virtual
  desktops, per-monitor or global layouts. PolyForm Perimeter 1.0.1. Local
  `fancywm`, partial: window-management submodules absent, hiding unknown.
  Main branch quiet since March. Sources: `README.md`, `FancyWM/FancyWM.csproj`,
  `FancyWM/Utilities/LowLevel{Keyboard,Mouse}Hook.cs`, `LICENSE`. Toast positioning
  is not evidence of managed-window hiding.
- **[Seelen UI](https://github.com/eythaann/Seelen-UI)**: broader Windows shell
  with automatic layout-tree placement (leaf/stack/horizontal/vertical templates;
  BSP/column presets). Tree/container and region-based layouts. Rust +
  TypeScript/Tauri, Win32 `ShowWindow`/`SetWindowPos`, service and hook DLL;
  keyboard-hook dependency, exact hook split unknown. Custom/emulated virtual
  desktops, independent per-monitor configuration. AGPL-3.0-or-later; active.
  Local `Seelen-UI`. Sources: `README.md`, `documentation/wm-layouts.md`, `Cargo.toml`,
  `src/{background,service}/windows_api/`.
- **[Whim](https://github.com/dalyIsaac/Whim)** - quiet alpha/watchlist:
  pluggable TreeLayoutEngine and fully automatic SliceLayoutEngine;
  tree/container and dynamic-layout families. C#/CsWin32, `SW_HIDE` hiding,
  `WH_KEYBOARD_LL`; own monitor-independent workspaces, not Windows desktops.
  MIT. Local `Whim`; default tip December 2025 is a dependency update, so current
  maintenance is uncertain. Sources: `README.md`,
  `src/Whim/Native/NativeManager.cs`, `src/Whim/Keybind/KeybindHook.cs`.

## macOS - host-integrated

Mechanism detail and SIP/TCC tradeoffs stay in the
[macOS survey](macos-port/prior-art.md). Private API use does not by itself imply
SIP reduction; none of the following is a measured jank ranking.

- **[AeroSpace](https://github.com/nikitabobko/AeroSpace)**: automatic i3-like
  trees, tiles/accordion containers. Swift, public AX geometry plus private
  window-ID helper; Carbon hotkeys through HotKey. Emulated workspaces use
  offscreen parking with slivers; shared workspace pool across monitors,
  independent visible selections. MIT; active. Local `AeroSpace`.
  Sources: `README.md`, `Package.swift`, linked survey/guide.
- **[yabai](https://github.com/asmvik/yabai)**: automatic BSP, with stack/float
  modes. C, AX baseline and optional Dock scripting addition for elevated
  operations; external shortcuts (e.g. skhd). Native Spaces, display-aware,
  separate Spaces ON required. Workspace invisibility follows native Spaces;
  optional scripting addition requires partial SIP disable. MIT. Local `yabai`.
  Sources: `README.md`, `LICENSE.txt`, linked survey/SIP documentation.
- **[Amethyst](https://github.com/ianyh/Amethyst)**: xmonad-style workspace
  layouts (Tall and other dynamic layouts). Swift/AX via Silica, private Spaces
  IDs; KeyboardShortcuts/MASShortcut integration. Native Spaces, focus/throw
  across displays; custom hiding not established. MIT. Local `Amethyst`.
  Sources: `README.md`, linked survey's `Space.swift`/hotkey/dependency evidence.
- **[GlazeWM macOS](https://github.com/glzr-io/glazewm)**: same Rust
  tree/container project, macOS support in v3.10.0. AX geometry, private SLPS
  focus calls, session `CGEventTap` keyboard interception. Exact macOS workspace
  hiding and native/emulated/per-monitor projection not established here; do not
  infer them from Windows. GPL-3.0 (only/later not established here).
  Local `glazewm`. Sources:
  `packages/wm-platform/src/platform_impl/macos/{native_window,keyboard_hook}.rs`;
  [release](https://github.com/glzr-io/glazewm/releases/tag/v3.10.0).
- **[Rift](https://github.com/acsandmann/rift)**: multi-layout Glide fork:
  tree, BSP, master-stack, scrolling and stack. Rust/AX + SkyLight;
  `SLSOrderWindow(..., kCGSOrderOut, ...)` hiding; HID/event-tap/hotkey input.
  Virtual workspaces projected onto native Spaces, display-aware with separate
  Spaces ON. Apache-2.0; active. Local `rift`. Sources: `README.md`,
  `src/model/server.rs`, `src/sys/cgs_window.rs`, `src/actor/input.rs`.
- **[Glide](https://github.com/tmandry/glide)**: tree/container auto-tiler.
  Rust, AX + CGWindowList + private SkyLight; per-app threads/transaction IDs
  address asynchronous AX delivery. Native Spaces integration, separate Spaces
  ON; exact hiding/hotkey substrate unknown in this read (controller owns
  hotkeys; mouse event tap documented). Apache-2.0 OR MIT. Local `glide`; active.
  Sources: `README.md`, `ARCHITECTURE.md`, `Cargo.toml`. GitHub resolves
  `glide-wm/glide` to `tmandry/glide`; manifest still names the former.
- **[Paneru](https://github.com/karinushka/paneru)**: scrollable per-monitor
  strips; opening does not resize existing windows. Rust/Bevy ECS, AX + SkyLight,
  CGEvent tap with passthrough; offscreen parking leaves slivers. Keeps native
  Spaces, with experimental virtual rows. MIT; active. Local `paneru`.
  Sources: `README.md`, `ARCHITECTURE.md`, `src/platform/input.rs`,
  `src/manager/skylight.rs`, `src/ecs/display.rs`.
- **[komorebi-for-mac](https://github.com/LGUG2Z/komorebi-for-mac)** - quiet
  early port: Rust BSP/dynamic layouts; AX + SkyLight, AXMinimized hiding,
  HID head-insert CGEvent tap. Own Workspace ring per Monitor. Komorebi License
  2.0.0 permits personal use; commercial use needs the separate paid Individual
  license described upstream. Local `komorebi-for-mac`; quiet since May, not
  evidence of abandonment. Sources: `README.md`, `LICENSE.md`,
  `komorebi/src/{window,monitor,input_event_listener}.rs`.
- **[PaperWM.spoon](https://github.com/mogenson/PaperWM.spoon)**: automatic
  scrollable columns through Hammerspoon. Lua, AX geometry/private identity and
  Spaces helpers supplied by the host; Carbon hotkeys; edge-margin parking.
  Native Spaces, per-Space strips across screens (vertical display arrangement
  advised). MIT; active. Local `PaperWM.spoon`. Sources: `README.md`, linked
  survey. **[Hammerspoon](https://github.com/Hammerspoon/hammerspoon)** is the
  MIT Lua/C/Objective-C automation host, not itself an auto-tiler; local
  `hammerspoon`.

## KDE Plasma - host-integrated KWin scripts

All use KWin's scripting/shortcut authority and native desktop visibility, not
an external input hook. Individual script-specific hiding mechanisms were not
established. KWin native desktops are shared desktop IDs; per-screen layouts do
not imply independent native desktop selection per monitor.

- **[Krohnkite](https://codeberg.org/anametologin/Krohnkite)**: maintained KWin 6
  fork, dwm-inspired dynamic tiling; master-stack plus columns, binary-tree and
  other selectable layouts. TypeScript; native desktops/Activities and
  multi-screen layout rules. MIT; September commits, including this week.
  Local `Krohnkite`. Sources: `README.md`, `src/layouts/`, `LICENSE`, clone remote
  and log. The archived GitHub fork is not the maintained upstream.
- **[Polonium](https://github.com/zeroxoneafour/polonium)**: automatic pluggable
  binary-tree/dwindle, half/three-column/pillars layouts and KWin tile editing.
  BSP/dynamic-layout families. TypeScript; native layouts per desktop/screen;
  Wayland-only per README. MIT; September update. Local `polonium`.
  Sources: `readme.md`, `src/engine/layouts/`, `license.txt`.
- **[Karousel](https://github.com/peterfajdiga/karousel)**: automatic scrollable
  columns; user-controlled widths, horizontal scrolling when full. TypeScript +
  QML; native desktops. README explicitly excludes multi-screen and
  all-desktops/all-Activities windows. GPL-3.0 (only/later not established here);
  August update.
  Local `karousel`. Sources: `README.md`, `LICENSE`.
- **[Grid-Tiling-Kwin](https://github.com/lingtjien/Grid-Tiling-Kwin)**:
  automatic configurable grid slots per desktop/screen; overflow tries other
  screens/desktops then leaves windows untiled. Grid/region. JavaScript/KWin;
  native desktops, multi-screen allocation. GPL-3.0 (only/later not established
  here); August update.
  Local `Grid-Tiling-Kwin`. Sources: `README.md`, `contents/`, `LICENSE`.

## GNOME - host-integrated Shell extensions

These use in-process GJS/Meta.Window/Shell actors and GNOME keybindings; not
generic external Wayland geometry APIs. Workspaces are native; per-monitor
layouts must be distinguished from GNOME's shared workspace stack. Hiding
internals are unknown except the previously inspected PaperWM projection.

- **[PaperWM](https://github.com/paperwm/PaperWM)**: automatic scrollable
  columns/rows. JavaScript, Shell clone actors and viewport clipping/scrolling.
  Native workspace stack shared across monitors; different monitors display
  different workspaces, not independent niri-style stacks. GPL-3.0 (only/later
  not established here). Local `PaperWM`; see
  [pinned profile research](reference-wm-profile-support.md#paperwm) for column
  operations, input/conflict restoration and workspace policy.
- **[Pop Shell](https://github.com/pop-os/shell)**: optional automatic
  binary-tree tiling and stacks; tree/container. TypeScript/GJS, Shell
  keybindings; native GNOME workspaces, exact per-monitor policy not inspected.
  GPL-3.0 (only/later not established here). Local `shell`: remote confirms Pop
  Shell, default branch
  `master_noble`; GNOME 45-50 metadata and March GNOME 50 change, not COSMIC's
  compositor. Sources: `README.md`, `metadata.json`, `src/{forest,auto_tiler,stack}.ts`.
- **[Tiling Shell](https://github.com/domferr/tilingshell)**: region-layout
  editor/snap assistant with genuine opt-in auto-placement: new windows move to
  the best tile, disabled by default. Grid/region; TypeScript/GJS and GNOME
  keybindings. Native per-workspace layouts, multi-monitor/mixed scaling;
  metadata supports Shell 42-50. GPL-3.0-or-later. Local `tilingshell`.
  Sources: `README.md` Auto-tiling section, `resources/metadata.json`.
- **[MosaicWM](https://github.com/CleoMenezesJr/MosaicWM)** - active experimental
  testbed: automatic radial mosaic/packing, preferred sizes, LRU live-thumbnail
  miniatures and workspace overflow fallback. JavaScript/GJS, native
  workspaces; multi-monitor requires Workspaces on all displays. GPL-2.0-or-later.
  Local `MosaicWM`; current tree targets GNOME 51, frozen GNOME 50 tag. Sources:
  `README.md`, `extension/{mosaicModel,sizeAllocator}.js`. Proposing the model
  upstream is a goal, not evidence of an accepted GNOME collaboration.

## Other Linux desktops

- **Cinnamon, Xfce, MATE, Budgie**: no established maintained host-integrated
  auto-tiler was verified in this bounded survey. That is a catalogue gap, not
  proof none exists. Built-in snapping alone does not qualify. X11 tiling WMs
  below are separate WM choices; desktop replacement/coexistence needs its own
  compatibility research, especially for compositor-coupled shells.
- **LXQt**: its [Wayland session documentation](https://github.com/lxqt/lxqt/wiki/ConfigWaylandSettings)
  lists Sway, Hyprland, niri and river alongside stacking compositors. This is
  native compositor selection, not an LXQt auto-tiling extension. The page is
  marked deprecated; its river description predates the current split below.

## Linux WMs/compositors - compositor-native tilers

These own native workspace/tag visibility and input dispatch; they do not need
host-integrated `SW_HIDE`/AX parking to implement workspaces. Source analysis
does not prove runtime parity on any desktop.

- **[COSMIC / cosmic-comp](https://github.com/pop-os/cosmic-comp)**: Rust/Smithay
  Wayland compositor, ordered **N-ary split** groups with proportional sibling
  shares; tree/container. Joining/leaving splits inserts/removes a share and
  resizes peers; drag targets distinguish window splits, group edges/interiors
  and tab stacks. Stacks are separate from splits. Native output/workspace
  layout instances and compositor input. GPL-3.0-only; October update. Local
  `cosmic-comp`. Sources: `src/shell/layout/tiling/mod.rs` (`Data::Group`,
  `add_window`, `remove_window`, `TargetZone`, `toggle_stacking`) and `grabs/`.
  User favourite and primary functional-spec input for join/leave UX; existing
  observed movement evidence stays in the [comparison](../reference-wm-comparison.md).
- **[Hyprland](https://github.com/hyprwm/Hyprland)**: C++ Wayland compositor
  with Dwindle BSP, Master, Scrolling and Monocle algorithms; separate tabbed
  groups. Native workspaces bound/moved across outputs, special workspaces;
  compositor-owned input, IPC/dispatchers and version-coupled plugins.
  BSD-3-Clause; October update. Local `Hyprland`. Sources:
  `src/layout/algorithm/tiled/`, `LICENSE`; [profile detail](reference-wm-profile-support.md#hyprland).
- **[i3](https://github.com/i3/i3)**: C/XCB X11 WM, automatically inserts into
  split/tabbed/stacked containers; tree/container. Native named/numbered
  workspaces assigned to outputs, text key/pointer config and IPC.
  BSD-3-Clause; September update. Local `i3`, clean and readable in this audit
  despite the earlier clone failure. Sources: `README.md`, `LICENSE`,
  `src/{tree,workspace,ipc}.c`.
- **[Sway](https://github.com/swaywm/sway)**: C/wlroots Wayland auto-tiler with
  i3-compatible containers/config/IPC, native workspaces across outputs and
  compositor keyboard/pointer handling. Tree/container; MIT. Remote default
  branch commit 2026-09-21. [Official introduction](https://swaywm.org/) and
  upstream README/docs only; no clone, source analysis deferred.
- **[bspwm](https://github.com/baskerville/bspwm)**: C/XCB X11 WM; windows are
  leaves of a full binary partition tree, automatic or preselected insertion.
  BSP, with monocle and empty receptacles. Native desktops per monitor;
  `bspc` socket control, external `sxhkd` keyboard bindings, native pointer
  actions. BSD-2-Clause; January maintenance fix. Local `bspwm`. Sources:
  `README.md`, `doc/bspwm.1.asciidoc`; [profile detail](reference-wm-profile-support.md#bspwm).
- **[qtile](https://github.com/qtile/qtile)**: **confirmed auto-tiler**, not
  merely a manual layout tool. Python X11/Wayland WM: Columns and MonadTall
  automatically admit/layout clients and call `client.place(...)`.
  Dynamic-layout/master-stack plus columns; Python input/config and command
  interface, native groups shown on screens. MIT; v0.37.1 September update.
  Local `qtile`. Sources: `README.rst`, `libqtile/layout/{columns,xmonad}.py`,
  especially `add_client`/`configure`.
- **[xmonad](https://github.com/xmonad/xmonad)**: Haskell X11 auto-tiler with
  layout functions, core Tall/master-stack and xmonad-contrib alternatives.
  Native workspaces with per-screen views/Xinerama; Haskell key/mouse config.
  BSD-3-Clause; September update. Local `xmonad`. Sources: `README.md`,
  `src/XMonad/{Layout,StackSet}.hs`, `LICENSE`.
- **[awesome](https://github.com/awesomeWM/awesome)**: C/XCB core, Lua-defined
  automatic dynamic layouts; master-stack and other layouts, keyboard/pointer
  config and D-Bus. Native **tags per screen**, clients can carry several tags;
  not exclusive numbered workspaces. GPL-2.0-or-later; remote master commit
  2026-08-28 despite old stable 4.3. [Official overview](https://awesomewm.org/)
  and upstream docs; licence election in [`awesome.c`](https://github.com/awesomeWM/awesome/blob/master/awesome.c).
  No clone; deeper source analysis deferred.
- **[dwm](https://dwm.suckless.org/)**: C/Xlib dynamic master-stack, monocle
  and float; compile-time `config.h` key/mouse bindings. Native tags and a view
  per Xinerama screen, not an emulated workspace layer. MIT/X Consortium;
  release 6.8 dated 2026-01-30. Official introduction/multi-monitor docs only;
  upstream git `https://git.suckless.org/dwm`, no clone, source analysis deferred.
- **[niri](https://github.com/niri-wm/niri)**: Rust scrollable-tiling Wayland
  compositor; columns on infinite strips, opening never resizes existing
  windows. Native dynamic vertical workspace stacks and independent strip per
  monitor; touchpad/mouse gestures, tabs, live-reloaded config. GPL-3.0 as
  reported by upstream metadata (only/later not established). Remote commit
  2026-10-01. **Public README/docs only; no local clone; source analysis deferred.**
  Source: [README](https://github.com/niri-wm/niri/blob/main/README.md).

### river - related integration boundary

- **[river](https://codeberg.org/river/river)** now separates the Zig/wlroots
  compositor from its WM. `river-window-management-v1` delegates geometry,
  workspaces, focus and bindings to the chosen external WM; algorithm and
  per-monitor workspace policy are WM-defined. Thus current river alone is
  **not an auto-tiler** and does not fit either tiler type above. Its stable
  management protocol is a relevant third-party integration surface. Code
  GPL-3.0-only, protocols MIT, docs CC-BY-SA-4.0; canonical commit 2026-09-23.
  The older dynamic tiler is `river-classic`, not this current architecture.
  Canonical README only; no clone, source analysis deferred.

## Most relevant to us

- **COSMIC**: N-ary split join/leave, directional restructuring and separate
  tabbed-stack UX for the functional spec, with the linked observed evidence.
- **GlazeWM + komorebi**: external Windows geometry/input, hiding and managed
  per-monitor workspaces; GlazeWM also exposes a macOS adapter contrast.
- **AeroSpace + yabai + Rift**: emulated/native Spaces and AX/private-helper/
  optional-injection contrasts for the approved macOS research direction.
- **Polonium + maintained Krohnkite**: host-authoritative KWin script/layout
  integration; **PaperWM + niri**: column/viewport semantics versus split trees.
- **Grid-Tiling-Kwin/Tiling Shell + MosaicWM**: region allocation versus
  preferred-size packing/overflow. Mosaic remains experimental.

## Historical/excluded

- [Bismuth](https://github.com/Bismuth-Forge/bismuth): archived historical KWin
  tiler; [Forge](https://github.com/forge-ext/forge): historical GNOME reference,
  README still says "Forge needs a NEW MAINTAINER" despite recent pushes.
- Original GitHub Krohnkite and archived GitHub anametologin fork are historical;
  use the maintained Codeberg project above.
- Rectangle/Loop are snapping tools; FlashSpace manages app workspaces, not
  window layouts. Hammerspoon alone is an automation host. See macOS survey.

## Local inventory and evidence status

All local paths below are relative to `C:\Users\beefs\Development`. Audit used
read-only `remote -v`, `status --short`, `log -1` and `submodule status`.
**Full/ok** means clean top-level checkout and readable bounded source, not a
build, runtime test or exhaustive analysis. **Partial** means missing checkout
content/dependencies; **deferred** means web-only/source analysis unavailable.
No clones, checkouts, repairs, lock deletion or external repo writes occurred
in this continuation.

Dates below are local **committer dates** (`git log --format=%cs`), not author
dates or repository-wide push times. Remote default-branch checks matched the
local SHA for GlazeWM, komorebi, PaperWM, Pop Shell, FancyWM, Whim,
komorebi-for-mac, Tiling Shell and cosmic-comp; newer push timestamps are not
evidence those checkouts are behind. Most other rows are local snapshots only.

| Local folder | HEAD | Commit date | Checkout / analysis status |
| --- | --- | --- | --- |
| `AeroSpace` | `74a1bf17` | 2026-10-01 | Full/ok; README + existing mechanism survey |
| `Amethyst` | `6508ee2` | 2026-08-19 | Full/ok; README + existing mechanism survey |
| `yabai` | `dd84572` | 2026-06-14 | Full/ok; README + existing mechanism survey |
| `glazewm` | `5709ad0a` | 2026-04-09 | Full/ok; Windows and macOS adapter reads |
| `komorebi` | `e0709f02` | 2026-08-22 | Full/ok; layouts/hiding/input |
| `bspwm` | `e11eff4` | 2026-01-08 | Full/ok; README/manpage + linked profile |
| `qtile` | `83c697a5` | 2026-09-20 | Full/ok; automatic-layout source |
| `PaperWM` | `8bf6dd2` | 2026-05-03 | Full/ok; README + linked pinned source research |
| `xmonad` | `a8055cd` | 2026-09-27 | Full/ok; README/layout/workspace model |
| `Hyprland` | `ae50c4d6` | 2026-10-03 | Full/ok; layouts; three submodules populated |
| `cosmic-comp` | `3d55cba0` | 2026-10-01 | Full/ok; N-ary shares/drop/stack source |
| `fancywm` | `947e955` | 2026-03-14 | Partial; `winman`, `winman-windows`, `ModernWpf` absent; core analysis deferred |
| `Seelen-UI` | `56c1d75d` | 2026-10-02 | Full/ok; README/templates/Win32 reads |
| `Whim` | `1e86b57` | 2025-12-14 | Full/ok; README/hiding/input; quiet alpha |
| `polonium` | `227967e` | 2026-09-08 | Full/ok; README/layouts |
| `Krohnkite` | `ade1de7` | 2026-09-28 | Full/ok; maintained Codeberg remote/layouts |
| `karousel` | `8b9f0b6` | 2026-08-23 | Full/ok; README limitations |
| `Grid-Tiling-Kwin` | `725c25b` | 2026-08-22 | Full/ok; README/grid |
| `tilingshell` | `de30eb7` | 2026-06-20 | Full/ok; opt-in auto-placement/metadata |
| `MosaicWM` | `c3c3171` | 2026-10-02 | Full/ok; README/packing files |
| `shell` | `7898b65` | 2026-03-31 | Full/ok; Pop Shell `master_noble` |
| `rift` | `41f1c05` | 2026-10-02 | Full/ok; workspace/hiding/input |
| `komorebi-for-mac` | `bdf1045` | 2026-05-04 | Full/ok; workspace/hiding/input/licence |
| `glide` | `2837add` | 2026-09-29 | Full/ok; architecture; exact hotkey API unknown |
| `paneru` | `b1b6abb` | 2026-10-02 | Full/ok; strip/parking/input |
| `PaperWM.spoon` | `82f5dde` | 2026-09-24 | Full/ok; README + linked mechanism survey |
| `hammerspoon` | `23e387e2` | 2026-07-08 | Full/ok; supporting host, linked mechanism survey |
| `i3` | `903bcd51` | 2026-09-21 | Full/ok; no partial checkout observed now |
| niri | none | - | Deferred source; public README/docs only |
| Sway, river, awesome, dwm | none | - | Deferred source; web summaries above, not cloned |

### Maintenance of this index

- Refresh by canonical upstream, selected branch and committer date; preserve
  unknowns/deferred source work. A clean checkout is not maintenance proof.
- GitHub metadata checks used `gh api repos/<owner>/<repo>` and
  `commits?per_page=1`; canonical URLs above and Codeberg pages supply provenance.
  Per-project source paths are relative to the inventory clone at its listed HEAD;
  local licence files were read. niri licence is metadata-level only.
- Deeper FancyWM core/submodule work and the web-only Linux source entries are
  deferred to a Linux/macOS source-review session. Other unknown input/hiding/
  workspace details remain labelled until a port needs their investigation.
