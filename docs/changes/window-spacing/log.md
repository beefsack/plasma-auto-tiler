# Log: Native KWin Custom Tile Window Spacing

Append-only.

## 2026-08-23 - Approved artifact creation

- Created the approved Standard-change specification and three-unit static
  plan for fixed uniform KWin Custom Tile padding.
- Recorded the pinned KWin 6.7.3 constraint and the deliberate native
  `(outer=8, inner=8)` divergence from COSMIC's `(outer=0, inner=8)` default.
- No production, test, bundle, configuration, live-session, or implementation
  change is included in this planning package.

## 2026-08-23 - unit-00 accepted

- Lead inspected the authorized artifact and backlog diff; it matches the
  pre-approved Standard-change semantics and `git diff --check` passed.

## 2026-08-23 - unit-01 accepted

- Added the typed KWin Tile padding declaration and guarded Custom Tile setter
  with the fixed `8` logical-pixel value.
- Focused boundary tests directly exercise one guarded padding assignment and
  assert the approved uniform `(outer=8, inner=8)` result; 20 tests and
  typecheck passed.

## 2026-08-23 - unit-02 accepted

- The shared KWin `workspace.rootTile()` entry seam now prepares each returned
  managed root with uniform padding before controller use, without changing the
  controller source.
- Direct managed-root tests cover assignment/reflow ordering and repeat-safe
  preparation without topology changes; 2 focused tests and typecheck passed.

## 2026-08-23 - unit-03 accepted

- Regenerated `kwin/contents/code/main.js`; four builds produced the same
  `f91f7d27843057cb98cae43611361fab6847407e054dc914ab03fa5c3bcd3433` SHA-256.
- Complete static gates passed: 965 tests across 91 suites, typecheck, and
  dogfood 347 / 0. Source and bundle inspection found no forbidden spacing path.
