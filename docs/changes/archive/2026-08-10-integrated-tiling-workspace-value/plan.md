# Plan: Integrated Tiling and Workspace Value Audit

Ownership and approval:
- Owner: Lead
- Status: Approved.

## Technical Approach

Assess the same critical workflows for every full comparator before drawing a
product conclusion. Establish the rubric and versioned baseline first, collect
current source/documentation evidence second, validate only disputed
high-impact claims through safe hands-on observation, then apply the approved
Decision Rule. A component is not treated as part of the Krohnkite baseline
unless its end-to-end installation and configuration role is evidenced.

Multi-output handling remains a first-class product dimension across all full
comparators. The reopened rubric also evaluates the structural-authoring and
direct-placement workflow: arbitrary-leaf horizontal/vertical splitting,
keyboard-directed insertion, pointer-directed drag-to-split placement,
persistent structure independent of window ordering, automatic placement that
preserves authored structure, and empty-branch collapse/retention semantics.
bspwm is a bounded reference for that workflow only, not a full desktop
comparator. The audit must establish, not assume, whether the Krohnkite/
companion baseline has material workflow gaps and whether an integrated Plasma
product could plausibly improve the selected combination of workflows.

## Work Units

| ID | Status | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|---|
| unit-01 | Accepted 2026-08-10 | Revise the versioned rubric, journeys, fair baseline assumptions, and operational definitions for multi-output and structural authoring/direct placement. Bound bspwm to the latter reference role only. | - | `research/evaluation-rubric.md` | No | Every required structural workflow element has observable criteria; full-comparator and bspwm-reference boundaries are explicit; all multi-output criteria remain complete. |
| unit-02 | Accepted 2026-08-10 | Reassess stock Plasma and Krohnkite plus evidenced companion components against the revised rubric, including authored-structure preservation and all multi-output workflows. | unit-01 | `research/plasma-krohnkite-baseline.md` | No, except a later safe observation authorized by the plan gate | Current source/docs support every capability claim; every structural workflow element has evidence or an explicit unknown; each required companion component is justified or recorded unknown; unverified baseline behavior is not called a failure. |
| unit-03 | Accepted 2026-08-10 | Reassess COSMIC and Hyprland against the revised rubric, and document bspwm's versioned structural-authoring/direct-placement reference evidence without extending it into a desktop-wide comparison. | unit-01 | `research/cosmic-hyprland-comparison.md` | No, except a later safe observation authorized by the plan gate | Current source/docs support every full-comparator claim; COSMIC/Hyprland and bspwm structural evidence cover each required element or an explicit unknown; semantic differences and the bspwm scope boundary are recorded. |
| unit-04 | Accepted and preserved | Preserve the accepted disputed-claim validation evidence. Do not dispatch this unit unless reopened units identify a specific new runtime-only, high-impact claim that requires safe validation. | Historical unit-02, unit-03 evidence | `research/hands-on-validation.md` | Conditionally; stop before any configuration, package, session, output, or window-layout change | Preserved evidence remains cited and status remains accepted; any later validation need must identify its claim, environment, reversal, and authorization before dispatch. |
| unit-05 | Accepted 2026-08-10 | Reproduce the product-justification findings using the reopened evidence and apply the revised Decision Rule, including the recommendation for sustained-workload validation. | unit-01, unit-02, unit-03; preserved unit-04 evidence where relevant | `findings.md` | No | Every acceptance criterion maps to revised cited evidence or an explicit unknown; the conclusion evaluates the coherent combination of selected workflows, does not credit bspwm outside its bounded reference role, and is strong justification, narrow differentiated product, or insufficient value. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Safety Gates

- Source and documentation research does not require live-session interaction.
- Before unit-04 performs any hands-on check, the Lead must describe the exact
  environment, actions, reversal, and affected user state. No check proceeds
  when it requires modifying the user's working Plasma configuration, installing
  software, switching sessions, changing outputs, or creating a disruptive
  window layout without explicit authorization.

## Progress

- [x] unit-01 Reopened rubric and comparator/reference boundary
- [x] unit-02 Reopened Plasma and Krohnkite baseline
- [x] unit-03 Reopened: COSMIC, Hyprland, and bounded bspwm reference
- [x] unit-04 Conditional safe hands-on validation
- [x] unit-05 Reopened: product-justification findings

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Versioned full-comparator comparison and bounded bspwm reference | `unit-01`, `unit-02`, and `unit-03` accepted: rubric sections 2.3 and 3.5 define the pinned bspwm scope; `research/plasma-krohnkite-baseline.md` sections 1, 3, 4, 4A, and 6 cover the Plasma/Krohnkite baseline; `research/cosmic-hyprland-comparison.md` sections 1, 3, 4, 4A-4C, and 6 cover COSMIC/Hyprland and the bounded bspwm reference |
| Critical workflows distinguished from feature trivia | `unit-01` and `unit-05` accepted: `research/evaluation-rubric.md` sections 5 D9 and 8-9.1; `findings.md` sections 1-3, 6, and 8 apply the target-segment workflow distinction and Decision Rule without feature counting |
| Structural authoring/direct placement evidence or explicit unknowns | `unit-01`, `unit-02`, and `unit-03` accepted: rubric sections 5 D9, 6 J9-J10, 7, 10-12.1; baseline report sections 3 J9-J10, 4A, 5, and 6; COSMIC/Hyprland report sections 3 J9-J10, 4A-4C, and 6 classify every full-comparator structural cell and scope bspwm 0.9.12 to its reference cells |
| Complete multi-output evaluation or explicit unknowns | `unit-01`, `unit-02`, and `unit-03` accepted: rubric sections 5 D4.8-D4.11 and 7; baseline report section 4; COSMIC/Hyprland report section 4 records the full-comparator D4.8-D4.11 structural-state model only where source supports it; accepted `research/hands-on-validation.md` remains supplemental evidence |
| Krohnkite baseline claims evidenced | `unit-02` accepted: `research/plasma-krohnkite-baseline.md` sections 3 J9-J10, 4, 4A, 5, and 6; accepted `research/hands-on-validation.md` remains supplemental evidence |
| Hands-on checks safe and reproducible | Accepted `research/hands-on-validation.md`; no new runtime check is authorized by this amendment |
| Decision Rule applied to the sustained-workload recommendation | Accepted `unit-05`: `findings.md` sections 2-3 and 8 apply the revised Decision Rule as strong justification for the approved target segment; sections 9 and 11 retain UKs and recommend only a narrow feasibility/performance gate, preserving Q-A/Q-B |

## Residual Risks

- Comparator research can expand into feature parity; the workflow rubric and
  Decision Rules limit the audit to material product gaps.
- Dynamic-workspace, structural-authoring, and multi-output terms may differ
  between environments; unit-01 must preserve those semantic differences.
- bspwm evidence could be overextended into a desktop-wide comparison; unit-03
  must retain its bounded reference role.
- Safe hands-on evidence may be unavailable. Unknowns cannot be converted into
  product claims.
- An identified gap may be real but not plausibly solvable through a coherent
  Plasma product; unit-05 must keep those questions separate.

## Historical Accepted Outcomes (Pre-Amendment)

- `unit-01` accepted on 2026-08-09. The evidence rubric, baseline assumptions,
  source-dated version pins, unknowns registry, and Decision Rule mapping are
  ready for unit-02 through unit-04. No comparator capability conclusion has
  been made.
- `unit-02` accepted on 2026-08-09. Source-only evidence covers all stock
  Plasma and Krohnkite journeys and multi-output dimensions. Runtime-dependent
  claims remain explicit unit-04 candidates; no product conclusion has been
  made.
- `unit-03` accepted on 2026-08-09. Source-only evidence covers all COSMIC and
  Hyprland journeys and multi-output dimensions. Runtime-dependent claims and
  packaging-default ambiguity remain explicit unit-04 candidates; no product
  conclusion has been made.
- `unit-04` accepted on 2026-08-09. Pinned-source, KWin integration-test-source,
  and upstream-fix evidence establishes Krohnkite 0.9.9.2's per-output-desktop
  mis-keying as D4.1 MF, while Krohnkite hotplug remains D4.4 UK because no safe
  end-to-end observation exists. COSMIC's source-default `autotile=false` is
  scored once as J1/D6.1 MF enablement friction, not tiling-workflow friction.
  No live session interaction occurred; no product conclusion has been made.
- `unit-05` accepted on 2026-08-09. The mechanical Decision Rule application
  finds a narrow differentiated product, not strong justification: the baseline
  has no evidenced high-frequency CB, but repeatable multi-output and coherence
  MFs remain. Sustained-workload validation stays paused pending the technical
   report's Phase 0 benchmark; accepted Q-A/Q-B work is preserved unchanged.

## Amendment Status

- On 2026-08-10, the user approved reopening `unit-01`, `unit-02`, `unit-03`,
  and `unit-05` to add the structural-authoring/direct-placement workflow and
  bounded bspwm reference. Their historical outcomes remain preserved above but
  are not current acceptance evidence for the amended criteria.
- `unit-04` remains accepted. Its source and integration-test evidence is
  preserved and may be cited where relevant; no new runtime validation is
  authorized unless reopened evidence identifies a specific need.
- Amendment-time next dispatch: `unit-01/attempt-02`.
- `unit-01/attempt-02` accepted on 2026-08-10. The revised rubric adds distinct
  D9.1-D9.6 structural criteria, J9-J10 target-segment journeys, D4.8-D4.11
  structural multi-output criteria, operational structural-model distinctions,
  a pinned and bounded bspwm reference, and target-segment Decision Rule
  handling. No comparator capability was assessed or re-scored.
- Unit-01 completion next dispatch: `unit-02/attempt-02`.
- `unit-02/attempt-02` accepted on 2026-08-10. Current source evidence covers
  all amended Plasma/Krohnkite D9 and D4.8-D4.11 cells, including the corrected
  KWin Custom Tiling model, bug 466057, Krohnkite source-surface coverage, and
  one-root-limitation accounting. Stock D4.10 is UK overall because
  session-restart window-to-tile assignment remains unestablished. No product
  conclusion was made.
- Next dispatch: `unit-03/attempt-02` by a successor Lead.
- `unit-03/attempt-02` accepted on 2026-08-10. Current source evidence applies
  J9/J10, D9.1-D9.6, and D4.8-D4.11 to COSMIC Epoch 1.5.0 and Hyprland v0.56.2,
  keeps their live-window trees distinct from saved authored topology, and
  records bspwm 0.9.12 only as a bounded structural reference. Both full
  comparators score J9/J10 CB on authored-structure cells; Hyprland alone
  satisfies D9.2 through `layoutmsg preselect`; both source-evidence D9.3
  pointer split paths. D4.8-D4.11 are out of scope for authored structure and
  retain only their supported live-tree observations. No product conclusion or
  new runtime validation was made.
- Unit-03 completion next dispatch: `unit-05/attempt-03`.
- `unit-05/attempt-03` accepted on 2026-08-10 after one synthesis Worker, one
  authorized synthesis correction, two host-unknown review reconciliations, an
  authorized changed-recovery independent review, and one bounded review
  correction. The amended Decision Rule yields strong justification only for the
  approved persistent-authored-layout target segment: J9/J10 are repeatable CBs
  from one root topology/composition limitation plus the distinct D9.3 mechanism
  gap, with no documented rescue and a plausible integrated-Plasma closure.
  General-market prevalence is not claimed. The recommendation is narrowly
  scoped feasibility/performance validation; accepted Q-A/Q-B work remains
  preserved.
- All amended audit units are accepted. Orchestrator alignment and scoped result
  approval are complete. This audit is archived; sustained-workload execution
  remains paused pending the proposed structural-feasibility gate.
