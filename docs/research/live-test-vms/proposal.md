# Live-test environments proposal: nested A plus lean VM B (research only)

- Date: 2026-10-07 (revised). Research proposal for user-operated environments.
- Scope: prepare environments for the [508-cell queue](../../changes/archive/reference-matrix-expansion.md#consolidated-sourceinventorynative-test-queue); environment availability alone does not resolve cells.
- Profiles: [matrix index](../../spec/reference-outcomes.md#wm-profiles-and-config-assumptions) and [area scenarios](../../spec/reference-outcomes/). Full action predicates and profile overrides remain authoritative there.
- Recommendation: default to nested sessions (A), use one lean NixOS VM (B) only where A is unsuitable. Both consume one shared per-WM configuration definition (sketch below, not implemented).
- Evidence labels: SOURCE = inspected source/docs; UNVERIFIED = unsupported at the exact profile/backend combination. No nested or VM runs were performed for this proposal. Backend capability is not runtime verification.

## Pinned source and config inventory

- Local checkouts below are under a local development directory; short SHAs match the matrix profiles. Resolve full commit IDs when authoring fetches; source pins and docs release baselines are distinct.

| Env | Local path | HEAD | Config anchor |
|---|---|---|---|
| COSMIC | `cosmic-comp` | `3d55cba0` | tiled mode, ordinary admission |
| Hyprland | `Hyprland` | `19fb395d` | Dwindle profiled defaults |
| bspwm | `bspwm` | `e11eff4` | longest_side / second_child / 0.5 |
| i3 | `i3` | `903bcd51` | shipped `etc/config` |
| xmonad | `xmonad` / `xmonad-contrib` | `284dd52c` / `5097a457` | Tall + Navigation2D/EWMH profile |
| sway | `sway` | `1652c54b` | shipped `config.in` |
| qtile | `qtile` | `83c697a5` (`v0.37.1`) | shipped `default_config.py` |
| awesome | `awesome` | `0a5e50cf` | shipped `awesomerc.lua` |
| niri | `niri` | `ed22699d` | shipped `default-config.kdl` |
| PaperWM | `PaperWM` | `8bf6dd2` | shipped GSettings schema |
| karousel | `karousel` | `8b9f0b6` | shipped `definition.ts` |
| paneru | `paneru` | `b1b6abb` | shipped defaults |
| Ours KDE/Windows | `omnitiler` | repo HEAD at run time | per-output-local / 2560x1440 125% |

## Evidence policy: exploratory baselines vs pin-equivalent evidence

- No blanket rule forces every run to build from a pinned rev. Each per-WM definition carries `sourceMode`: `prebuilt` (nixpkgs package at the flake lock) or `pinned-override` (package source replaced by the matrix commit, optional override fields below).
- `prebuilt` runs are exploratory baselines: useful for plumbing, fixture design and broad behavior orientation. Record their actual version/revision; mismatches must not close pinned-profile cells. A prebuilt package proven to match the pin/config needs no source override.
- `pinned-override` supplies the matrix revision when nixpkgs differs: full rev + `hash`, required submodules, recomputed language dependency hashes (`cargoHash`, vendor hashes; changing `src` alone may retain stale dependencies), compatible wlroots/Aquamarine/portal pins, recorded GNOME Shell / Plasma-KWin versions for PaperWM/karousel. Pin/config equivalence, not the source-mode label alone, determines whether a run can resolve cells.
- No silent substitution either way: each observation manifest records package source mode, full rev, config digest and runtime version. A version mismatch never becomes a passing cell by omission.
- Install shipped-default configs plus the matrix's declared variants, not distro rice. Record gaps, output mode/scale, toolkit versions and fixture-only rules; helper bindings must not change admission/focus policy.

## Route A: nested sessions (default)

- One WM at a time runs nested inside the host Plasma/KWin session: Wayland compositors as Wayland clients, X11 WMs under Xephyr. A shares host GPU, RAM and the host Nix store (no guest disk, no guest kernel).
- Launcher shape (all WMs): private `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` (plus `KDEHOME` for KWin-family), a unique child Wayland socket or `DISPLAY`, fixture clients pointed at the child. Never write into the host config or runtime directories.
- Runtime-directory isolation note: a private child `XDG_RUNTIME_DIR` cuts the child off from the host socket name, so the parent socket must be passed as an ABSOLUTE path wherever the backend accepts one. This is per-backend, not universal: KWin takes `--wayland-display <absolute-parent-socket>` (per [nested KWin isolation](../../live-kwin-testing.md#nested-kwin-isolation)); the same absolute-path pattern is documented for nested Hyprland launchers. For each other backend, validate at implementation whether an absolute socket path, an inherited `WAYLAND_DISPLAY`, or a bind-mounted proxy is accepted; do not assume one shape works everywhere. Socket-name collisions (child defaulting to `wayland-0`) are the failure mode to check first.
- Per-WM launch, output emulation and limits (all BACKEND, unverified here):

| Env | Nested launch | Emulated outputs | Limits / unsupported |
|---|---|---|---|
| sway | `WLR_BACKENDS=wayland WLR_WL_OUTPUTS=2 sway -c <matrix-config>` with parent `WAYLAND_DISPLAY` set. SOURCE: [wlroots env vars](https://github.com/swaywm/wlroots/blob/master/docs/env_vars.md); explicit backend avoids DRM selection. | `WLR_WL_OUTPUTS=2` requests two outputs; exact wlroots dependency at the sway pin UNVERIFIED. | Queued OUT-06 connector identity is not established in A; route to B with limits or leave TBD. |
| Hyprland | Run `Hyprland -c <matrix-config>` from the Wayland session; Aquamarine requests HEADLESS (mandatory), DRM (if-available), Wayland (fallback) in that order, so a Wayland session selects the nested Wayland backend with no nested flag (local `Hyprland/src/Compositor.cpp:314-326` at pin `19fb395d`: https://github.com/hyprwm/Hyprland/blob/19fb395d/src/Compositor.cpp#L314-L326). Private `XDG_RUNTIME_DIR`, host socket as absolute `WAYLAND_DISPLAY`. | No stable multi-output emulation established for nested Hyprland; OUT-03/05/06 prefer B. | Known upstream nested-render/input quirks (e.g. hyprwm/Hyprland#7411 history); record behavior, do not assume clean input separation. |
| niri | Run plain `niri --config <matrix-config>` with `WAYLAND_DISPLAY` (or `DISPLAY`) set; backend selection at local `niri/src/niri.rs:741-755` (pin `ed22699d`: https://github.com/YaLTeR/niri/blob/ed22699d/src/niri.rs#L741-L755) picks winit whenever a display env is present, else TTY. Do NOT use `--session` in A: it strips `DISPLAY`/`WAYLAND_DISPLAY`/`WAYLAND_SOCKET` (unless WSL) so the TTY backend is selected instead (local `niri/src/main.rs:73-91`: https://github.com/YaLTeR/niri/blob/ed22699d/src/main.rs#L73-L91). Nested-window runs are niri's documented dev loop (https://niri-wm.github.io/niri/Development%3A-Developing-niri.html). | winit backend presents one window/output; multi-output emulation in nested mode UNVERIFIED. | Shipped default: `Mod` = Super on TTY but Alt as a winit window (local `resources/default-config.kdl:355-356`). Use the Alt fallback in A or set an explicit modifier; record which. X11 fixtures need the satellite route (per archive). |
| COSMIC | `cosmic-comp` backend auto-select (local `cosmic-comp/src/backend/mod.rs:20-46` at pin `3d55cba0`: https://github.com/pop-os/cosmic-comp/blob/3d55cba0/src/backend/mod.rs#L20-L46): `COSMIC_BACKEND=x11` selects the X11 backend, `COSMIC_BACKEND=winit` the winit backend, `COSMIC_BACKEND=kms` KMS; unset with `DISPLAY` or `WAYLAND_DISPLAY` present tries X11 first, falls back to winit; neither present means KMS. "NO Wayland backend" means only that smithay has no Wayland-backend module yet (`mod wayland; // tbd in smithay`); nested still works as a Wayland CLIENT via the X11 backend (XWayland window) or the winit backend (winit Wayland window). Run nested with `WAYLAND_DISPLAY` set (X11 backend via XWayland, or force `COSMIC_BACKEND=winit`). | winit backend has no notion of multiple windows (local `src/backend/winit.rs:42-43`); multi-output emulation in nested COSMIC UNVERIFIED. | Full `cosmic-session` (panel, applets) out of scope for A; run `cosmic-comp` only with fixture clients. Smithay X11-backend resolution/scale behavior at the pin is UNVERIFIED. |
| KWin/karousel | `kwin_wayland --wayland-display <absolute-parent-socket> --socket <unique-child-socket> --output-count 2 --no-lockscreen --no-kactivities` inside `dbus-run-session` with private XDG dirs, per [nested KWin isolation](../../live-kwin-testing.md#nested-kwin-isolation) and the feasibility spike (`docs/research/integrated-plasma-structural-feasibility/nested-kwin-feasibility.md`: `--wayland-display`/`--socket`/`--output-count` at `src/main_wayland.cpp`, KWin v6.2.2 source https://github.com/KDE/kwin/blob/v6.2.2/src/main_wayland.cpp). Load karousel into the nested session for karousel rows. | `--output-count 2` (source-established) gives two static nested outputs; `--virtual` variant gives two equal-geometry virtual outputs without a parent connection. | External hotplug control NOT established (spike verdict: static two-output geometry only). OUT rows needing disconnect/reconnect identity route to B. NOTE: `--no-global-shortcuts` is deliberately OMITTED here; it disables child shortcut support and would break karousel's essential bindings. Super handling is a host-side rule (next section), not a child flag. |
| GNOME Shell/PaperWM | GNOME 49+: `dbus-run-session -- gnome-shell --wayland --devkit`; GNOME <=48: `--nested --wayland`. SOURCE: [extension handbook](https://gjs.guide/extensions/development/debugging.html), [Mutter running guide](https://github.com/GNOME/mutter/blob/main/doc/building-and-running.md). Current devkit requires `mutter-devkit`; inherited host display is the parent, printed Wayland socket is the child (`--wayland-display` names the child). | Current devkit: `--devkit-args="--monitor-size 1920x1080 --add-monitor --monitor-size 1440x900"` ([source](https://github.com/GNOME/mutter/commit/1484e1ea8d49f5c0b559de257daf60fe321c3225)). Older nested backend uses `MUTTER_DEBUG_NUM_DUMMY_MONITORS`; that mechanism was removed with the backend ([Shell change](https://github.com/GNOME/gnome-shell/commit/c306e2b5f2bb48776aadbb1ab939f2b34dbb1842)). | Shell/extension pairing and devkit package/version are load-bearing, runtime UNVERIFIED. START-01..03 extension-enable fixtures can use A; real session-restore needs B/native. No Shell version is pinned by the matrix yet. |
| i3 | `Xephyr -resizeable -no-host-grab -screen 1920x1080 :1`, then `DISPLAY=:1 i3 -c <matrix-config>` (proposed, runtime UNVERIFIED). SOURCE: Xephyr/Xserver man pages (`-screen`, `-resizeable`, `-no-host-grab`, `+xinerama`). For two heads, try a second `-screen` plus `+xinerama`. Without Xinerama, multiple X screens (`:1.0`, `:1.1`) do not automatically become one WM's monitors; Xinerama aggregation and RandR enumeration must be checked per WM. | Static multi-head is UNVERIFIED/TBD until the WM reports both heads in one managed topology; no claim of connector equivalence. | OUT-06 identity/hotplug is not established in A. |
| bspwm | Same Xephyr shape as i3 with `bspwm -c <matrix-config>` plus `sxhkd` for the declared bindings (same X-screen caveat; runtime UNVERIFIED). | Same as i3 row. | OUT-06 UNSUPPORTED in A. |
| xmonad | Same Xephyr shape with the Tall+Navigation2D/EWMH profile (same X-screen caveat; runtime UNVERIFIED). | Same as i3 row. | OUT-04 (explicit send) may be observable on static dual screens IF the WM enumerates both; OUT-06 needs B or TBD. No stable IPC: geometry-only observation stands in every route. |
| qtile | Same Xephyr shape with shipped `default_config.py`, X11 ONLY (same X-screen caveat; runtime UNVERIFIED). No Wayland/qtile-Wayland route is in scope. | Same as i3 row. | OUT-06 UNSUPPORTED in A. Introspection gaps are route-independent. |
| awesome | Same Xephyr shape with `awesomerc.lua`, `suit.tile` selected per profile (same X-screen caveat; runtime UNVERIFIED). | Same as i3 row. | OUT-06 UNSUPPORTED in A. Introspection gaps are route-independent. |
| Ours KDE (adapter) | Same nested-KWin launcher as the karousel row, plus project adapter/script under test. | Same as KWin row. | Layout/focus/geometry cells are valid nested evidence; shortcut/daemon/session cells are not. |

- Multi-output policy: static geometry is an A candidate for sway, KWin, GNOME devkit (old Shell: dummy monitors), and Xephyr/Xinerama, subject to profile/backend verification. OUT-06 connector identity/return affinity needs B-with-limits, native or TBD; B hotplug itself remains qualified by viewer/QMP/driver support. Other rows need B when a backend cannot emulate their topology. Static multi-output alone does not require B.

## Super / host-shortcut handling (sourced mechanism, runtime UNTESTED)

- Host-side mechanism: match the nested window (class/title) with a KWin window rule, "Ignore global shortcuts" = Force/Yes. SOURCE: [rules.cpp v6.7.3](https://github.com/KDE/kwin/blob/v6.7.3/src/rules.cpp) defines `disableglobalshortcuts`; [activation.cpp](https://github.com/KDE/kwin/blob/v6.7.3/src/activation.cpp) evaluates it on activation; [workspace.cpp](https://github.com/KDE/kwin/blob/v6.7.3/src/workspace.cpp) `disableGlobalShortcutsForClient` sets the window flag and calls KGlobalAccel `blockGlobalShortcuts`. [KDE docs](https://docs.kde.org/stable_kf6/en/kwin/kcontrol/windowspecific/attributes.html) specify active-window scope. Rule matching and key delivery to these nested windows are runtime UNVERIFIED. Meta-only handling is delegated to KGlobalAccel ([globalshortcuts.cpp](https://github.com/KDE/kwin/blob/v6.7.3/src/globalshortcuts.cpp)); suppression of the launcher on Meta tap remains UNVERIFIED, not promised by the rule's existence.
- Why host-side, not child-side: child `--no-global-shortcuts` does NOT stop the host from grabbing Super; it only disables the CHILD's shortcut support, which breaks karousel's essential bindings and removes shortcut behavior under test. Child disabling is an isolation option with consequences (useful for input-path purity), never the Super solution.
- Verified-vs-untested split: rule existence, Force semantics and active-window scope are VERIFIED from source+docs above. UNTESTED at runtime: matching a nested compositor/Xephyr window by class/title, Meta-tap launcher behavior (modifier-tap may bypass global-shortcut suppression - check at implementation), Xephyr passive key grabs (Xephyr grabs keys it needs; test whether Super reaches the X11 WM), and Alt-Tab/pointer-drag delivery. Fallback is an explicit modifier remap in the nested config (niri ships the Alt fallback); record which binding set produced each observation. IPC-driven setup avoids grab conflicts but does not test the literal input path.

## Route B: one lean NixOS VM (as needed)

- Build route: `nixos-rebuild build-vm --flake ...#<wm>` (one `nixosConfigurations.<wm>` per WM sharing a base module). Default `build-vm` shares the host Nix store read-only over 9p, which makes rebuilds cheap (BACKEND: `nixos/modules/virtualisation/qemu-vm.nix` header + `virtualisation.mountHostNixStore` default true, `virtualisation.memorySize` default 1024 MiB; https://github.com/NixOS/nixpkgs/blob/master/nixos/modules/virtualisation/qemu-vm.nix).
- Cost split BW: (a) the shared host store (guest base OS closure + WM closures, see budget section), versus (b) per-guest disk writes. The guest root is a sparse qcow2 created on first boot (`virtualisation.diskImage`, default `./<name>.qcow2`; verified at the lock rev in `qemu-vm.nix`: image created on startup if missing). Sparse means the host file tracks WRITTEN blocks, not virtual size. Clarification: the guest ext4 still sees the full virtual size; sparseness does not auto-expand anything, it only avoids preallocating unwritten space. With default `writableStoreUseTmpfs=true` the store overlay lives in guest RAM, not on disk; persistent disk writes are guest state, logs and fixtures only. Disk sizing: propose `virtualisation.diskSize` 4096-8192 MiB (4-8 GiB virtual; 8-16 GiB only if a large desktop closure demands it) as a SPARSE growable ceiling. The image grows with writes up to that ceiling; it does NOT auto-resize beyond it (manual `qemu-img resize` / config change required). Fresh fixture-run writes are reasoned at roughly 0.2-1 GiB actual, UNVERIFIED.
- Memory: set `virtualisation.memorySize` / `cores` per class (see estimates). Host-pressure relief via virtio-balloon with free-page-reporting: proposed `virtualisation.qemu.options = [ "-device virtio-balloon-pci,free-page-reporting=on" ]` (qemu-vm passes `qemu.options` straight to the QEMU command line; the device property is QEMU-documented, default on since QEMU 5.x: QEMU patch `DEFINE_PROP_BIT("free-page-reporting", ...)` https://lists-archive.oasis-open.org/archive/lists/virtio-dev/months/202004/messages/83, guest mechanism https://docs.kernel.org/mm/free_page_reporting.html). CORRECTION: free-page-reporting reclaims via guest-initiated madvise WITHOUT QMP; QMP (or a manager) is only needed to automate balloon TARGET inflate/deflate. No balloon run was performed here. Do not promise overcommit; size B for one guest at a time with host headroom.
- Graphics for B: start with virtio-gpu/virgl + Mesa in guest, GL-capable viewer, host render-device access. Virgl is OpenGL, not Vulkan; Venus/rutabaga only if a pinned compositor proves Vulkan-mandatory. Software fallback is a separately recorded backend, never timing-equivalent. Hyprland/niri/COSMIC/KWin/GNOME need this qualification; X11 guests need only a 2D virtual display.
- B display/outputs: QEMU virtio-gpu `max_outputs=2` is head capacity, not two connected outputs. Fix two heads with declared arrangement/scale, validate guest enumeration + viewer tabs/SPICE before trusting OUT geometry; OUT-06 hotplug needs viewer/QMP/driver support and stays qualified per run.

## Shared per-WM configuration (sketch only, not implemented)

- One Nix attribute per WM feeds both routes. Sketch of the shape only; names may change at implementation:

```nix
# sketch: per-WM test-environment definition (not implemented)
referenceEnvs.<wm> = {
  basePackage = pkgs.<wm>;          # prebuilt nixpkgs package at the flake lock
  sourceMode = "prebuilt";          # or "pinned-override" (per-run flip)
  pinnedOverride = {                # used only when sourceMode = "pinned-override"
    rev = "<matrix-pin>";
    hash = "<recomputed>";
  };
  matrixConfig = ./configs/<wm>;    # shipped default + declared variant (shared by A and B)
  fixtureClients = [ "xterm" "foot" <toolkit-fixture> ];
  observers = [ "wm-query-helper" ];  # per-env IPC adapter from the table below
};
# A: nix run .#nested-<wm>  -> sets private XDG/socket dirs, launches the
#    nested command from the per-WM table with matrixConfig, points fixtures
#    at the child socket.
# B: modules.<wm> consumes the same selected package, matrixConfig,
#    fixtureClients and observers; shared base supplies session/VM settings.
#    nixosConfigurations.<wm> imports [ sharedBase modules.<wm> ];
#    packages.<system>.vm-<wm> = nixosConfigurations.<wm>.config.system.build.vm;
#    nix build .#vm-<wm> (or nixos-rebuild build-vm --flake .#<wm>).
```

- Observer adapters stay those already proposed: i3/sway `i3-msg`/`swaymsg`; bspwm `bspc`; Hyprland `hyprctl -j`; niri `niri msg --json`; qtile/awesome read-only introspection; xmonad `xprop`/`xwininfo`/`wmctrl -lG` geometry-only; COSMIC fixture logs + screenshots; GNOME/KWin guest-side read-only scripting + screenshots; project traces for Ours.
- Fixture pack (both routes): `xterm -geometry` / `foot --window-size-chars` labeled A/B/C (character cells, not pixel guarantees), one small GTK/Qt fixture (ordinary/fixed/minimum, transient/dialog, urgency, fullscreen/max/min requests), X11 drivers `wmctrl`/`xdotool`, Wayland native IPC only. `no-counterpart` follows pinned inventory review; missing harness verbs never prove native absence.

## Prebuilt vs pinned-source cost

- Prebuilt (nixpkgs at lock `54ba4bcec4043e72a4006d825e0d7aff5562008f`): binary cache hits are likely. All profiles use one host store; existing-host package reuse requires identical store paths, not merely matching version strings. Host Plasma does not establish same-rev Qt/KF6 reuse. Record mismatches per observation; exploratory runs cannot silently close pinned cells.
- Pinned-source override (matrix commit): use when prebuilt differs. Cost is the WM rebuild plus dependency drift (compatible wlroots/Aquamarine/portal pins, `cargoHash`/vendor recompute, possible rebuild cascades). Cache reuse for dependencies is likely only when their derivations remain unchanged; record per-WM growth.
- Policy: prove A/B plumbing with prebuilt packages, then flip `sourceMode` per WM before recording matrix cells. The manifest always states which mode produced the observation.

## Host needs and budget (reasoned ranges, not measurements)

- Method: no closure measurements were obtained; cached metadata was not available without evaluation/fetch work. These are reasoned planning ranges, not measured sizes. Replace them with closure metadata and `qemu-img info` during implementation. The previous 80-120 GiB reserve is replaced by slice-sized budgeting.
- A has no guest-image cost; it still needs WM, fixture and observer package closures in the shared host store.
- Test system first slice, incremental NEW store (sharing with the host only reduces these WHERE locked package versions match; host Plasma Qt/KF6 reuse is conditional, not proven):
  - i3+bspwm+sxhkd, Xephyr, xterm and observation tools: roughly 0.8-1.5 GiB new. sway+foot/wlroots adds roughly 0.7-1.5 GiB, giving the recommended i3+sway+bspwm slice roughly 1.5-3 GiB total, subject to Mesa/toolkit reuse.
  - xmonad is a later profile, not in that first slice; including its GHC/config compilation toolchain could bring the X11 set alone to roughly 1.5-3 GiB.
  - niri after that: roughly 0.5-1 GiB new (Rust runtime closure is small; most cost is its dependency tree deltas).
  - KWin/karousel after that: roughly 0.5-1.5 GiB new IF the host Plasma store already holds the SAME-REV Qt6/KF6 (expected on this host, UNVERIFIED); a version mismatch or non-Plasma host pays the full Qt/KF6 closure instead (several GiB).
  - GNOME Shell/PaperWM: heaviest single addition, roughly 2-4 GiB new (mutter, gnome-shell, gjs, gnome-settings-daemon chain), only when scheduled.
- Nested A RAM (reasoned, NOT measured; separate from VM RAM below): X11 WMs roughly 0.2-0.6 GiB extra per nested session; light Wayland compositors (sway, niri, Hyprland, COSMIC-comp-only) roughly 0.3-1 GiB; full desktops (GNOME Shell, KWin/Plasma session) roughly 1-2 GiB. These share host RAM with the host Plasma session; keep host headroom.
- Full-collection vs sequential: holding every WM closure live at once sums the above (order of 6-15 GiB new store, UNCERTAIN, plus prebuilt-vs-pinned duplication when both modes are retained). Sequential profiling keeps live store near the largest single profile plus host; live-store reduction between profiles is a budgeting note only (retained GC roots may hold paths; no global `nix-collect-garbage` run is proposed as an implementation step here). Pinned-source overrides DUPLICATE prebuilt closures wherever the source differs; drop the mode not under test.
- Prebuilt runtime closures vs build-time peaks: runtime closures are the figures above. Build-time peaks add transient inputs AND retained sources/targets: Rust WMs (niri, cosmic-comp) need rustc/cargo plus vendored crates and target dirs (order of 2-5 GiB transient at minimum, but large workspaces with vendored sources + incremental targets can be MUCH bigger during the build); KWin/mutter C++ builds need compilers plus Qt/KF6 or GNOME dev outputs (order of 2-4 GiB transient at minimum, larger with debug/test outputs); a pinned wlroots rebuild cascades into every wlroots consumer. Peaks are temporary (GC-able subject to roots) but must fit on disk DURING the build; keep 10+ GiB free headroom while building pinned sources.
- B on top: guest base OS closure plus QEMU (minimal X11-capable NixOS closure + qemu, roughly 1-3 GiB new where not already in the host store at the same rev) is SEPARATE from WM closures; per-guest qcow2 actual writes are guest state/logs only (roughly 0.2-1 GiB actual for fixture runs, reasoned, not a claim). B RAM: X11 2 cores/2 GiB; Wayland 3-4 cores/4 GiB; GNOME/KDE 4 cores/4-8 GiB. Keep ~4 GiB host RAM headroom; one guest at a time unless the user explicitly parallelizes.
- `devenv.nix`: no additions. The pinned `build-vm` wrapper supplies QEMU/`qemu-img`; fixture/IPC packages belong in guest modules. Add host viewer/direct-QEMU tools there only if the chosen workflow requires them, then restart the session before use.

## Queue routing to A/B

- Counts: Linux guests 389, macOS track 82, Windows track 37 (507 potentially runnable; Windows FLT-11 awaits implementation). Exact IDs in the archive; families below.
- Correction to the previous revision: the first-slice trio (i3 13 + sway 18 + bspwm 19 = 50) contains one OUT-06 cell EACH (i3 OUT-06, sway OUT-06, bspwm OUT-06 per the archive queue), which A cannot prove. At most 47 of the 50 are nested candidates before any other constraint applies.

| Env | N | Route | Rationale / limits |
|---|---|---|---|
| COSMIC | 29 | A default | Nested `cosmic-comp` covers ACT/CLOSE/FLT/GRP/INS/MAX/MNZ/MOU/MOV/OUT/RST/RSZ/SPC/WS geometry and focus cells; OUT-03/06 to B or TBD. Gesture/input-threshold legs (MOU/DRAG where queued) may need real hardware: neither A nor B. |
| Hyprland | 37 | A default, B for outputs | Nested covers CLOSE/FLT/FOC/INS/LAY/MAX/MNZ/MOU/MOV/RST/RSZ/SPC/WS; OUT-03/05/06 need B display qualification. |
| bspwm | 19 | A (Xephyr) | X11 nested is the cheapest path; OUT-06 to B or TBD (1 of the 19). |
| i3 | 13 | A (Xephyr) | GRP/INS/MOV/RST/RSZ/SPC/WS Xephyr-runnable; OUT-06 to B or TBD (1 of the 13). |
| xmonad | 22 | A (Xephyr) | Geometry-only observation stands; OUT-04 may use A if dual-screen enumeration works, otherwise B/TBD. OUT-06 needs B/TBD. |
| sway | 18 | A default | `WLR_WL_OUTPUTS=2` keeps static dual-output preparation in A; OUT-06 identity itself to B or TBD (1 of the 18). No OUT-03 in the sway queue. |
| qtile | 21 | A (Xephyr, X11 only) | X11 profile only; no Wayland route in scope. Introspection gaps are route-independent. OUT-06 to B or TBD. |
| awesome | 19 | A (Xephyr) | FOC/MOU/OUT rows use `global_bydirection` equivalents. OUT-06 to B or TBD. |
| niri | 41 | A default | Nested winit covers DRAG/FLT/FOC/GRP/INS/MAX/MIN/MOU/RST/RSZ/SPC/WS and COL mechanics; OUT-05/06 qualified (single nested output). Niri COL/WS families route A except where a second output is load-bearing. |
| PaperWM/GNOME | 73 | A default, B only for true session rows | Nested Shell covers ACT/CLOSE/COL/DRAG/FLT/FOC/GRP/INS/MAX/MIN/MNZ/MOU/MOV/RST/RSZ/SPC/WS; START-01..03 are extension-enable journeys (nested-valid). R-RST-02 session-restore and R-CTL session/persistence legs need B or native where the nested session cannot provide the real session manager. Exact Shell/extension pair load-bearing. |
| karousel/KWin | 58 | A default, B only for true session rows | Static `--output-count 2` gives two nested outputs, but karousel's pinned profile is SINGLE-screen (`S(S-kar-single)`); dual-output nested runs are NOT automatically comparable to the profile. OUT geometry rows are profile-gated; OUT hotplug identity to B-with-limits or TBD. START-01..03 are script-enable journeys (nested-valid); true session-restore legs need B or native. |
| Ours KDE | 39 | A default (nested KWin + adapter) | Same enable-vs-session split as karousel; shortcut/daemon/session cells excluded from nested. |
| paneru/macOS | 82 | Neither A nor B | Mac hardware required; Apple SLA 2B(iii) path on a licensed Mac host. |
| Ours Windows | 37 | Neither | Declared validation stays on the native host. |

- Session-test rule: nested compositor restart is NOT session restart and reload is neither. R-RST-02 / R-CTL legs naming session-manager restore, cross-session persistence, or owner-specific staging route to B at best, and to native hardware where B cannot provide the real manager. R-RST-01 (orderly owner restart with apps kept alive) and compositor-reload legs CAN be nested where the predicate is in-process restart/re-adoption; check exact predicates per cell, do not force into B. Gesture/input-timing legs that depend on physical devices are flagged neither-A-nor-B, not forced into B.

## Slice decision and effort

- Test system-first slice: i3 (13) + sway (18) + bspwm (19) = 50 queued, at most 47 nested candidates (3x OUT-06 excluded), subject to exact fixtures. Shared observer family, roughly 1.5-3 GiB runtime-store growth, no guest images.
- Next: niri in A with its shipped Alt fallback, then karousel/KWin in A under its single-screen profile. Build B when hotplug, unsupported topology, real session restore or graphics qualification is scheduled.
- Scrolling-first alternative: i3 + sway + niri = 72 cells; pays nested-winit single-output limits early for column-model value.
- Minimal-slice effort: roughly 8-14 authoring days (shared per-WM definition + nested launchers for 3 WMs + fixture pack + snapshot harness + pinned-source overrides); source/dependency incompatibilities could extend this. User live-test time is separate.

## Decisions needed

| Decision | Recommendation |
|---|---|
| Default route | Nested A; B only where the per-WM table marks a limit |
| Config layout | One shared per-WM definition (`sourceMode` + shared `matrixConfig`) consumed by `nix run .#nested-<wm>` and `.#vm-<wm>` (sketch above) |
| Evidence modes | Prebuilt for plumbing/exploration; `pinned-override` before closing cells; manifests always state the mode |
| First slice | i3+sway+bspwm, 50 queued (47 max nested); niri replaces bspwm only if scrolling is the priority |
| Host budget | First slice ~1.5-3 GiB new store (+ nested RAM 0.2-1 GiB class-dependent); full collection ~6-15 GiB uncertain + QEMU/base 1-3 GiB + sparse disk ceiling 4-8 GiB virtual (~0.2-1 GiB actual); keep 10+ GiB free while building pinned sources; ~4 GiB RAM headroom |
| Host dependencies | No `devenv.nix` additions; restart session after any later host-dependency change |
| Operating/test responsibility | User boots/runs environments and records outcomes; Mac/Windows tracks stay on native hosts |

- Exact next action: user selects the slice and confirms RAM/disk budget; a separately authorized implementation change authors the shared per-WM definition, nested launchers, exact-pin packages, fixture clients and snapshot helper. Builds/boots and test execution require that later scope.

## Primary sources

- [NixOS qemu-vm module at current lock](https://github.com/NixOS/nixpkgs/blob/54ba4bcec4043e72a4006d825e0d7aff5562008f/nixos/modules/virtualisation/qemu-vm.nix) (shared store default, `memorySize`/`diskImage`/`writableStore`/`qemu.options` passthrough)
- [NixOS VMs on nix.dev](https://nix.dev/tutorials/nixos/nixos-configuration-on-vm.html)
- [Nested KWin isolation](../../live-kwin-testing.md#nested-kwin-isolation) and `docs/research/integrated-plasma-structural-feasibility/nested-kwin-feasibility.md` (KWin flags, isolation shape, static-outputs-only verdict)
- [KWin main_wayland.cpp at v6.2.2](https://github.com/KDE/kwin/blob/v6.2.2/src/main_wayland.cpp) (`--output-count`, `--no-global-shortcuts`, `--socket`, `--wayland-display`)
- [KWin rules at v6.7.3](https://github.com/KDE/kwin/blob/v6.7.3/src/rules.cpp), [activation](https://github.com/KDE/kwin/blob/v6.7.3/src/activation.cpp), [workspace blocking](https://github.com/KDE/kwin/blob/v6.7.3/src/workspace.cpp), [KDE rule docs](https://docs.kde.org/stable_kf6/en/kwin/kcontrol/windowspecific/attributes.html).
- [GNOME extension handbook](https://gjs.guide/extensions/development/debugging.html) and [Mutter running guide](https://github.com/GNOME/mutter/blob/main/doc/building-and-running.md) (>=49 devkit, <=48 nested); [devkit monitor CLI](https://github.com/GNOME/mutter/commit/1484e1ea8d49f5c0b559de257daf60fe321c3225), [Shell removes dummy env vars](https://github.com/GNOME/gnome-shell/commit/c306e2b5f2bb48776aadbb1ab939f2b34dbb1842).
- [niri backend selection at pin](https://github.com/YaLTeR/niri/blob/ed22699d/src/niri.rs#L741-L755) and [`--session` env stripping](https://github.com/YaLTeR/niri/blob/ed22699d/src/main.rs#L73-L91); [niri default Mod fallback](https://github.com/YaLTeR/niri/blob/ed22699d/resources/default-config.kdl) (`Mod`=Super TTY, Alt winit); [niri Developing niri](https://niri-wm.github.io/niri/Development%3A-Developing-niri.html) (nested window as main dev loop) and [niri IPC docs](https://niri-wm.github.io/niri/IPC.html)
- [cosmic-comp backend auto-select at pin](https://github.com/pop-os/cosmic-comp/blob/3d55cba0/src/backend/mod.rs#L20-L46) (x11/winit/kms; Wayland module `tbd in smithay`) and [winit single-output note](https://github.com/pop-os/cosmic-comp/blob/3d55cba0/src/backend/winit.rs#L42-L43)
- [Hyprland backend setup at pin](https://github.com/hyprwm/Hyprland/blob/19fb395d/src/Compositor.cpp#L314-L326) (HEADLESS mandatory, DRM if-available, Wayland fallback)
- [wlroots env vars](https://github.com/swaywm/wlroots/blob/master/docs/env_vars.md) (`WLR_BACKENDS`, `WLR_WL_OUTPUTS`; exact dependency pin unverified).
- [QEMU virtio-balloon free-page-reporting patch](https://lists-archive.oasis-open.org/archive/lists/virtio-dev/months/202004/messages/83) (`DEFINE_PROP_BIT("free-page-reporting", ...)`), [kernel free-page-reporting docs](https://docs.kernel.org/mm/free_page_reporting.html) (guest madvise path, no QMP for reporting); hinting vs reporting distinction per the virtio spec thread
- [i3 IPC docs](https://i3wm.org/docs/ipc.html) (sway shares the family)
- [UTM macOS guests](https://docs.getutm.app/guest-support/macos/) and [Apple SLA index](https://www.apple.com/legal/sla/)
- Line numbers from dated checkouts; re-verify at implementation.

## Remaining uncertainties

- Exact per-WM module/option/package names at the frozen nixpkgs rev; pinned-rev source builds (cargoHash, wlroots/Aquamarine, Shell/KWin pairs).
- Nested multi-output behavior per compositor at the pins; Xephyr/Xinerama and GNOME devkit/Shell version pairing need runtime checks.
- Host rule matching/Meta-tap/Xephyr-grab behavior at runtime; Alt/modifier fallback per WM.
- Balloon `qemu.options` integration and actual free-page reclamation; optional QMP target automation.
- Host KVM/GL outcome for B graphics qualification.
- All disk/RAM figures are reasoned ranges; replace with `nix path-info` / `qemu-img info` values at implementation.
