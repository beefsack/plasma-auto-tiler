# Specification: Integrated Plasma Structural Feasibility

Ownership and approval:
- Owner: Lead (`lead-openai`)
- Status: Approved by the user on 2026-08-10.
- Dependency: archived [integrated-tiling-workspace-value verdict](../archive/2026-08-10-integrated-tiling-workspace-value/findings.md), section 11.

## Intent and Desired Outcome

Determine whether the archived audit's scoped persistent-authored-layout thesis
can be delivered as one coherent, installable, enableable, and configurable
Plasma product without replacing normal Plasma behavior. This is a focused
structural-feasibility gate, not an implementation commitment.

The exact workflow under evaluation is persistent authored topology plus
dynamic-tiling composition, keyboard-directed insertion, pointer-directed
drag-to-split placement, automatic placement that preserves authored structure,
explicit empty-branch retention or collapse semantics, and one coherent
install/enable/configure experience.

## Scope and Constraints

In scope:

- Establish a KWin 6.7.3 source-cited API-surface matrix for the workflow's
  mandatory control and observation surfaces.
- Distinguish documented supported scripting/QML surfaces from version-coupled
  native surfaces and unavailable surfaces.
- Establish the smallest supported package-composition and version boundary
  consistent with the workflow.
- Define, then only after fresh user authorization execute, the smallest
  reversible proof of the combined workflow.
- Evaluate representative responsiveness from that proof only and issue one
  decisive feasibility verdict.

Constraints:

- The result must remain architecture-neutral. A version-coupled native result
  is a feasibility classification, not an architecture, language, plugin, or
  packaging selection.
- The workflow is limited to the archived audit's persistent-authored-layout
  target segment. It makes no general-market or feature-parity claim.
- Mandatory surfaces are persistent authored topology access, dynamic-tiling
  composition that preserves it, keyboard-directed insertion, pointer-directed
  drag-to-split placement, automatic placement into authored structure,
  explicit empty-branch semantics, and coherent install/enable/configure
  control.

Non-goals:

- No broad feature parity investigation, full product implementation, or broad
  performance benchmark.
- No native-vs-JS decision and no source, package, dependency, or architecture
  change.
- No resumption or reinterpretation of sustained-workload validation, its
  accepted Q-A evidence, approved Q-B amendment, thresholds, or unit
  definitions.
- No change to `docs/decisions.md`, the technical report, or the archived
  audit's accepted evidence and verdict.

## Safety Boundaries

- Units 01 through 03 are source and protocol work only. They must not interact
  with the live session, load a script, install software, alter configuration,
  restart KWin, or create a test window.
- Unit 04 is prohibited until the user freshly authorizes the exact protocol
  and reversal steps prepared by unit-03. Authorization must identify every
  script, package state, configuration change, window, duration, and cleanup
  action.
- The proof must be minimal and reversible. It must restore configuration and
  unload or close every proof artifact, then verify KWin responsiveness.
- Representative responsiveness is limited to the authorized proof. It cannot
  substitute for, broaden, or weaken sustained-workload thresholds.

## Acceptance Criteria

- [ ] A source-cited KWin 6.7.3 matrix classifies every mandatory surface as
      supported scripting/QML, version-coupled native, or unavailable.
- [ ] Any mandatory unsupported surface fails the gate before package or live
      proof work proceeds.
- [ ] Package composition and version coupling are source-cited, coherent, and
      bounded without selecting an architecture.
- [ ] The proof protocol and authorization request are exact, minimal,
      reversible, and complete before any live interaction.
- [ ] No live proof runs without fresh user authorization, and authorized proof
      cleanup verifies KWin responsiveness.
- [ ] The final verdict is evidence-backed, limited to the target workflow, and
      does not alter sustained-workload evidence, thresholds, or unit
      definitions.

## Outcome Rule

- **Supported scripting/QML feasible:** every mandatory surface is available
  through documented supported scripting/QML paths, the composition is coherent,
  and the authorized proof succeeds.
- **Version-coupled native feasible:** the workflow is feasible only through a
  documented, bounded version-coupled native surface, the composition boundary
  is explicit, and the authorized proof succeeds. This classification does not
  select an architecture.
- **Infeasible/unjustified:** a mandatory surface is unavailable, the bounded
  composition cannot be made coherent, or the authorized proof cannot establish
  the workflow safely and reversibly.
