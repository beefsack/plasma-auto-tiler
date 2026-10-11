# Windows directional dogfood diagnosis

Status: complete, KDE/core parity confirmed, 2026-10-02. Baseline: `49d4191`.

## Goal and acceptance

- Diagnose final Win+Shift+Up/Down actions in dogfood trace
  `run-01dd52415c2991a6.log`, including Engine planning and native outcomes.
- Preserve KDE/shared-core directional semantics. Fix a confirmed Windows
  adapter divergence with targeted regression and scoped live evidence.
- Close and archive the physically accepted minimum-size change; commit,
  push and check CI after accepted evidence.

## Approach

1. Trace diagnosis, then offline reconstruction of structural planning where
   the existing log omits topology/rules.
2. If needed, bounded Windows adapter fix and regression coverage, independent
   mutation review, scoped Paint/Notepad live journey and native gates.
3. Record outcome, archive completed notes, reconcile backlog, commit and CI.

## Diagnosis and parity verdict

- No Windows adapter defect found; no production code or semantics changed.
  A fresh independent offline replay matched all 38 move plans and 152 logged
  readbacks. The replay reconstructed the retained topology, because the trace
  itself does not include the fired rule or tree.
- Near the end the retained tree was `H[w28,V[w26,w27,w25]]`, a three-child
  vertical group, rather than an enduring two-leaf pair. Down from its middle
  child `w27` wrapped `w27,w25` (R2c); subsequent Up from that pair's top child
  escaped to the parent (R3). Neither action requests a swap.
- Token `w27` has the known Paint visible minimum 864x617. The log omits
  executable identities, so Paint/Terminal token names remain inferred from
  size signatures and the user's report, not proven native identity.

| Tick / direction | Trace lines | Replayed Engine rule | Native result |
| --- | --- | --- | --- |
| 62 Down / 63 Up | 468-487 | R2c wrap / R3 escape | 3 writes each; dimensions changed, order retained |
| 67 Down / 68 Up | 502-521 | R2c wrap / R3 escape | 3 writes each; dimensions changed, order retained |
| 69 Down | 522-528 | R2c wrap | Zero writes; all readbacks match |
| 71 Up | 535-541 | R3 escape | Zero writes; all readbacks match |
| 72 Down | 542-548 | R2c wrap | Zero writes; all readbacks match |
| 73 Up | 549-555 | R3 escape | Zero writes; all readbacks match |

- Final chords were received/classified/consumed as `move` from `w27`
  (527/540/547/554), dispatched to the Engine and returned `MoveDirectional`.
  No planner refusal, overconstrained skip, refused-intent skip, setter veto or
  mismatch occurred. Four hints were freshly queried successfully each time
  (522-523/535-536/542-543/549-550).
- Plans (524/537/544/551) equal tick 68: `w26` top `(1143,8,1409,246)`,
  `w27` middle `(1143,262,1409,617)`, `w25` bottom `(1143,887,1409,485)`;
  `w28` left `(8,8,1127,1364)`. Readbacks match (525/538/545/552).
- Minimum enforcement pins the column to heights 246/617/485 in the 1348px
  available after sibling gaps. The new R2c pair spans 1110px including its
  gap; its equal 551/551 allocation becomes 617/485 after redistribution.
  R3 produces the same visible result. This is feasible minimum redistribution,
  not proportional overconstrained fallback or refused-tracker suppression.
- `move-noop` is an adapter outcome for zero native writes, not proof of a
  structural Engine no-op: these four moves commit nested/flat topology changes.
  Source: `tiling_sys.rs:2750-2789,2831-2860`; identical observed geometry
  bypasses setters and calls `note_match` at `1845-1848`.
- KDE uses the same core movement and minimum-aware projection. R2a swaps a
  parallel two-child leaf neighbor (`directional.rs:817-828`); R2c wraps a
  neighbor in three-or-more-child groups (`886-895`); outward movement from a
  nested pair escapes via R3 (`912-928`). See the conformance rules R2a/R2c/R3
  and `size_hints.rs:250-305`. The true vertical two-leaf Paint617/Terminal95
  control swapped visibly both Down and Up; outward root edges returned
  `planner-noop`. No parity change is selected.

## Verification and evidence

- RunDir: `target/windows-directional-diagnosis/20261002-180400/`.
  Contains the trace copy, per-move rule/capability/pre-post tree/flags in
  `replay-output.json`, `control-output.json`, saved reproducer
  `tmp-replay-test.rs.txt`, and `manifest.md`. The temporary integration test
  passed 2/2 and was removed; the saved text can reproduce the investigation.
- Trace: `%LOCALAPPDATA%/omnitiler/session-1/run-01dd52415c2991a6.log`,
  602 lines; SHA-256
  `B32C059D26D3D9D2F18CAEF081BA2F94C293BCE5DBAF52B440D2C7EBD0F46EDF`.
- Current-source native build/test/strict clippy for `tiler-core`,
  `tiler-protocol`, `tiler-kwin-effect-ffi`, `tiler-windows`, all-package fmt
  and whitespace gates pass. Commands are in the evidence manifest.
- No live mutation journey was needed because no adapter defect was found.
  Read-only end check at `2026-10-02T08:15:05Z`: zero project processes,
  no ledger JSON or requests, arranging raw 1, pen raw 35. Notepad, Paint and
  exe-child-verified Calculator main windows visible and unminimized. Native
  invisible IME/GDI helper windows are not hidden managed app windows. Evidence:
  `endstate-verify.json` and `endstate-verify.txt` in the same RunDir.

## Outcome and succession

- Minimum-size physical acceptance and populated-workspace send were supplied
  by the user in this session; prior automated select evidence is not send proof.
  That change is archived and its backlog item closed.
- Diagnostic caveat: zero-write moves still advance retained revisions and
  alter shares (final 3520/19683/35846). No failure occurred; long repetition
  was not tested. Shared behavior changes require a product-intent decision.
- Next action for this item: none. Following product item: Windows active
  window border, then group underlay. Use `tiler_core::visual` policy and fresh
  visible-frame physical-pixel geometry; native stacking/rendering/suppression
  require their own evidence. Multi-monitor/mixed-DPI remains unaccepted.
