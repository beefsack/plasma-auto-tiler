# Specification: Native KWin Custom Tile Window Spacing

## Status

- Change class: Standard.
- Owner: Lead.
- Status: Accepted by Orchestrator; static completion complete.
- Artifact map: [plan](plan.md).

## Intent

Provide native-feeling spacing for tiled windows, closest to COSMIC, using the
supported KWin Custom Tile padding contract.

## Scope

- Define a typed, script-visible, writable tile-padding boundary.
- Apply uniform `8` logical-pixel padding to every managed root Custom Tile
  contract during bootstrap, initialization, and recovery.
- Apply the padding before tile-managed window assignment or reflow where the
  relevant path permits.
- Add focused static tests for outer and adjacent native spacing semantics.
- Regenerate and verify the bundle, with only truthful fixed-behavior
  documentation or settings changes if required.

KWin owns physical-pixel scaling. The fixed value is `8` logical pixels. The
native result is `(outer=8, inner=8)`: eight logical pixels at the managed root
boundary and eight logical pixels between adjacent tiled regions. This diverges
from COSMIC's default `(outer=0, inner=8)` because pinned KWin 6.7.3 exposes no
supported asymmetric Custom Tile gap API.

## Non-Goals

- Add a configurable setting or KCM.
- Use tiled `frameGeometry` to create spacing; preserve float, maximize, and
  fullscreen `frameGeometry` behavior and KWin-owned tiled window geometry.
- Add clipping, border-outline coupling, effects, shadows, scene manipulation,
  `kwinrc` writes, theme synchronization, or per-edge geometry.
- Change the controller geometry model or N-ary behavior.
- Split controller sources.
- Perform live mutation or fake the COSMIC `(0,8)` result.
- Change active or inactive borders. Inactive borders are deferred separately
  because of low-contrast usability.

## Acceptance Criteria

- [x] The typed script-visible writable padding contract is statically present,
      and focused tests prove the fixed value is `8` logical pixels.
- [x] Every relevant managed-root bootstrap, initialization, and recovery path
      applies padding `8` before tile-managed assignment or reflow where
      feasible; direct tests cover those paths.
- [x] Static tests document and assert `(outer=8, inner=8)` and adjacent native
      spacing, without claiming or constructing asymmetric `(0,8)` padding.
- [x] Static inspection proves spacing does not use tiled `frameGeometry`,
      controller geometry, `kwinrc`, effects, shadows, clipping, or scene
      manipulation, and existing float/maximize/fullscreen behavior remains
      unchanged.
- [x] `npm --prefix kwin test`, `npm --prefix kwin run typecheck`,
      `bash scripts/dogfood-install.test.sh`, and `npm --prefix kwin run build`
      pass; the generated bundle is reproducible and matches authored source.
- [x] Live visual measurement is separate user-run and authorized work, not
      static completion evidence.
