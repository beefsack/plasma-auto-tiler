# awesome reference source-fill

## Goal and scope

- Baseline `1f9713d`: attempt awesome/tile's 50 N and 12 U cells using
  read-only `upstream awesomeWM/awesome repository` at
  `0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f`, confirmed from the matrix legend.
- Documentation only. Preserve scenarios, other profiles, approved rules,
  source checkouts and the user's three stashes. No live testing.
- Existing F19/L8 excluded. Newly discovered blockers retain literal TBD
  with reasons and are reclassified H/F/L.

## Acceptance and approach

- Learn the codebase once; share the compact source map with every fill Worker.
- Trace every candidate without guessing; independently source-verify each slice.
- Record material approved-rule comparisons with rule/source locations, using
  the xmonad handover format. Reference evidence does not approve rule changes.
- Reconcile occurrence-aware coverage, citations, triage ledgers and counts;
  verify unchanged scenarios and documentation-only diff scope/whitespace.
- Archive this note, commit and push only intended documentation.

## Bounded units

1. Orientation, pin verification and exact inventory (complete).
2. Layout/admission/navigation/fixed-size: 13 N + 2 U (verified).
3. Tags/screens/workspaces/output: 19 N + 2 U (verified).
4. Floating/fullscreen/maximize/minimize/utility: 12 N (verified).
5. Mouse/persistence/control/groups: 6 N + 8 U (verified).
6. Corrected-source audit and approved-rule comparison audit (complete).
7. Final independent reconciliation, triage integration and archive (complete).

Workers use `muse-spark`, one active at a time. A separate source verifier
follows every fill unit. The Lead owns this note and the triage report.

## Accepted evidence and outcome

- Workspace clean on `main`, tracking `origin/main`; pinned awesome checkout clean.
- Orientation: tile is flat master/stack (nmaster=1, mwfact=0.5, ncol=1),
  global manage/swap list order rather than focus order. New clients prepend.
  Float/fullscreen/maximized clients excluded from tile allocation.
- Semantic directional actions use geometric focus/swap, unlike shipped
  byidx keybindings. Tags are fixed sets with native multi-tag/sticky support;
  sends do not themselves switch view. Default rc starts each tag floating.
- Inventory: 89 awesome TBDs, 50 N/12 U/19 F/8 L. Exact candidate occurrences
  enumerated by the orientation Worker; no duplicate N occurrences.
- Shared source map: `lib/awful/layout/suit/tile.lua`, `lib/awful/client.lua`,
  `lib/awful/client/focus.lua`, `lib/gears/geometry.lua`,
  `lib/awful/permissions/init.lua`, `lib/awful/tag.lua`, `lib/awful/screen.lua`,
  `lib/awful/mouse/{resize,snap}.lua`, `awesomerc.lua`, `objects/client.c`,
  `ewmh.c`, `awesome.c`. All citations use the existing full pin.

- Slice 1: 4 N + 2 U closed; 2 N reclassified F (INS-04/06),
  7 N reclassified L (MIN-01..03, SPC-08/09/12/13).
  Independent review corrected the fixed-size-only exception, native list
  nomenclature, newcomer-focus citation and stale cycle legend wording.
- Slice 2: 4 N + 2 U closed; 14 N reclassified F (WS-01/02/05/06/12/17/
  21/22/23/26, OUT-01/06/07, MOU-03), 1 N L (WS-25).
  Author's closure claims were rejected because literal TBDs remained.
  Full delayed-path review corrected send refocus, hidden-tag migration,
  disconnect versus explicit migration, and OUT-01 focus/retag behavior;
  WS-26 cross-screen history was traced rather than called untraced F.
- Slice 3: all 12 N closed. Separate source review corrected an unstated
  absolute origin in MAX-02 and added minimize arrange-hook evidence.
- Slice 4: 4 N + 8 U closed; RST-01 reclassified F, RST-02 H.
  Separate review corrected transient admission (tags/screen, not implicit
  floating), press-activation gates, and traced restart scan, client-order
  permutation, EWMH desktop remapping and rule-focus rather than accepting
  an untraced focus leg as F.
- Material failed approach: orientation and early reviews misread
  `client_array_push` as append. The persistence review inspected
  `common/array.h:110-122` and proved index-zero prepend. A bounded correction
  unit fixed INS-01/04/06, MIN-01, MAX-06, FOC-03 and `S-awe-tile`; a fresh
  independent Worker verified all affected outcomes plus corrected delayed
  screen/tag focus and restart chains. No repeat of the append assumption.
- Fresh audit rejected an invented secondary missing-host blocker for X
  query-tree listing direction and restored literal TBD on RST-02.
  RST-01's genuine primary F is the unstated pre-restart stacking/focus-raise
  input, not client-order persistence or an unfinished startup trace.
- All **62 candidates attempted: 24 N + 12 U closed (36)**; **26 N
  reclassified H1/F17/L8**. Original F19/L8 unchanged. Awesome residual
  **53 (H1/F36/L16)**; global references **763 TBD:
  N189/H72/F258/L128/U116**, down from 799.
- New H: R-RST-02. New F: R-INS-04/06; R-MOU-03; R-OUT-01/06/07;
  R-RST-01; R-WS-01/02/05/06/12/17/21/22/23/26.
  New L: R-MIN-01..03; R-SPC-08/09/12/13; R-WS-25.
  INS-04 retains secondary live pointer/focus settlement; RST-02 secondary
  relaunch order/flags fixture limits. All residuals keep literal TBD.
- New key: `S-awe-rst`. Existing tile, manage, cycle, focus, minimize, tag,
  swap, history and workspace citations extended at the existing full pin.
- Older out-of-scope append claims discovered but preserved: R-INS-02/05/07
  (`insertion.md:71,172,240`), R-CLOSE-02 (`close.md:76`) and the analogous
  existing column cell (`column-mechanics.md:438`). These are outside this
  pass's baseline N/U occurrence set; the corrected shared legend now
  records prepend-first. This is a recorded separate correction dependency.

## awesome versus approved rules

Source keys resolve in the [matrix index](../../spec/reference-outcomes.md).
All source locations below use `0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f`.
These are reference differences, not authorization to change Ours.

### Comparisons requiring user review

| Case | Approved rule location | Pinned awesome source evidence | Explicit deliberate-deviation coverage |
|---|---|---|---|
| INS-01: fixed master/stack with newcomer-first instead of long-edge split | `docs/spec/functional-spec.md:70` REQ-INS-01; `docs/decisions.md:690-692` | `lib/awful/layout/suit/tile.lua:164-169,232-310`; `objects/client.c:2202,3084-3116`; `common/array.h:110-122`; `lib/awful/client.lua:219-251`; `lib/awful/screen.lua:529-560`; `S-awe-tile` + `S-awe-manage` | No explicit awesome coverage; newcomer position stays OPEN per REQ-INS-01b |
| WS-01/02 and OUT-07: explicit sends stay, retaining global order rather than remembered-leaf admission; no follow/stay split | `functional-spec.md:143-145,148,280` REQ-WS-01/01b/02/04, REQ-OUT-04; `decisions.md:164-173,267-282,404-414` | `lib/awful/client.lua:577-587,653-674`; `lib/awful/permissions/init.lua:94-146,809-814`; `S-awe-tag` + `S-awe-hist` + `S-awe-tile` | No explicit awesome coverage; retained-order coincidence is not remembered-A policy |
| OUT-01: screen-exchange ends focused on the encountered peer with delayed consistency retag, rather than mover-focus ordinary admission | `functional-spec.md:110-111,277` REQ-MOV-08/08b, REQ-OUT-01; `decisions.md:380-421` | `lib/awful/client.lua:308-369,653-674`; `lib/awful/client/focus.lua:171-229`; `lib/awful/tag.lua:1813-1836`; `lib/awful/permissions/init.lua:310-330`; `S-awe-swap` + `S-awe-focus` + `S-awe-tag` | Item 5.2 names awesome and covers window-position selection (`decisions.md:395-397`); focus/retag/admission split is not covered |
| OUT-06: delete into first tag, clear history and create fresh reconnect tags, without return affinity | `functional-spec.md:282` REQ-OUT-06; `decisions.md:193-207` | `lib/awful/tag.lua:409-485,607-645,1913-1948`; `S-awe-ws` | No explicit awesome coverage |
| FLT-01: unfloat re-includes at retained global order instead of fresh admission | `functional-spec.md:180` REQ-FLT-01; `decisions.md:1339-1349` | `lib/awful/client.lua:837-853,973-1003`; `lib/awful/screen.lua:529-560`; `objects/client.c:3084-3116`; `S-awe-float` + `S-awe-tile` | No explicit awesome coverage |
| MAX-01/02/03: maximize/fullscreen leave tiling without a retained-slot overlay; exit rejoins retained order | `functional-spec.md:209-211` REQ-MAX-01/02/03; `decisions.md:1536-1545` Q3 scope | `lib/awful/client.lua:895-1024`; `objects/client.c:2699-2790`; `ewmh.c:325-375,588-650`; `S-awe-fs` + `S-awe-tile` + `S-awe-float` | No explicit awesome coverage |
| MAX-06: born-maximized admits implicitly floating and later rejoins retained order, without a reserved overlay slot | `functional-spec.md:216` REQ-MAX-06; `decisions.md:1536-1545` Q3 | `lib/awful/client.lua:895-1024`; `objects/client.c:2202`; `common/array.h:110-122`; `S-awe-manage` + `S-awe-fs` + `S-awe-float` + `S-awe-tile` | No explicit awesome coverage |
| SPC-08/D2: dynamic hint reclassification both directions instead of admission-only | `functional-spec.md:350` REQ-SPC-04b; `decisions.md:441-443` | `lib/awful/client.lua:988-1024`; `S-awe-fixed-dynamic` | No explicit awesome coverage |
| DRAG-01: hover-swap without drop resolver, index insert, preview or centre mapping | `functional-spec.md:291-292` REQ-DRAG-01/02; `decisions.md:1003-1005,1016-1024,1071-1080` | `lib/awful/layout/init.lua:400-420`; `lib/awful/mouse/client.lua:21-34`; `lib/awful/mouse/resize.lua:151-244`; `lib/awful/mouse/snap.lua:108-155,268-286`; `S-awe-drag` | No explicit awesome coverage |
| FLT-10/11: geometric list-swap without snap/half state instead of selected half-snaps | `functional-spec.md:191-192` REQ-FLT-10/11; `decisions.md:1382,1396` | `lib/awful/client.lua:308-369`; `lib/gears/geometry.lua:95-106,149-169`; floating arrange no-op; `S-awe-swap` + `S-awe-geodir` + `S-awe-float` | No explicit awesome coverage |
| WS-12: moved hidden tag remains unselected on R while R keeps showing WS3, instead of showing the moved workspace | `functional-spec.md:160` REQ-WS-12d; `decisions.md:296-300` D4 | `lib/awful/tag.lua:534-566,607-645`; `S-awe-ws` | No explicit awesome coverage |

### Comparisons already covered

- MIN-01..03: explicit B6 origin+minimum deviation (`decisions.md:699-708`,
  REQ-MIN-01..03); allocation and subsequent hint shaping remain distinct.
- MAX-05: Windows keeps preimage refusal despite reference exit consensus
  (`decisions.md:1483-1485`, `functional-spec.md:214-215`).
- DRAG-04 is excluded and unchanged; Ours keeps Esc cancel despite reference
  drop/persist consensus (`decisions.md:1000-1002`).
- The OUT-01 window-position selection metric is explicitly selected with
  awesome named (`decisions.md:395-397`); its focus/retag difference is above.
- WS-25 overlay carry aligns with D8 (`decisions.md:315-322`, REQ-WS-12h);
  SPC-09 explicit override aligns with D3 (`decisions.md:444`, REQ-SPC-04c).
- OPEN outcomes, owner-specific controls and unsupported verbs do not
  establish approved-rule contradictions. No rule or scenario was edited.

## Verification and next action

- Four independently authored slice source reviews, separate prepend
  correction verification, delayed-focus/restart source audit and independent
  approved-rule comparison audit completed. All review findings were corrected.
- Exact changed occurrence set is all 62 baseline N/U candidates. Original
  F19/L8, resolved awesome cells, other profiles, scenarios and approved rules
  are preserved. Evidence is pinned source policy, not live runtime acceptance.
- Final integration caught and repaired twelve indented outcome bullets and
  one out-of-scope edit to resolved WS-24 (restored byte-for-byte to baseline).
  Initial executable reconciliation had 10 failures; the scope/format repair
  restored strict checks without changing the candidate set. The checker also
  repaired its non-awesome filter and extra-change assertion, without bypasses.
- Lead diff review found ambiguous WS-05 "focus stays B throughout" wording.
  The slice verifier traced synchronous banning before delayed refocus: forward
  send clears B then refocuses A; return clears B on empty WS2; final WS1
  selection refocuses B. Added C banning citations, scoped the local-versus-global
  swap legend qualifier and made the post-array client-file citation explicit.
  INS-01 share wording now correctly states both prior clients halve their
  allocation (1/2 to 1/4), consistent with the independently verified frames.
- Temporary executable evidence: `awesome-final-reconcile.py`
  and `awesome-final-reconcile.json`. Archived integrated check:
  **111 assertions passed, zero failures**, rerun by the Lead.
- Reference cells remain 1,896; Ours remains 169 TBD. Every per-WM partition
  and actual count, N-area row/column sum and exact awesome H/F/L ledger
  reconciles. Fixture ledger totals 258 across 89 rows; other WM memberships
  unchanged. Touched citations resolve at the full pin; local links resolve.
- Awesome checkout remains clean; all three stash object identities unchanged.
  Whitespace and documentation-only scope checks pass.
- Exact next action for this source-fill pass: none. No N/U areas remain.
  Rule comparison review, external session-manager identification/pinning,
  fixture inputs and live observations remain separate user-owned follow-ups.
