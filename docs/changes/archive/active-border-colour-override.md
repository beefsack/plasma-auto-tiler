# Active Border Colour Override

## Goal

Allow the active border to use its configured colour instead of the Plasma
highlight colour, without changing the current default behavior.

## Scope And Non-Goals

- Add one migration-free native effect setting, defaulting to theme colour use.
- Add the corresponding QWidget KCM control, hot apply, effect resolution, and
  focused static/package coverage.
- Do not alter existing groups, keys, values, defaults, or unrelated settings.
- Do not claim live or session-delivery acceptance without a bounded reversible
  check.

## Acceptance

- `Use theme colour` defaults to enabled and persists in the native effect
  group.
- Enabled selects the Plasma highlight colour with the configured colour as its
  fallback; disabled selects the configured colour unconditionally.
- KCM Apply hot-applies both controls and causes existing borders to repaint.
- Producer and consumer lock updates are independently verified, committed, and
  non-force pushed.

## Plan

- Audit the native setting, KCM, effect, packages, and tests.
- Independently validate compatibility and state-flow semantics.
- Implement and verify focused native, Nix, KCM, and static contracts.
- Perform an independent review, reconcile records, publish producer, then
  update and publish only the consumer lock.

## Outcome And Evidence

- Implemented one new bool `UseThemeColor` in
  `Effect-plasma-auto-tiler-active-border`, default true, migration-free.
- Enabled retains theme highlight with configured fallback; disabled selects
  configured colour unconditionally.
- Native QWidget KCM controls it; the existing hot-apply/repaint path applies
  it.
- Focused native CMake build and 10 CTests including offscreen KCM cases
  passed; native static contract passed; native Nix build/package checks
  passed.
- Independent review found no defects.
- Read-only live feasibility found Nix-managed duplicate plugin-ID and
  unverifiable baseline, so no mutation/live acceptance ran and none is
  claimed.
- One post-deployment manual visual check remains.

## Next Action

- Normal deployment rebuild, then session boundary, then visual KCM Apply
  confirmation. Existing native-border live/session/manual acceptance remains
  pending.
