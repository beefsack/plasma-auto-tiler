# paneru reference source-fill

## Goal and scope

- Baseline `c023391`: attempt paneru's 57 N and 13 U cells using read-only
  source at `b1b6abbd3f1a4be138152b6f0389c9ff1b27a269`.
- Documentation only. Preserve scenarios, other profiles, approved rules,
  the source checkout and the user's three stashes. No live testing.
- Existing H18/F3/L1 cells are excluded. Newly discovered blockers retain
  TBD with reasons and are reclassified H/F/L; macOS host policy has no
  public implementation source.

## Acceptance and approach

- Learn the codebase once and share its short source map with each fill Worker.
- Trace every candidate without guessing; distinguish policy from host/runtime
  acceptance and list material approved-rule contradictions without changing rules.
- Independently source-verify each slice, then check occurrence-aware coverage,
  citation resolution, unchanged scenarios, diff scope and whitespace.
- Reconcile triage counts and ledgers, archive this note, commit and push only
  intended documentation with a single-line source-fill message.

## Bounded units

1. Orientation and pin verification (complete).
2. Insertion, columns, focus, groups and layout commands: 16 N + 1 U.
3. Move, workspaces and multi-output: 12 N + 1 U.
4. Floating, minimize, minimum size, maximize/fullscreen and resize: 16 N + 1 U.
5. Activation, close and mouse: 8 N.
6. Restart/persistence, special windows and controls: 5 N + 10 U.
7. Independent final reconciliation, triage update, archive, commit and push.

Workers use `muse-spark`, one active at a time; separate verification Workers
follow each fill unit. The Lead owns this note and the triage report.

## Accepted evidence and outcome

- Initial workspace clean at `c023391`; three user stashes present.
- Orientation confirmed the matrix's full pin and clean sibling checkout at
  `/home/beefsack/Development/paneru`. Layout is a strip of Single/Stack/native
  Tabs columns. Directional swap is same-strip, with North/South-only display
  fall-through. AX/CG native outcomes remain host-owned where decisive.
- Shipped bindings are empty; operations are configured explicitly. Admission
  is role/rule-gated, not size-hint-gated. Restore defaults on; reaping and
  automatic virtual-row creation default off. All subsequent units receive
  the orientation source map and these policy boundaries.
- Unit 2: 16 N + 1 U attempted; 12 N + 1 U closed, 2 H
  (INS-06, COL-10), 2 F (COL-07/09: unstated Follow/Stay input).
  Independent verification corrected Stack/tabbed-display scope and traced
  fullscreen admission before retaining its opaque native-Space remainder.
  The verifier's initial summary miscount was reconciled against literal TBDs.
- Unit 3: 12 N + 1 U attempted and closed, including both MOV-01
  occurrences and MOV-03's explicit-swap leg. Independent verification
  corrected WS-05: virtual transfer re-inserts the still-Floating window
  without clearing `Unmanaged`; it is not fresh tiled admission. WS-18's
  move-path row creation was confirmed despite a contradictory source comment.
  No material approved-rule contradictions in either accepted slice.
- Unit 4: 16 N + 1 U attempted; 9 N + 1 U closed, 2 H
  (FLT-13, MNZ-03), 2 F (MNZ-01/02: nearest-center geometry), 3 L
  (MIN-01/02/03: client frames/recovery). Independent verification corrected
  float z-order retention, the fullscreen host-event wording and a stale
  minimized-state source path; all residual literal TBDs were counted as blockers.
- Unit 5: 8 N attempted; 2 closed (DRAG-05, MOU-02), 4 H
  (ACT-01/02, CLOSE-02/03), 2 F (CLOSE-01/04: nearest-center geometry).
  Independent verification removed unnecessary mouse pixel/grab-input blockers,
  qualified close handoff and distinguished synthesized focus policy from
  host physical focus acceptance; added the guarded event/focus source key.
- Unit 6: 5 N + 10 U attempted; 3 N + all 10 U closed, 2 H
  (RST-01, SPC-13: host restart focus), with secondary live-frame fixture
  and settlement limits. Independent verification extended restore/admission
  citations and replaced generic strip/F-handling TBDs with traced outcomes:
  matched strip order restores, widths re-derive from live frames, unmatched
  no-rule F freshly tiles, and restore writes no focus.
- All 70 candidates attempted: **38 N + 13 U closed (51)**; **19 N
  reclassified H10/F6/L3**. Paneru residual: **41 (H28/F9/L4)**, no N/U.
  Global reference TBD count: **876**, down from 927. No material
  approved-rule contradictions in any slice.
- New reusable keys: `S-pan-stripwidth`, `S-pan-focus`, `S-pan-stack`,
  `S-pan-focusobs`. Existing fullscreen, virtual-row, float, minimized,
  admission and restore keys were extended with verified source ranges.
- Independent final occurrence-aware reconciliation passed: all 70 changed
  occurrences exactly match baseline N/U candidates; original H18/F3/L1,
  resolved paneru cells, every other profile and all scenario text are unchanged.
  Reference cells remain 1,896; Ours remains 169 TBD. Per-WM and N-area
  tables reconcile to N321/H69/F216/L111/U159; fixture ledger totals 216
  across 80 rows. Other WMs' existing per-cell classes were carried forward
  from the previously verified triage, not retraced in this pass.
- The initial final-check script had an incorrect exclusion intersection,
  incomplete scope checks and a bypass; its report was rejected. One bounded
  evidence repair produced strict occurrence/scope checks and executable
  row/column arithmetic with nonzero exit on failure. Lead reran the repaired
  check after integration: all 29 checks passed. A retained out-of-bounds
  reaping citation was corrected to the inspected function's `1351-1383`.
- All touched citation blocks resolve to real files/ranges at the full pin;
  29 paneru keys are unique and all cell citations resolve. Diff whitespace
  and scope passed. Source checkout remains clean at the full pin and all
  three user stashes are intact. Documentation only; no live testing.
- Final temporary evidence: `/tmp/opencode/paneru-final-reconcile-v2.py`
  and `/tmp/opencode/paneru-final-reconcile-v2.json`. These supersede the
  rejected initial checker and are not repository dependencies.
- Exact next action for this paneru source pass: none. No N/U areas remain;
  opaque macOS host policy, missing fixture inputs and live observations
  remain user-owned.
