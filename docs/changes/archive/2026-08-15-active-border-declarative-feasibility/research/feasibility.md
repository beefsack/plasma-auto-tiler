# Declarative Active-Border Feasibility

Status: Bounded research complete. This records accepted architecture evidence
and future proof requirements only. No live behavior, client coverage, or
production carrier is established.

## Citations From Accepted Reports

- [Prior Window Visual Effects Feasibility research](../../2026-08-14-window-visual-effects-feasibility/research/feasibility.md), especially its active-window outline, declarative content-rounding, native compositor, package/dependency, and live-matrix findings.
- [Prior Window Visual Effects Feasibility specification](../../2026-08-14-window-visual-effects-feasibility/spec.md), which preserves the earlier scope and parked carrier decision.
- The prior research cites [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/), [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/), and the [KWin effects API](https://api.kde.org/kwin-effects.html). These are inherited documentary citations, not fresh live proof.

## Accepted Architecture Facts

1. `EffectWindow.frameGeometry` is global, while a `SceneEffect` delegate is
   per output. The declarative border position for an output is therefore the
   global frame position minus `SceneView.screen.geometry`:

   ```text
   localX = window.frameGeometry.x - sceneView.screen.geometry.x
   localY = window.frameGeometry.y - sceneView.screen.geometry.y
   ```

   This is an accepted coordinate-mapping fact for future live validation. It
   does not establish behavior on any particular output configuration.
2. Direct `Workspace.activeWindow` bindings are available to declarative code.
   They remove the need for an imperative active-window bridge, but do not
   reduce the rendering boundary below.
3. `SceneEffect` replaces the scene. A declarative border is consequently not
   a lightweight transparent overlay over KWin's normal scene. To retain the
   scene, the effect must reconstruct it with `WindowModel` and
   `WindowThumbnail`, then draw the border in that reconstructed scene.

The prior accepted report documents `SceneEffect` delegates and
`WindowThumbnail` rendering, and leaves arbitrary-client clipping unproven.
See [Declarative QML Content Rounding](../../2026-08-14-window-visual-effects-feasibility/research/feasibility.md#qmldeclarative-content-rounding) and [Candidate Architectures](../../2026-08-14-window-visual-effects-feasibility/research/feasibility.md#candidate-architectures).

## Declarative Conclusion

The available declarative primitives can express coordinate conversion and
active-window selection, but the scene-replacement boundary makes an active
border a full compositor-scene reconstruction task. Without authorized live
validation of that reconstruction, its rendering, stacking, lifecycle, and
failure behavior are too risky for production implementation. Declarative
active-border work is parked.

## Exact Live Proof Matrix

Run only after following `docs/live-kwin-testing.md` and receiving separate,
explicit mutation authorization. Each row is a distinct proof obligation; a
pass in one row does not establish another.

| ID | Controlled proof | Required observation | Pass condition | Failure consequence |
|---|---|---|---|---|
| D1 | On a target runtime with an output whose global origin is non-zero, draw a test rectangle from `frameGeometry - SceneView.screen.geometry`. | Record the active frame and output geometry, then compare the local rectangle to the active frame on that output. | The rectangle is aligned only when both origin components are subtracted. | Do not use declarative geometry for a border. |
| D2 | Bind a declarative item directly to `Workspace.activeWindow`; change focus and clear the active window. | Record each binding update and the cleared state. | The binding tracks the runtime active-window transitions without an imperative bridge. | Do not assume direct declarative active-window tracking. |
| D3 | Enable the smallest `SceneEffect` that draws only a border item, then enable a version that explicitly renders `WindowModel` rows through `WindowThumbnail`. | Observe whether the normal scene remains when it is not reconstructed and whether it is restored only by explicit model/thumbnail rendering. | The test confirms that the border carrier must reconstruct the scene, not overlay it transparently. | Reject the declarative border design. |
| D4 | With the D3 reconstruction present, change active window, move it, minimize it, and close it. | Record border geometry, active selection, scene ordering, and cleanup at each transition. | Each transition leaves a coherent reconstructed scene and no stale border or thumbnail. | Park declarative production and retain the evidence. |
| D5 | Verify the target version's declarative `KWin/Effect` package discovery, enablement, and reload behavior for the D1-D4 spike. | Retain the exact target version, package metadata, enablement result, and reload result. | All lifecycle operations are documented by retained evidence. | Do not distribute or select the declarative carrier. |

This matrix deliberately makes no claim about client classes or XWayland. It
also uses only a visibility placeholder for proof and selects no border visual
policy.

## Parked Decisions and Claim Limits

- No border color, thickness, radius, animation, exclusions, or other visual
  policy is selected.
- No client or XWayland coverage is claimed.
- Native C++ compositor effects remain the leading path for border and
  rounded-corner work because the prior accepted research identifies C++ window
  drawing control as the strongest candidate. This is not a carrier selection
  or a claim that selective rounding is proven.
- Native exploration needs a separate development-toolchain, package, and
  dependency decision. If that decision changes `devenv.nix`, the session must
  be restarted before the dependencies are assumed available.
- No implementation begins from this archive. A future change must approve the
  carrier, visual policy, dependency scope, and live-proof authorization.
