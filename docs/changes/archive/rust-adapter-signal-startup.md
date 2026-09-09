# Rust Adapter Signal Startup

## Goal

Restore fail-closed construction of the four packaged Rust-authority KWin
adapters on KWin 6.7.4 without changing Rust authority policy or activation.

## Scope

- Correct the public KWin QObject signal capability check shared by focus,
  movement, keyboard resize, and pointer resize entries.
- Retain lexical `workspace`, direct Window APIs, exact signal ownership,
  all-or-nothing Rust authority, on-demand Planner activation, and exact
  detach semantics.
- Add runtime-shape, source, bundle, and authority regressions for callable
  KWin signals and required versus optional signal handling.

## Non-Goals

- No live KWin action, polling, fake globals, Legacy fallback, Planner startup,
  geometry actuation, or portable Rust contract change.

## Acceptance

- Callable QV4 QObject signals attach and detach exactly once for all four
  adapters in static KWin runtime-shape tests.
- Focus/movement/keyboard use lexical-workspace lifecycle signals and direct
  Window `moveResizedChanged`; pointer uses exact per-Window interactive
  start/step/finish signals and an optional geometry guard.
- A missing required pointer signal and any missing required shared signal
  refuse Rust authority under the explicit all-or-nothing policy.
- Package/bundle/source tests exclude polling, generic globals, and Legacy
  fallback.

## Approach

1. Share a narrow callable-QObject-signal connector across the four entries.
2. Cover live QV4 function-shaped signals, optional guards, required refusal,
   idempotent detach, packaged construction, and authority startup.
3. Run focused static verification, package build, review, commit, and push.

## Evidence

- Read-only deployed diagnosis: all four entries rejected before a Planner
  command. KWin 6.7.4 exposes QObject signals as callable functions with
  prototype `connect`/`disconnect`; the entries incorrectly required objects.

## Outcome

- A shared callable QObject-signal connector now attaches the same handler and
  idempotently detaches it across all four entries. Focus uses the five lexical
  workspace lifecycle signals; movement and keyboard resize also use direct
  Window `moveResizedChanged`; pointer uses direct Window interactive
  start/step/finish signals with an optional geometry guard.
- Static KWin-shaped runtime tests construct all four real entries together,
  prove exact handler counts and repeated-stop cleanup, and prove that a
  missing pointer step signal disables the all-or-nothing Rust authority with
  no Legacy route. No live KWin success is claimed.
- Verification passed: KWin typecheck; 243 focused adapter, authority,
  controller, and bundle tests; KPackage contract tests; an impure path-source
  Nix KWin-script build; and diff checks. No Rust or native KCM source changed.
