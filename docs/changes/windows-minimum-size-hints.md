# Windows application-declared minimum sizes

Status: active, feasible geometry and infeasible no-fighting verified; real
workspace-send acceptance pending, 2026-10-02. Baseline: clean `a442c38`.

## Goal and decision

- Supply fresh Windows application-declared minimum sizes to the existing
  minimum-aware shared Engine projection (user option A, 2026-10-02).
- Convert outer minimum track dimensions into visible physical-pixel dimensions
  using current measured frame insets. Timeout, failure or invalid data means
  unknown, with no hint.
- Keep KDE's infeasible behavior: proportional allocation, overconstrained
  leaves, skipped writes, possible overlap. Keep refused-attempt suppression.
- Generic learned limits remain parked. No persistent/app-wide floors, hint
  inheritance on HWND reuse, or changes to KDE policy.

## Approach and acceptance

- Query `WM_GETMINMAXINFO` with correctly initialized Rust `MINMAXINFO`,
  `SendMessageTimeoutW`, `SMTO_ABORTIFHUNG`, and a short bounded timeout.
  Bound owner-loop cost and avoid querying unrelated windows.
- Carry `WindowSizeHints` through reconcile, admission, directional actions,
  and workspace send/select observations. Hint-only changes reproject.
- Bounded correlated query/change/projection/overconstraint summaries; geometry
  detail only in trace. Portable conversion/normalization/unknown tests.
- Scoped live Paint/Notepad journey: width and height neighbour redistribution,
  feasible nonoverlap, send hint preservation, infeasible no-fighting, measured
  query/action latency. Calculator only with clean identity.
- End-state readbacks and standard native gates; independent mutation review.

## Bounded units

1. Implementation and focused offline evidence.
2. Fresh independent review of integration, observation coverage and bounds.
3. Fresh live verification Worker, scoped by chat authorization and the live
   Windows guide; one mechanical harness repair/retry if needed.
4. Records/evidence validation; Lead promotes decisions, archives this note,
   advances backlog and stages explicit paths without committing.

## Known evidence

- Earlier Paint query: outer minimum 880x625, visible 864x617. Paint held
  2032x617 against 2032x543, producing 66px overlap. Notepad outer 415x253,
  visible 401x246. Source:
  `C:\Users\beefs\AppData\Local\Temp\opencode\minprobe3-20261002-142326\probe.jsonl`.
- Probe default initialization was broken by PowerShell struct-copy semantics;
  do not carry that defect into Rust. Current inset conversion lives in
  `crates/tiler-windows/src/tiling.rs`.

## Outcome

- Implementation covers fresh visible and verified hidden-destination hints,
  Rust-seeded DPI-aware native defaults, and all Engine-building paths.
  Queries wait at most 10ms each, clamped to a shared 40ms operation deadline
  (two fifths of the 100ms poll interval). Native identity/frame calls and
  scheduling are not hard realtime. No persistent hint cache.
- Independent review identified hidden-destination omission, per-domain log
  pruning, missing action correlation, and a soft query deadline. Corrected
  coverage and log joins; Lead clamped remaining wait and removed dead
  same-operation caching/timing fields after Worker dispatch overloads.
- Current native four-package build/test/strict clippy, all-package fmt and
  whitespace gates pass. Lead's first budget-constant build hit a u32/u64
  mismatch; the direct cast repair restored the gates. No KDE/core source
  changes. Current-artifact live evidence is below; send remains pending.
- Gate transcript:
  `C:\Users\beefs\.local\share\opencode\tool-output\tool_0fb2522fd001uQtBi2PMJ7Ut4j`.
- Initial live Worker dispatch failed three times before starting, each with
  backend temporarily overloaded; no desktop experiment ran in that session.
  Subsequent Workers ran successfully; send acceptance remains pending.
- Read-only end check, 2026-10-02 16:25:47 +10:00: zero project processes,
  enumerated Notepad/Paint/ApplicationFrameWindow windows visible; arranging
  raw 1, pen raw 35. Session directory has no ledger JSON, stop request or
  workspace request (the existing lock file and historical logs remain).
  The initial read-only helper used an unmarshallable generic callback; one
  explicit native delegate correction restored the readback without mutation.

## Current-artifact live evidence

- Artifact SHA-256:
  `2E5893E58F6CA4C958C41108F8E705749F9F8F7F6F6FA147E9753DEC6C00BC7F`.
  Rebuilt binary and run copies match; no production or repo harness changes
  were required. Independent evidence/cleanup review completed.
- Feasible run:
  `target/windows-minhints-smallset/20261002-165736-8732/acceptance-summary.json`.
  Physical visible `(x,y,width,height)` readbacks matched the plan: Paint
  `(1688,755,864,617)`, Notepad `(1688,8,864,739)` and Notepad
  `(8,8,1672,1364)`. Both gaps are 8px, with zero overlap/mismatch or
  overconstrained leaves. The source-backed no-hint projection would give
  Paint 647x520; hints redistribute 217px in width and 97px in height.
  Two initial writes, no subsequent writes across 78 geometry summaries.
- The feasible fixture temporarily excluded surplus Notepads by minimizing
  them and excluded Calculator by executable scope. Three observed/admitted
  windows were confirmed in Engine diagnostics. Fresh spatial fitting needed
  a managed foreground anchor; two earlier equal-split fixture runs did not
  exercise minimum forcing. Three temporary-script setup errors were corrected
  before that script ran. A teardown rectangle mismatch was corrected and
  all original approved window baselines reverified.
- Infeasible run:
  `target/windows-workspace-normal/20261002-163234-26296/workspace-normal-report.json`.
  Thirteen approved app windows produced proportional overconstrained plans
  (10 affected leaves initially). Each of the two owner runs wrote once at
  tick 1, then no more writes across 29 and 7 geometry summaries respectively;
  overlapping held frames remain expected. This first fixture could not prove
  feasible redistribution, so the small-set fixture supplied that evidence.
- Small-set select completion: hide 120/103/107ms, reveal 122/128/129ms;
  earlier select baseline 72-124ms. The new range extends 5ms above the old
  maximum; these runs do not isolate query overhead from actuation variance.
  Summed `query_ms` per correlation was 0ms across 78 operation groups at
  whole-millisecond resolution. Thirteen-window selects were 396-443ms,
  dominated by hide/reveal; per-operation query sums peaked at 4ms and 6ms
  in the two separate logs. Successful fast queries do not prove hung-query
  behavior or hard-realtime bounds. Correlations are owner-run-local.
- Raw logs under `%LOCALAPPDATA%/plasma-auto-tiler/session-1/`:
  feasible `run-01dd523b4ed69001.log`; infeasible
  `run-01dd5237d06639d2.log` and `run-01dd5237daa21e61.log`.
- Read-only independent end check: zero project actors, clean ledger/request
  state, arranging raw 1 and pen raw 35, approved windows visible and
  unminimized. Small-set baseline restoration passed for all 13 app windows.
  Two Calculator hosts retain geometry written by the first normal-mode run
  (physical visible `(1284,694,630,678)`); stop/recovery restores show-state,
  not pre-tiling geometry. No extra app instances were opened.
- Workspace select/reveal is verified, including hidden-target observations.
  Workspace **send is not verified** by either live harness. The normal CLI
  exposes select only; normal mode rejects injected chords, and workspace-proof
  requires tagged owned helpers. Do not substitute select evidence for send
  or expand those contracts solely to complete this acceptance.

## Succession

- Next action: user-owned physical workspace send into a populated hidden
  destination on the same staged artifact, with correlated minimum hints and
  source/target geometry readbacks. Then archive and complete the backlog item.
- Outstanding evidence risks: send-specific hidden DWM measurements and
  slow/hung query unknown behavior under load. Linux gates remain pending;
  no shared core/KWin source changed. No product defect was found in these runs.
- Windows active border remains the following product item; use existing
  `tiler_core::visual` policy and current visible-frame physical-pixel geometry.
  Native rendering/stacking and suppression need their own scoped evidence.
