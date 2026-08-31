# R-06 Baseline Stabilization

## Goal

Restore the nine clean-main static failures reproduced by pointer R-06 without
changing approved product behavior or crossing the pointer F-01 and tray public
route boundaries.

## Scope

- Two artifact-smoke failures, two deferred/fullscreen-resize failures, four
  interactive-drag attachment failures, and one tray-bridge fixture failure.
- Regression-first corrections where practical, focused clusters, typecheck,
  package build, R-06, R-07, and independent review.

## Non-Goals

- Live or host operations, dependency changes, protected candidate/archive
  access, product-semantic changes, and any failure beyond the nine identities.

## Acceptance

- Clean lockfile tooling reproduces and attributes exactly nine failures.
- R-06 and R-07 pass with canonical generated-output scope and recorded hash.
- Independent review finds no product-semantic drift, F-01 regression, tray
  public-route widening, artifact startup regression, or test/production mixup.

## Units

- Attribution and exact reproduction.
- Smallest implementation.
- Verification and canonical-output checks.
- Independent review.

## Current Outcome

- Clean `origin/main` at `da05cd6` reproduced exactly 992 passing and nine
  failing tests. The failures were stale seven-signal or resize-observer test
  contracts plus one omitted tray fixture runner environment.
- Focused clusters, typecheck, package build, R-06 (1002 passing), the 255-pass
  shell lifecycle tail, and R-07 passed. The sole generated artifact is
  `kwin/contents/code/main.js`, 366448 bytes, SHA-256
  `133e935329855c1c06511524ee9266f121d4441f90eba549bb1e4f7b6e1d9c44`.
- Independent review accepted the diff with no F-01, tray route, artifact
  startup, test/production, or product-semantic finding. L-01 remains separate.
