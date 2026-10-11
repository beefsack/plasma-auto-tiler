# Windows Phase 2 automatic tiling

## Goal and scope

- User-started single-display Windows tiling preview, using the retained
  portable `tiler-core::engine::Engine` as layout authority.
- Eligible normal windows tile on open/close/restore; native notifications
  trigger complete enumeration. Manual move/resize uses Engine gesture
  operations following KDE behavior, not a reconcile-only snap-back loop.
- Physical coordinates, per-monitor-v2 awareness, monitor work area and DWM
  visible-frame/outer-rectangle conversion; KDE default inner/outer gaps 8/8.
- Geometry writes never activate, change z-order, hide or restyle windows.
  Minimized, maximized, elevated, shell, cloaked, tool/dialog and fullscreen
  windows are initially unmanaged. No shortcuts, input hooks, workspaces or
  visuals; WinEvent notifications drive enumeration.
- Stop/crash leaves geometry in place. Independent exact-owner stop remains
  available; no per-window geometry ledger.

## Approach and bounded units

1. Confirm Engine reuse, KDE behavior and native lifecycle integration.
2. Implement observation/geometry and retained Engine integration with
   portable fixture coverage, then continuous event-driven lifecycle/CLI.
3. Implement scoped live proof tooling, review native mutation boundaries,
   then run owned-helper journeys and a bounded normal-mode representative-app
   smoke. Physical shortcut/display/game acceptance remains user-owned.

## Acceptance and verification

- Selected native packages build/test, fmt-all, strict all-target clippy,
  whitespace; Linux compatibility inspection without adding tools/targets.
- Owned helpers prove open/close/minimize-restore, geometry/readback at 125%,
  graceful and forced owner exit with geometry unchanged.
- Proof targets only owned helpers on a frozen HWND/process-identity/lifetime-
  tag allowlist, excludes Terminal ancestry, and records artifact identity,
  native received arguments and requested/read-back frames. Native checks
  enforce the target set before every geometry write; other windows receive
   no proof writes or activation. Separate normal-mode smoke records real-app
   admission/reflow, native size refusals and geometry-preserving stop.
- Production logs use structured correlation/lifecycle data without window
  titles, application content or raw native identifiers; scoped proof receipts
  retain identities needed to audit targets and restoration.

## Findings

- Engine is already in dependency-free `tiler-core`, with no Linux transport
  or platform imports. `Engine::handle` returns committed replies; the Windows
  in-process adapter does not issue an extra session acknowledgement.
- KDE defaults are inner/outer gaps 8/8 (`kwin/src/domain-gap.ts`). Its manual
  gestures hold reconcile during manipulation and settle via drag-drop or
  pointer-resize commands. Frame insets remain adapter-owned.
- Meta/Win defaults and Windows Snap takeover/off-setting are selected for the
  next shortcut slice; this preview implements neither input hooks nor bindings.
  Mouse Snap prevention uses the selected session-only SPI experiment in the
  shortcut slice and does not block this preview.

## Outcome

- Implemented portable observation/Engine policy in `tiling.rs`, Windows
  enumeration/notification/actuation in `tiling_sys.rs`, continuous `tile`
  command with the existing owner lease and stop controls, explicit capture/
  inspect/proof-restore tools, passive helper journeys and the scoped proof
  driver. Core/protocol/Linux sources are unchanged.
- Selected four-package native build/test and strict all-target clippy,
  fmt-all, PowerShell parse, recipe dry-runs and whitespace passed. Linux
  compatibility is source inspection only: `tiler-core` is portable and native
  modules/dependencies remain Windows-gated; no Linux target was installed.

## Live proof failure, 2026-10-01

- Owned proof stopped at the first visible admission, 18:38:08-18:38:37 +10.
  Evidence: `target/windows-tiling/20261001-183808-34768/owned-report.json`
  and `mutation-run.log`; source `9946265` plus the recorded working tree.
  Owner SHA-256:
  `DC7E47F5F5A44125BFFB4A498E35A83F5164E9616CA0B9E8ECD6D87995C8DDAB`.
- Physical baseline: Win11 Pro build 26200, medium integrity, session 1,
  one display, full bounds (0,0,2560,1440), work area (0,0,2560,1380),
  inset domain (8,8,2544,1364).
- Launch arguments were lost: all three recorded owner invocations are
  `tile `, and the actual startup receipt reports `mode:normal`, without
  trace. `Start-ProofOwner` names its parameter `$Args`, which collides with
  PowerShell's automatic `$args`. A harmless function reproduction showed
  the argument in `$PSBoundParameters['Args']` but an empty `$Args` value.
- The expected frozen helper allowlist was therefore not active. The saved
  mutation log records three accepted geometry setter calls in total; its
  first call occurred before any helper was shown and targeted an ordinary
  window. Exact affected-window identities were not recorded in normal-mode
  logs. Earlier owner logs were overwritten, so total writes across all three
  invocations cannot be established. The earlier zero-write assertion was
  invalid because trace was absent. These are failed proof results.
- Recovery stopped the exact owner, closed all three recorded helpers and
  cleaned the empty ledger/request. Independent end checks found no project
  actors, ledger.json or stop.request. No Apps stage or live retry ran.
- Ordinary windows were left in place; original rectangles were not captured
  before this unexpected normal-mode run. Read-only post-incident capture
  (`postincident-apps.json`) found all three apps visible/normal at DPI 120.
  Visible rectangles (x,y,width,height): Notepad (8,8,1268,1364), Paint
  (1284,8,1268,678), Calculator (1284,694,630,678). No original-geometry
  restoration was attempted without preimages.
- Helper layout/gap, minimize/restore, gesture and ordinary-app proof remain
  unaccepted. The saved normal-mode log also reports a persistent geometry
  mismatch and changing skipped-window tokens; these require investigation.
- Next repair requires argument-name correction, a nonmutating argument
  delivery check and a test entry point that cannot become normal mode when
  its required allowlist argument is lost. New live evidence is pending.
- User impact report: a borderless-windowed fullscreen game was active; the
  user noticed no window moves. This does not negate the logged setter calls.

## Launch and scope repair

- Replaced the colliding `$Args` parameter with `OwnerArguments`; audited the
  changed PowerShell scripts for other automatic-variable collisions.
- Separate `tile-proof` command requires a nonempty valid tagged allowlist and
  verifies exact owned-helper executable/class/process/lifetime identity before
  startup and each setter. Lost arguments cannot select normal mode. Normal
  `tile` requires `--user-start`. Removed non-owned app mutation proof tooling.
- Logs and proof audit are unique per owner run; prior logs are never truncated.
  Proof audit records received argv, parsed flags, frozen identities and each
  geometry setter target/flags/result; production logs retain opaque tokens.
- Observer-progress and zero-setter assertions replace the vacuous zero-trace
  assertion. Convergence reads only complete JSON lines and requires a full
  same-tick Engine plan and native readback. Cleanup closes tagged helpers.
- Skipped-token churn was caused by retaining only eligible identities; keeping
  all enumerated identities stabilizes skipped-window tokens. Fixtures cover
  stable no-op summaries and transient failures distinct from successful clamps.
- The old persistent mismatch is unidentified: its normal-mode log contains no
  native mapping or requested/read-back rectangle. DWM rounding versus app size
  refusal cannot be distinguished retrospectively. No learned limits or host
  settings were introduced; fresh helper proof and user dogfood supply evidence.
- Borderless fullscreen classification now requires captionless style and
  coverage of a full monitor rectangle, not just the work area, on any monitor.
  The same predicate guards foreground suspension and per-write veto. Fixtures
  cover full/work-area differences, captioned and small borderless windows,
  negative origins and non-primary monitor coverage.
- Native/owned-helper live evidence for the repaired tree remains pending.

## Repaired-tree verification, 2026-10-01

- Six no-write CLI probes passed: missing allowlist, empty path, nonexistent
  file, malformed JSON and empty list refuse `tile-proof`; bare `tile` refuses
  without `--user-start`. No lease, run log or geometry call was created.
- One owned run: 19:48:30-19:48:38 +10, source `ea700e4` plus the recorded
  working tree. Report:
  `target/windows-tiling/20261001-194830-21448/owned-report.json`.
  Owner SHA-256:
  `29EE1BA433F538086BD9B8BD03C1A908C4A601A3957E390064E150354DB0BE50`.
- Received argv includes the allowlist, trace and mutation-run deadline.
  Digest `2ac1871670d13d97` binds three frozen tagged helpers. Nonmoving
  graceful and forced owners each completed full enumeration with zero managed
  targets and zero geometry setter calls; their independent logs/audits remain.
- Passive first-show admission of one, two and three helpers passed. Full
  Engine plans matched native DWM frames exactly; inner/outer gaps were 8/8,
  DPI 120, full bounds (0,0,2560,1440), work area (0,0,2560,1380).
  Three-helper frames were (1284,8,1268,1364), (8,694,1268,678) and
  (8,8,1268,678). No new HWND creation after owner startup was tested.
- Lead re-read the mutation audit: seven setter calls, all successful, all
  targeting exact frozen helper identities/tags, all using
  `SWP_NOACTIVATE|SWP_NOZORDER`. Zero non-owned setter targets. The repaired
  helper log records zero managed geometry mismatches through these journeys.
- Run stopped at `minimize not observed via enumeration`. The minimized helper
  left management and the two survivors retiled exactly, but the script's
  minimize assertion failed. Its inspection response was not persisted, so
  the actual reported skip cannot be established. Restore, ordinary close and
  geometry-preserving active-owner stop/forced-exit checks were not reached.
- Source inspection explains the reporting defect: frame queries precede
  `IsIconic`, and `cmd_inspect` maps any failed full observation to
  `identity-changed`. Native identity/state must be reported separately from
  optional DWM frame availability; the exact failing native query was not saved.
- Residual churn remains on post-identity unreadable windows: failed frame
  queries mint a token but bypass the enumerated identity retain list. The
  successful-observation retain fix did not cover this error path. No geometry
  workaround or broader live test was attempted.
- Exact recovery stopped the owner, closed all recorded tagged helpers and
  cleaned the empty ledger/request. Independent end checks found no project
  actors, ledger.json or stop.request. No retry ran; complete helper acceptance
  is still blocked. Next bounded repair: identity/state-first inspection,
  retain identities on unreadable-frame paths, offline regressions, then a new
  owned-helper proof.

## Identity/state repair and repeated proof, 2026-10-01

- `observe_window` now resolves native identity and `IsIconic` before frame
  queries. Minimized helpers retain exact identity with `skip:minimized` and
  no invented geometry; post-identity frame failures retain identity/token
  with `unreadable`. Inspection separates identity/state from optional frames.
- Proof enumeration filters by frozen HWND before per-window queries and
  retains known identities even on frame-query failures. Non-owned windows do
  not mint proof tokens or generate per-window proof logs.
- Offline four-package build/test, fmt, strict all-target clippy, scripts and
  whitespace passed; 37 tiling and four helper-argument tests passed. Targeted
  independent review found no blocker in the repair.
- One repeated proof, 20:16:17-20:16:23 +10:
  `target/windows-tiling/20261001-201617-34604/owned-report.json`.
  Owner SHA-256:
  `9F9476ED3BBE38121DF77450C61F8BD2E7E88EB097C4E496AC98519428216B9A`.
- Nonmoving graceful/emergency probes passed with zero geometry calls.
  First-show admissions of one/two/three helpers again matched full Engine
  plans and native frames at DPI 120 with 8/8 gaps. The native loop reports
  `minimized` on stable token `w2`; two survivors retiled with exact readbacks.
  Tokens stayed `w1`/`w2`/`w3`, with zero managed mismatches.
- All seven audited setter calls targeted the frozen owned-helper identities,
  with `SWP_NOACTIVATE|SWP_NOZORDER`; zero non-owned calls. The minimized helper
  received no geometry write after minimization. Restore and managed close,
  plus active-owner stop/emergency geometry-preservation checks, were not reached.
- The repeated minimize assertion failed because the proof script has a merged
  statement: `Assert-ProofDpi ... "minimize"` and `$h2entry = ...` share a line.
  PowerShell treats the latter as extra command arguments; `$h2entry` remains
  unset. A harmless reproduction confirmed extra arguments `null`, `=` and the
  sample entry, with assignment false. The failure is a harness defect; it does
  not establish a bad native inspection response.
- Exact recovery stopped the owner, closed all three recorded tagged helpers
  and cleaned the empty ledger/request. Independent end checks found no project
  actors or recovery files. No retry ran. Next bounded repair is separating the
  two statements, preserving the inspection entry in proof evidence, checking
  the assertion with a mock, then repeating the full owned-helper journey.

## Mechanical proof repair and fullscreen block, 2026-10-01

- Split the merged minimize-check statements. The proof now records the complete
  inspection, selected helper entry and minimize-command result before asserting
  exact identity, ineligibility and `skip:minimized`.
- Mocked shipped assertion passed for an exact minimized entry and rejected
  wrong reason, changed identity and missing target while retaining evidence.
  Targeted PowerShell statement/argument checks and script parsing passed.
- Close now waits for survivor plan/readback/gap convergence. Each stop compares
  per-HWND full identity plus outer/visible frames; swapped frames fail the mock.
  Emergency-stop uses its own immediate pre-stop baseline after restart settles,
  rather than the previous owner's layout. Evidence stores before/after records.
- One proof invocation, 20:39:12-20:39:31 +10:
  `target/windows-tiling/20261001-203912-5400/owned-report.json`.
  Native artifact SHA-256 is unchanged from the preceding state repair.
- A captionless full-monitor foreground window caused the owner to suspend
  before its first observation. Received argv, proof mode, trace and all three
  frozen tagged identities were recorded; zero observations, zero ticks and zero
  geometry setter calls occurred. The nonmoving gate correctly reported
  `fullscreen suspension prevented observation`, rather than a vacuous pass.
- Recovery stopped the exact owner and closed all three tagged passive helpers.
  Independent checks found no project actors, ledger.json or stop.request;
  historical logs/audits remain intact. No retry or foreground manipulation ran.
  A normal window must be foreground before the complete owned-helper proof can
  proceed; restore/close and active-owner geometry-preserving stop evidence is
  still pending.

## Mouse Snap prevention research

- Research only; native Snap remains active in this tiling-only preview.
  [SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)
  documents `SPI_SETWINARRANGING` as a master arrangement switch, and
  `SPI_SETDOCKMOVING`/`SPI_SETSNAPSIZING` as narrower edge-drag/vertical-sizing
  controls. These are system-wide settings, not per-window/workspace APIs.
  Omitting `SPIF_UPDATEINIFILE` avoids persisting to the user profile;
  `SPIF_SENDCHANGE` broadcasts the change. A crash still requires recovery of
  the live setting, even for a nonpersistent override.
- Recommendation for a later mechanism experiment: the master SPI switch is
  simplest; granular switches have narrower effects but incomplete coverage.
  Either needs an explicit decision on desktop-wide impact, visible Apply/
  Revert, exact preimage and unchanged-owned-override restoration. No setting
  was queried or written. Per-workspace/per-monitor behavior is not guaranteed.
- [NoWindowMinimizingShortcuts](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-desktop#nowindowminimizingshortcuts)
  is a documented user policy for disabling Aero Shake. It is broader and more
  persistent than a workspace-local behavior; policy control/refresh/restoration
  need separate consideration.
- [Snap Layouts guidance](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
  describes enabling an application's own maximize-button flyout. No supported
  foreign-window/workspace-local flyout suppression API was found. The SPI
  documentation does not establish coverage of all Windows 11 flyout/bar/Assist
  surfaces; they remain explicit proof gaps, not guaranteed suppression.
- AHK's studied source supplies keyboard menu-mask techniques, but no targeted
  mouse-Snap SPI precedent was found. The [KDE host-settings record](host-settings-conflicts.md)
  provides visible Fix/Revert and readback precedent; KDE currently restores
  defaults without preimages, so exact Windows preimage restoration would be
  a proposed mechanism choice rather than existing parity.

## Survivor restart repair and final owned proof, 2026-10-01

- Intermediate run `target/windows-tiling/20261001-212809-30052` passed
  admission/gaps, minimize/restore, tagged close/survivor reflow and graceful
  stop with per-helper frames unchanged. Its 11 successful setter calls were
  owned-only. Emergency restart correctly refused the original allowlist after
  helper 3 closed; this was a harness-scope defect, not a native gate failure.
- The forced restart now derives a two-survivor allowlist verbatim from the
  frozen entries. Failed-start recovery uses native `restore` only for a dead,
  empty, same-artifact/SID/session lease; malformed predicate conversions fail
  closed. Suspension watcher, survivor derivation and recovery mocks passed.
  No ownership gate was relaxed. The dead empty lease from `212809` was recovered
  before the final run; the recovery branch was not triggered by the passing run.
- Fullscreen blocker identification found `firefox` / `MozillaWindowClass`.
  Activating Notepad allowed observation; Firefox received no test mutation.
- One complete proof passed, 22:26:11-22:26:20 +10:
  `target/windows-tiling/20261001-222611-6068/owned-report.json`.
  Source was `ea700e4` plus the receipt's working-tree hashes; owner SHA-256
  remained `9F9476ED3BBE38121DF77450C61F8BD2E7E88EB097C4E496AC98519428216B9A`.
- Nonmoving graceful/forced gates observed progress and zero writes. One/two/
  three admissions, 8/8 gaps at DPI 120, minimize/restore and tagged close with
  survivor convergence passed. Graceful and emergency owner stops preserved
  each survivor's full identity, outer rect and visible frame exactly.
- Independent audit confirmed all 11 writes targeted frozen tagged helpers,
  all successful with `SWP_NOACTIVATE|SWP_NOZORDER`, zero foreign writes.
  Survivor restart observed two targets without setters. Cleanup closed only
  tagged helpers; no project actors, `ledger.json` or `stop.request` remained.

## Normal-mode real-app smoke, 2026-10-01

- Bounded automated smoke passed the normal `tile --user-start --trace` route:
  `target/windows-tiling/20261001-223101-30052/report.json`, with baseline,
  settled/opened/restored and pre/post-stop frame receipts in the same directory.
  Owner artifact was `target/windows-dev/tiler-windows.exe`, same SHA-256 as the
  owned proof, medium integrity/session 1. Product log:
  `%LOCALAPPDATA%/plasma-auto-tiler/session-1/run-01dd51a0f442e4a5.log`.
- Notepad, Calculator, Paint and Terminal were admitted. Terminal initially
  maximized was correctly skipped, then admitted after native restore. At tick
  22, Notepad/Calculator/Terminal readbacks matched canonical plans and 8px gaps.
- Paint refused a planned visible height of 543px and held 617px (+74px),
  producing 66px overlap with the bottom row. Logs retained `mismatched=1`
  and bounded `refused-intent` suppression rather than claiming a matching
  readback or repeatedly writing. Exact four-app gap acceptance is therefore
  partial. Native minimum-size neighbour replanning is a recorded preview
  limitation, outside this item's small-defect scope.
- A new blank Notepad HWND was created after owner startup, admitted at tick 57
  with exact readback, then closed by exact HWND at tick 74; the original window
  remained open and reflowed. Calculator minimize at tick 89 removed it from
  management and reflowed survivors; restore at tick 100 freshly admitted it.
- Normal graceful stop preserved all four frames per identity. All original
  apps remained open, unminimized and unmaximized; no Terminal closure or content
  input occurred. Final foreground was Calculator after native restore. Final
  checks found no project actors or recovery files. No product fixes were needed.

## Delivery verification and remaining scope

- Independent native-boundary/evidence review accepted the preview with the
  explicit Paint limitation. Current-tree four-package locked stable build/test,
  fmt-all, strict all-target clippy, PowerShell parsing, proof recipe dry-run and
  whitespace checks passed. Linux compatibility was inspected through cfg
  boundaries; hosted CI supplies Linux verification after delivery.
- Complete owned lifecycle and bounded real-app smoke are accepted. Manual
  gestures, multi-monitor/mixed DPI, games and display/session transitions remain
  unaccepted; the historical ordinary-window mismatch cannot be identified from
  its old redacted log. Native Snap is still active; no shortcuts/hooks, visuals
  or managed workspaces are included.
- Next: shortcut slice, Win+Arrow focus and Win+Shift+Arrow move matching KDE,
  selected LL hook/vkE8 mechanism, visible Snap takeover off/Apply/Revert and the
  session-only mouse-Snap experiment. Windows workspaces follow that slice.

## Dogfood procedure

```powershell
just --justfile windows.justfile tile --user-start --trace
just --justfile windows.justfile tile-stop

# Exact-owner fallback if graceful stop fails, then clean the empty lease.
& "target/windows-dev/tiler-windows.exe" emergency-stop | Out-String
& "target/windows-dev/tiler-windows.exe" restore | Out-String
```

- Start with a normal, non-fullscreen foreground window. The launcher prints
  `log_path` and verified owner identity. Eligible normal windows, including
  Terminal, may tile; minimized/maximized/elevated/fullscreen windows are skipped.
- Exercise open/close, minimize/restore and manual move/resize. Stop leaves
  frames in place. Record app names, steps/time, log path and requested/readback
  size or gap discrepancies; Paint minimum-height overlap is already known.
