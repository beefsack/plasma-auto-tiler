# PaperWM reference source-fill

## Goal and scope

- Baseline `abf7f26`: attempt PaperWM's 70 N and 8 U cells in the remaining
  reference triage, using read-only source at
  `8bf6dd264f60d6c0c402b63df7b424b888959a48`.
- Documentation only. Preserve scenario wording, other profiles, approved
  rules, the source checkout and the user's three stashes. No live testing.
- Existing 17 H, 6 F and 2 L cells are excluded. Newly discovered blockers
  retain TBD with their reason and are reclassified in the triage report.

## Acceptance and approach

- Learn the codebase once; pass its source map to context-sized fill units.
- Trace every candidate without guessing, retaining policy/runtime distinctions
  and existing citation conventions. Report material approved-rule conflicts.
- Independently source-verify each slice before acceptance; check diff scope,
  citation resolution, cell counts, unchanged scenarios and whitespace.
- Update the triage's current PaperWM counts and ledgers; commit and push the
  accepted slices or complete pass, staging only intended documentation.

## Bounded units

1. Source orientation (complete: pin verified, clean source checkout).
2. Insertion, column mechanics, move, focus, layout commands: 21 N.
3. Floating, minimize, close, maximize/fullscreen, resize, minimum size: 16 N.
4. Workspaces, multi-output, activation: 14 N.
5. Mouse and groups/stacks: 9 N.
6. Restart/persistence and special windows: 10 N and 8 U.
7. Reconcile counts, final checks, archive this note, commit and push.

Workers use `muse-spark`, one active at a time; separate verification Workers
follow each fill unit. The Lead owns this note and the triage report.

## Accepted evidence and outcome

- Orientation verified the profile pin and reusable source keys. PaperWM is
  a column/row strip with separate floats; directional move binds swaps,
  `move_to` is viewport placement, and native resize/focus legs can be host-owned.
- Unit 2: 21/21 N cells closed; independent source verification checked all
  fills and citations. Corrected cycle-return wording and restricted the
  fullscreen retention claim to state. No reclassifications or rule conflicts.
- Unit 3: 16/16 N attempted, 4 closed, 8 reclassified H (FLT-02/05/12/13,
  MNZ-01/02, CLOSE-05, MAX-09), 4 L (MAX-01, MIN-01/02/03). Independent
  verification found host/settlement overclaims and incorrect fresh-fullscreen
  and scratch-dialog scope; one correction pass resolved all findings and
  the verifier accepted the corrected slice. No approved-rule conflicts.
- Unit 4: 14/14 N attempted, 6 closed, 6 H (WS-05/24/25, OUT-06,
  ACT-01/02), 2 F (WS-12/22: unstated stack/tab order, secondary host
  neighbor/index policy). Independent verification caught extension-absence
  and automatic-float overclaims; one correction pass resolved findings.
  WS-04's synchronous scratch-removal chain was independently confirmed.
  No approved-rule conflicts.
- Unit 5: 9/9 N attempted, 3 closed, 3 F (DRAG-01/04/06: pointer
  y/hover/path), 3 H (DRAG-03, MOU-02, GRP-03). DRAG-04 also retains a
  secondary host Esc-interception limitation. Independent verification found
  missing literal TBD markers and an unsupported native-refocus claim; one
  correction pass resolved all findings. No approved-rule conflicts.
- Unit 6: 10/10 N and 8/8 U attempted; 8 U closed, 4 H
  (START-01/02/03, SPC-02), 3 F (RST-01, SPC-03/13), 3 L
  (SPC-05/10/11). Independent verification caught startup-order and native
  settlement overclaims; one correction pass resolved findings. A reviewer
  claim that native restore toggles PaperWM width back was rejected after
  direct source inspection: the width toggle writes frames, not maximize
  flags. The verifier confirmed the correction. No approved-rule conflicts.
- All 78 candidates attempted: 34 N and 8 U closed; 36 N reclassified
  H21/F8/L7. PaperWM residual: 61 (H38/F14/L9), no N/U. Global reference
  TBD count: 964.
- Final independent occurrence-aware reconciliation passed: all 78 changed
  cells match the original N/U multiset, including separate MOV-01/03 swap
  legs; all 25 original H/F/L cells and every other profile are unchanged.
  Scenario text is identical after excluding Then cells. All source keys
  resolve; six new PaperWM keys contain the full pin and introduce no duplicate
  keys. Triage tables and ledgers reconcile (N436/H58/F186/L104/U180;
  fixture 186 cells across 66 rows). Diff whitespace/scope checks passed;
  source checkout is clean at the pin and three user stashes are intact.
- Verification artifacts: `/tmp/opencode/verify-final-v1.py` through
  `verify-final-v4.py` (temporary, occurrence-aware matrix/scope/citation and
  triage checks, not repository dependencies). No acceptance gaps remain
  within the authorized N/U source-pass scope.
- Exact next action for this PaperWM pass: none. Its remaining host-source,
  fixture-input and live-observation decisions are user-owned.
