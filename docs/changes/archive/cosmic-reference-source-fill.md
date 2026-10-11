# COSMIC reference source-fill

## Goal and scope

- Baseline `b3d7265`: attempt COSMIC's 41 N and 8 U cells using read-only
  cosmic-comp source at `3d55cba06c9cf6f27609cdefb520f7857dba20af`, as
  recorded in the matrix index.
- Documentation only. Preserve scenarios, other profiles, approved rules,
  source checkouts and the user's three stashes. No live testing.
- Existing H0/F19/L14 cells are excluded. Newly discovered blockers retain
  TBD with reasons and are reclassified H/F/L.

## Acceptance and approach

- Learn the codebase once; pass its compact source map to every fill Worker.
- Trace every candidate without guessing and independently source-verify each
  area slice before acceptance.
- Report COSMIC differences from approved rules with rule locations and source
  citations, including whether a recorded deliberate deviation covers each.
- Verify occurrence-aware coverage, citation resolution, preserved scenarios,
  diff scope and whitespace; reconcile triage ledgers and global counts.
- Archive this note, commit and push only intended documentation.

## Bounded units

1. Orientation, pin verification and exact candidate inventory (complete).
2. Insertion, close, groups and move: 10 N (complete).
3. Floating, minimize, minimum size and maximize/fullscreen: 12 N (complete).
4. Workspaces, multi-output and mouse: 8 N (complete).
5. Restart/persistence, controls and special windows: 11 N + 8 U (complete).
6. Final independent reconciliation, triage integration, archive and delivery.

Workers use `muse-spark`, one active at a time; separate source-verification
Workers follow each fill slice. The Lead owns this note and the triage report.

## Accepted evidence and outcome

- Initial workspace clean at `b3d7265`, tracking `origin/main`; three user
  stashes present. Matrix full pin and clean sibling checkout confirmed at
  `upstream pop-os/cosmic-comp repository`; sparse temporary exports rejected.
- Orientation reconciled all 49 candidates. Shared map: geometric MRU-leaf
  admission, separate tiled/floating focus paths, native workspace-first
  vertical move fallback, retain-slot maximize, saved-slot fullscreen,
  fresh-map unfloat and sequential workspace enable, stack-specific move paths.
- Unit 2: all 10 N attempted; 6 closed, 4 F (CLOSE-05, INS-04/06,
  MOV-08). Independent verification corrected pre-close unmaximize and
  MOV-07's tree notation, extended close citations, corrected workspace-layout
  and fallback ranges, and removed stale stack-join inventory wording.
- Rule comparison: MOV-08 origin-distance differs from approved window-based
  output selection and is explicitly covered by decisions item 5.2. COSMIC's
  workspace-first Up fallback differs from the R4 rule excluding workspace
  cycling; no explicit recorded COSMIC deviation covers that ordering. No
  approval inferred and no rule changed. Precise citations will accompany
  the final handover.
- Unit 3: 12 N attempted; 5 closed, 3 F (MIN-01/03, MAX-09), 4 L
  (FLT-05, MIN-02, MAX-01/05). Initial author left deterministic policy
  untraced and proposed excess live blockers; independent corrections traced
  sticky visibility, lower inventory, minimize focus/lifecycle and maximized
  move, corrected minimum-allocation citations, and derived MIN-02 shrink
  shares from the supplied fixture. No literal TBD counted as closed.
- Unit 4: 8 N attempted; 3 closed, 5 F (MOU-02/03, OUT-06, WS-12/20).
  Independent follow-up traced frame focus fixup and shipped send defaults,
  replaced untraced cleanup timing with convergent lifecycle policy, and removed
  WS-22's out-of-Observe pixel blocker. OUT-06 retains secondary live visuals.
- Unit 5: 11 N + 8 U attempted; 7 N + all 8 U closed, 1 H (RST-02),
  2 F (CTL-04, SPC-07), 1 L (START-03). Independent review rejected
  allocation-equals-client-response, separated pinned override persistence,
  traced sticky unfloat refusal and closed scoped unsupported journeys.
- Final verifier corrected missing literal TBDs in CTL-04/WS-20, identified
  cosmic-session as RST-02's missing host, and traced already-lockfile-pinned
  smithay/x11rb instead of treating incomplete dependency tracing as H.
  SPC-07's remaining F is the X11 encoding of per-axis absent height.
  Lead review corrected a wrong input-file citation and a checker boolean
  bypass; the repaired check asserts occurrence-key uniqueness, exact blocker
  classes, literal TBD accounting and stash object identities.
- All **49 candidates attempted: 21 N + 8 U closed (29)**; **20 N
  reclassified H1/F14/L5**. COSMIC residual **53 (H1/F33/L19)**;
  global references **847 TBD: N280/H70/F230/L116/U151**, down from 876.
  Original F19/L14, resolved COSMIC cells, other profiles and scenarios preserved.

## COSMIC versus approved rules

All cosmic-comp locations below are at
`3d55cba06c9cf6f27609cdefb520f7857dba20af`; source keys resolve in the
[matrix index](../../spec/reference-outcomes.md). Rules were not edited.

### Comparisons requiring user review

| Case | Approved rule location | COSMIC source evidence | Explicit deliberate-deviation coverage |
|---|---|---|---|
| MOV-08: Up tries previous workspace before output; Ours crosses directly after local exhaustion | `docs/decisions.md:1635-1647`, especially no workspace cycling; `docs/spec/functional-spec.md:110-111` REQ-MOV-08/08b | `src/input/actions.rs:436-510,812-880`, `S-cos-move-out` | None for workspace-first ordering; item 5.2 covers the selection metric only |
| MAX-08: COSMIC maximized focus is fenced; Windows policy permits entering/leaving | `docs/decisions.md:1458-1461` | `src/shell/mod.rs:4140-4143`, `S-cos-maxmove` | None found; REQ-MAX-08 at `functional-spec.md:219` still says OPEN/unselected, a cross-document policy-status inconsistency |
| MAX-08: COSMIC unmaximizes then performs ordinary move; Windows policy refuses maximized movement | `docs/decisions.md:1460` | `src/shell/mod.rs:4239-4253`, `src/shell/layout/tiling/mod.rs:1781-1814`, `S-cos-maxmove` + `S-cos-move` | None found; same REQ-MAX-08 OPEN inconsistency |
| MAX-09: tiled-target workspace send drops maximize; Windows policy preserves it | `docs/decisions.md:1461-1462` | `src/shell/workspace.rs:648-653`, `src/shell/mod.rs:3587-3603`, `S-cos-sendoverlay` | None found; REQ-MAX-09 at `functional-spec.md:220` calls maximize unresolved, so selection/status needs user reconciliation |
| CTL-04: pinned workspace override survives restart; Ours resets every override | `docs/decisions.md:148-151`; `docs/spec/functional-spec.md:326` REQ-CTL-04 | `src/shell/workspace.rs:455-471`, `src/shell/mod.rs:853-864,867-935,1511-1524`, `S-cos-persist` | None found; exact fixture outcome remains F because pin status is unstated |
| WS-20: sole-window next send refuses/branches by inferred chord instead of filling pre-transfer E | `docs/decisions.md:257-259,275-279` scoped ring; REQ-WS-14 | `src/shell/mod.rs:3181-3194`, `src/input/actions.rs:35-42,348-530`, `S-cos-wssingle` + `S-cos-ws` | None found; exact invoked chord is F |
| SPC-07: equal sentinel hints float; Ours rejects sentinel vectors | `docs/decisions.md:425-435` D1; REQ-SPC-04a | `src/shell/layout/mod.rs:47-55`, `src/shell/element/surface.rs:565-595`, lockfile-pinned X11 mapping in `S-cos-fixed-hints` | D1 explicitly selects sentinel exclusion, but no explicit COSMIC-deviation label covers this case; partial-zero alignment is separate |
| OUT-06: disconnecting focused R leaves L's occupied workspace shown and keyboard fixup chooses L's shown-workspace MRU; Ours shows the relocated R workspace with its active focus | `docs/decisions.md:183-207`, especially `195-197`; `docs/spec/functional-spec.md:282` REQ-OUT-06 | `src/shell/mod.rs:937-1029`, `src/shell/focus/mod.rs:553-616,684-790`, `S-cos-outremove` + `S-cos-focusfix` | None found; exact L focus node remains F. Merging workspace sets is not merging their separate layouts and is not an additional difference |

### Comparisons already covered

- Output selection: origin-distance instead of window-position/largest-shared-edge
  (`src/shell/mod.rs:2273-2300`, `S-cos-move-out`), explicitly covered by
  decisions item 5.2 at `385-397`, including whole-workspace migration.
- START-01/02: nested frozen-MRU chain and non-guaranteed roundtrip identity
  instead of clean recursive-cut fit (`src/shell/workspace.rs:1433-1489`,
  `S-cos-wstile`/`S-cos-last`/`S-cos-axis`): startup adoption explicitly says
  not exact COSMIC parity (`docs/decisions.md:709-713`, REQ-START-01/02).
- MIN-01..03/START-03: ignore tiled minima instead of B6 origin+minimum
  (`src/shell/layout/tiling/mod.rs:2998-3128`, `S-cos-min`): documented
  deliberate minimum-policy deviation, REQ-MIN-01..03/START-03.
- MAX-05: no preimage refusal (`src/input/actions.rs:927-953`,
  `src/shell/mod.rs:4891-5048`, `S-cos-fsact`/`S-cos-fsrestore`): Windows
  retains refusal despite unanimous exit consensus, REQ-MAX-05/05b and
  `docs/decisions.md:1483-1485`.
- SPC-12: auto fixed and intentional C re-tile without reclassification
  (`src/shell/workspace.rs:1440-1454`, `S-cos-fixed-workspace`): explicit
  fixed-size D6 COSMIC deviation, `docs/decisions.md:455-460`, REQ-SPC-04f.
  This D6 is workspace enable, not the separate migration-focus D6.

## Final verification and next action

- Four separately authored source reviews plus final occurrence-aware review.
  Repaired temporary checker: `cosmic-final-reconcile-20261009.py`
  and its JSON output. Initial final-check claims were not accepted until the
  cited-file and boolean/occurrence/accounting repairs passed.
- Final integrated check: 95 assertions passed. Exactly 1,896 reference
  occurrences remain; Ours remains 169 TBD. All 49 changed occurrences match
  baseline N/U; original F19/L14 unchanged; no scenario/profile/rule changes.
- Eight new and eleven extended COSMIC source keys; all touched ranges resolve
  at the compositor/lockfile dependency pins. No new source revision selected.
- Independent triage reconciliation passed: every per-WM class partition,
  actual TBD count and N-area row/column sum; fixture ledger totals 230 across
  88 rows; COSMIC H/F/L ledger matches all 53 residual occurrences. Other WMs'
  classes/membership unchanged. Source checkout clean at its full pin; all
  three initial stash object identities unchanged. Whitespace/scope passed.
- Post-archive Lead rerun exposed a temporary checker hardcoded to the active
  note path; repaired it to require exactly one active/archive note and removed
  a redundant always-true clause in a rule-support assertion. Final archived
  rerun passed all 95 checks before authorized delivery.
- Exact next action for this COSMIC source-fill pass: none. No N/U areas
  remain. User review of the comparisons above, cosmic-session pinning,
  missing fixture inputs and live-only observations are separate follow-up work.
