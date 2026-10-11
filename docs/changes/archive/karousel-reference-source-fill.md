# karousel reference source-fill

## Goal and scope

- Baseline `f04511c`: attempt karousel's 58 N and 8 U cells in the remaining
  reference triage, using read-only source at
  `8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b` and pinned KDE/kwin `8438567a`.
- Documentation only. Preserve scenario wording, other profiles, approved
  rules, source checkouts and the user's three stashes. No live testing.
- Existing 3 F and 4 L cells are excluded. Newly discovered blockers retain
  TBD with a reason and are reclassified H/F/L in the triage report.

## Acceptance and approach

- Learn the codebase once; pass its short source map to context-sized fill units.
- Trace every candidate without guessing; use pinned GitHub raw URLs for KWin.
  Report material contradictions with approved rules without changing the rules.
- Independently source-verify every slice before acceptance. Check actual diffs,
  occurrence-aware counts, citation resolution, unchanged scenarios and whitespace.
- Reconcile triage counts and ledgers and archive this note.

## Bounded units

1. Source orientation and pin verification.
2. Insertion, columns, focus and layout commands: 11 N.
3. Floating, close, minimize, maximize/fullscreen, resize and minima: 19 N.
4. Workspaces: 8 N (trace pinned host where needed).
5. Mouse and groups/stacks: 6 N.
6. Restart/persistence and special windows: 14 N and 1 U; controls: 7 U.
7. Independent final reconciliation, triage update and archive.

## Accepted evidence and outcome

- Initial workspace is clean at `f04511c`; three user stashes are present.
- Orientation confirmed the full matrix pin and clean sibling checkout at
  `upstream peterfajdiga/karousel repository`. The upstream KWin source at pinned commit 8438567a
  is an export, not a git checkout; host citations use pinned raw URLs.
- Unit 2: 11 N attempted; 2 closed (INS-08, FOC-01), 9 F
  (INS-01..07, COL-01, LAY-06). Independent review rejected unfinished
  host tracing as live-only; a correction traced X11/Wayland newcomer
  activation and named omitted fixture inputs. Corrected slice accepted.
- Unit 3: 19 N attempted; 12 closed, 6 F (CLOSE-02, FLT-12,
  MAX-06, MIN-01/03, RSZ-01), 1 L (MAX-01). Independent native-path
  tracing corrected generic host remainders, unminimize/newcomer confusion,
  sticky transitions, close refocus and unnecessary exact-pixel claims.
  A separate final check source-verified the corrected 19-cell slice.
- Unit 4: 8 N attempted; all closed after independent verification and
  final integration. Corrected source-vs-target focus recipient, native
  desktop switching, explicit-only desktop lifecycle and tiled-only float
  return. Final review dropped an unnecessary pixel TBD; WS-02's stale sole-A description corrected
  to the fixture's retained C then A.
- Unit 5: 6 N attempted; 5 closed, DRAG-05 reclassified F
  (title-bar hold duration vs host startDragTime). Independent host tracing
  closed the switcher target as unsupported and split zero-move producers.
  Final review removed an unnecessary exact-drop-frame TBD in DRAG-06.
- Unit 6: 14 N + 8 U attempted; 2 N and all 8 U closed, 8 F
  (START-01..03, RST-01/03, SPC-01/02/13), 1 H (RST-02:
  unpinned ksmserver/app session participation), 3 L (SPC-05/10/11).
  Independent verification corrected X11 zero/partial-zero hint handling,
  startup creation-order evidence, splash-vs-utility activation gates and
  the inverted born-fullscreen admission condition; all findings resolved.
- All 66 candidates attempted: **29 N + 8 U closed (37)**; **29 N
  reclassified H1/F24/L4**. Karousel residual: **36 (H1/F27/L8)**,
  no N/U. Global reference TBD count: **927**, down from 964.
- No material contradictions with approved decisions or functional rules.
  SPC-11's existing Observe still describes the cross-profile discriminator
  as TBD; determinate source sub-legs do not alter that scenario or rule.
- Reusable host keys in the matrix index: `S-kwin-scriptact` (existing
  mapped-window focus), `S-kwin-switch` (native desktop MRU),
  `S-kwin-desktops` (explicit-only lifecycle), `S-kwin-sticky`,
  `S-kwin-close`, `S-kwin-min`, `S-kwin-moveresize`, `S-kwin-winorder`.
  `S-kwin-manage/add` apply only to first-map/newcomer activation, not
  script focus or unminimize. Missing fixture inputs are F; unfinished
  pinned-host tracing is not H/L. Observe determines needed precision.
- Independent final occurrence-aware reconciliation covers all 66 changed
  cells, original 3 F/4 L exclusions, other profiles, scenario wording,
  citation keys/pins, triage tables/ledgers and whitespace: passed after
  final integration. Reference cells: 1,896; triage N378/H59/F210/L108/U172;
  fixture ledger: 210 cells across 75 rows. Ten new KWin keys resolve with
  pinned raw URLs and introduce no duplicate keys. Source checkout is clean
  at the full pin and the three user stashes remain intact.
- Temporary final verification evidence:
  `verify-karousel-accept.py` and its output. This supersedes
  the earlier KAR-only `verify-karousel-final.py` check; the final parser
  preserves repeated MOV-01/03 main/swap occurrences. No acceptance gaps
  remain within the authorized N/U source-pass scope.
- Exact next action for this karousel source pass: none. Remaining
  session-manager source, fixture inputs and live observations are user-owned.
