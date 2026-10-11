# Functional specification draft

## Scope and acceptance

- Deliver the provisional cross-platform functional specification for backlog P1.
- Mirror all 18 matrix areas and cover all 125 scenario IDs, including variant hooks.
- Normative requirements require a recorded selected user decision and matrix test links. Pending choices stay OPEN; provisional decisions stay PROVISIONAL.
- Record KDE/Windows/macOS applicability and implementation gaps per requirement; collect default shortcuts and an end-of-spec open-decision index.
- Report source contradictions without changing product behavior. No live testing.
- Use one specification file if readable.

## Sources

- `docs/spec/reference-outcomes.md` and `docs/spec/reference-outcomes/*.md`.
- `docs/research/reference-wm-consensus.md`, especially Table A and undecided predicates.
- `docs/decisions.md`; existing shortcut catalogs in `kwin/src/plan-adapter-entry.ts`, `kwin/src/workspace-native.ts` and `crates/tiler-windows/src/settings.rs`.
- `docs/backlog.md` and cited implementation paths for current gaps.

## Bounded units and verification

1. Read-only source mapping informed the draft; sources were checked during drafting and review.
2. Draft wrote `docs/spec/functional-spec.md`; an independent sample checked decision fidelity, scenario alignment, shortcuts and platform scope.
3. Review initially blocked acceptance: over-claimed choices, mismatched scenarios, incomplete chords and missing precise links. Corrections demoted unsupported claims, separated platform scope and selected targets from pending choices, and fixed citations. Final independent sample: ACCEPT, no residual serious findings in the sample.
4. Integrated the corrections and checked all 125 scenario IDs, all 24 Table A predicates, unique requirement IDs/table shape, 323 local links and fragments, normative/provisional decision anchors, ASCII and complete OPEN/PROVISIONAL index coverage. All passed. `git diff --check` passed; no live tests.

## Flagged contradictions

- Q3 selects reserved-slot admission, while R-MAX-06 Ours cells still call preserve variants unselected. Their one-shot-clear description matches lagging code; the selection label is stale.
- B6 selects origin+minimum on both platforms; KDE code and matrix still report skipped overconstrained writes. Recorded implementation gap, not a reversal of B6.
- Selected float-origin focus/half-snaps still meet Windows subject refusal; parity is pending, not an intentional platform difference.
- Selected KDE no-size-inference rule vs Windows captionless-containment classification: portable consistency gap with Table A R-MAX-07 choice explicitly OPEN.
- B9 provisional stay-maximized unfloat differs from COSMIC source unmaximize-then-admit; user live check remains pending. Windows refusal remains current while that check is outstanding.
- R-MAX-03 floating-to-tiled one-shot restore overlaps Q3 scope; the recorded open question is preserved, without asserting two conflicting normative paths.
- Older maximize-clear and Windows skip-write decisions are explicitly superseded; consensus disagreements alone are not contradictions. Windows resize/non-local workspace catalogs expose unavailable runtime, recorded as gaps rather than supported actions.

## Outcome

- Complete first draft at `docs/spec/functional-spec.md`: one file, 18 matrix areas, one default-action shortcut table, contradiction notes and grouped open index. Format is "Provisional, to discuss".
- 144 requirement rows: 49 NORMATIVE, 84 OPEN, 11 PROVISIONAL. All 125 input scenarios covered; all 24 Table A predicates explicitly OPEN (22 rows, with three minimum predicates grouped).
- 12 selected KDE/Windows gap rows: REQ-RSZ-01; REQ-FLT-08/09/10/11; REQ-MAX-06/07; REQ-MIN-01/02/03; REQ-START-03; REQ-CTL-05a. macOS adapter absence is counted separately once platform-wide.
- No product choices made. Backlog, principles and decisions were not edited.
- Backlog handover: P1 "Cross-platform functional specification" has its first provisional draft; finalization still requires user review of the grouped OPEN/PROVISIONAL index.
- Exact next action: user reviews the open index, starting with Q3 floating-to-tiled scope and B9's discriminating COSMIC R-FLT-06 check. No live check was performed or authorized by this documentation change.
