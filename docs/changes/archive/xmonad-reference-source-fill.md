# xmonad reference source-fill

## Goal and scope

- Baseline `bf058ee`: attempt xmonad/Tall+Navigation2D's 41 N and 23 U
  cells using read-only core `284dd52c9c957cab6b6e5cc7580f2a63dafa00a7`
  and contrib `5097a457e7a409bc9a7584dc5aa82b34c69d6dda`.
- Documentation only. Preserve scenarios, other profiles, approved rules,
  source checkouts and the user's three stashes. No live testing.
- Existing F7/L4 cells excluded. Newly discovered blockers retain literal
  TBD with reasons and are reclassified H/F/L.

## Acceptance and approach

- Learn the codebase once; share the compact source map with every fill Worker.
- Trace every candidate without guessing; independently source-verify each slice.
- List material differences from approved rules with rule/source locations;
  do not edit product decisions or infer approval from reference behavior.
- Verify occurrence-aware coverage, source citations, unchanged scenarios,
  diff scope and whitespace; reconcile triage ledgers and global totals.
- Archive this note, commit and push only intended documentation.

## Bounded units

1. Orientation, pin verification and exact inventory (complete).
2. StackSet/admission: close, insertion, workspaces, minimum size (14 N, complete).
3. Navigation/move/output: focus, move, multi-output (10 N, complete).
4. States/persistence: floating, fullscreen, special windows, session restore (11 N, complete).
5. Mouse (6 N, complete).
6. Unsupported profile journeys (23 U, complete).
7. Final independent reconciliation, triage integration and archive (complete).

Workers use `muse-spark`, one active at a time. A separate source verifier
follows every fill unit. The Lead owns this note and the triage report.

## Accepted evidence and outcome

- Initial workspace clean on `main`, tracking `origin/main`, at `bf058ee`.
  Three stash object identities recorded for final comparison.
- Orientation confirmed full matrix pins and clean sibling checkouts at
  `upstream xmonad/xmonad repository` and `xmonad-contrib`.
- Shared source map: flat Tall master/stack, positional zipper insertion and
  deletion, same-layer geometric Navigation2D swap, no-follow `shiftWin`,
  default EWMH full-float/sink without saved-slot restoration. No tabs,
  sticky, maximize or workspace tiling-toggle counterpart in this profile.
- Inventory reconciled 75 TBD cells: 41 N/23 U/7 F/4 L. Already-closed
  MOV-01/03 explicit-swap occurrences are distinct and excluded.
- Unit 2: all 14 N attempted; 8 closed, 3 F (CLOSE-02/04, INS-04),
  3 L (MIN-01..03). INS-04 retains secondary live pointer settlement.
  Independent verification removed an invented INS-01 geometry blocker,
  derived supplied-fixture allocations, separated allocation from client
  settlement, completed workspace focus/restack and fixed bullet indentation.
- Unit 3: all 10 N attempted; final 5 closed, 5 F (MOV-01/03/04/09
  unrecorded Tall projection, MOV-08 output geometry).
  Independent verification traced cross-screen same-layer Navigation2D,
  removed beyond-Observe blockers and closed deterministic hotplug retention.
  Author's initial retained N/generic host blockers were rejected; every
  accepted residual has a named F/L blocker and literal TBD.
- Unit 4: all 11 N attempted; final 6 closed, 1 H (RST-02),
  3 F (FLT-03, MAX-02, SPC-07), 1 L (MAX-05).
  Independent review removed invented frame/history inputs, extended manage,
  refresh, fullscreen and startup citations, and corrected literal-TBD
  closure accounting. RST-02's session manager is primary H, fixture secondary.
- Unit 5: all 6 N closed after independent review. Review corrected
  `shiftMaster` to press-time, traced asynchronous drag installation and
  release completion, and removed beyond-Observe pixel/repaint blockers.
- Unit 6: all 23 U closed; separate source verification confirmed every
  unsupported preparation/action and in-profile inventory qualification.
- Final independent rule/fixture audit rejected four unconditional move
  verdicts derived from unstated H-to-Tall mapping. Conditional analogues
  remain sourced, but exact Given outcomes retain literal TBD as F.
  SPC-11's classification closes: first/native exits sink to tiled; no
  beyond-Observe frame/focus blocker. A separate Worker verified all five
  final corrections against pinned source and full scenario wording.
- All **64 candidates attempted: 25 N + 23 U closed (48)**; **16 N
  reclassified H1/F11/L4**. Original F7/L4 unchanged. xmonad residual
  **27 (H1/F18/L8)**; global references **799 TBD:
  N239/H71/F241/L120/U128**, down from 847.
- New keys: `S-xmo-topfocus`, `S-xmo-arrange`, `S-xmo-rescreen`.
  Existing manage/float, navigation/scope, mouse, fullscreen and restart
  citations extended at the existing full pins. No new source revision.
- Initial final-check claims exceeded the executable assertions and were
  rejected. The repaired checker uses exact occurrence keys, literal-TBD
  membership, all 18 area files and strict baseline scope checks. Lead
  integration removed bypasses/stale counts and fixed archive/stage handling.
- An ad-hoc Ours recount incorrectly included 39 row-footer TBDs; two
  occurrence parsers confirmed the unchanged **169 Ours TBD**, not 208.

## xmonad versus approved rules

Source keys resolve in the [matrix index](../../spec/reference-outcomes.md).
Core locations below use `284dd52c9c957cab6b6e5cc7580f2a63dafa00a7`;
contrib locations use `5097a457e7a409bc9a7584dc5aa82b34c69d6dda`.
These are reference differences, not authorization to change Ours.

### Comparisons requiring user review

| Case | Approved rule location | Pinned xmonad source evidence | Explicit deliberate-deviation coverage |
|---|---|---|---|
| CLOSE: positional down-else-up instead of source-domain MRU | `docs/spec/functional-spec.md:251` REQ-CLOSE-01; `docs/decisions.md:1603-1608` | Core `StackSet.hs:333-349,511-521`; `Operations.hs:391-392`; `S-xmo-close` + `S-xmo-topfocus` | No explicit xmonad coverage |
| INS-01: fixed master/stack and insert-above-focus instead of long-edge splitting | `functional-spec.md:70` REQ-INS-01; `decisions.md:690-692` | Core `StackSet.hs:472-486`, `Layout.hs:54-98`; `S-xmo-ins` + `S-xmo-layout` | No explicit xmonad coverage |
| WS-02/04 and OUT-04/07: live StackSet focus (including floats), no remembered eligible-leaf/history fallback; sends leave source view unchanged | `functional-spec.md:143-145,148,280` REQ-WS-01/01b/02/04, REQ-OUT-04; `decisions.md:693-694,404-414` | Core `StackSet.hs:527-532,566-590`; contrib `Navigation2D.hs:587-612`; `S-xmo-shift` + `S-xmo-scope` | No explicit xmonad coverage; a fixture coincidence with remembered A is not the same policy |
| MOV-08: direct same-layer geometric swaps across visible screens, not local structural exhaustion then reciprocal-output transfer | `functional-spec.md:110-111` REQ-MOV-08/08b; `decisions.md:380-403,1641-1647` | Contrib `Navigation2D.hs:462-473,511-534,570-612,663-704,856-898,940-954`; `S-xmo-nav` + `S-xmo-out` | Item 5.2 explicitly covers COSMIC metric divergence, not xmonad's hybrid selection; exact fixture hit remains F |
| FLT-01: sink reuses retained stack position instead of fresh admission | `functional-spec.md:180` REQ-FLT-01; `decisions.md:1341-1349` | Core `StackSet.hs:527-532`; `S-xmo-float` | No explicit xmonad coverage |
| MAX-02: fullscreen floats out, siblings refill; exit sinks rather than restoring an untouched tiled allocation | `functional-spec.md:210` REQ-MAX-02; `decisions.md:1418-1428,1473-1475` | Contrib `EwmhDesktops.hs:664-709`, `ManageHelpers.hs:289-290,329-330`; core `Operations.hs:183-221`; `S-xmo-ewmh` + `S-xmo-arrange` | No explicit xmonad coverage; exact focus sequence remains F |
| MAX-06: born-maximized normal window ordinarily tiles, with no reserved maximize overlay | `functional-spec.md:216` REQ-MAX-06; `decisions.md:1536-1544` Q3 | Core `Operations.hs:90-124`; contrib `EwmhDesktops.hs:107-143`; `S-xmo-admit` + `S-xmo-ewmh` | No maximize counterpart; ordinary-admission contrast only, never a native-maximize vote |
| SPC-07: equal full-zero/sentinel hints float without Ours' validity guards | `functional-spec.md:349` REQ-SPC-04a; `decisions.md:425-435` D1 | Core `Operations.hs:93-99`; `S-xmo-float` | D1 selects the guards, but no explicit xmonad-deviation label; partial-zero alignment is separate |
| SPC-11: born/prior fixed-fullscreen clients exit tiled, not fixed-float admission/restore | `functional-spec.md:353` REQ-SPC-04e; `decisions.md:450-454` D5 | Core `Operations.hs:90-124`, `StackSet.hs:527-532`; contrib `EwmhDesktops.hs:682-709`; `S-xmo-admit` + `S-xmo-float` + `S-xmo-ewmh` | D5 labels COSMIC game-safety deviation, not xmonad |
| OUT-06: retain current workspace, hide other disconnected-screen workspaces, positional reconnect without return affinity | `functional-spec.md:282` REQ-OUT-06; `decisions.md:193-207` | Core `Operations.hs:349-371`; `S-xmo-rescreen` | No explicit xmonad coverage |
| DRAG-01/02/05/06: float raw frame and press-time shiftMaster, not center snap-back/index insert/preview; zero-motion floats; off-area frame retained | `functional-spec.md:291-292,296-297` REQ-DRAG-01/02/05/06 | Core `Config.hs:246-256`, `Operations.hs:787-841`, `Main.hs:330-344`, `StackSet.hs:551-556`; `S-xmo-mouse` + `S-xmo-master` | No explicit xmonad coverage; drag presentation and press-focus separately match native/selected intent |

### Comparisons already covered

- MIN-01..03: unconditional Tall allocation ignores tiled minima
  (`Layout.hs:64-98`, `Operations.hs:328-335`, `S-xmo-layout`/`S-xmo-admit`)
  instead of B6 origin+minimum. Explicit deliberate reference-policy
  deviation: `docs/decisions.md:699-708`, REQ-MIN-01..03.
- MAX-05: no preimage refusal (`EwmhDesktops.hs:664-709`, `S-xmo-ewmh`).
  Windows deliberately retains refusal despite unanimous exit consensus:
  `decisions.md:1483-1485`, `functional-spec.md:214-215` REQ-MAX-05/05b.
- MAX-07: no captionless-size fullscreen inference (`Operations.hs:90-124`,
  `S-xmo-admit`/`S-xmo-ewmh`). Explicit Windows game-compatibility difference:
  `decisions.md:1487-1490`, `functional-spec.md:217-218` REQ-MAX-07/07b.
- Existing DRAG-04 is excluded and unchanged. The mouse inventory confirms
  no key-cancel branch; Ours deliberately keeps Esc cancel despite reference
  drop/persist consensus (`decisions.md:1000-1002`, REQ-DRAG-04/04b).
- OPEN move/cycle policies and unsupported owner-specific controls do not
  establish an approved rule contradiction. No rule or scenario was edited.

## Verification and next action

- Five separately authored source reviews, final residual/source review,
  independent rule/projection audit and separate final-correction verification.
- Temporary executable evidence: `xmonad-final-reconcile.py`
  and `xmonad-final-reconcile.json`. Archived integrated check:
  **77 assertions passed, zero failures/pending**, independently rerun by
  the integration reviewer.
- Exact changed occurrence set is all 64 baseline N/U candidates; original
  F7/L4 and resolved xmonad cells, other profiles, scenarios and approved
  rules preserved. Reference cells remain 1,896; Ours remains 169 TBD.
- Every per-WM partition/actual TBD count, N-area row/column sum and exact
  xmonad H/F/L ledger reconciles. Fixture ledger totals 241 across 89 rows;
  other WM memberships unchanged. Touched citations resolve at full pins.
  Both checkouts remain clean; all three stash object identities unchanged.
  Whitespace and documentation-only scope checks pass.
- Exact next action for this source-fill pass: none.
  No N/U areas remain. Rule comparison review, external session-manager
  identification/pinning, fixture inputs and live observations are separate
  user-owned follow-ups.
