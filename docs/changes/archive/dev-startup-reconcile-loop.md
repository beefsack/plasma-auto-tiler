# Development Startup Reconcile Loop

## Goal

- Stop a non-converging background-domain geometry echo from dispatching
  unbounded successful `reconcile` flights at development startup.

## Scope

- Apply the existing max-three same-scope drift reassertion then park policy to
  successful background reconciles.
- Preserve background admission/removal, shared single-flight, per-domain
  baselines, focus/desktop non-interference, and retained work-area projection.

## Evidence

- The supplied log records p0-p2 admissions followed by 6,808 successful
  `reconcile` flights, p3 through p6810, with one window. It does not identify
  the domain or native trigger.
- Hermetic reproduction shows a persistent hidden-domain geometry mismatch
  causes the same chain because successful background reconciles clear their
  retry state.

## Verification

- Production-adapter regression proves a persistent hidden-domain native echo
  stops after three successful reconciles and emits one park transition.
- `npm run typecheck --prefix kwin` passes.
- `npm test --prefix kwin` passes: 774 tests in 110 suites.
- `npm run build --prefix kwin` produces the production KWin IIFE.
- No live KWin, Plasma, D-Bus, or `just dev` action occurred. Live acceptance
  remains pending because the supplied log cannot identify its concrete domain
  or native geometry trigger.
