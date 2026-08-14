# Window Visual Effects Feasibility

Status: Bounded research complete. It sets an architecture boundary and parked
live decisions; no feature, live behavior, or carrier selection is asserted.

## Scope and Evidence Quality

This assessment uses the four authoritative KDE/KWin references listed below
and a read-only inspection of the current project's packaging metadata and
`devenv.nix`. All four source URLs resolved on 2026-08-15. The scripting API
source identifies itself as KWin 6.0, so it cannot establish behavior on a
later target version. Confidence describes the documented claim, not
unperformed live behavior.

## Findings

### Decoration-Level Coverage

Confidence: High that decoration-only treatment is insufficient evidence for
the required client coverage.

Plasma 6.5's changelog records rounded bottom corners for borderless
Breeze-themed windows and support for server-side decorations to round surface
corners. This is decoration-scoped evidence, not an API guaranteeing arbitrary
client-side-decorated, non-Qt, or XWayland content. A decoration-only design
therefore cannot satisfy the stated cross-client requirement without live
proof.

Source: [Plasma 6.5.0 complete changelog](https://kde.org/announcements/changelogs/plasma/6/6.4.5-6.5.0/).

### Active-Window Outline

Confidence: High for tracking and drawing a compositor-managed outline;
medium for final visual placement across every client class.

The scripting API exposes `workspace.activeWindow`, the
`workspace.windowActivated(KWin::Window *)` signal, `frameGeometry`, and
`showOutline()`. Declarative effects use a per-screen `SceneEffect` delegate
and can display the active window through `WindowThumbnail`. C++ effects
subclass `KWin::Effect` and can customize where and how windows are drawn via
`EffectWindow` and `EffectsHandler`.

An active-window border or highlight is thus viable as a compositor effect with
active-window tracking. A QML effect is a candidate for the outline alone; live
testing must establish its geometry and stacking behavior for CSD, fullscreen,
and XWayland clients.

Sources:

- [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/)
- [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/)
- [KWin effects API](https://api.kde.org/kwin-effects.html)

### QML/Declarative Content Rounding

Confidence: High that the documented QML interface can replace and render a
scene or overlay; low that it can clip individual arbitrary client content.

`SceneEffect` owns a per-screen delegate. The documented examples show that
the effect is responsible for what appears in the scene and uses
`WindowThumbnail` to display a client. The published QML interface does not
document a per-window operation that clips or rounds the real client surface.
It therefore supports an outline candidate but does not establish true
per-window rounding for arbitrary client content. A full-scene shader or a
thumbnail mask would not prove that the actual window content is rounded.

Source: [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/).

### Native Compositor Support

Confidence: Medium.

The C++ effects API is the documented extension route for controlling window
drawing. Plasma 6.5 additionally records native rounded-corner work at the
surface and decoration layers. Together, these make a native compositor effect
with shader work the strongest candidate for actual per-window content
rounding. The references do not document a supported third-party API that
attaches the native rounded-corner treatment selectively to arbitrary windows,
so native C++ support is a candidate, not a settled requirement.

Sources:

- [KWin effects API](https://api.kde.org/kwin-effects.html)
- [Plasma 6.5.0 complete changelog](https://kde.org/announcements/changelogs/plasma/6/6.4.5-6.5.0/)

### XWayland and Non-Qt Coverage

Confidence: Low for coverage; High that it remains unproven by these sources.

None of the four references promises that a QML or C++ third-party effect will
outline or round XWayland, non-Qt, and client-side-decorated content uniformly.
The compositor-level candidate is better aligned with that goal than a window
decoration, but the required coverage is a live-validation item rather than a
research conclusion.

### Project Packaging and Dependencies

Confidence: High for current state and declarative package shape; Medium for
the native build toolchain implication.

Read-only inspection of `kwin/metadata.json` found a `KWin/Script` package with
`X-Plasma-API: javascript`; it is not an effect package. A declarative effect
would be a separate `KWin/Effect` package with
`X-Plasma-API: declarativescript`, as documented by KDE. The project has no
C++/KWin development toolchain configured in `devenv.nix`, so a native effect
would require a later, separately approved toolchain and build-packaging
decision.
The exact package names, headers, ABI/support policy, and distribution route
were not established here.

Source: [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/).

## Architecture Boundary

- A compositor effect is viable for an active-window border or highlight with
  active-window tracking.
- A decoration path cannot establish the required Qt, non-Qt, client-side-
  decorated, and XWayland coverage because its documented rounding is
  decoration-scoped.
- Declarative QML has documented screen-scene and thumbnail rendering, but no
  documented operation for clipping arbitrary client content. It is not proven
  for true per-window content rounding.
- Native C++ is the leading candidate for rounded corners because its documented
  effect interface controls window drawing. A supported third-party selective
  rounding route is not proven.
- Non-Qt and XWayland coverage, as well as package discovery and runtime
  behavior, require live proof. This is a research boundary, not a feature or
  implementation decision.

## Candidate Architectures

1. Native compositor effect with per-window shader/drawing control, plus an
   active-window outline. Leading rounded-corner candidate; requires a prototype
   to prove the supported third-party route and coverage.
2. Declarative `SceneEffect` for the active-window outline only. Supported
   package form and lowest dependency burden; it does not yet meet the actual
   content-rounding requirement.
3. Decoration-only rounded corners plus any separate outline. Inadequate as a
   cross-client solution because the cited behavior is decoration-scoped.
4. Extend the existing JavaScript KWin script. Not viable for compositor
   rendering: its package type is a script, whereas rendering effects use the
   documented effect package forms.

No architecture is fully validated for both requested visual features across
Qt, non-Qt, and XWayland clients. These are candidates, not a carrier decision:
architecture 1 leads for rounding and architecture 2 is viable only for the
highlight portion.

## Live Decision Matrix

| Parked question | Research boundary | Required live proof | State |
|---|---|---|---|
| Can QML clip actual arbitrary client content? | `SceneEffect` and `WindowThumbnail` are documented; per-window arbitrary-client clipping is not. | Declarative `SceneEffect` spike distinguishes client-content clipping from a scene replacement, thumbnail, or overlay. | Parked |
| Can native C++ selectively round arbitrary client content? | C++ effects can control window drawing; no cited source establishes a supported third-party selective rounding route. | Minimal native C++ spike proves clipping or rounding on selected windows. | Parked |
| Does either candidate cover all required clients? | The sources do not promise uniform Qt, non-Qt, CSD, or XWayland coverage. | Exercise geometry, stacking, activation, and cleanup across the client matrix. | Parked |
| What package and dependency behavior applies? | QML package shape and native installation namespace are documented; target-version discovery, enablement, reload, ABI, and distribution behavior are not. | Verify discovery, enablement, restart or reload behavior, and exact dependencies on the target version. | Parked |
| What visual policy applies? | No source selects border geometry, color, radius, animation, or exclusions. | Product decision, not a live spike. | Parked |

## Required Live Spikes

Live work is deliberately deferred. Before any implementation decision, run
only after following `docs/live-kwin-testing.md` and obtaining separate
mutation authorization:

1. On the target Plasma/KWin version, verify an active-window outline effect
   against Qt, GTK/Electron or other CSD, non-Qt, XWayland, maximized, and
   fullscreen windows. Observe activation, geometry, stacking, and cleanup.
2. Build a minimal declarative `SceneEffect` spike to determine whether it can
   round actual per-window client content rather than only render a replacement
   scene, thumbnail, or overlay.
3. Build a minimal native C++ effect spike only if spike 2 does not establish
   the required rounding. Verify selective per-window clipping/rounding and
   the same client matrix.
4. Verify package discovery, enablement, restart/reload behavior, and the
   exact target-version development and runtime dependencies for the selected
   carrier.

## Parked Decisions

- Border color, thickness, radius, animation, exclusions, and other visual
  policy are product decisions and remain parked.
- Native C++ versus QML/declarative carrier remains parked. Native C++ is the
  leading rounded-corner candidate, while QML is documented for an outline; the
  live-decision matrix decides whether either can meet the complete requirement.
- Target Plasma/KWin version and any resulting compatibility floor remain
  unknown and must be selected before interpreting the Plasma 6.5 evidence.

## Sources

1. [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/) -
   `workspace.activeWindow`, `windowActivated`, window geometry, and scripting
   outline interfaces.
2. [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/) -
   declarative `SceneEffect`, `WindowThumbnail`, effect package metadata, and
   distribution guidance.
3. [KWin effects API](https://api.kde.org/kwin-effects.html) - C++ `Effect`,
   `EffectWindow`, `EffectsHandler`, plugin factory, and CMake installation
   namespace.
4. [Plasma 6.5.0 complete changelog](https://kde.org/announcements/changelogs/plasma/6/6.4.5-6.5.0/) -
   rounded-corner changes for decorations and surfaces.
