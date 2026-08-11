# Plan: Keyboard Window Movement

Status: static scope completed and archived on 2026-08-11.

## Work Units

| ID | Status | Scope | Verification |
|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Directional empty-leaf movement actions, guarded assignment, occupancy reconciliation, focused tests, and bundle build. | Controller/action tests, `npm run typecheck`, `npm run build`, `npm test`, SHA-256. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| Nine-action registration and inert failure | Entry/controller registration vectors |
| Empty directional selection and tie fidelity | Pure/controller directional vectors |
| Guard and throw inertness | Controller no-write diagnostics and assignment-failure vectors |
| Single-write occupancy reconciliation | Controller behavior after success |
| Static delivery | Typecheck, build, full suite, bundle hash |

## Residual Risk

KWin tile assignment and callback behavior remain static-only and unvalidated in
a live session.

## Final Outcome

- The nine-action gate now includes the four exact move actions. Each reuses the
  accepted directional ranking but filters only empty non-layout leaves.
- A move requires a singleton active source, checks fresh active identity/scope,
  source occupancy, target emptiness, and target direction before one guarded
  tile assignment. Controller occupancy is decode-derived, so KWin reassignment
  subsequently exposes source empty and target occupied without persistent state.
- `npm run typecheck`, `npm run build`, and `npm test` pass. The complete suite
  reports 259 tests across 36 suites and the generated IIFE SHA-256 is
  `18b05f2232ebccc81cf667f22fa595956184b350ba2b62da6401489c98dd1a92`.
