# Plan: Native KWin Custom Tile Window Spacing

## Ownership And Acceptance

- Owner: Lead.
- Status: Accepted by Orchestrator; static completion complete.
- Accepted implementation: `c173f70 feat(window-spacing): apply native tile padding`.
- Completion records retain `spec.md` and this plan. The transient execution
  log is intentionally removed.

## Technical Approach

Use one typed writable Custom Tile padding boundary and one fixed uniform value
of `8` logical pixels. Apply it at managed-root bootstrap and recovery seams,
then prove the native outer and adjacent semantics with focused static tests.
KWin 6.7.3 is pinned and provides no supported asymmetric Custom Tile gap API;
the plan therefore does not attempt COSMIC's `(outer=0, inner=8)` result.

This is a static implementation plan. No live KWin/Plasma mutation is part of
these units, and no unit depends on N-ary or controller-source work.

## Work Units

| ID | Objective | Depends on | Verification |
|---|---|---|---|
| unit-01 | Add the typed script-visible writable tile-padding boundary and focused tests for fixed `8` logical pixels, root outer spacing, and adjacent native spacing. | none | Inspect the typed boundary and run the focused padding/spacing tests. |
| unit-02 | Apply padding `8` at all relevant managed-root bootstrap, initialization, and recovery paths before tile-managed assignment or reflow where feasible, with direct tests for each path. | unit-01 | Inspect each root setup/recovery path and run its direct tests, including ordering before assignment/reflow. |
| unit-03 | Regenerate the bundle and complete full static verification, including forbidden-path inspection and preservation checks. | unit-01, unit-02 | Run `npm --prefix kwin test`, `npm --prefix kwin run typecheck`, `bash scripts/dogfood-install.test.sh`, `npm --prefix kwin run build`, and `git diff --check`; inspect the generated bundle and source for no tiled `frameGeometry` spacing, `kwinrc` writes, effects, shadows, clipping, scene manipulation, per-edge geometry, live mutation, or fake `(0,8)` behavior. |

## Acceptance Evidence Map

| Criterion | Static evidence |
|---|---|
| Typed writable contract and fixed logical value | Accepted: unit-01 declaration/boundary inspection and 20 focused tests prove fixed `8` logical pixels. |
| Root bootstrap and recovery coverage | Accepted: unit-02 inspected every root-acquisition path and directly tested assignment/reflow ordering and repeat-safe preparation. |
| Native outer and adjacent semantics | Accepted: unit-01 focused tests assert `(outer=8, inner=8)` and do not claim asymmetric `(0,8)` behavior. |
| Forbidden spacing paths and preservation | Accepted: unit-03 source/bundle inspection found no tiled `frameGeometry` spacing, controller geometry, `kwinrc`, effects, shadows, clipping, scene manipulation, per-edge geometry, or border change. |
| Full static gates and bundle | Accepted: 965 tests / 91 suites / 0 failures; typecheck clean; dogfood 347 / 0; four deterministic builds with SHA-256 `f91f7d27843057cb98cae43611361fab6847407e054dc914ab03fa5c3bcd3433`; `git diff --check` clean. |
| Live visual behavior | Accepted boundary: no static evidence is claimed. Optional user-run live visual measurement remains outside static completion. |

## Progress And Evidence

| Unit | Status | Evidence |
|---|---|---|
| unit-01 | accepted | `kwin/src/kwin-globals.d.ts`, `kwin/src/boundary.ts`, and `kwin/tests/boundary.test.ts` inspected; focused boundary tests (20 passing), typecheck, and `git diff --check` passed. |
| unit-02 | accepted | Shared `entry.ts` root acquisition prepares every controller root lookup before return. `managed-root.test.ts` directly covers assignment/reflow ordering and repeat-safe topology preservation; 2 focused tests, typecheck, and `git diff --check` passed. |
| unit-03 | accepted | Full static gates passed: 965 tests / 91 suites / 0 failures; typecheck; dogfood 347 / 0; four deterministic builds with SHA-256 `f91f7d27843057cb98cae43611361fab6847407e054dc914ab03fa5c3bcd3433`; `git diff --check`; source and bundle forbidden-path inspection. |
| unit-00 | accepted | Approved `spec.md`, `plan.md`, and `log.md` created; one linked backlog entry added; `git diff --check` passed. |

## Attempt Counts

| Unit | Attempts | Corrections | Independent reviews |
|---|---:|---:|---:|
| unit-00 | 1 | 0 | 0 |
| unit-01 | 1 | 0 | 0 |
| unit-02 | 1 | 0 | 0 |
| unit-03 | 1 | 0 | 0 |

## Pending Decisions

- None. Uniform `(outer=8, inner=8)` is user-approved.

## Residual Risks

- Static completion cannot establish user-visible output-scale rendering; separate
  user-run live validation remains optional and outside this change.

## Final Outcome

- Accepted: all static acceptance criteria are met by `c173f70`. The approved
  behavior is uniform `(outer=8, inner=8)` logical-pixel padding, intentionally
  diverging from COSMIC's `(outer=0, inner=8)` because KWin 6.7.3 provides no
  supported asymmetric Custom Tile gap API.
- Optional live visual measurement remains separate user-run work and is not
  required for this static completion.
