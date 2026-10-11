# Windows shortcut slice

## Goal and acceptance

- Product `tile` uses the KDE catalog's Win+Arrow/HJKL focus and
  Win+Shift+Arrow/HJKL move actions through the retained portable Engine.
  Win+L focus remains explicit opt-in; no host lock-policy changes.
- Approved foreground managed-window chords only; bounded callback intent
  queue, owner-loop fresh observation and identity-checked native actuation.
- Keyboard takeover uses the accepted LL hook and vkE8 release mask, default
  on with visible CLI off. Mouse prevention uses session-only
  `SPI_SETWINARRANGING FALSE`, default on with visible CLI off, persisted exact
  preimage/readback and conditional restoration on stop or independent restore
  after crash. No registry/policy writes or settings persistence.
- Correlated bounded action lifecycle logs exclude raw input, titles and native
  identifiers. Portable regressions cover routing, pairing and restoration.
- Native standard gates, independent mutation/recovery review, bounded automated
  live focus/move and graceful/crash restoration evidence; physical keyboard
  acceptance and unautomatable Snap flyout/Assist checks explicitly pending.
- Stop leaves frames. No workspaces, visuals, minimum-size replanning or changes
  to principles. Proper Windows settings UI with Apply/Revert parity follows.

## Approach and bounded units

1. Source survey: accepted. KDE catalog is `planShortcutCatalog` in
   `kwin/src/plan-adapter-entry.ts`; focus/move use arrow and HJKL aliases.
2. Product hook, bounded intents and Engine focus/move dispatch with CLI off and
   opt-in flags; portable tests. Preserve proof allowlist and ownership gates.
3. Session-only mouse-Snap override, recovery-ledger integration and conditional
   independent restore with portable tests.
4. Fresh independent review of native mutation/public contracts; scoped live
   harness and automated verification, then material corrections if needed.
5. Current-tree standard gates, evidence/outcome and backlog update, delivery
   and hosted Windows/Linux CI.

## Verification contract

- Windows build/test and strict all-target clippy for tiler-core, tiler-protocol,
  tiler-kwin-effect-ffi and tiler-windows; fmt-all, PowerShell parse, recipe
  dry-runs and whitespace. Linux verification is hosted CI.
- Live receipts bind source/artifact hashes, process start/executable/session
  identities, display baseline, approved targets and observations. Exact-owner
  stop/emergency-stop/restore, setting preimage/readbacks and clean end state
  must be proven. Test-only injected input cannot change product filtering.
- Evidence distinguishes dispatch, Engine acceptance, native observed completion
  and uncertainty. API success alone is insufficient.

## Findings and pending checks

- Phase 1 physically accepted LL hook/vkE8 on this test system; Phase 2 retains Engine
  and provides `TileLoop::reconcile_tick`/`apply_geometry` plus verified target
  revalidation. New action dispatcher belongs beside these in the owner loop.
- Win+L remains unproven; no lock/secure-desktop experiment in this slice.
- Windows 11 flyout/bar/Assist and shake coverage of the SPI master switch is
  unknown. Probe only the authorized ordinary apps/helpers and record limits.
- Known Phase 2 Paint minimum-height overlap remains outside this slice.

## Completed outcome, 2026-10-02

- Shortcut slice passes automated acceptance. The retained Engine handles focus
  and move for the KDE arrow/HJKL catalog; keyboard takeover and session-only
  mouse prevention default on, with explicit CLI off switches. Physical input
  and Windows settings UI Apply/Revert parity remain follow-ups.
- Evidence directories are under `target/windows-shortcuts/`:
  - `20261002-040025-21256`: complete owned-helper journey, native focus-left/H
    and focus-down/J, move-up/Shift+K and move-right/Shift+Arrow with matched
    per-window geometry readbacks and retained mover focus, repeat, edge no-op,
    extra-modifier and unmanaged-origin pass-through, six clean menu-mask pairs,
    token-only production logs, graceful stop/restore and native Snap release.
    The release oracle uses real nonempty before/after rectangles.
  - `20261002-034536-14660`: graceful mouse-setting restoration, raw arranging
    1 -> 0 -> 1, persisted v2 original-TRUE claim.
  - `20261002-034546-6292`: forced exact-owner loss and independent restore,
    arranging 1 -> 0 -> 1 with recovery state removed only after readback.
  - `20261002-034556-32508`: normal-mode default-on/both-off smoke on the
    existing desktop containing Notepad, Calculator/AFH, Paint and Terminal;
    Notepad-targeted injected input consumed zero actions, settings restored,
    both-off installed no keyboard hook or mouse-setting claim. This is ordinary
    app/settings smoke, not physical directional-shortcut acceptance.
- Product artifact SHA-256 for these runs:
  `433CDD47D12D2172A2174389DF5058F56CA84C550F81DFC6F46DC92E469FF272`.
  Helper SHA-256:
  `605A53299583795B51C659DCB66AE7380AE1AAED18734E8A8BE9E1A3C66DD26E`.
  Receipts retain source revision/status, script hash, exact actor/target
  identities, OS/session, display bounds and native observations.
- Independent native mutation/public-contract review accepted the slice with
  no must-fix findings. Locked stable four-package build/test, strict all-target
  clippy, fmt-all, PowerShell parsing, Just dry-runs, proof mock and whitespace
  checks passed. Delivery and hosted Windows/Linux CI are recorded in Git.
- End readbacks: arranging raw 1, pen visualization raw 35; zero project actors,
  no ledger.json or stop.request; Notepad, Calculator/AFH, Paint and Terminal
  remain open and unmaximized. Firefox was untouched. No hook remains.
- Independent post-gate process/window reads include Terminal separately from
  the harness's three-app snapshot: all four original process instances have
  windows, none minimized or maximized. The final harness receipt-only repair
  labels every SendInput chord synthetic (including unmarked input) and keeps
  enhanced-arrow encoding on partial-insertion cleanup. Earlier receipt fields
  `synthetic:false` meant unmarked injection, never physical keyboard input;
  old receipts are retained unchanged. Final offline gates passed after these
  repairs; the passing live path is unchanged.

## Previous outcome before correction

- Slice is incomplete. Implementation and proof tooling remain in the working
  tree; no feature delivery or physical-input acceptance is claimed. Records
  can be committed independently. Keep this note active until the blockers
  below are resolved and the complete slice passes live verification.
- Implemented: `snapkey.rs` catalog/classifier, origin-bound bounded intents,
  LL/vkE8 product hook, fresh retained-Engine focus/move dispatch beside
  `TileLoop::reconcile_tick`, token/correlation logs, retryable hook setup,
  visible CLI settings and dedicated frozen-helper `shortcut-proof` command.
  Product filters all injected input; only the separate proof command accepts
  the fixed proof marker. Win+L remains default-off and was never sent live.
- Mouse prevention uses SDK-named `SPI_GETWINARRANGING`/`SPI_SETWINARRANGING`
  (0x0082/0x0083), session-only flags, durable write-before-effect preimage and
  conditional restore. New ledgers write v2; the new reader accepts v1 only
  without setting work, while old readers refuse v2 without deleting recovery.
  Verified restoration relinquishes the claim before subsequent recapture.
- Corrected mouse-Snap setting restoration passed graceful stop at
  `target/windows-shortcuts/20261002-010140-26000` and forced owner loss plus
  independent restore at `20261002-010150-14640`: original TRUE, live FALSE
  with v2 owned preimage, final TRUE. These runs used owner SHA-256
  `D792D065A87FC7BCEA5F18C9029CDBAB318B88C30343B8181DC8A81349100814`.
  Subsequent changes affected focus diagnostics and proof tooling.
- Normal product smoke passed `20261002-012933-30752`: default-on hook and
  prevention; injected Ctrl+Win+H produced zero consumed actions; both-off
  flags installed no hook, recorded no mouse preimage and preserved TRUE.
  Existing Store Notepad remained open. This is plumbing/settings evidence,
  not successful product directional-focus/move evidence.
- Surface probe `20261002-021721-20968`: guarded maximize hover and unmarked
  Win+Z were delivered to an exact helper while SPI was FALSE, with zero
  consumed Win+Z actions. Enumeration found a helper tooltip, no identified
  shell flyout; that absence is not a reliable visual/suppression oracle.
  Edge-drag comparison was skipped after the helper-occlusion fixture failed.
  Snap Layouts/bar/Assist/shake and physical keyboard checks remain pending.

## Resolved blockers and failed approaches

- Successor focus evidence, 2026-10-02: owner-injected unassigned E8 prime
  changed setter refusal to TRUE, but alone did not immediately transfer
  foreground (`20261002-023828-19876`). First attach attempt
  (`20261002-024139-32880`) used the process-ID out parameter instead of the
  thread-ID return from `GetWindowThreadProcessId`; this was a mechanical API
  defect, not evidence of OS coupling refusal. Corrected owner-to-foreground
  thread attachment plus E8 prime passed exact immediate foreground readback
  for focus-left/H and focus-down/J in `20261002-024604-32652`, preserving all
  helper geometry. The run then reached the unchanged move/Shift blocker.
  All three runs recovered exact owners and setting preimage. No Alt, ASFW,
  registry or policy changes. Focus unit native tests/clippy passed; independent
  activation/recovery review and full current-tree verification subsequently
  passed as recorded above.
- Modifier evidence: bounded proof-only sender and callback diagnostics at
  `20261002-025846-28288`, `20261002-031939-30908` and
  `20261002-032404-27880` found Shift-up scan 554 (`0x22A`) between sent
  Shift-down and Right-down. An initial external-hook attribution was not
  established and was withdrawn: AHK's study-only notes identify that exact
  scan as Windows-generated fake Shift for numpad navigation. The harness
  omitted `KEYEVENTF_EXTENDEDKEY` on arrows. Correct enhanced-arrow scan/flags
  eliminated the fake traffic at `20261002-033107-14636`; focus H/J and
  move-right then passed native readback. The remaining run failure is a fixture
  ordering defect: move-right creates three full-height columns with no up
  candidate for the next row. The final journey runs move-up before move-right.
  Product filtering/ownership gates were not relaxed; no foreign actors were
  changed and no GPL code was copied. Independent native/public-contract review
  accepted the slice with no must-fix findings; full live gates then passed.
- Further causal fixture repairs: `20261002-033854-5228` exposed a back-to-back
  titlebar double-click that maximized a helper; spacing the edge-source click
  fixed it in `20261002-034149-33080`. That run exposed an unmanaged helper
  occluded under tiles. A verified no-activation z-raise returned TRUE but did
  not raise (`20261002-035017-12844`); the final exact-helper activation uses
  E8 prime/thread attach when activating raise is lock-refused, with identity,
  geometry, foreground and point-occlusion readbacks. `20261002-035549-5948`
  completed the journey but exposed an undefined release-before variable;
  correcting it and rejecting empty rectangles produced the final pass above.
  Product routing and ownership gates were never weakened for these fixtures.

- Focus: `SetForegroundWindow` refused despite an approved consumed focus
  chord and an accepted Engine candidate. `20261002-012901-16936` recorded
  focus-unverified; `20261002-015301-9276` explicitly recorded
  `setter_accepted=false`. The asynchronous-completion hypothesis was tested
  and ruled out for this refusal. Its speculative 5-second foreign-message
  wait was removed because it could starve the LL-hook message pump. No
  coupled input queues, Alt injection, ASFW cooperation or focus escalation
  were used in those earlier runs. The successor mechanism and native proof
  above supersede that blocker.
- Movement: `20261002-014658-35744` delivered a marked Win+Shift+Right stream
  but classified focus/right. One encoding correction from generic Shift to
  LSHIFT plus scan 0x2A produced the same result at
  `20261002-020153-27160`; both sent six accepted events. Do not replay these
  encodings without new evidence. The callback/sender diagnostics and enhanced
  arrow correction above resolved native routing; portable tests alone had
  not established it.
- Fixture corrections: passive helpers are shown and admitted explicitly;
  exact-tag exposed-titlebar clicks replace background activation that lacked
  foreground rights; INPUT is 40 bytes on x64; inserted key releases are
  counted; existing Store Notepad replaces a false System32/Explorer-parent
  assumption. Mock assertions exercise negative cases, but did not catch all
  sender defects. Failed live runs retained receipts and exact-owner cleanup.

## Unexpected setting mutation and recovery

- Initial hardcoded 0x201E/0x201F targeted pen visualization, not arranging.
  The earlier reports `004351`/`004403` are invalid mouse-Snap evidence.
  Pen visualization changed from an initial observed raw 35 to 1;
  those initial JSON receipts coerced the value to boolean and did not retain
  the raw preimage. Recovery `20261002-004839-35820-pen-recovery` restored raw
  35 with three stable readbacks. The documented pointer-style pen SET yielded
  an address-valued readback; value-direct SET restored 35. No persistent flags
  were used. SDK named arranging constants and a native regression now prevent
  the target mix-up.
- First correctly targeted arranging run `20261002-005705-18448` disabled
  successfully, but documented pvParam-style TRUE restoration read back FALSE
  and retained the ledger. A bounded probe established that this Win11 build
  requires TRUE in uiParam with NULL pvParam. The setter was corrected, TRUE
  restored and the dead-owner ledger cleaned before the two passing repeats.
  This is observed adapter behavior on build 26200, not an API-success claim.

## Previous gates and desktop state

- Current-tree locked stable four-package build/test, strict all-target clippy,
  fmt-all, pwsh-7 parsing of four scripts, Just evaluation, proof mock and
  whitespace checks passed. Hosted CI on a records-only commit cannot validate
  the uncommitted implementation; Linux implementation CI remains pending.
- Current artifact SHA-256:
  `648C86964DCCE185A978CEB67F800B60F80E4193E576DB664601EF5C3BE455EA`, matching
  the surface-probe artifact. Final ignored native verification receipt is
  `docs/changes/windows-shortcut-slice/results/final-verification-20261002.json`.
- Independent final reads: arranging raw 1, pen raw 35; no project actors,
  ledger.json or stop.request. Notepad, Calculator/AFH, Paint and Terminal
  visible, unminimized and unmaximized; foreground Notepad. Firefox was not
  touched. No hook or altered live setting remains.

## Dogfood and successor seams

```powershell
# Build and start the default-on shortcut preview.
just --justfile windows.justfile tile --user-start --trace
just --justfile windows.justfile tile --user-start --trace --no-keyboard-snap-takeover --no-mouse-snap-prevention
just --justfile windows.justfile tile-stop
& "target/windows-dev/tiler-windows.exe" emergency-stop
& "target/windows-dev/tiler-windows.exe" restore
```

- Flags default to keyboard and mouse takeover on. `--allow-win-l` is explicit
  opt-in, unproven, and not part of this verification. Proper settings UI with
  Apply/Revert parity remains a follow-up. Report commands/settings, app names,
  steps/time, printed log_path, focus refusal or move/focus misrouting, native
  Snap/Start behavior, and stop/restore result. Physical evidence must be labeled
  separately from marked injection.
- Dogfood: with ordinary unmaximized Notepad/Calculator/Paint windows, use
  Win+arrows and Win+H/J/K for focus, Win+Shift+arrows/HJKL for move; confirm
  activation/raise, mover focus retention and edge no-ops. Repeat with both off
  switches to check native Snap, then stop and check settings restoration.
  Physical Win down/up, repeats, Start leakage and Snap Layouts/bar/Assist/shake
  remain pending; do not infer them from automated input. Win+L is excluded.
- Dispatcher seam: `tiling_sys.rs::keyboard_tick`; chord table:
  `snapkey.rs::catalog_index`/`SnapClassify::push`. Retain the Engine and native
  identity fences for the next workspace slice.
- Activation seam: `tiling_sys.rs::actuate_focus` freshly revalidates the
  target while holding its process, primes last-input rights with unassigned
  E8, attaches the owner thread to the current foreground thread (TID is the
  return value, not the PID out parameter), calls SetForegroundWindow once,
  detaches immediately and accepts only exact native foreground readback. A
  bounded own-queue pumped settle keeps the LL callback available on a miss.
  No Alt, ASFW cooperation or policy changes. Product rejects all injected
  input; only frozen-helper `shortcut-proof` accepts the exact proof marker.
- Workspaces still follow decisions.md: Meta+1..9 select existing workspace,
  Meta+Shift+1..9 send the focused tiled window, 0 selects/sends to trailing
  empty. Future hiding must commit identities before hide and use lifecycle
  independent restore; the Phase 1 helper hide/reveal path remains proven.
  Product recovery ledger currently carries the mouse setting, not geometry
  or product-workspace hides. Ordinary-app hiding requires identity-safe
  extension of the helper-only hide/reveal gate, not its removal.
- Exact next action: scope the Windows workspace slice around the retained
  Engine and an identity-safe write-before-hide recovery-ledger extension,
  implementing the existing digit select/send/trailing-empty contract.
