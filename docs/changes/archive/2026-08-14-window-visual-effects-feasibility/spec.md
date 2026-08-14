# Research Specification: Window Visual Effects Feasibility

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under user-authorized autonomous mode; finalized as a bounded research result

## Intent and Desired Outcome

Establish an evidence-backed Plasma 6 architecture boundary for an
active-window border or highlight and rounded-corner treatment across Qt,
non-Qt, and XWayland windows. This result identifies what the sources support,
what they do not establish, and the live decisions that remain parked; it does
not deliver or select an implementation.

## Scope and Non-Goals

In scope:

- Research current authoritative KDE/KWin documentation or source and current
  project packaging.
- Assess decoration coverage, compositor-effect APIs, declarative/QML limits,
  native effect requirements, active-window tracking, XWayland coverage,
  packaging implications, and exact live spikes.
- Record ranked architecture options, citations, confidence, and unknowns.

Non-goals:

- Implementing, packaging, installing, enabling, or live-testing any effect.
- Selecting visual policy, including border geometry, color, animation, or
  rounded-corner behavior.
- Selecting a native C++ or QML/declarative carrier without sufficient evidence.

## Applicable Principles and Decisions

- `docs/principles.md` is absent at repository inspection time.
- No `docs/decisions.md` was loaded because this research is not authorized to
  change governance.

## Constraints

- Research only: no production code, packaging, dependency, installation,
  enablement, or live KWin/Plasma changes.
- Use no more than four authoritative current KDE/KWin documentation or source
  references.
- Treat coverage claims separately for decoration-managed, Qt, non-Qt, and
  XWayland clients.

## Acceptance Criteria

- [x] Durable research establishes a sourced architecture boundary for each
  requested topic, including claim-level confidence and limits.
- [x] Research identifies candidate architectures and explicitly excludes a
  decoration-only route from satisfying the required cross-client coverage.
- [x] Research records packaging implications and a live decision matrix
  without asserting unperformed live behavior.
- [x] Visual policy and implementation-carrier selection remain explicitly
  parked pending the listed live decisions.

## Parked Live Questions

- Can a declarative effect clip arbitrary client content, rather than only
  replacing a screen scene or rendering a thumbnail or overlay?
- Can a third-party native C++ effect selectively round arbitrary client
  content through a supported extension route?
- Do either candidate's geometry, stacking, and rendering cover Qt, non-Qt,
  client-side-decorated, and XWayland clients on the target KWin version?
- Which carrier's package discovery, enablement, reload behavior, dependencies,
  and distribution route are supported on the target platform?

## Consequential Decisions

- Do not select native C++ versus QML/declarative carrier until the documented
  API surface, packaging route, and live matrix are validated.
- Park all visual-policy choices; they are product decisions outside this
  feasibility research.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
