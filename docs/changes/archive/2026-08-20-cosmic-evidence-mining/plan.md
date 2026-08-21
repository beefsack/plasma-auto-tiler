# Plan: COSMIC Evidence Mining (Research)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-20 by Orchestrator (spec approved by user)

Semantic sections - Technical Approach, Work Units, Pending User Decisions -
need Orchestrator approval before each edit. Record-keeping sections -
Progress, Attempt Accounting, Acceptance-Criterion Evidence, Residual Risks,
Final Outcome - are Lead-owned and edited directly.

## Technical Approach

Five work units across four independent streams. `unit-A`, `unit-B`,
`unit-C1`, and `unit-D` have no cross-dependency; `unit-C2` depends on
`unit-C1`'s timeline. Dispatched serially in the order below.

Every screenshot/video-touching Worker holds its own evidence (corpus
ownership) and returns a curated summary plus a written doc edit; it never
returns raw pixel dumps, full frame sets, or transcripts to the Lead.

- **Streams A and C1** use pure programmatic pixel analysis: `ffmpeg` crops a
  strip or converts to raw/PPM, `python3` stdlib parses the bytes and finds
  colour-run boundaries (edges) to compute gap widths, border thickness, and
  window bounding boxes. No image-reading tool call touches a screenshot or
  frame in these two units - the Worker only ever sees numbers.
- **Stream B** is genuine visual reading: 2 tray screenshots, read directly,
  described in full menu-structure detail.
- **Stream C2** is genuine visual reading of a *curated, capped* frame set:
  `unit-C1` narrows 3555 frames to a shortlist of distinct-state timestamps
  via scene-change detection; the interpretive pass reads at most 40 of those
  frames, downscaled and cropped, prioritised toward no-op moves, 3+-window
  states, screen-edge moves, and orientation changes. **The 40-frame cap is a
  whole-change cap, not a per-Worker cap (Orchestrator amendment, this
  session).** Forty downscaled frames is roughly 50k tokens of image alone,
  too close to one Worker's 150k ceiling. If `unit-C1`'s shortlist exceeds
  about 20 frames, the interpretive pass splits into sequential Workers -
  `unit-C2a`, `unit-C2b`, ... - each bounded to a disjoint slice of the
  shortlist, each writing its findings to the shared research file and
  returning only a curated summary; the next sub-unit's brief states what the
  prior one already found so it isn't rediscovered. The Lead decides the
  split points from `unit-C1`'s shortlist size before the first C2 dispatch.
  The running total across all C2 sub-units still may not exceed 40 frames.
- **Stream D** is Lead-direct (forfeit): the Lead already loaded
  `docs/backlog.md` while scoping this change and can state the exact one-line
  edit; dispatching a Worker for it would reload material the Lead already
  holds.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification (static or live) |
|---|---|---|---|---|
| unit-A | Programmatic pixel measurement of the 10 layout screenshots (`~/Pictures/Screenshots/Screenshot_2026-08-20_12-30-58.png` through `_12-33-06.png` inclusive, `_12-30-31.png` excluded) for: inter-window gap, border-to-window gap, screen-edge gap, panel gap, active border thickness, inactive border thickness, active/inactive border colour, corner treatment, and cross-shot consistency. Write findings into a new COSMIC-observed subsection of section 9 of `docs/reference-wm-comparison.md`, using the `observed`/`[C-OBS-*]` tier defined in the spec, and note explicitly that COSMIC's corner rounding is not adoptable here. | - | 10 screenshots (read-only, byte-level, 0 image-tool reads); `docs/reference-wm-comparison.md` (edit) | Lead re-derives at least 2 reported numbers from the Worker's saved script/intermediate output (not images) and confirms they match |
| unit-B | Read the 2 tray screenshots (`Screenshot_2026-08-20_12-46-44.png`, `_12-46-57.png`) directly. Document icon appearance and full menu structure - every item, label, order, grouping, separators, state indicators/checkmarks, submenus, shortcut hints - at a fidelity a later change can reproduce closely. Write into new `docs/reference-cosmic-tray-menu.md`. | - | 2 screenshots (read via image tool, budget: 2); new `docs/reference-cosmic-tray-menu.md` | Lead checks the written doc against the brief's required-elements checklist (icon description, every menu item enumerated, structure/grouping/separators/shortcuts present) |
| unit-C1 | Run `ffprobe`/`ffmpeg` scene-change detection (e.g. `select='gt(scene,T)'`, tune `T`) on `~/2026-08-20 12-36-28.mp4` to find timestamps of distinct layout states. For each candidate timestamp, extract a frame and run the same edge-detection technique as `unit-A` (0 image-tool reads) to compute window count, bounding boxes, split orientation, and which window's border differs (candidate focus). Write a timestamped state timeline plus the list of extracted candidate-frame file paths to `docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/video-timeline.md`. | - | video (read-only, byte-level, 0 image-tool reads); scratch frame extraction under `/tmp/opencode/cosmic-evidence-mining/`; new `docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/video-timeline.md` (write) | Lead inspects the written timeline (text, not images) for a plausible, monotonic, in-range (0-59.25s) sequence of distinct states - not 1, not 3555 |
| unit-C2 (may split into unit-C2a, unit-C2b, ... at Lead's discretion once unit-C1's shortlist size is known) | Using `unit-C1`'s timeline and extracted frames, select and read frames from the shortlist, downscaled and cropped, prioritised toward: any no-op move, any state with 3+ windows, any screen-edge move, any orientation/split change. If split, each sub-unit reads a disjoint slice and appends to the shared research findings file; the change-wide total across all sub-units stays <=40 frames. Cross-reference against `unit-A`'s active/inactive border colours where useful. The final sub-unit (or the sole unit-C2 if unsplit) writes the consolidated Stream C findings into a new section of `docs/reference-wm-comparison.md`: whether/when a split rotates on a no-candidate move, screen-edge behaviour, and whether behaviour differs by tree depth - each claim labelled confidently-observed or inferred, and an explicit statement if no 3+-window state exists in the evidence. | unit-C1 | `unit-C1`'s frame set and timeline (read); `docs/reference-wm-comparison.md` (edit) | Lead checks the written section against the acceptance-criteria checklist (rotation question, edge behaviour, tree-depth dependence, each claim labelled) and cross-references cited timestamps against `unit-C1`'s timeline via `ls`/text search - no image re-viewing |
| unit-D | Add one new `docs/backlog.md` line for the Steam GUI tiling-escape issue (Steam's own GUI resize/move is not picked up by the auto-tiler and Steam is not placed correctly), in the existing entry format, proposed priority P3 (non-critical per user), dependencies: none, `(not yet scoped)` link per existing convention (cf. lines 27, 45). Executed by the Lead directly, not a Worker (forfeit: material already loaded). | - | `docs/backlog.md` (edit) | Lead's own diff review |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Scope Amendment (2026-08-20, follow-up stint, successor Lead 3rd)

The user requested the transcript corpus behind section 11 be captured as a
durable, machine-checkable conformance suite. This dispatch arrived from the
Orchestrator with the full semantic content of `unit-E` (notation, all 41
transitions, both pending corrections, the rule text, the five pending live
tests) already specified verbatim - treated as pre-approved plan scope, not a
fresh proposal requiring a separate sign-off round. Two new units added:

- **unit-E** - write a durable conformance-corpus document capturing the
  user's transcript, the notation, both unconfirmed model-derived
  corrections, per-transition rule annotations, and the five pending live
  test placeholders.
- **unit-F** - a pure reference implementation of the four rules plus a test
  that mechanically replays the entire corpus, to check the hand-derived
  section-11 model by execution rather than trust it.

**Execution order reversed from presentation order: unit-F before unit-E.**
unit-E's per-transition rule annotations cannot be produced correctly by
hand without repeating the exact error risk the Orchestrator flagged
("looks right and contains an error") - a second independent hand-derivation
would not actually check the first one. Deriving the annotations from
unit-F's executed trace instead makes them a verified artifact, not a second
guess, and is a stronger fulfilment of "second check on the model" than
parallel, unlinked manual annotation.

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-F | Pure, self-contained TypeScript reference implementation of the four movement rules over an N-ary tree (no KWin/controller/logic coupling), plus a test replaying all 41 corpus transitions across S1/S2/S3, asserting each result and carrying it forward as the next input. Emit a per-transition rule-firing trace for unit-E to consume. | - | new `kwin/tests/` files (implementation module without `.test.ts` suffix + one `*.test.ts` replay file) | `npm run typecheck`, `npm test` (new suite passes, old suites unaffected), before/after test and suite counts recorded |
| unit-E | Write `docs/cosmic-move-conformance.md`: notation, the 41-transition corpus (S1/S2/S3), both corrections marked as unconfirmed, the four rules, per-transition rule annotations sourced from unit-F's verified trace, and the five pending live-test placeholders (P1-P5) as unknowns, not assertions. Cross-referenced from `docs/reference-wm-comparison.md` section 11 and this plan. Executed Lead-direct (forfeit: full content already loaded via this dispatch's brief; only the per-transition annotations are sourced externally, from unit-F's trace, not re-derived by hand). | unit-F (for verified annotations) | new `docs/cosmic-move-conformance.md`; `docs/reference-wm-comparison.md` (cross-reference only) | Lead's own diff review against the acceptance checklist below; annotations cross-checked 1:1 against unit-F's trace output |

## Progress

- [x] unit-A - pixel-measure border/gap/corner metrics from 10 screenshots (accepted)
- [x] unit-B - document tray icon and menu from 2 screenshots (accepted)
- [x] unit-C1 - scene-detect and geometry-analyse the video into a state timeline (accepted; superseded as primary evidence, retained as spot-check resource)
- [x] unit-C2 - superseded by scope change: evidence source changed from video frames to user hand-transcription; directional-movement findings recorded (accepted) via a new Lead-direct dispatch (codebase N-ary investigation) plus Lead-direct doc write, not the original image-interpretation brief
- [x] unit-D - file Steam backlog entry (accepted)
- [x] unit-F - pure reference implementation + corpus replay test (accepted)
- [x] unit-E - conformance-corpus document (accepted)

## Attempt Accounting

- **unit-C2**: attempt-01 halted (stop-on-surprise - OBS-picker
  misidentification; 9/20 image budget spent, no doc edit). attempt-02
  dispatched as the authorized correction round after user confirmation;
  halted again (stop-on-surprise - new two-band-structure discrepancy,
  unrelated to the attempt-01 issue; 4/21 image budget spent, no doc
  edit). **A third attempt would trip the hard breaker rule ("a third
  attempt on one unit") - not dispatched.** Escalated to
  Orchestrator/user per Pending User Decisions above. unit-C2 remains
  unaccepted; no doc edit has been made by any attempt so far.

## Pending User Decisions

- None currently open (breaker below resolved by scope change; see
  Attempt Accounting). A further correction round to the recorded model
  is *expected*, not pending now: the user is running five live
  discriminating tests in COSMIC and will report back. Test 1 in
  particular probes whether rule 2b's nested-split structure is real
  (does a three-window row go 33/33/33 -> 25/25/50, or stay 33/33/33) -
  if it does not, rule 2b needs rework. This is a known, anticipated
  follow-up, not a blocker.

- **RESOLVED by scope change, 2026-08-20: the unit-C2 breaker (below) no
  longer applies.** The evidence source for Stream C changed from video
  frames to a user hand-transcription of the same recording session (~45
  discrete tree transitions), from which the Lead derived a single rule
  set reproducing every transition (including predicting two
  transcription errors). The video is now a spot-check resource, not
  primary evidence. This is a scope change (changed approach per the
  breaker-reset rules: "reduce or split scope, change approach, freeze
  partial acceptance, or park"), not a third attempt at the same
  image-reading brief - the breaker does not re-trip. `unit-C2` as
  originally scoped (image interpretation of `unit-C1`'s frame set) is
  superseded; the acceptance criterion it was meant to satisfy is instead
  met by a new Lead-direct doc edit recording the transcript-derived
  model (see Progress/Evidence below). Image budget frozen at 15/42 -
  no further image reads against this unit.

- **BREAKER TRIPPED on unit-C2 (superseded, kept for record), 2026-08-20.** attempt-02 (the
  authorized correction round applying the user's OBS/workspace-2
  correction) halted on a *new, different* discrepancy after reading 4 of
  its 21-image budget (t=11.4s, 17.517s, 24.767s, 25.817s). Every frame
  checked shows a **two-band vertical structure**, not the single flat
  tiled layout `unit-C1`'s timeline describes: a washed-out top band
  (~y=44-706 of 1440px) with 2-3 small dark rectangles resembling
  thumbnails, and a full-brightness bottom band (~y=760-1412) with its
  own border (white in one frame, lavender in three) containing what
  looks like the "real" tiled windows. This was not mentioned anywhere in
  `unit-C1`'s per-state descriptions and is not explained by the
  workspace-2/workspace-1 correction already applied. A third Worker
  attempt on this unit would trip the process's hard breaker rule ("a
  third attempt on one unit") - not dispatched. Escalating to
  Orchestrator/user for a plan amendment. Three explanations were
  raised, none investigated further pending direction: (1) a persistent
  OBS picture-in-picture/dual-source layout throughout the clip, not just
  at the very start; (2) a COSMIC workspace-overview/pager element
  appearing during directional-move testing (plausible: the user was
  specifically testing edge/workspace-crossing moves, and many tiling
  WMs surface a workspace-switcher preview during such operations - if
  so this could be *directly relevant evidence*, not an artifact); (3) a
  frame-extraction/decode issue (considered less likely - resolution
  assumption matches unit-C1's documented 2560x1440 and images decode
  cleanly). See return report for full detail and the resolution
  question for the user.
- Superseded context (resolved 2026-08-20, folded into the above): the
  user confirmed OBS is visible only in the opening frames, on workspace
  2, before switching to workspace 1 where all testing happened; the
  "grid of rectangular cells" is tiled terminal windows; `126 x 16` is a
  terminal columns x rows resize overlay; the lavender outline is
  unit-A's already-confirmed `#BD93F9` active-window border. This
  correction is still believed correct as far as it goes - it just does
  not explain the newly found two-band structure.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| COSMIC gap/border/corner metrics entry in `docs/reference-wm-comparison.md` | unit-A accepted: new `[C-OBS-1]` citation + "COSMIC observed metrics" subsection under section 9, 10-item table. Lead independently re-derived gap (5px), active border (3px, `#BD93F9`), and inactive border (1px, `#53555E`) from the Worker's saved `row720` run-length dump - all matched. Zero image-tool reads confirmed. Items 3 (edge gap) and 4 (panel gap) reported as partially inconclusive by the Worker rather than asserted; this is a residual risk, see below. |
| COSMIC directional-movement-with-no-candidate section in `docs/reference-wm-comparison.md` | **accepted**, evidence source changed mid-flight (see Pending User Decisions history): `unit-C1`'s video timeline (23 states, `docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/video-timeline.md`) is retained as a spot-check resource but was superseded as primary evidence after `unit-C2` hit an unresolved frame-legibility problem twice. Primary evidence is instead the user's own hand-transcription of ~45 tree transitions from the same session (`[C-OBS-3]`), from which the Lead derived a single rule set reproducing every transition, predicting two transcription errors ahead of the user flagging them. Recorded as new section 11 of `docs/reference-wm-comparison.md`: full rule model, tree-depth ambiguity resolved (immediate-parent-split scope only), user's original scenario confirmed, user's proposed precondition shown unnecessary, rule 2b's render-ambiguity flagged as an open design question (not a recommendation), rule 2a's "nearest slot" and rule 4 (screen-edge/no-ancestor-can-act) marked explicitly unresolved/unanswerable from available evidence, N-ary requirement cross-referenced against a Lead-dispatched codebase investigation (`docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/tile-tree-nary-support.md`) which found this project's own split logic is binary throughout and N-ary support would be a substantial architectural change. Every claim labelled `observed` or `inferred` per constraint. |
| `docs/reference-cosmic-tray-menu.md` created with full menu fidelity | unit-B accepted: new `docs/reference-cosmic-tray-menu.md`, `[C-OBS-2]` citation, 8 menu items enumerated in order across 5 separator-delimited groups, icon description, toggle/checkmark state indicators, shortcut-hint table, explicit notes on unresolved content (closed-icon appearance, "Window management settings..." destination). Exactly 2 images read, confirmed no re-reads. Scope respected (no other file touched by the Worker). |
| New `docs/backlog.md` line for Steam issue | unit-D accepted: one new P3/open/no-dependencies line added after line 45, existing entry format, `(not yet scoped)` link, matching lines 27/45 convention. Lead's own diff review. |
| No `kwin/` or native-effect file modified | confirmed clean through unit-B (git status shows only docs/ changes); pending final diff review across all units |
| Image/frame budget (<=42 total) respected | unit-A: 0, unit-B: 2, unit-C1: 0, unit-C2 attempt-01: 9, unit-C2 attempt-02: 4 (frozen here - evidence source changed to transcript, no further image reads against this unit). Final total: 15/42. |

## Residual Risks

- **RESOLVED, not by the planned route**: the video did contain 3+-window
  states (`unit-C1` found 12 of 23), so the depth ambiguity was in
  principle empirically resolvable from the video - but it was actually
  resolved from the user's hand-transcription instead, after automated
  frame interpretation hit an unresolved legibility problem twice. Kept
  here for provenance rather than deleted.
- Low-contrast COSMIC theming could make automated edge detection (unit-A,
  unit-C1) unreliable; if so, that is a plan amendment (a small, explicitly
  budgeted, Orchestrator-approved image-read fallback), not a silent switch
  to eyeballing. Did not materialize as a blocker for unit-A or unit-C1
  themselves; the actual blocker (`unit-C2`'s two-band frame structure) was
  a different, unresolved problem, sidestepped by the transcript rather
  than diagnosed.
- Scene-change threshold tuning in unit-C1 may over- or under-segment the
  video; unit-C1's own verification step (plausible-count sanity check) is
  designed to catch this before unit-C2 is dispatched against a bad timeline.
  This worked as designed for unit-C1's own acceptance, but did not (and
  could not) catch the separate two-band frame-content problem `unit-C2`
  hit, which was about frame *content*, not timeline *shape*.
- The tray screenshots may not capture every submenu in an expanded state;
  Stream B must note this as a limitation rather than guess unseen submenu
  contents.
- unit-A's screen-edge gap (37px top) and panel/taskbar gap could only be
  confirmed with confidence on 2 of the 10 shots (drop-shadow blur on
  inactive windows contaminated the naive colour heuristic on the other 8);
  the panel/taskbar gap is reported as inconclusive rather than measured.
  Accepted as-is because the doc reports this honestly rather than asserting
  an unverified number; a future change could re-run isolated on all 10 shots
  with a shadow-aware heuristic if the exact figure becomes load-bearing.
- **The unit-C2 video-frame two-band discrepancy was never root-caused.**
  It was superseded, not diagnosed - none of the three candidate
  explanations (persistent OBS PiP layout, COSMIC workspace-overview UI
  during edge-move testing, frame-extraction issue) was investigated. If
  the video is later needed as more than a spot-check resource (e.g. to
  resolve rule 2a's "nearest slot" ambiguity or rule 4's screen-edge/
  no-ancestor case), this should be revisited first rather than assumed
  safe to read.
- **Rule 2a ("spatially nearest slot") rests on one transcript data point**
  and is recorded as unresolved in `docs/reference-wm-comparison.md`
  section 11 - not a defect in this change, but a known evidence gap
  a later change should not treat as settled.
- **Rule 4 (no ancestor can act) is entirely unobserved** in the transcript
  and is recorded as unresolved/unanswerable - this directly covers the
  original acceptance criterion's screen-edge/workspace-crossing question,
  which this change cannot fully discharge from available evidence.
- **The derived model requires N-ary split containers.** A Lead-dispatched
  codebase investigation
  (`docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/tile-tree-nary-support.md`)
  found this project's own split logic (`kwin/src/controller.ts`,
  `kwin/src/logic.ts`) is binary throughout, and N-ary support would be a
  substantial architectural change, further bounded by unverified
  constraints in KWin's native tile-tree runtime. This is a feasibility
  finding, not a decision - whether/how to pursue N-ary support is
  explicitly out of scope for this research-only change.
- **A further correction round to the recorded model is expected, not
  hypothetical.** The user is currently running five live discriminating
  tests in COSMIC directly (not from the video or transcript) and will
  report back. Test 1 specifically probes whether rule 2b's nested-split
  structure is real: does a three-window row's ratios go from 33/33/33 to
  25/25/50 (consistent with rule 2b's nested-split model) or stay
  33/33/33 (inconsistent, meaning rule 2b needs rework)? Any correction
  from this should land as `unit-C2/attempt-03` or a clearly-scoped
  follow-up unit, not a silent edit to the accepted section 11.

| unit-F: reference implementation + corpus replay | `kwin/tests/move-conformance-model.ts` (pure rule model, no `src/` coupling), `kwin/tests/move-conformance.test.ts` (replays all corpus transitions, writes the trace), `docs/changes/archive/2026-08-20-cosmic-evidence-mining/research/move-conformance-trace.md`. All 40 transitions (see count note below) replay correctly. `npm run typecheck` clean on both tsconfigs. `npm test`: 879 tests / 79 suites / 879 pass / 0 fail (delta from the 838/78 baseline re-established this session: +41 tests, +1 suite - 40 transition assertions + 1 trace-writing test, 1 new `describe`). `git diff --stat -- kwin/contents/code/main.js` empty, confirmed independently by the Lead. Lead independently spot-checked 3 transitions (S1-01, S1-02, S1-03) by hand-tracing the rule model against the code and confirmed the reported rule and resulting tree for each. |
| unit-E: conformance-corpus document | New `docs/cosmic-move-conformance.md`: notation, all 40 transitions across S1/S2/S3 with per-transition rule annotations sourced verbatim from `move-conformance-trace.md` (not hand-derived), both S1-17/S3-05 corrections marked explicitly unconfirmed, the four rules verbatim, the five pending live-test placeholders (P1-P5) as unknowns. Cross-referenced from `docs/reference-wm-comparison.md` section 11 (new pointer paragraph added) and from this plan. Lead-direct (forfeit: full content already loaded via this dispatch's brief; annotations sourced from unit-F's verified trace rather than re-derived, and independently script-verified 1:1 against the trace file by the Lead). |
| Baseline correction for `controller-test-split` | The 838/78 baseline was re-measured on this machine before unit-F (this session, not carried over unverified from a prior machine) and confirmed to match the previously recorded number exactly. Recorded in `docs/changes/archive/2026-08-21-controller-test-split/plan.md` as the pre-unit-F baseline, with the post-unit-F 879/79 total noted as this change's cause, so `controller-test-split` does not gate on a stale number. |

**Count discrepancy, disclosed not silently resolved**: the corpus as given in this session's dispatch brief totals 40 transitions (21 in S1, 5 in S2, 14 in S3), not 41 as the brief's own prose stated. Every row given was transcribed and replayed; no row was invented or dropped. This is recorded in the trace file, the test file, and the corpus doc (unit-E) rather than silently corrected to match the stated "41".

## Final Outcome

- **Accepted, all seven units.** unit-A, unit-B, unit-C1, unit-D (prior
  stint) plus unit-F and unit-E (this stint) are all accepted; unit-C2's
  original image-interpretation brief was superseded by a scope change
  (transcript evidence + codebase investigation) and its replacement
  output is accepted. All five original `spec.md` acceptance criteria have
  evidence recorded above. This stint added two units beyond the original
  spec, both from a direct, pre-approved Orchestrator dispatch: the
  transcript corpus is now captured as a durable, machine-checkable
  document (`docs/cosmic-move-conformance.md`, unit-E) and mechanically
  replayed against a pure reference implementation (unit-F), which
  independently confirmed the hand-derived section-11 model rather than
  merely restating it.
- A known, user-flagged follow-up remains open, not blocking: the five
  live COSMIC tests (P1-P5, now recorded in `docs/cosmic-move-
  conformance.md`'s Pending Cases section) are still running on the user's
  side and will need a future dispatch once reported - most likely a
  corpus/model correction round, not a fresh investigation, since the
  methodology and tooling to check it (the executable replay) already
  exist.
- The unit-C2 video-frame two-band discrepancy remains un-root-caused (see
  Residual Risks); the video is retained in the archived research only as
  a spot-check resource, not reopened this stint.
