# Floor-Ratio Feasibility Static Runner

## Goal

Provide a hermetic static contract runner for the parked nested floor-ratio
feasibility proof without launching or mutating KWin, Plasma, D-Bus, or host
configuration.

## Scope

- `scripts/floor-ratio-feasibility.sh` has one executable mode,
  `static-self-test`, and a documentation-only `live-proof` refusal gate.
- The static contract fixture specifies private nonce-owned roots, a strict
  one-attempt limit, KWin 6.7.4, one child, fixed disposable layout, command
  allowlist, bounded timeout, journal scope, persistence requirements, cleanup,
  and four required vectors.
- Hermetic fakes test path isolation, host-tool non-invocation, authorization
  parsing, injection rejection, fresh-decode traces, fallback/mismatch behavior,
  interruption cleanup, and evidence retention.

## Non-Goals

- Nested or host KWin launch, live D-Bus, synthetic input, dependency changes,
  production opt-in behavior, or a feasibility verdict.

## Outcome

- Static test and full fixture validation passed with 92 assertions.
- Runner self-test passed with 44 assertions.
- Final independent static safety review found no findings after the refusal
  diagnostic correction.
- `npm run typecheck` could not run because `tsc` is unavailable in this
  session; no dependency was installed.
- No proof was executed. A future implementation still needs separate exact
  user authorization and must establish the declared runtime gates with
  authentic evidence.
