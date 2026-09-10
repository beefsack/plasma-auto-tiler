# Rust Active Normalized Identity

## Goal

Replace fragile active-window wrapper-reference membership checks in all Rust
authority adapter entries with the established normalized native ID.

## Scope And Non-Goals

- Static source and focused test work only; no KWin/Plasma, D-Bus, script-load,
  Planner, build, or host action.
- Preserve all eligibility, duplicate-identity, authority, retry, refusal, and
  validation behavior.
- Do not update backlog or decisions records.

## Acceptance And Approach

- Each active ID uses its entry's existing `normalizeNativeId` helper and fails
  closed when unavailable or invalid.
- Active membership compares normalized IDs only, preserving duplicate refusal.
- Fixed redacted diagnostics distinguish invalid active ID, active eligibility
  exclusion, and the same-ID distinct-wrapper case.
- Focused authority tests cover wrapper identity, invalid IDs, ineligibility,
  and duplicates without a native QList/QObject harness.

## Verification

- `npx esbuild "tests/engine-authority.test.ts" --bundle --platform=node
  --format=cjs --target=es2020 --outdir="/tmp/opencode/authority-id-review" &&
  node --test --test-name-pattern="engine authority active identity by native id"
  "/tmp/opencode/authority-id-review/engine-authority.test.js"` passed: 4/4.

## Outcome

- All four entries derive the active ID through their existing
  `normalizeNativeId` and compare that value against the eligible ID set; no
  reference fallback exists. Duplicate IDs still fail before membership.
- `active-unobserved:active-id-invalid` and
  `active-unobserved:active-ineligible:<fixed-category>` refuse failures;
  same-ID distinct wrappers succeed and emit `active-wrapper-mismatch`.
- `engine-authority.test.ts:171-252` uses plain JS arrays and objects with
  consistent synthetic IDs, so structurally it could not have caught native
  wrapper identity divergence. No native QList/QObject harness was added.

## Next Action

- None.
