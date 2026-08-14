# Specification: Drop Overlay Feasibility

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Completed and archived 2026-08-15 under explicit autonomous authorization

## Intent and Desired Outcome

Establish the documented overlay surfaces available to the existing KWin JavaScript controller and identify the smallest truthful live proof before any overlay implementation.

## Scope and Non-Goals

In scope:

- Surface-level research of existing controller drag state and package metadata.
- Three current authoritative KDE/KWin documentation references.
- A durable, bounded conclusion and the required minimal live proof.

Non-goals:

- Implementing an overlay or changing production code, dependencies, packages, or host configuration.
- Running live KWin/Plasma checks, installing software, mutating the host, or claiming live behavior or XWayland support.
- Selecting or implementing a rich QML carrier or controller-to-visual communication mechanism.

## Applicable Principles and Decisions

- `docs/principles.md` is absent at research start.
- No active decision is changed by this research.

## Constraints

- Distinguish documented facts from unproven runtime behavior.
- Preserve rich QML carrier and controller-to-visual bridge choices as parked until live evidence supports them.

## Acceptance Criteria

- [x] The report documents the ordinary JavaScript rectangle-only `showOutline()` / `hideOutline()` surface and the QML drawing capability of declarative `KWin/Effect`.
- [x] The report records that the controller can resolve a target geometry from its tracked drag and decoded tile geometry, but that live motion cadence and overlay cleanup remain unproven.
- [x] The report states only that no ordinary-script-to-effect bridge or declarative-effect Custom Tile mutation surface was found in the reviewed public documentation.
- [x] The report recommends a minimal live outline spike before richer architecture work and explicitly parks the QML carrier and bridge decisions.
- [x] No production, dependency, package, or host mutation occurred. Documentation archival and its requested Git commit are authorized completion actions.

## Unresolved Questions

- Does the target KWin/Plasma runtime deliver useful interactive motion cadence and cleanup for an ordinary-script outline?
- Does the minimal outline path work for the project's actual deployment environment, including XWayland drags?

## Consequential Decisions

- Rich QML carrier selection and controller-to-visual communication design are parked. The live spike must not be treated as proof of either architecture.
