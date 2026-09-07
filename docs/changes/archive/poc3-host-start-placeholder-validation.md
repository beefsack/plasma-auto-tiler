# POC3 Host Start Placeholder Validation

## Goal

Correct the generated start-bundle placeholder check and run the one authorized
frozen3 host `start` lifecycle exactly once.

## Scope And Non-Goals

- Validate only the four generator-defined executable JSON placeholder tokens.
  The explanatory `__POC3_START_*__` comment is not an unresolved token.
- Preserve template, fixture, sidecar hash, receipt, production, KWin, trio,
  planner, and exact Script0 lifecycle checks.
- No production resume, focus or move action, client replacement, broad build,
  or retry is in scope.

## Acceptance

- Focused generator/action tests, syntax checks, and `git diff --check` pass.
- The ignored frozen3 bundle and sidecar are retired only after revalidation.
- Exactly one replacement is generated and one `start` lifecycle runs.
- Start proves Script0, applies only `H[A,V[B,C]]` with focus A, observes
  convergence, unloads the exact script, and records actual geometry/focus and
  latency.

## Evidence

- `bash scripts/poc3-host-pilot-start.test.sh` passed 159/0 and
  `bash scripts/poc3-host-pilot-action.test.sh` passed 201/0. Bash and Node
  syntax checks plus `git diff --check` passed.
- Independent review confirmed the one-shot route rechecks KWin, production,
  trio, scope, hashes, inodes, fixture, template, bundle binding, convergence,
  and exact unload. Planner absence is revalidated separately with the
  read-only planner validator.
- The ignored prior bundle and sidecar are absent before the live sequence;
  the exact retirement command is therefore a no-op.
- Outcome: the first read-only frozen3 revalidation stopped before retirement,
  generation, `loadScript`, geometry, or focus mutation. The trio/planner
  validator rejected `/etc/profiles/per-user/beefsack/bin/jq` because it is not
  the exact Nix/devenv executable. No retry occurred.
- Actual rectangles, focus, latency, convergence, and visual state are
  unavailable because the start action did not run. Production and terminal
  exclusion were not re-observed after this pre-effect failure; the prior
  frozen3 evidence remains unchanged.
