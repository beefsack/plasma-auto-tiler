# Windows gaming coexistence

## Active follow-up: attributable live containment (2026-10-03)

- Scope now: backlog P0 part (a), authentic owned-shortcut containment on the
  normal desktop. KDE bindings remain mandatory. Placement defects D1/D2/D4/D5,
  Xbox detection and alternate Game Bar access are separate work.
- Physical dogfood T2/T3 still leaked Win+F11/Win+G after the earlier delivery;
  inclusion of `5746fca` in that payload is undetermined. T3 logged 36 consumed
  and zero passed classified events, without correlation to the leaking taps.
- Current source `4b3096a` includes both earlier fixes. Product hooks ignore all
  injected input; use the existing fixed-marker `shortcut-proof` path for
  automated classifier-equivalent evidence, never claim physical acceptance.
- Units: (1) source/artifact provenance and trace-only bounded callback decision
  and timing diagnostics; (2) normal-desktop owner-ready single F11 then G taps,
  observing OS surfaces, stopping/recovering on first leak; (3) evidence-directed
  supported fix or install-order comparison; (4) independent review, native/CI
  gates and handover. Extend conflict coverage only after the gaming taps pass.
- Live authority: standing autonomous brief permits hooks, injection and owned
  windows on this physical host. Preserve the hosting Terminal process tree.
  End every run with no project process/overlay/ledger/hidden test window,
  SPI 0x0082=1 and 0x201E=35, and close only disposable apps opened for this work.
- Stop for undocumented mechanisms, registry/policy writes or architecture
  changes. Keep this record active until containment acceptance is established.
- Diagnostic/provenance unit accepted: `windows-dev.ps1` records source HEAD,
  dirty state, copied-payload SHA256, argv and exact ready identity in
  `<owner-log>.provenance.json` plus stdout. This is launch attribution, not an
  embedded commit claim. The owner log stays single-writer; sidecar-write failure
  requests verified stop/restore.
- Trace-only `snap-callback` reports bounded closed-catalog decisions, modifier
  state, source, local classification timing, mask-send count/max latency and
  saturating loss/privacy-filter counts. Collection is disabled without trace.
  No ordinary typed letters, app content or native window identifiers enter it.
  Armed state is captured before classification so early-Win-up chord releases
  remain diagnosable. Downstream-hook latency and time waiting for the owner to
  pump messages remain outside this metric.
- Independent review found diagnostic edge/privacy-overhead and concurrent-log
  writer/recovery gaps. One correction resolved them before acceptance. Lead
  inspected the final diff and ran locked four-package native tests, strict
  all-target clippy, full rustfmt and diff checks; the explicit locked build also
  passed. Snapkey: 58 tests. No shortcut behavior changed in this unit.
- `2c9c11c` hosted CI [37113756434][diagnostic-ci] passed all four jobs.
- Fixture contract accepted after correcting stop-after-recovery, consumed-action
  versus interception eligibility, project-overlay exclusion and newly-uncloaked
  observation. Lead additionally bounded post-tap sampling to two seconds and
  fenced recovery to the exact newly observed foreground shell/gaming surface.
  Mock: 44 negative gates pass. Test observer selectors are evidence-only;
  they are not a product Xbox-mode detector. Subsequent screenshot evidence
  invalidated their clean-desktop inference; the fixture remains an unaccepted
  working-tree diagnostic draft, not an acceptance gate.
- First live run (Win11 build 26200, medium IL 8192, one display):
  `target/windows-shortcuts/20261003-195626-33604/shortcuts-fail.json`, source
  `2c9c11c` plus the fixture diff; owner SHA256
  `553D839B9EC6B0503E941CF430308C9ECB753CA15CC1FDDD592298AB878679E3`.
  One marked F11 tap, zero G taps. F11 callback down/up consumed (12/15 us),
  mask inserted 2, mask-send 622 us, no diagnostic drops. Taskbar held;
  no selector-recognized Game Bar/Xbox surface appeared in those samples. At
  sample 2, new visible
  `EdgeGameAssist.exe`/`msedge.exe` windows made observation uncertain; STOP
  before G. They were preserved. This snapshot alone did not establish a leaked
  shortcut or prove whether fullscreen activity triggered Game Assist.
- First run stop/restore succeeded, helper closed, no project actors or ledger,
  SPI arranging=1, pen=35, hosting Terminal and original apps alive. Accessible
  exact-owner graceful and emergency routes were first proved with nonhook runs.
- Final outcome: containment goal NOT met. Read-only shell screenshot later
  confirmed the "Switching to XBOX mode" prompt in an Explorer-owned
  `ApplicationFrameWindow`, not a GameBar/Xbox-named process. It was absent from
  the first baseline window set. Exactly one gaming chord was sent across all
  runs (marked F11); G and the remaining collision matrix were not reached.
  Prompt onset was not timestamped, so direct key leakage, an earlier observer,
  delayed delivery and indirect fullscreen activation remain distinguishable
  hypotheses, not an established OS root cause. Current artifact inclusion of
  the earlier fixes and consumption of this tap are established.
- Ten-second no-input dwell was stable with GameBar and EdgeGameAssist running.
  Later-owner install-order comparisons were blocked BEFORE input by the shell
  frame's fullscreen foreground: first reconcile suspension, then foreground
  activation refusal. One causal fixture repair moved exact helper activation
  ahead of convergence; it did not solve refusal. Subsequent runs
  `20261003-200151-32208`, `20261003-200738-4544` and
  `20261003-202209-32864` contain zero F11/G taps. No install-order conclusion
  follows from owner/process start ordering alone; no further attempt is selected.
- Recovery: screenshot-verified exact Explorer prompt received one successful
  Escape down/up pair; it disappeared and cloaked 0->2 with NOACTIVATE. An
  initial malformed test INPUT struct inserted zero events and was replaced
  with the existing proven sender before the successful pair. No Enter or
  "Don't remind" interaction occurred. Full Xbox mode was never selected.
  The cloaked shell frame remained the stale foreground; raise/attach activation
  still refused. Post-recovery PMv2 screenshot confirmed normal desktop/taskbar
  and no prompt; cloak/foreground alone are not product mode detection.
- Final live end: all exact owners/helpers stopped and closed, restore true,
  no project actors/overlays/ledger/stop/workspace request residue, SPI 1/35,
  original Notepad/Paint and hosting Terminal alive. No ordinary apps were
  launched or closed; existing GameBar/Edge processes and windows were preserved.
- Delivery: accept the diagnostic/provenance unit only. Preserve the unaccepted
  fixture diff in `scripts/windows-shortcuts.ps1`; do not archive this active
  record or advance containment to done. No rebind, registry/policy write,
  undocumented mechanism or hook-thread redesign was implemented.
- Options/recommendation: first have the user click a normal app to clear the
  stale shell foreground, then resume a bounded install-order comparison with
  screenshot-confirmed baseline and delayed post-tap observation. This is the
  smallest next step; it needs no product architecture choice. If timing evidence
  then implicates installer-thread latency, propose a dedicated-thread experiment
  for approval. If supported interception proves insufficient, return a policy
  or mechanism tradeoff instead of silently disabling gaming surfaces.
- User-owned acceptance remains all physical colliding chords, plain Win and
  unowned chords, release ordering, holds and reversal/stop. Fast local callback
  timing excludes neither queued callback delivery delay nor silent later hook
  loss. Observed F11 consume/mask success is not suppression acceptance.

## Goal and scope

- Enforce the existing authentic Windows shortcut catalog without OS leakage,
  including unmanaged/shell foregrounds, repeats and release ordering.
- Find a documented Xbox full screen experience signal before implementing
  pause/restore of tiling, effects and shortcuts with preserved workspace state.
- Research alternate Game Bar access and anti-cheat implications of existing
  mechanisms, including Windows prior art.
- Exclude initial split-axis and unmaximise overlap defects.

## Acceptance

- Audit every owned chord and its Windows conflicts; extract relevant evidence
  from the user's 2026-10-03 trace without application content/raw identifiers.
- Any shortcut fix has meaningful offline regression coverage and passes locked
  native build/test, strict all-target clippy and rustfmt; pushed CI is green.
- Xbox detection uses a documented signal, not a cloak/foreground heuristic.
  If no suitable signal is established, document the blocker and options.
- Research distinguishes documented guarantees, source inspection, user
  observations and unresolved physical acceptance.
- Public Game Bar access choices, mechanism/security changes and unsupported
  shortcut interception return for a user decision.

## Bounded units

1. Investigate hook routing/catalog, trace evidence and official Xbox detection.
2. Implement and verify the supported authentic shortcut correction, if justified.
3. Research Game Bar alternatives, anti-cheat and local prior art.
4. Review risky shortcut changes independently; integrate records and evidence.

## Outcome and accepted implementation

- Authentic shortcut containment is implemented and offline-verified. Xbox
  automatic pause/restore remains blocked on a documented runtime mode signal;
  alternate Game Bar access remains a user decision. This record stays active.
- `snapkey.rs` separates interception from action eligibility. Existing owned
  fresh chords consume whenever takeover/shortcut handling is enabled, including
  unmanaged, unadmitted and desktop/shell foregrounds, normal fullscreen
  suspension, gestures and elevated foregrounds. The latter are not authorization
  to manipulate protected windows: owner identity/scope/integrity checks remain.
- Consumed holds retain their verdict and down-time operation through repeats,
  modifier changes and either release ordering. Repeats with a changed modifier
  combination, released Win or disabled handling do not dispatch actions.
  Initially passed holds remain passed until release. Injected input, fresh
  unowned combinations and the existing default Win+L exception are unchanged.
- Saturation drops action/trace evidence, not interception. A full queue evicts
  one oldest record to reserve necessary E8 mask evidence; losses are counted.
  The mask survives consumed holds and its actual send result is recorded.
  Bare swallowed repeats after Win-up do not rearm it, so a subsequent naked
  Win tap retains normal Start behavior. This follow-up regression was found
  during Lead integration and fixed across every classifier arm.
- Fresh Shift state binds supported preheld move/send/sticky combinations;
  fresh Ctrl/Alt combinations remain unowned. The callback stays bounded with
  no synchronous logging, Engine work or window mutations.
- Maximize/fullscreen/float/sticky dispatch now rechecks suspension and elevated
  foreground per intent. The existing verified managed-fullscreen exemption
  preserves exiting project-owned fullscreen. Its native behavior needs live proof.
- Independent review exposed toggle fencing and coverage/contract gaps. Lead
  inspection additionally exposed modifier/Win guards ahead of armed repeats;
  one corrective unit fixed these before acceptance. Superseded managed-only
  assertions failed during migration and were updated to the authorized contract.
  No arbitrary missing-key-up timeout was accepted.

## Binding and conflict audit

- Reference: `kwin/src/plan-adapter-entry.ts` shortcut catalog; Windows
  `snapkey.rs::{catalog_index,push,push_digit,push_maximize,push_fullscreen,push_g}`.
- Before this change, directional, maximize, fullscreen, float/sticky and
  workspace-send interception depended on a managed origin. Workspace select
  did not, but all arms depended on tiling activity/fullscreen/elevation/gesture
  gates. Repeats/ups could pass when those conditions changed; saturation also
  deliberately passed. Those are all deliberate pass-through paths, now removed
  from enabled authentic interception.
- Conflicts below are documented in [Windows shortcuts][shortcuts], except
  Xbox-mode Win+F11, documented separately in [KB5070297][xbox-mode]. Availability
  depends on OS version, device and app. Absence from this list is not a guarantee
  against third-party shortcut owners.

| Our existing chord | KDE operation | Windows collision |
| --- | --- | --- |
| Win+Left/Right | Focus | Snap left/right |
| Win+Up/Down | Focus | Maximize/minimize |
| Win+Shift+Left/Right | Move | Move between monitors |
| Win+Shift+Up/Down | Move | Stretch vertically / restore snapped or maximized window |
| Win+H | Focus left | Voice dictation |
| Win+J | Focus down | Recall on supported devices |
| Win+K | Focus up | Cast / Connect |
| Win+L | Focus right, existing explicit opt-in only | Lock; no supported suppression established here |
| Win+Shift+H/J/K/L | Move | No matching default found in the cited Windows 11 list |
| Win+0..9 | Select workspace | Taskbar app launch/switch |
| Win+Shift+0..9 | Send and follow | Taskbar new instance |
| Win+M | Maximize toggle | Minimize all |
| Win+F11 | Fullscreen toggle | Enter/exit Xbox mode |
| Win+G | Float toggle | Game Bar |
| Win+Shift+G | Sticky toggle | No matching default found in the cited list |

- Win+Shift+M/F11 are not owned fresh chords. Extra Ctrl/Alt combinations,
  Win+Tab and Win+D remain OS-owned. Shift released during an already consumed
  Shift+L hold does not turn its repeats into an OS lock chord in the classifier;
  physical Windows behavior for this boundary remains unproven.

## User trace evidence (2026-10-03)

- Source: local `session-1/run-01dd530861947ef5.log`, 4081 lines, owner started
  with `--user-start --trace`, four ordinary windows including Notepad. Only
  targeted hook/toggle/lifecycle rows were extracted; no raw trace is committed.
- Lines 2113/2142: Win+F11 down/up consumed, tick 259 enters project-owned
  fullscreen and tick 261 closes its pair. The managed fullscreen is a retained
  overlay, not evidence of Xbox mode or whole-session suspension.
- Lines 2620/2636, ticks 304/305:

  ```json
  {"disposition":"passed","edge":"down","event":"fullscreen-toggle","outcome":"passed","tick":304}
  {"disposition":"passed","edge":"up","event":"fullscreen-toggle","outcome":"passed","tick":305}
  ```

- Both edges reached the hook and were deliberately passed. This establishes
  a product pass-through route, not an OS bypass of a consuming hook. The user
  physically observed Xbox-mode entry; the trace has no mode-specific signal.
  It does not identify the failing gate/origin term. No suspension was logged at
  304/305; unmanaged/null foreground, transient gesture/elevation or a transient
  foreground veto cannot be disambiguated from these rows.
- Line 2991: another consumed down at tick 337 restores project-owned fullscreen.
  No matching up row follows; its cause is unknown. Line 3002 is the run's only
  `suspend` (`fullscreen-foreground`), followed by `snap-stale dropped:1` and
  `resume`. A dropped owner record is not proof of a missed physical key-up.
- Win+M: 14 consumed down/up pairs, targets alternating maximized/restored, no
  passed maximize rows. Four `snap-mask` results insert both events successfully
  (one focus, two maximize, one fullscreen). `snap-available`, successful
  `snap-release` and `run-end status:stopped` bound the run.
- No float/sticky actions or logged repeats in this run. It cannot prove held
  repeat behavior, all release orderings, hook-presence continuity, or suppression
  by the new code. Existing unmaximise overlap remains a separate defect.

## Xbox detection blocker

- [Microsoft's Xbox-mode guide][xbox-mode] documents Win+F11, Game Bar, Task View
  and controller/touch entry/exit; one-window/fullscreen behavior; startup options;
  and disabled desktop shortcuts. It gives no developer runtime mode signal.
- Two bounded searches of Microsoft Learn/Support plus local prior art did not
  establish an official Xbox-mode-specific query/event. This is a search result,
  not proof that no API exists.
- Rejected substitutions: [SHQueryUserNotificationState][notification-state]
  reports notification suitability, exclusive Direct3D fullscreen and presentation
  mode, not Xbox mode; [Game Mode APIs][game-mode] concern game resources and are
  deprecated; [GameBar.Visible/IsInputRedirected][gamebar-ui] describe an overlay,
  not the full screen experience; [effective power GameMode][power-mode] is power
  policy; [Gaming Configuration unattend][gaming-unattend] is provisioning rather
  than runtime state. AppCapture/AppBroadcasting signals were not established as
  Xbox-mode detectors either.
- Cloaked ApplicationFrameWindow and DWM cloak 0->2 remain symptoms. No class,
  process-name, geometry or cloak heuristic was installed as mode detection.
- Options for the user: (A) retain the detection requirement and seek Microsoft
  clarification/a documented signal; (B) authorize a reversible explicit pause
  surface as an interim behavior, with manual enter/exit responsibility; (C)
  authorize heuristic research, accepting false pauses and missed transitions.
  Recommendation: A. B is a public-behavior decision; C changes the current
  documented-signal constraint. Automatic mode lifecycle is not implemented.

## Alternate Game Bar access (decision pending)

| Option | Evidence and consequences |
| --- | --- |
| Start-menu Game Bar launch | [Microsoft Learn][gamebar-launch] explicitly documents it; keyboard-only via Start/search, without changing our catalog. That guide cautions about PowerShell/Cmd focus. Needs current-host verification. |
| Controller Xbox button | [Xbox-mode guide][xbox-mode] documents it; no new tiler binding or input synthesis, but requires hardware. |
| User-configured Game Bar shortcut | [Xbox Support customization][gamebar-custom] and community Q&A describe it. Candidate for keyboard access; current Win11 UI, open-Game-Bar operation and reliability need verification. Q&A is not an API guarantee. |
| New tiler binding/tray action | Adds public behavior requiring user approval and a supported launch mechanism. No supported external main-Game-Bar activation was established. |

- Recommendation: approve documenting Start-menu/controller access now; evaluate
  the OS-custom-shortcut option for a convenient keyboard route before adding a
  tiler surface. No public binding, tray item or automatic launch was added.
- [Game Bar widget-control docs][gamebar-uri] describe `ms-gamebar:` URI syntax
  but explicitly say URI activation is currently unsupported apart from
  widget-to-widget activation. Do not treat ShellExecute/LaunchUriAsync of that
  URI as a supported external main-Game-Bar opener. `ms-gamebarservices:` has
  no suitable supported behavioral guarantee established here.
- Synthetic Win+G is not an alternate route: product ignores injected input,
  but synthesizing an OS gaming chord adds input behavior and anti-cheat exposure,
  and has not been authorized. Releasing Win+G in authentic mode would contradict
  the selected preset; it is not a technical fix for this change.

## Anti-cheat assessment

- No anti-cheat vendor certification, allowlist or specific incompatibility was
  established for this project or the mechanisms below. Compatibility and
  false-positive risk remain undetermined; official Win32 support and prior-art
  usage do not establish anti-cheat acceptance. No finding justifies a mechanism
  or architecture replacement without further evidence/user decision.

| Mechanism | Established facts and uncertainty |
| --- | --- |
| WH_KEYBOARD_LL | [Microsoft][ll-hook] says callbacks run in the installer's context, without injection into the target process. A prompt message loop is required. That differs from a game DLL hook, but is not anti-cheat certification. |
| E8 SendInput mask / focus prime | [SendInput][send-input] is documented and UIPI-limited. It creates detectable injected events; use is bounded and is not a demonstrated anti-cheat-safe exception. |
| Topmost/layered border and underlay | Separate project-owned windows, no game rendering injection. Existing carriers/band logic are in `active_border_sys.rs`, with eligibility in `active_border.rs` and `group_underlay.rs`; topmost/layered API support does not guarantee game/anti-cheat compatibility. |
| Cross-process window placement | Documented [SetWindowPos][set-window-pos], with existing identity/integrity/scope fencing. Fullscreen/protected targets are refused, not forcibly overridden. Vendor compatibility remains unknown. |
| Workspace hide / cloaking | Product workspaces use public [ShowWindow][show-window] SW_HIDE with recovery; DWM cloak observation is not Xbox detection. Prior art also uses COM virtual-desktop cloaking. [DWM cloak attributes][dwm-attributes] are documented, but cross-app use/anti-cheat support cannot be inferred from that alone. |

- Reliability boundary: Microsoft documents that LL-hook timeout can pass an
  event and silently remove the hook, with no supported notification of removal.
  This correction removes deliberate pass-through while the hook is present; it
  cannot promise absolute OS suppression after hook loss or on secure desktops.
  If physical Win+F11 still enters Xbox mode despite logged consume/mask success,
  stop and return the evidence/options; do not add registry, driver or injection
  workarounds. A dedicated-thread architecture or broader gaming exclusions would
  require a separately justified user decision.

## Local prior art

- Revisions below were read-only inspections; source paths are relative to each
  repository under the user's Development directory. Searches of their relevant
  source found no explicit Game Bar/Xbox full screen experience or anti-cheat
  compatibility contract. These are search-limited absences, not certifications.

| Repository / revision | Relevant source and behavior |
| --- | --- |
| GlazeWM `5709ad0a3c7c386bbc3e38166a865ffc12937515` | `packages/wm-platform/src/platform_impl/windows/keyboard_hook.rs`: WH_KEYBOARD_LL. `native_window.rs`: SetWindowPos, ShowWindowAsync, COM `set_cloak`, focus priming, MarkFullscreenWindow. `packages/wm/src/traits/window_getters.rs`: fullscreen frame-cover check. `wm.rs` / `wm_state.rs`: explicit pause and ignore commands. |
| komorebi `e0709f02bfae4e503bf4640f58ee75ecbbfdbb97` | `komorebi/src/com/mod.rs` and `com/interfaces.rs`: virtual-desktop cloak. `windows_api.rs`: DWM cloak reads. `window.rs` / `winevent.rs`: cloak/uncloak lifecycle. `core/asc.rs`: ignore/float/layered rules. `process_event.rs` / `process_command.rs`: pause. Shortcuts delegated to whkd/AHK; no in-process LL keyboard hook found. |
| Seelen-UI `56c1d75dae814bd5c3d03d5eea3d6f0428b02db1` | `Cargo.toml`: win-hotkeys keyboard hook. `background/windows_api/mod.rs`: fullscreen geometry and service-mediated window operations. `background/state/application/performance.rs`: fullscreen or GameMode/MixedReality power mode selects Extreme performance. `modules/power/*`: effective power signal and widget suspension. `cli/shortcuts.rs`: shortcut pause. This is generic performance policy, not Xbox detection. Its system-tray WH_CALLWNDPROC DLL is a different mechanism from our LL hook. |
| Whim `1e86b579206373a8e9939a5343b67696419ed284` | `src/Whim/Keybind/KeybindHook.cs`: WH_KEYBOARD_LL. `Store/WindowSector/Transforms/WindowAddedTransform.cs`: cloaked-window exclusion. `Native/CoreNativeManager.cs`: cloak query. `Processors/FirefoxWindowProcessor.cs`: cloak sequencing. `Filter/DefaultFilteredWindowsKomorebi.g.cs`: imported app exclusion rules. No mode-specific solution found. |

## Verification and required live plan

- Baseline: `de213b2`, clean working tree, aligned with `origin/main`.
- Native gates: the four packages in `.github/workflows/ci.yml` Windows job.
- Latest native verification passed after the corrective unit and Lead gate-repeat
  integration: locked build/test for `tiler-core`, `tiler-protocol`,
  `tiler-kwin-effect-ffi`, `tiler-windows`; strict all-target clippy; full rustfmt;
  `git diff --check`. Snapkey suite: 55 passing, including modifier/Win ordering,
  unmanaged interception, disabled-gate pairs and saturated queues. Three pure
  Shift-sync tests pass. First delivered unit `962b0f3` passed all four hosted
  jobs (Windows, Rust, KWin, shell), [run 37109086579][first-ci]. The follow-up
  mask correction passed native gates; delivered-head CI is checked in the
  terminal handover.
- No live run was performed for this change. Required normal-desktop test, only
  after the user frees the desktop and authorizes the bounded run:
  1. Read the live guide, confirm taskbar/normal desktop, no game/anti-cheat or
     protected target. Record source/artifact hash, exact owner identity, display
     and restoration baselines, including SPI 0x0082=1 and pen 0x201E=35. Preserve
     the hosting Terminal process/tree and establish the out-of-hook stop route.
  2. Open four disposable Notepad windows. Run
     `just --justfile windows.justfile tile --user-start --trace --scope-exe notepad.exe`
     through the approved launcher. Confirm owner-ready and `snap-available`
     before any gaming chord. Terminal and other executables remain unmanaged.
  3. Physical taps and bounded two-second holds: arrows/H/J/K, Shift+direction,
     0..9 select/send, M, F11, G and Shift+G. Repeat on managed Notepad, unmanaged
     Terminal, Notepad's unadmitted dialog and desktop foreground. No Win+L lock
     or elevated/secure-desktop test. Windows must not Snap/minimize-all/open
     dictation/Cast/Recall/taskbar apps/Game Bar/Xbox mode for owned chords.
  4. On an owned chord hold, vary Shift/Ctrl/Alt and release Win before the chord,
     then test the reverse release ordering. Expect consumed pairs, no toggle
     repeats, no actions after the live modifier combination changes, successful
     bounded `snap-mask`, and no accidental Start. Plain Win, Win+D/Win+Tab and
     fresh Win+Shift+M remain OS-owned. Prehold Shift across hook install in one
     separately bounded restart to verify move/send/sticky selection.
  5. Enter/exit project-owned fullscreen with physical Win+F11 twice; both must
     log consumed down, fullscreen/restored, and preserve the normal desktop.
     Verify sibling workspace state after physical workspace select/send.
     Any unexpected Xbox entry ends the run: user uses Task View's desktop
     return surface and the out-of-hook exact-owner stop, not more injected keys.
  6. Graceful `just --justfile windows.justfile stop` and restore; verify released
     hook/overlays, revealed windows, no project owner/watcher/ledger residue,
     SPI and pen baselines. If needed use exact-identity emergency-stop then
     restore per the guide. Close only newly opened disposable windows.
- Expected current logs: consumed `snap`/`workspace`/toggle records or settled
  origin/suspended/elevated rejections, `snap-mask result:mask-ok`, no owned
  `disposition:passed` while handling is enabled, successful `snap-release` and
  `run-end status:stopped`. Blocked batches may use bounded `snap-stale` instead
  of per-chord records. Trace absence alone does not prove OS suppression.
- Xbox lifecycle testing is deferred until a documented signal/approved route
  exists. Its acceptance must include startup-in-mode, enter, exit, new/closed
  windows and workspace continuity; bounded enter/exit/restore outcomes; no
  geometry/effects/shortcut consumption in mode; exact normal-desktop cleanup.
- No new public behavior or provisional product decision was selected. Next:
  user decision on detection/access options and normal-desktop physical proof.

[shortcuts]: https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec
[xbox-mode]: https://support.microsoft.com/en-gb/topic/windows-gaming-full-screen-experience-67fb8d12-5467-4a95-8adf-0a10789576ab
[gamebar-launch]: https://learn.microsoft.com/en-us/xbox/game-bar/quickstart/run-gamebar
[gamebar-custom]: https://support.xbox.com/en-US/help/games-apps/game-setup-and-play/customize-game-bar-on-windows-10
[gamebar-uri]: https://learn.microsoft.com/en-us/xbox/game-bar/api/xgb-widgetcontrol
[gamebar-ui]: https://learn.microsoft.com/en-us/uwp/api/windows.gaming.ui.gamebar
[notification-state]: https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state
[game-mode]: https://learn.microsoft.com/en-us/previous-versions/windows/desktop/gamemode/game-mode-portal
[power-mode]: https://learn.microsoft.com/en-us/windows/win32/api/powersetting/ne-powersetting-effective_power_mode
[gaming-unattend]: https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-gaming-configuration
[ll-hook]: https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc
[send-input]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
[set-window-pos]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos
[show-window]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow
[dwm-attributes]: https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute
[first-ci]: https://github.com/beefsack/plasma-auto-tiler/actions/runs/37109086579
[diagnostic-ci]: https://github.com/beefsack/plasma-auto-tiler/actions/runs/37113756434
