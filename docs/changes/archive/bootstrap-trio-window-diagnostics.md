# Bootstrap Trio Window Diagnostics

## Goal

Make a single Rust-mode script reload identify the ID-sorted bootstrap slot and
orientation predicate a user must correct.

## Scope

- Emit a bounded diagnostic for each of the three sorted bootstrap candidates.
- Preserve all adoption decisions, eligibility, sorting, and the exact-three
  requirement.
- Regenerate the generated KWin bundle without reloading it.

## Non-Goals

- Change startup-only adoption, retry behavior, Rust, geometry, focus, or
  fallback behavior.
- Create `docs/principles.md`.

## Acceptance

- A failed orientation bootstrap emits three per-window diagnostics with slot,
  orientation, predicate satisfaction, and one non-sensitive identity mechanism.
- Tests reject titles and raw geometry in the diagnostic output.
- KWin typecheck, tests, and the start-test harness are run with known failures
  distinguished.

## Approach

- Derive diagnostic-only categories from the existing observed three-window
  scope immediately before its unchanged bootstrap decision.
- Record the two deferred product decisions in the backlog.

## Outcome

- Every exact-three bootstrap attempt now emits one line per lexical opaque-ID
  slot after its existing summary line:
  `plasma-auto-tiler:route-diag:scope:detail=trio-slot-{0|1|2}:kind={landscape|portrait|square}:result={pass|fail}:wid=<8-lowercase-hex>`.
- `result` mirrors only the existing slot rule: slot 0 always passes, slot 1
  requires landscape, and slot 2 requires portrait or square. The diagnostic
  does not participate in the bootstrap decision.
- `wid` is an FNV-1a 32-bit hash of the already normalized internal ID. It is
  emitted through a dedicated schema field that accepts exactly eight lowercase
  hexadecimal characters and fails closed to `00000000`.
- Raw `resourceClass` was rejected: the shared route-diagnostic convention
  explicitly excludes application IDs, as well as captions, native IDs, and
  geometry. The opaque hash is bounded and non-sensitive, but it can only link
  a candidate across repeated diagnostic output; public KWin scripting exposes
  no safe user-visible inverse mapping from that hash to a physical window.
- Post-startup retry is technically possible by calling the existing observation
  and resize seed path from a later trigger while the shared revision remains
  fresh. It would change lifecycle behavior, need an explicit bounded trigger,
  deduplication/coalescing and race rules, and repeatedly observe/log scope;
  it remains pending user decision.
- Lexical ID order is load-bearing for the current deterministic seed because
  KWin and Rust bind the sorted A/B/C IDs to `H[A,V[B,C]]`, including the shape
  checks and focused last window. It is incidental to topology semantics: a
  stable observable physical order could replace it if both sides adopted the
  same order, but that changes window-to-leaf mapping and bootstrap outcomes,
  so it remains pending user decision.

## Evidence

- Focused bootstrap suite: 11 passed, 0 failed. It covers both orientation
  refusals, all slots, all orientation categories, fixed hash format, malformed
  hash refusal, raw ID/title/caption/application-class/raw-geometry exclusion,
  and a Qt-style non-Array window list with a distinct active wrapper.
- `npm --prefix kwin run typecheck`: expected unrelated unused
  `catalogValidationDiagnostics` error in `kwin/src/controller.ts`.
- `npm --prefix kwin test`: 1,831 passed and 11 failed. The new bootstrap suite
  passed; failures are the pre-existing protected untracked COSMIC/POC residue
  tests.
- `bash scripts/start-test.test.sh`: 399 passed, 0 failed.
- Regenerated `kwin/contents/code/main.js`. No KWin reload, shortcut, Planner
  action, or live tiling action occurred.
