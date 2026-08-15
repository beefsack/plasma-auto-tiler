# Research Specification: Declarative Active-Border Feasibility

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Approved 2026-08-15 by parent Orchestrator under user-authorized autonomous mode; finalized as bounded research

## Intent and Desired Outcome

Record the accepted declarative active-border architecture facts and the reason
production implementation is parked. This result narrows the prior visual-
effects feasibility boundary; it does not deliver an effect or select a visual
policy.

## Scope and Non-Goals

In scope:

- Preserve the accepted coordinate, active-window binding, and `SceneEffect`
  architecture facts with citations to the prior accepted feasibility archive.
- Define the exact future live proof matrix needed before reconsidering a
  declarative border.
- Record the native C++ effect path and its separate dependency decision as
  parked follow-up work.

Non-goals:

- Production implementation, package creation, dependency changes, or live
  KWin/Plasma testing.
- Selecting border color, thickness, radius, animation, exclusions, or other
  visual policy.
- Claiming coverage for any client class, including XWayland.
- Selecting native C++ or declarative QML as the production carrier.

## Applicable Principles and Decisions

- `docs/principles.md` is absent at repository inspection time.
- The prior accepted boundary is
  [Window Visual Effects Feasibility](../2026-08-14-window-visual-effects-feasibility/research/feasibility.md).
- This research does not change `docs/decisions.md`.

## Constraints

- Research only, with no live mutation or production/package/dependency edit.
- No transient log is retained for this direct bounded synthesis.
- Any future live work must first follow `docs/live-kwin-testing.md` and have
  separate explicit mutation authorization.
- A native toolchain decision requires a separately approved `devenv.nix`
  change and a session restart before the new dependencies can be used.

## Acceptance Criteria

- [x] Durable research records the accepted per-output coordinate mapping,
  direct active-window binding, and `SceneEffect` reconstruction boundary.
- [x] The research cites the accepted prior feasibility archive and its KDE/KWin
  evidence rather than asserting fresh live behavior.
- [x] An exact live proof matrix and all parked decisions are explicit.
- [x] The result does not claim client or XWayland coverage and does not choose
  visuals or a production carrier.

## Unresolved Questions

- Can a full reconstructed declarative scene preserve all required compositor
  behavior on the target KWin/Plasma version with acceptable risk?
- Which native C++ effect development and distribution dependencies are
  supported by the target platform?

## Consequential Decisions

- Park declarative active-border production. `SceneEffect` is a scene
  replacement, so a border is not a lightweight transparent overlay: it needs
  full scene reconstruction using `WindowModel` and `WindowThumbnail`.
- Keep native C++ compositor effects as the leading path for a border and
  rounded-corner work, without selecting it. Its toolchain, package, and
  dependency decision is separate.
- Keep all visual policy and coverage decisions parked pending authorized live
  evidence.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
