# macOS port: tentative implementation plan

Status: TENTATIVE, researched 2026-10-03. No macOS architecture newly
approved; nothing below is tested on a Mac. The user expects macOS work soon,
building on Windows. Approved goals remain in
[decisions](../../decisions.md#windows-port): managed per-display workspaces
for feature completeness, custom-drawing/true-underlay experiment with outline
fallback, and KDE action/behavior parity. Evidence detail lives in
[prior art](prior-art.md) and the [setup runbook](../../macos-dev-environment.md).
The structure mirrors the [Windows plan](../windows-port/plan.md).

## Recommended architecture (tentative, not approved)

- One per-login signed Rust app in the user's graphical session. Retained
  `tiler-core` Engine for layout policy; a Mac adapter owns AX
  observation/actuation, focus readback, visuals, menu/settings, and
  login/update lifecycle. No KWin D-Bus transplant, no universal IPC hop.
- Public Accessibility (AX) control plane only on the default path. No
  private AX-to-CG bridge (`_AXUIElementGetWindow`), no SkyLight/SLS use,
  no Dock injection, no SIP reduction by default.
- Private-API routes that run under stock SIP are still version-coupled,
  not public API guarantees. A private stock-SIP advanced mode and a
  reduced-SIP/injection route are separate alternatives, not selected.
  Recommend deferring both; do not build two backends before proving one.
- Keep a single-instance owner per graphical login. Start with Rust AX FFI
  and AppKit bindings; use `tiler-protocol` only if external IPC is needed.
  Small Swift glue is an option for demonstrated native UI/binding gaps.

## What Windows delivered (reuse intent, do not transplant mechanics)

- Reuse retained Engine layout/focus/move, minimum-aware projection, visual
  intent and the shared stale-destination-focus send fix. Skip redundant
  writes; measure action latency and native readback, not only dispatch time.
- Windows now delivers select/send-and-follow/trailing-empty workspaces,
  independent restoration plus a same-executable crash watcher, active border,
  underlay, maximise/fullscreen, float/sticky float. Mac phases target those
  behaviors, then drag/drop preview, output support and settings parity.
- Win32 hooks, `SW_HIDE`, `SPI_SETWINARRANGING` and `AttachThreadInput` stay
  in the Windows adapter. Parking changes geometry, so the Windows visibility-
  only ledger cannot be copied unchanged.

Evidence: [workspaces](../../changes/archive/windows-managed-workspaces.md),
[latency](../../changes/archive/windows-workspace-action-latency.md),
[minimum sizes](../../changes/archive/windows-minimum-size-hints.md),
[send fix](../../changes/archive/windows-send-split-axis.md) and the Windows
border/underlay/maximise/fullscreen/float/sticky archive records. Shipped
Windows slices still have user-owned physical and multi-output checks;
their delivery is not evidence of macOS capability.

## Observation, identity, and control contract

- AX setter returns are not proof; every write needs a bounded readback.
  Keep the core's hint-aware projection, reconcile actual frames, never
  reassert endlessly. Calls (focus requests included) are not evidence.
- Public AX/CG identity join is ambiguous: `CGWindowListCopyWindowInfo`
  supplements bounds/PID/ordering but same-PID/same-geometry matches can
  collide. Refuse ambiguous joins; never treat a missing AX window as
  proof of closure.
- Minimum sizes: probe whether fresh app-declared constraints are available
  through public AX per client (no universal minimum-size query established).
  Feed usable hints to the existing projection, no generic learning. Failed
  or timed-out queries supply no hint; match the shared overconstrained
  rule (retain allocation, flag, skip writes).
- Native mac fullscreen (own Space) vs project fullscreen handling
  differences are OPEN. Implement scope against the KDE reference; leave
  native-fullscreen windows and their Spaces untouched until the spike
  proves otherwise.

## Shortcuts and host-setting conflicts

- The 2026-10-03 per-binding conflict decision applies to Mac: settings
  show each binding conflicting with an OS/desktop chord and offer keep
  (override), disable, or rebind, with one-step "compatible" and
  "authentic" presets. No new Option defaults and no Cmd/Meta mapping are
  selected; modifier mapping stays open until the catalog/conflict spike
  against KDE's existing catalog. Compatible avoids known OS conflicts;
  authentic may override only proven chords, with explicit unsupported status.
- Carbon `RegisterEventHotKey` reports conflicts but does not promise
  takeover of system chords; a session event tap can intercept/suppress
  but needs its own consent, suffers Secure Input blackout and
  timeout-disable. Probe matched down/up/repeat behavior and non-leakage even
  with an unmanaged foreground, a lesson from Windows Win+G/Game Bar leakage.
  Respect lock/Secure Input; missing interception cannot silently mean success.
- Apple-owned chords to inventory (fetched 2026-10-03): Cmd-Space,
  Ctrl-Up/Down, Cmd-Tab, Ctrl-Cmd-Q, Fn-Control tiling chords, and
  Mission Control/Spaces/System Keyboard remappables. See Apple
  shortcuts and tiling-shortcut sources below.

## Native coexistence inventory (spike before promising)

- Native tiling (macOS 15): edge drag, Option-accelerated drag, green
  button layouts, Window menu, Fn-Control(-Shift/-Option-Shift) chords.
  Source: Apple tile-windows and tiling-shortcuts pages below.
- Mission Control/Spaces/System Keyboard shortcuts are user-remappable;
  remappability is not a general takeover API. Record exact preimages of
  only owned changed settings; visible off/revert; no private defaults
  writes assumed.
- "Displays have separate Spaces" on/off changes monitor/fullscreen
  behavior; test both. Source: Apple Desktop and Dock settings page.
- Stage Manager needs a classification probe. Historical Amethyst reports
  could not distinguish staged-hidden from minimized reliably; that is an
  upstream limitation report, not proof about current macOS. Never infer
  closure or ownership from absence.

## Gaming coexistence

- Remember tiled membership across gaming sessions; suspend geometry
  moves, effects (border/underlay/preview), and shortcut handling while
  a game is active; resume with re-observation on return.
- Windows "Xbox mode" pause/resume is platform-specific; do not invent a
  Mac equivalent. Research native fullscreen games, borderless windows,
  Game Mode auto-engage on Apple silicon fullscreen, and Game Overlay
  (Cmd-Esc, Tahoe 26+) against the Apple Game Mode source below.
- Provide alternate access to displaced OS surfaces where authentic
  bindings collide; anti-cheat safety is a non-guarantee; no injection
  to work around it.

## Managed workspaces (public default gated)

- Default public path is offscreen parking of inactive members, enabled
  only after recovery and shell-behavior proof (restore identity,
  Mission Control/Dock/Cmd-Tab acceptance, forced-kill and quit/update
  restore with a visible manual recovery route).
- Maintain explicit `(output,workspace)` membership and last confirmed
  visible frames. Before parking, durably record owner/session, app lifetime
  and bounded window evidence plus restore frame; never serialize an AX
  pointer as recoverable identity. Re-enumerate after owner loss and refuse
  ambiguous matches. A small same-executable watcher needs its own TCC/lifetime
  proof; prove standalone restore before managing ordinary user windows.
- Test per-output-local/global-unique/shared semantics, independent layouts,
  existing-number selection, send/follow, trailing empty, parked-app activation,
  native Space changes and hotplug displacement/return. Do not require users
  to rearrange displays or alter Mission Control merely to hide defects.
- Alternatives, not approved as release contracts: native-Space-only
  tiling preview (no cross-Space authority); application hide
  (FlashSpace route fails per-window parity); optional private stock-SIP
  advanced mode vs injection (separate deferred options, NOT approved).

## Visuals (public AppKit only)

- No public proven primitive places our fill below specific foreign
  windows while above unrelated lower ones. Approved fallback: group
  outline (never a fill drawn above content masquerading as an underlay).
- Experiment with click-through nonactivating AppKit panels: separate active
  ring, group plane and drag preview. `order(_:relativeTo:)` uses AppKit window
  numbers, not a documented AX-to-global-window stacking contract. Compare
  real z-order before adopting a fill; renderer choice does not grant stacking.
- Acceptance must cover Mission Control thumbnails, Cmd-Tab, Dock,
  click-through, fullscreen/game suppression, and mixed-scale
  multi-display. Active suppression around fullscreen/game targets.

## Phases (mirror Windows; owned probes first)

| Phase | Scope | Exit evidence |
| --- | --- | --- |
| 0. Setup/contract | Mac host per `docs/macos-dev-environment.md`; stable signed identity; portable-crate baseline; contract seams from Windows intent (no Win32 mechanics) | Reproducible signed `.app` with stable TCC consent; CI allowlist green |
| 1. AX/input/lifecycle probes | AX observer loop on owned apps; Carbon-vs-tap comparison; sleep/wake/session/Space/display callbacks; independent crash-restore probe | Settable/error/readback matrix; conflict/suppression/TCC/SecureInput/timeout matrix; forced-kill restore with manual route |
| 2. Geometry | Engine tiling on the visible ordinary Space; per-app skips; min-size hints; fullscreen/float/sticky classification | Requested-vs-observed frames across scale/animation; no fullscreen-game writes; revoke/wake/hotplug recovery |
| 3. Workspaces + visual parity | Managed per-display sets (default parking gated as above); active border; outline fallback or proven underlay; drag/drop preview | Two-display send/switch/trailing-empty; shell acceptance; no game cost; preview without focus theft |
| 4. Settings/menu/distribution/update | Native menu/settings; per-binding conflict UX; notarized DMG + cask; update/uninstall lifecycle | Live settings/readback; TCC survival across update; clean login/exit; quarantine path documented |

## Open user decisions (recommendations, none selected)

| Decision | Recommendation |
| --- | --- |
| Version floor and arch | Tentative macOS 15+, arm64-first until a physical Intel host exists; no Intel parity claims without one |
| Modifier mapping | Open; choose after shortcut-catalog/conflict spike, do not invent keys |
| Development signer and governance | Stable Apple Development or persistent local dev identity before repeated TCC grants; adopt the runbook tool inventory with user-performed installs; decide separately from mise |
| Distribution | Notarized Developer ID DMG plus Homebrew cask first; notarization is not App Store approval |
| Mac App Store | Defer: mandatory sandbox/public-API rules are established; cross-app AX parity is unproven for a new sandboxed app. Separate signed sandbox spike plus Review pass before any Store promise |
| Updates | Manual DMG upgrade first; Sparkle only after parked-window safe-restore/update proof |
| UI language | Rust first (`objc2`/AX FFI spike); minimal Swift shim only if a demonstrated binding/UI gap requires it |
| Advanced/private mode | Deferred option, not approved alongside the default path |
| Native settings takeover | Default choice pending; visible off/revert, preimages of owned changes only |
| Native vs project fullscreen | Preserve native fullscreen Spaces/games; define the project action against KDE maximize/fullscreen/slot restoration intent after the capability spike |

## Risks (gates, not an exhaustive register)

Parking recovery/stranding, fullscreen-game interference, AX/TCC
refusal or permission loss, false joins, overlay-above-content,
Space/display interaction, shortcut conflict or stalled taps, signing or
update permission resets, Mission Control/Cmd-Tab pollution. Hold the
workspace release if recovery or shell behavior fails; use the outline
fallback if the underlay spike fails.

Verification: portable Rust gates in CI; permission, recovery, input and
visual journeys on an authorized physical Mac with owned test windows first.
Measure input/frame-time/CPU/wakeups in real native and borderless games;
neither notarization nor hosted CI proves anti-cheat compatibility. Keep
bounded structured lifecycle logs, no app content, titles or raw key events.

## Sources (fetched 2026-10-03; repo docs as paths)

- https://support.apple.com/guide/mac-help/mchlef287e5d/mac (tile windows: edge drag, Option drag, green button, menu, shortcuts)
- https://support.apple.com/guide/mac-help/mchl9674d0b0/mac (tiling icons and Fn-Control keyboard shortcuts)
- https://support.apple.com/guide/mac-help/mh14112/mac (Spaces: create, move, switch, assign, delete; fullscreen own-Space behavior)
- https://support.apple.com/guide/mac-help/change-desktop-dock-settings-mchlp1119/mac (separate Spaces, Stage Manager dependency, tiling toggles, Mission Control shortcuts)
- https://support.apple.com/en-us/102650 (system shortcuts: Cmd-Space, Ctrl-Up/Down, Cmd-Tab, Ctrl-Cmd-Q, Fn chords)
- https://support.apple.com/en-us/105118 (Game Mode: auto-engage on Apple silicon fullscreen; Game Overlay Cmd-Esc on Tahoe 26+; Sequoia 15 Game menu path)
- https://developer.apple.com/documentation/appkit/nswindow/order(_:relativeto:).md
- https://developer.apple.com/documentation/appkit/nswindow/windownumber.md
- https://developer.apple.com/documentation/security/app-sandbox.md
- https://developer.apple.com/app-store/review/guidelines/ (2.4.5 sandbox/updates, 2.5.1 public APIs, 2.5.8 alternate desktops)
- `docs/macos-dev-environment.md` (setup, signing, TCC, CI proposal)
- `docs/research/macos-port/prior-art.md` (upstream routes, keyboard mechanisms, licenses, gaps)
- `docs/decisions.md` (Windows 2026-09-30/10-01/10-02/10-03 selections; cross-platform conflict-preset and gaming rules)
- `docs/research/windows-port/plan.md` (mirrored structure)
