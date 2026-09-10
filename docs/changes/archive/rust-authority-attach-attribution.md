# Rust Authority Attach Attribution

## Goal

Identify the failed Rust-authority adapter slice behind the deployed
fail-closed `Meta+Right` refusal without changing authority behavior.

## Scope

- Add bounded, correlated failed-slice attribution to Rust authority attach and
  retry diagnostics.
- Preserve the all-or-nothing four-slice attach, one retry, no Legacy fallback,
  exact-three bootstrap, and existing session and Planner contracts.

## Acceptance

- A failed initial attach or lazy retry names only closed adapter slice tokens.
- Successful slices and existing retry/refusal behavior are unchanged.
- Focused authority, route-diagnostic, bundle, formatting, and package checks
  pass.

## Evidence

- Current-boot KWin PID 1949 received physical `Meta+Right` sequence 6, then
  refused it after its sole lazy retry had been consumed by an opaque
  all-slice attach failure. No adapter, D-Bus, or Planner request was reached.

## Outcome

- Failed `attach` records now add a closed `failed` slice category. A single
  null-returning slice is named; throws or multiple losses are `multiple`.
  Ready records are unchanged.
- Focused authority and route-diagnostic tests passed (46 tests), as did KWin
  typechecking and a temporary KWin bundle. Independent review found no
  correctness or authority-lifecycle findings.
- No live mutation was run: the new source is not the deployed KWin script.
