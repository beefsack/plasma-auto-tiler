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
   commit/push and hosted Windows/Linux CI.

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

- Phase 1 physically accepted LL hook/vkE8 on this PC; Phase 2 retains Engine
  and provides `TileLoop::reconcile_tick`/`apply_geometry` plus verified target
  revalidation. New action dispatcher belongs beside these in the owner loop.
- Win+L remains unproven; no lock/secure-desktop experiment in this slice.
- Windows 11 flyout/bar/Assist and shake coverage of the SPI master switch is
  unknown. Probe only the authorized ordinary apps/helpers and record limits.
- Known Phase 2 Paint minimum-height overlap remains outside this slice.

## Current outcome, 2026-10-02

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

## Blockers and failed approaches

- Focus: `SetForegroundWindow` refused despite an approved consumed focus
  chord and an accepted Engine candidate. `20261002-012901-16936` recorded
  focus-unverified; `20261002-015301-9276` explicitly recorded
  `setter_accepted=false`. The asynchronous-completion hypothesis was tested
  and ruled out for this refusal. Its speculative 5-second foreign-message
  wait was removed because it could starve the LL-hook message pump. No
  coupled input queues, Alt injection, ASFW cooperation or focus escalation
  were used. A native-focus mechanism decision or physical-input comparison
  is needed before further semantic attempts.
- Movement: `20261002-014658-35744` delivered a marked Win+Shift+Right stream
  but classified focus/right. One encoding correction from generic Shift to
  LSHIFT plus scan 0x2A produced the same result at
  `20261002-020153-27160`; both sent six accepted events. Do not replay these
  encodings without new evidence. Next investigation must distinguish actual
  callback modifier delivery from classifier state; portable mapping tests
  alone do not establish native routing.
- Fixture corrections: passive helpers are shown and admitted explicitly;
  exact-tag exposed-titlebar clicks replace background activation that lacked
  foreground rights; INPUT is 40 bytes on x64; inserted key releases are
  counted; existing Store Notepad replaces a false System32/Explorer-parent
  assumption. Mock assertions exercise negative cases, but did not catch all
  sender defects. Failed live runs retained receipts and exact-owner cleanup.

## Unexpected setting mutation and recovery

- Initial hardcoded 0x201E/0x201F targeted pen visualization, not arranging.
  The earlier reports `004351`/`004403` are invalid mouse-Snap evidence.
  Pen visualization changed from an initial worker-observed raw 35 to 1;
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

## Final gates and desktop state

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

## Current-tree dogfood and successor seams

```powershell
# Current working-tree build only; directional acceptance is blocked above.
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
- Dispatcher seam: `tiling_sys.rs::keyboard_tick`; chord table:
  `snapkey.rs::catalog_index`/`SnapClassify::push`. Retain the Engine and native
  identity fences for the next workspace slice.
- Workspaces still follow decisions.md: Meta+1..9 select existing workspace,
  Meta+Shift+1..9 send the focused tiled window, 0 selects/sends to trailing
  empty. Future hiding must commit identities before hide and use lifecycle
  independent restore; the Phase 1 helper hide/reveal path remains proven.
  Product recovery ledger currently carries the mouse setting, not geometry
  or product-workspace hides. Ordinary-app hiding requires identity-safe
  extension of the helper-only hide/reveal gate, not its removal.
- Exact next action: obtain direction on native-focus activation exploration
  versus physical-input discrimination; inspect callback modifier delivery
  without another blind Shift encoding retry. Complete live acceptance before
  committing/pushing the feature and advancing to Windows workspaces.
