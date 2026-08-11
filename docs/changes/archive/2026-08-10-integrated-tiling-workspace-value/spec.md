# Specification: Integrated Tiling and Workspace Value Audit

Ownership and approval:
- Owner: Lead (`lead-openai`)
- Status: Approved. User approved this Expanded product investigation and
  elevated first-class multi-output handling as a possible major opportunity.

## Intent and Desired Outcome

Test whether one installable and enableable Plasma product can provide a
coherent dynamic-tiling and workspace experience that materially improves on
current Plasma plus Krohnkite, even if multiple KDE components are required
internally. This is a product-value investigation, not a commitment to a
specific implementation architecture.

The technical report's target is a native-feeling automatic tiling mode that
preserves normal Plasma behavior and treats Krohnkite as the minimum quality
baseline. This audit determines whether a sufficiently important product gap
exists before further performance-investigation work is resumed.

## Scope and Non-Goals

In scope:

- Compare stock Plasma, Krohnkite plus commonly required companion components,
  COSMIC, and Hyprland as full desktop comparators against the same
  workflow-based evaluation. Use bspwm only as a versioned reference model for
  the structural-authoring and direct-placement interaction workflow; it is not
  a full desktop comparator.
- Assess dynamic workspace lifecycle: creation, retention, removal, ordering,
  migration, and recovery behavior.
- Assess tiling behavior: initial placement, layout changes, insertion,
  stack/tab behavior where relevant, and predictable mixed tiling/floating
  behavior. Assess structural authoring and direct placement as one critical
  workflow: arbitrary-leaf horizontal/vertical splitting, keyboard-directed
  insertion, pointer-directed drag-to-split placement, persistent layout
  structure independent of window ordering, automatic placement that preserves
  authored structure, and explicit empty-branch collapse or retention
  semantics.
- Assess keyboard focus and window-movement semantics, including directional
  focus, moving or swapping windows, and cross-workspace behavior.
- Treat multi-output handling as a first-class hypothesis, not an assumed
  baseline failure. Assess output-local versus global workspace semantics;
  directional focus and window movement across outputs; workspace
  creation/removal effects across outputs; output hotplug/disconnect and layout
  recovery; per-output workspace indication; preservation of window
  location/layout; and predictable behavior without hidden per-output setup.
- Assess workspace indication, configuration and installation coherence,
  workflow smoothness, and escape hatches: floating, fullscreen, manual
  override, exceptions, and temporary disablement.
- Determine whether the Krohnkite/companion baseline actually fails critical
  workflows and whether an integrated Plasma product can plausibly improve the
  selected combination of critical workflows. The target is not a claim that
  any one reference implements the complete model.

Non-goals:

- No product implementation, package creation, or KWin plugin work.
- No resumption, replacement, or reinterpretation of sustained-workload
  validation or its accepted Q-A evidence and approved Q-B amendment.
- No performance benchmark, feature-count contest, visual-style comparison, or
  claim derived from a package list alone.
- No assumption that a comparator lacks a workflow until current evidence
  establishes it.
- No live-session configuration changes, package installation, or destructive
  hands-on testing without a later explicit safety decision.

## Evidence Standards

- Prefer current upstream source and official documentation. Record version,
  date, and exact capability semantics for each claim.
- Use hands-on checks only when non-destructive and safe. Do not alter the
  user's working Plasma configuration for convenience.
- Evaluate end-to-end workflows, not isolated feature presence. A component
  only counts toward the Krohnkite baseline when its installation,
  enablement, configuration, and interaction are evidenced.
- Record unavailable comparators, unsupported environments, and uncertain
  behavior as explicit unknowns rather than negative findings.
- Treat bspwm evidence as a bounded interaction-model reference. Do not infer
  desktop-wide behavior, multi-output behavior, installation coherence, or
  other full-comparator results from that reference.

## Decision Rule

- **Strong justification:** a frequent, evidence-backed critical workflow gap
  remains after a reasonably configured stock Plasma plus Krohnkite baseline,
  and an integrated product can plausibly close the selected combined workflow
  through one coherent installation, enablement, and configuration experience
  without replacing normal Plasma behavior.
- **Narrow differentiated product:** the baseline covers most critical
  workflows, but one or a small set of high-value gaps supports an explicitly
  bounded product thesis.
- **Insufficient value:** the baseline plus evidenced companion components
  provides critical workflows coherently, or remaining differences are
  feature-list trivia, preference-only styling, or require replacing Plasma.

## Acceptance Criteria

- [ ] A versioned, workflow-based comparison covers stock Plasma, Krohnkite
       plus evidenced companion components, COSMIC, and Hyprland; a separately
       bounded bspwm reference covers only structural authoring and direct
       placement.
- [ ] The comparison distinguishes critical workflow gaps from isolated
       features, including structural authoring/direct placement, tiling,
       keyboard/focus/move semantics, workspace lifecycle and indication,
       configuration/install coherence, smoothness, and escape hatches.
- [ ] The structural-authoring/direct-placement workflow has evidence or an
       explicit unknown for arbitrary-leaf horizontal/vertical splitting,
       keyboard-directed insertion, pointer-directed drag-to-split placement,
       structure independent of window ordering, automatic preservation of
       authored structure, and empty-branch collapse/retention semantics.
- [ ] Multi-output behavior is evaluated across every listed multi-output
       workflow, with documented evidence or explicit unknowns for each
       full comparator.
- [ ] The Krohnkite/companion baseline is not claimed to fail a workflow
      without current evidence.
- [ ] Any hands-on observation is reproducible, non-destructive, and records
      its environment; unavailable safe checks remain explicit unknowns.
- [ ] Findings apply one Decision Rule and recommend whether sustained-workload
      validation should resume, narrow, remain paused, or close.

## Unresolved Questions

- Which companion components are commonly required to make Krohnkite a fair
  baseline, and whether their integration is coherent enough to count.
- Which comparator versions and environments can be safely examined during the
  audit.
- Which supported portions of the structural-authoring/direct-placement
  workflow each full comparator and the bounded bspwm reference evidence.
- Whether any observed multi-output workflow gap is material, reproducible,
  and plausibly addressable by an integrated Plasma product.

## Consequential Decisions

- The user approved this audit before further sustained-workload execution.
- Multi-output handling is a first-class product hypothesis. No comparator
  failure or product advantage is assumed before evidence.
- The product target combines selected critical workflows. COSMIC, Hyprland,
  and bspwm are references for evidenced workflow mechanisms, not claims that
  one reference implements the complete target.
