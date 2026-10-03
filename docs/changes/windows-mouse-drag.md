# Windows Mouse Drag And Drop Preview

## Goal And Scope

- Deliver Windows parity item 7 (title-bar and KDE-supported Win+left mouse
  movement) as an accepted, committed unit before item 8 (drop-zone preview).
- Shared Engine drop geometry is authoritative. Same-output only; cross-output
  placement belongs to item 9. Native Snap takeover must not compete with drop.
- Reassess underlay stage C with the movement producer; deliver only if simple
  and without substituting an unfocused subject into retained Engine focus.
- Preserve owner/window identity gates, bounded redacted lifecycle diagnostics,
  cancellation and independent recovery. No dependency or registry changes.

## Acceptance

- Title-bar and supported Win+drag reorganise tiled layout only on completed
  movement. Floating/native resize paths retain their existing semantics.
- Esc, zero movement, self/unsupported/outside drop retain source topology and
  restore tiled geometry. Shared resolver handles nested/window/group zones.
- Preview is a separate nonactivating click-through filled surface above
  windows, default KDE blue at alpha 64; same resolver/hints/sticky hover prior
  feed preview and final drop. Clear on cancellation, invalidation and teardown.
- Locked four-package Windows build/test, strict all-target Clippy, rustfmt,
  whitespace checks; hosted CI green, including KDE if shared code changes.
- Bounded SendInput proof with approved Notepad/Calculator/Paint, readbacks and
  screenshots. Physical input/feel remains user-owned.
- Live end state: no project actor, overlay, recovery ledger or hidden-window
  residue; arranging 1 and pen visualization 35; close only test apps opened.

## Units And Dependencies

1. Orchestrator split decision: deliver item 7 title-bar slice first, with
   identity-specific live assertions and a minimum-feasible fixture; discard
   the unaccepted native-loop Win producer explicitly. Accept, commit/push/CI.
2. One bounded project-driven Win+left movement investigation, never retrying
   SC_MOVE/non-client entry. Deliver a separate accepted unit if simple/correct;
   otherwise discard unaccepted code and park with evidence/options.
3. Item 8 preview on accepted producers; review, native/live acceptance,
   commit/push/CI as its own unit. Underlay C stays parked unless trivial.
4. Promote provisional decisions and matrix evidence, archive record, clean tree.

- Reopened 2026-10-04 by Orchestrator authorization. Prior blocker/evidence below
  is historical; new acceptance is measured separately after the split.

## Current Evidence And Decisions

- KDE `plan-adapter.ts::requestDragDrop` binds the gesture mover and Finish
  pointer; cancelled/no-change oracle verdicts make no plan.
- `tiler-core` drag preview/drop share `resolve_drag_shared`; centre-stack
  targets refuse, group-edge hover uses exact 32px/80px sticky prior.
- Existing Windows WinEvent move-size lifecycle and layered border/underlay
  carrier are reuse points. Win+drag has no current mouse producer.
- Underlay C remains parked: a distinct unfocused dragged subject still needs
  a subject-query path and invalidation lifetime; do not persist it as Engine
  focus. Win movement is not operational, so its focus/underlay lifetime cannot
  yet justify the additional machinery or a C acceptance claim.
- Unsupported reference-WM outcomes remain TBD; new behavioral choices require
  a shortest distinguishing row in `docs/spec/reference-outcomes.md`.

## Review And Verification Status

- Initial implementation failed review: app click passthrough, late identity
  checks, settle-time pointer capture and a vacuous one-app proof oracle.
  Corrected to a bounded queued producer, owner-side identity/lifetime gates,
  intercepted initiating click, Finish-callback pointer and sequence-bound
  cancellation. Native four-package gates and mock contracts pass.
- First live run `target/windows-mouse-drag/20261004-035435-28864` stopped
  before a gesture: Store Notepad reused a pre-existing process, invalidating
  the fixture's PID-delta assumption. Owner stopped/restored; actor count 0,
  no ledger/request residue, arranging 1 and pen 35. No live behavior accepted.
- Revised fixture may borrow an existing exactly identified approved app for
  movement and preserve it at cleanup; newly opened app windows remain owned
  disposable resources. This does not change product admission or behavior.

## Previous Blocker And Ownership Transfer (Superseded By Split)

- Item 7 is not accepted. Item 8 was not started, preserving the requested
  delivery order. No implementation commit, push or hosted CI run was made;
  the unaccepted diff is preserved for the Orchestrator's architecture decision.
- Two semantic approaches to Win+drag initiation failed: posted
  `WM_SYSCOMMAND(SC_MOVE|HTCAPTION)` and sent/posted non-client move messages.
  The product path passed owner/window gates and posted successfully but
  produced no move-size events and no displacement. Stop rather than retry.
- Lead audited the probe evidence: the background jobs in temporary probes
  12/13 passed invalid x64 SendInput size 28 and ignored insertion counts.
  Their stirring/release results are excluded. Other probes also omitted some
  insertion assertions; do not claim an exhaustive eight-variant API proof or
  a general Windows inability to enter move loops. The asserted product-flow
  failure remains the blocker; `SC_MINIMIZE` delivery control worked separately.
- Simplest prospective completed slice is title-bar-only movement after its
  remaining cancellation/restore gates pass. Descoping Win+drag needs an explicit
  parity decision. Otherwise select a bounded new movement-producer investigation
  before continuing; adapter-driven movement would change the current approach.

## Partial Evidence And Final Gates

- On Windows 11 build 26200, one 2560x1440 output, DPI 120, three app families
  yielded six eligible HWNDs (four pre-existing Notepad windows plus Calculator
  and Paint). Caption drops applied in run directories
  `target/windows-mouse-drag/20261004-042436-17816`,
  `20261004-042929-29208`, and `20261004-043420-25304`.
- Lead inspected the latest log
  `%LOCALAPPDATA%/plasma-auto-tiler/session-1/run-01dd535d6d11b0fe.log`:
  native title drop tick 8 has five writes, six matching native readbacks,
  `drag-drop-applied`, and focused-move underlay show/hide. Later
  `win-drag-initiate`/`win-drag-gate` report `posted` but no Win gesture occurs.
  Latest before/after PNGs and `machine.json` remain in the run directory.
- These are partial evidence, not item acceptance. No full run completed and
  no `report.json` was written. Cancel/zero/self/centre/outside, stale-window
  stress, Win modifier focus/underlay, physical mask/input and crash-during-drag
  acceptance remain open. The harness uses a frame multiset oracle; strengthen
  per-window desired identity matching before claiming complete placement proof.
- Six-window minimum-infeasible layout puts Calculator/Paint below the work
  area; this matches the existing minimum-clamp policy and is not repaired here.
  Use a feasible fixture when measuring precise preview/drop geometry later.
- Final Lead gates: installed native Cargo (mise unavailable), locked
  four-package build/test, strict all-target Clippy, rustfmt and whitespace
  checks all pass. `scripts/windows-mouse-drag.ps1 -Mock` passes ABI40 and
  positive/negative frame-parser contracts. No shared/KDE source was changed.
- Latest owner copy and final debug binary SHA-256 both:
  `5E781254184A42A1575E938FE8201BABDB40C3122899E35D15D22987CD3B2B85`.
- Final independent read-only audit: project actors 0, border/underlay HWNDs 0,
  ledger/stop/workspace request absent, arranging 1, pen visualization 35,
  taskbar visible. Borrowed apps were preserved and baseline geometry restored;
  created Calculator HWNDs were closed. Hosting Terminal tree was preserved.
- No Worker is running. Tree is intentionally dirty with the blocked source,
  tests, harness, matrix and this archived outcome; no clean-tree claim.

## Previous Handover (Superseded By Split)

- Provisional product decisions: none promoted. KDE parity remains selected;
  the blocked native mechanism is not a supported product contract.
- Matrix rows R-DRAG-03..06 distinguish producers, Esc, zero movement and
  outside-work-area release; unsupported/unexecuted Windows outcomes remain TBD.
- User-owned physical checks after implementation: title/client drag feel,
  click suppression, fast Esc, both Win keys/Start suppression, custom frames,
  Snap bar/Assist/shake, unfocused subject and topmost/DPI appearance.
- Proposed backlog text: "Windows parity (7) blocked on Win+drag producer;
  caption-drop partial evidence only, cancellation gates pending. (8) pending
  acceptance of (7). Underlay C remains parked with (7)."
- Exact next action: Orchestrator chooses a bounded replacement-producer
  investigation or explicitly authorizes a title-bar-only parity slice; preserve
  this diff and evidence and do not repeat the failed native-entry approaches.

## Item 7 Title-Bar Slice - Accepted

- The unaccepted native-loop Win producer, its Start-mask additions and dormant
  harness stage were explicitly discarded. No SC_MOVE/non-client initiation,
  mouse hook, parked producer stub or corresponding test file is shipped.
- Native move holds sibling reconciliation, captures Finish pointer and Esc
  sequence at the END callback, checks START/END member identity/lifetime,
  then dispatches the shared Engine drop once. Same-output fence precedes
  planning. Cancel/no-change/self/centre/outside converge to retained geometry.
- Independent review resolved END-bound Esc (post-END Esc must not cancel),
  cleanup errors falsely permitting success, and dead unaccepted harness code.
  Deterministic sequence coverage distinguishes during-gesture from later Esc.
- Live fixture: one exactly bound Notepad, Calculator and Paint; approved extra
  Notepad HWNDs minimised before owner admission and restored after stop.
  Token/native-HWND bijection and declared minima verify feasible placement;
  per-window pre/post checks reject wrong-subject restoration.
- Accepted latest report:
  `target/windows-mouse-drag/20261004-054615-32808/report.json`.
  All six rows pass: TitleDrop applied/native; injected Esc cancelled natively
  with no-change and exact source restore; zero press/release with no gesture or
  structural mutation; self and other-centre refused/restored; taskbar-outside
  refused/restored. Two mid-hold samples prove both siblings fixed before drop;
  Finish stability, screenshots, stop/restore and exact borrowed-state readbacks
  pass. Owner SHA-256:
  `A136B47AEE3936DF3EF9CEF7B145D91C70A751951CE26DB0E429C988BF5F5925`.
- Earlier sibling-freeze fixture attempts twice misread a numeric-key snapshot
  table. One Lead causal fixture repair used identity/frame records instead;
  the same oracle passed, without product changes. Prior silent borrowed-restore
  mismatch was repaired and readback failure now fails the final verdict after
  all cleanup legs execute. These are not accepted product-success observations.
- Final four-package locked native build/test and strict all-target Clippy,
  rustfmt, whitespace and mock contracts pass. Hosted CI follows the accepted
  commit. Physical Esc delivery, resize regression feel and custom frames remain
  user checks; injected evidence makes no physical-hook claim.
- End-state audits: zero actors/overlays, ledger/requests absent, arranging1,
  pen35, taskbar visible, six borrowed HWNDs restored and hosting Terminal intact.
- Provisional, to discuss: Windows item 7 ships title-bar drag first; Win+drag
  follows. Next bounded unit investigates project-driven movement only.
- Title slice delivered as `1b9bf7b`; hosted CI 37145619279 passed all five
  jobs (Windows, Rust, KWin, shell, macOS) before the next implementation unit.

## Project-Driven Win Producer - Selected Investigation

- Bounded read-only investigation recommends a stationary tiled mover: consume
  Win+left initiation, track pointer in a prompt low-level mouse hook, and use
  the same Engine drop path once on release. Item 8 later supplies the ghost
  preview. No native move loop or mid-gesture foreign-frame writes are needed.
- The new producer must preserve mover identity/focus semantics, bind a complete
  eligible tiled observation, cancel on Esc/zero/invalidation/outside, and retain
  title-bar/native resize behavior. Stage C stays parked. Do not restrict the
  gesture to a pre-focused subject merely to avoid the existing activation gates.
- This is the one project-driven mechanism investigation selected by the
  Orchestrator. If it fails the simplicity or acceptance checkpoint, discard
  its unaccepted code explicitly and continue preview on the accepted title path.

## Item 7 Project-Driven Win Slice - Accepted

- The bounded stationary producer is operational: one prompt WH_MOUSE_LL arm,
  coalesced pointer, bounded Down/Up/Cancel queue, shared owner gesture hold and
  Engine release. No native-loop entry or mid-hold foreign-frame writes.
- Independent review covered live input/lifecycle. Lead additionally tightened
  callback-bound full origin/member-tag identity, guaranteed terminal delivery
  on saturation, swallowed Up pairing after cancellation/suspension, synthetic
  mask-state isolation and both-Win terminal release. Deterministic regressions
  cover same-process HWND reuse and those input-lifetime cases.
- Focused Win movement feeds the existing known-Move underlay A/B arm; native
  underlay readback proves projected source geometry during the stationary hold.
  Unfocused subject retains native foreground during hold and activates through
  existing focus authority only on a valid drop. C stays parked.
- Latest accepted complete report:
  `target/windows-mouse-drag/20261004-070437-21516/report.json` (WinAll).
  Title six rows, WinDrop, unfocused WinFocus, WinCancel, WinZero, WinSelf,
  WinCentre, WinOutside and caption regression pass; fixed token/native-HWND
  mapping and mover plus sibling mid-hold freeze, complete desired readbacks,
  no-overconstrained gates, Finish stability and underlay readback pass.
  Owner SHA-256:
  `6BC6C81C0BA1D2CDDD8EAFDF42212A6EBE0605B80F7D8B624618C0CA541DC45C`.
- Synthetic mouse is admitted like native caption proof; injected Esc supplies
  a pass-through cancellation edge for project gestures, never a command.
  Injected Win remains command-filtered and cannot arm the product Start mask;
  synthetic Start dismissal is recorded separately from physical mask behavior.
- During correction a duplicate hook arm invocation consumed no Down and failed
  underlay proof twice; hook-side arm/consume counts located the defect, and one
  causal removal restored the original intended contract. Fixture feed-mark and
  reused target-zone failures were repaired; no SC_MOVE experiment was repeated.
  Bounded recovery released two synthetic held-button leftovers and verified
  async release. Latest full run is clean, with no repeated failed mechanism.
- Four-package native locked build/test, strict all-target Clippy, rustfmt,
  whitespace and mock contracts pass. Latest live cleanup proves actors/overlays
  zero, no ledger/requests, arranging1/pen35 and exact borrowed restoration.
- Physical feel/Start mask, custom frames, floating/sticky modifier passthrough
  and resize feel remain user-owned checks. Item 8 preview is next.
