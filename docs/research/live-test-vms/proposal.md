# Live-test VM proposal (research only)

- Date: 2026-10-07. Research proposal for user-operated guests.
- Scope: prepare environments for the [508-cell queue](../../changes/archive/reference-matrix-expansion.md#consolidated-sourceinventorynative-test-queue); VM availability alone does not resolve cells.
- Profiles: [matrix index](../../spec/reference-outcomes.md#wm-profiles-and-config-assumptions) and [area scenarios](../../spec/reference-outcomes/). Full action predicates and profile overrides remain authoritative there.

## Pinned source and config inventory

- Local checkouts below are under `/home/beefsack/Development/`; short SHAs match the matrix profiles. Resolve full commit IDs when authoring fetches; source pins and docs release baselines are distinct.

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
| Ours KDE/Windows | `plasma-auto-tiler` | repo HEAD at run time | per-output-local / 2560x1440 125% |

## Source-of-truth rule

- Guests must build each WM from its pinned rev: `fetchFromGitHub`/`fetchgit` with pinned `rev` + `hash`, required submodules, an overlay/override of the package's source, and version/patch review. Recompute language dependency hashes where needed (`cargoHash`, vendor hashes); changing `src` alone may retain stale dependencies. Pin compatible wlroots/Aquamarine/portal libraries and record GNOME Shell / Plasma-KWin versions for PaperWM/karousel; those host versions are not yet fixed by the matrix.
- Install shipped-default configs plus the matrix's declared variants, not distro rice. Record gaps, output mode/scale, toolkit versions and fixture-only rules; helper bindings must not change admission/focus policy.
- Each observation manifest records full rev, config digest, and runtime version. A nixpkgs-version guest is a non-equivalent baseline only; it cannot resolve pinned-profile cells without an explicit repin. No silent rev substitution.

## Queue by environment (counts + families; exact IDs in the archive)

Linux guests 389, macOS track 82, Windows track 37 (507 potentially runnable; Windows FLT-11 awaits implementation).

| Env | N | Queued group families | Guest limitation |
|---|---|---|---|
| COSMIC | 29 | ACT CLOSE FLT GRP INS MAX MNZ MOU MOV OUT RST RSZ SPC WS | Wayland backend qualification needed |
| Hyprland | 37 | CLOSE FLT FOC INS LAY MAX MNZ MOU MOV OUT RST RSZ SPC WS | Wayland backend qualification needed |
| bspwm | 19 | CLOSE FLT FOC INS MOU OUT RST RSZ SPC WS | X11; hotplug/input qualification |
| i3 | 13 | GRP INS MOV OUT RST RSZ SPC WS | X11; hotplug/input qualification |
| xmonad | 22 | ACT CLOSE FLT FOC INS MAX MNZ MOU MOV OUT RST RSZ SPC | no stable IPC; geometry-only |
| sway | 18 | CLOSE GRP INS MNZ MOU MOV OUT RST RSZ SPC WS | Wayland backend qualification needed |
| qtile | 21 | ACT COL FOC INS MAX MNZ MOU MOV OUT RST SPC WS | introspection gaps |
| awesome | 19 | ACT FOC INS MNZ MOU OUT RST RSZ SPC WS | introspection gaps |
| niri | 41 | CLOSE COL DRAG FLT FOC GRP INS MAX MIN MOU OUT RST RSZ SPC WS | Wayland backend + scrolling model |
| PaperWM/GNOME | 73 | ACT CLOSE COL DRAG FLT FOC GRP INS MAX MIN MNZ MOU MOV OUT RST RSZ SPC START WS | GNOME Shell guest; exact Shell/extension pair + display qualification |
| karousel/KWin | 58 | ACT CLOSE COL DRAG FLT FOC GRP INS MAX MIN MNZ MOU RST RSZ SPC START WS | Plasma/KWin guest; single-screen profile |
| Ours KDE | 39 | ACT CLOSE DRAG FLT INS MAX MNZ MOU OUT RST SPC WS | KWin/Plasma guest; production adapter + Engine |
| paneru/macOS | 82 | ACT CLOSE COL DRAG FLT FOC GRP INS MAX MIN MNZ MOU MOV OUT RST RSZ SPC WS | Mac hardware required |
| Ours Windows | 37 | ACT CLOSE DRAG FLT INS MAX MNZ MOU OUT RST SPC WS | declared validation on native host |

## Route recommendation

- Default: one flake, `nixosConfigurations.<wm>` + `config.system.build.vm` (`nixos-rebuild build-vm --flake ...#<wm>` route). Shared base: login, fixture pack, observer/export path, resettable guest disk; per-WM session and config. The module shares the host Nix store read-only and supplies the QEMU runner, reducing image duplication.
- Separate flakes isolate incompatible package universes but duplicate fixtures/locks. Prefer per-guest nixpkgs inputs within the shared flake if incompatible pins require them; document the divergence instead of silently replacing a WM rev.
- `nixos-generators`: useful for standalone/exportable images and multiple formats; VM variants defer to `build-vm`. Extra format machinery is unnecessary for this host-local first slice.
- `microvm.nix`: lightweight guests and multiple hypervisors; graphics/passthrough require a suitable backend and configuration. More desktop-device work than the standard QEMU VM module for this slice.
- Plain QEMU flake outputs: maximum GPU/viewer/QMP control, but own disk/boot/store-sharing lifecycle. Keep as an escape hatch, with higher maintenance cost.

## Backend constraints (qualified, compatibility unverified)

- KVM: host CPU virtualization enabled and invoking user has read/write `/dev/kvm` access. TCG is possible without KVM but unsuitable for reliable timing/animation comparisons.
- X11 (i3/bspwm/xmonad/qtile-X11/awesome): 2D virtual display normally suffices; no compositor 3D requirement for the WM itself.
- Wayland: sway can use software rendering; Hyprland's VM guidance calls for accelerated graphics. Start Hyprland/niri/COSMIC/KWin/GNOME qualification with virtio-gpu/virgl and a GL-enabled viewer, host Mesa/EGL/render-device access, and guest Mesa/DRM. Exact pinned combinations remain untested; software fallback is a separately recorded backend, not a timing-equivalent result.
- Virgl provides OpenGL, not automatically Vulkan. If a selected compositor/backend needs Vulkan, assess Venus/rutabaga and their host/guest requirements separately; none of these desktop names alone proves Vulkan mandatory. Do not reuse old Hyprland WLR environment recipes at the newer pin.

## Host needs and budget

- One guest at a time for the minimal slice (explicit host decision to parallelize).
- Per guest: X11 2 cores/2 GiB; Wayland 3-4 cores/4 GiB; GNOME/KDE 4 cores/4-8 GiB. Guest disks 10-20 GiB qcow2 each.
- Dominant disk cost is the shared Nix store (downloads/builds): estimate 30-60 GiB plus guest disks; reserve roughly 80-120 GiB total for the slice with headroom (uncertain). Keep ~4 GiB host RAM headroom.
- `devenv.nix`: no additions recommended initially: the pinned `build-vm` wrapper supplies QEMU/`qemu-img`. Add direct host QEMU/viewer tools there only if the chosen workflow requires them. OVMF/virtiofsd are not needed for default direct-boot/9p guests; fixture/IPC packages belong in guest modules. After any later host-dependency change, restart the session before using it.

## Multi-head, hotplug, Super grab (qualified)

- QEMU virtio-gpu `max_outputs=2` is head capacity, not proof of two connected outputs. Validate guest output enumeration and viewer support (GTK tabs or SPICE `remote-viewer`), then configure two fixed heads with a declared arrangement/scale. This can support R-OUT-01..05 geometry/routing fixtures, including queued OUT-03/04/05. SPICE GL requires a suitable local-socket workflow; validate the combination before adopting it.
- OUT-06: output disable/enable IPC is not physical connector hotplug. Viewer-driven monitor changes, QMP/device changes and guest-driver support need qualification; do not assume arbitrary virtio head hot-unplug. Record output IDs/modes before/after; VM connector identity/return affinity is not physical-host proof.
- Input: choose viewer keyboard-grab and release controls; confirm Super, Alt-Tab and pointer drags reach the guest while host shortcuts stay idle. Host Plasma may intercept them. IPC avoids grab conflicts for semantic-command cases but does not test the literal input path; record viewer/backend/grab state and host reactions for manual runs.

## Repeatable fixtures and stimulus

- Preinstall `xterm -geometry` and `foot --window-size-chars` with stable window labels A/B/C. Sizes are character cells, not pixel guarantees; measure accepted client/frame geometry.
- Add one small GTK/PyGObject or Qt fixture app: ordinary/fixed-size and minimum-size windows, parent+dialog/transient, urgency/activation, fullscreen/maximize/minimize requests. Pin toolkit/backend and report requested versus accepted state. X11 uses size/type/transient hints and EWMH; native Wayland uses xdg-shell/activation protocols. Wayland global positioning/focus and attention/minimize delivery are compositor-dependent; rejected requests are observations, not failed setup silently retried.
- X11 drivers: `wmctrl`/`xdotool`; native semantic commands: `i3-msg`, `bspc`, `swaymsg`, `hyprctl`, `niri msg`. X11 tools on Xwayland do not control native Wayland windows; niri X11 fixtures require its satellite route.
- `no-counterpart` follows pinned inventory review; a missing harness verb alone never proves a native counterpart absent, and tooling limits never relabel matrix outcomes.
- Scriptable while the user watches: fresh launch/focus histories, named IPC layout/move/resize/workspace actions, client state requests, and before/after snapshots. Manual: key-grab paths, hover timing, drag thresholds/drop zones, overview/gestures, modal/PiP interaction, hotplug and session restart. IPC can prepare a drag fixture but cannot prove a drag outcome; reload is not compositor/session restart.

## Observers (snapshot contract)

- Per action snapshot: raw + normalized tree/windows, geometry with coordinate/scale frame stated (physical/logical, frame vs client), workspace/output/focus/request state, config/pins, and sequence. The user records actual outcomes in the existing matrix.
- IPC-driven checks and literal-key/drag journeys are non-equivalent paths; log which produced the observation.
- xmonad: EWMH root active-window read suffices for partial focus evidence. GNOME Looking Glass and KWin scripting are interactive/sandboxed observer potentials, not stable CLIs.

| Environment | Proposed observer adapter |
|---|---|
| i3 / sway | `i3-msg` / `swaymsg` tree, workspaces, outputs + event subscriptions |
| bspwm | `bspc query -T` + subscribed node/desktop events |
| Hyprland | `hyprctl -j` clients/activewindow/workspaces/monitors + event socket |
| niri | `niri msg --json` windows/workspaces/outputs/focused-window + event stream |
| qtile / awesome | `qtile cmd-obj`/shell introspection / `awesome-client` read-only Lua queries |
| xmonad | `xprop`, `xwininfo`, `wmctrl -lG`; geometry/focus only, no recovered layout tree |
| COSMIC | fixture logs + screenshots; investigate read-only toplevel protocol, no assumed tree IPC |
| PaperWM / karousel / Ours KDE | GNOME or KWin guest-side read-only scripting + screenshots; project traces for Ours |

## Non-Linux tracks

- macOS/paneru (82): Mac hardware required. The Apple Silicon + macOS 12 floor describes Apple's Virtualization-backend path (UTM); Intel Macs exist outside that path. Primary license: Apple macOS SLA 2B(iii) allows up to two additional virtualized copies per owned/controlled Mac already running macOS, for dev/test/Server/personal use with stated exclusions; a licensed Mac-hosted VM is a candidate, but a Linux host is unsuitable.
- Ours Windows (37): declared validation stays on the native host; a Windows VM is technically possible but out of scope, not evidence for the declared profile.
- PaperWM/karousel guests work subject to exact Shell/extension and Plasma/checkout pairing plus display qualification.

## Slice decision and effort

- Recommend i3 (13) + sway (18) + bspwm (19) = 50 cells. Reason: cheapest backend story (X11 plus the most tolerant Wayland guest), shared tree observer family, proves the whole pipeline; modest queue, not the largest, by explicit trade-off.
- Scrolling-first alternative: i3 + sway + niri = 72 cells; adds a scrolling model but pays graphics qualification and column-fixture cost early. Later queue value: PaperWM 73, karousel 58, niri 41, Hyprland 37, COSMIC 29; order those after proving rendering and observer support.
- Minimal-slice effort total: roughly 8-14 authoring days (base + 3 guests + fixture pack + snapshot harness); source/dependency incompatibilities could extend this. User live-test time is separate.

## Decisions needed

| Decision | Recommendation |
|---|---|
| Build route/config layout | One flake, shared base and per-WM `build-vm` outputs |
| First slice/value trade-off | i3+sway+bspwm, 50 queued cells; niri replaces bspwm only if scrolling is the priority |
| Package baseline | Keep current nixpkgs `54ba4bcec4043e72a4006d825e0d7aff5562008f`; exact-source overlays, compatible inputs only where necessary |
| Host budget | One guest at a time, up to 4 GiB guest RAM + 4 GiB host headroom; reserve roughly 80-120 GiB disk for slice/store/headroom |
| Host dependencies | No `devenv.nix` additions initially; add viewer/direct-QEMU tools there only if required, then restart session |
| Operating/test responsibility | User boots guests and records observations; prioritize native Mac/Windows tracks separately |

- Exact next action: user selects the slice and confirms RAM/disk budget; a separately authorized implementation change authors the shared guest base, exact-pin i3/sway packages, fixture client and snapshot helper. Builds/boots and test execution require that later scope.

## Primary sources

- [NixOS qemu-vm module at current lock](https://github.com/NixOS/nixpkgs/blob/54ba4bcec4043e72a4006d825e0d7aff5562008f/nixos/modules/virtualisation/qemu-vm.nix)
- [NixOS VMs on nix.dev](https://nix.dev/tutorials/nixos/nixos-configuration-on-vm.html)
- [nixos-generators README](https://github.com/nix-community/nixos-generators/blob/master/README.md)
- [microvm.nix handbook](https://microvm-nix.github.io/microvm.nix/)
- [QEMU virtio-gpu docs](https://www.qemu.org/docs/master/system/devices/virtio/virtio-gpu.html)
- [Hyprland VM guidance](https://wiki.hypr.land/Getting-Started/Master-Tutorial/#vm) and [niri IPC docs](https://niri-wm.github.io/niri/IPC.html)
- [i3 IPC docs](https://i3wm.org/docs/ipc.html) (sway shares the family)
- [UTM macOS guests](https://docs.getutm.app/guest-support/macos/) and [Apple SLA index](https://www.apple.com/legal/sla/)
- [SPICE multi-monitor support](https://www.spice-space.org/multiple-monitors.html). Web docs describe upstream capabilities, not a successful run at the pinned package set.

## Remaining uncertainties

- Exact per-WM module/option/package names at the frozen nixpkgs rev; pinned-rev source builds (cargoHash, wlroots/Aquamarine, Shell/KWin pairs).
- Host KVM/GL outcome; pinned QEMU multi-head/hotplug feature set; viewer behavior per guest.
