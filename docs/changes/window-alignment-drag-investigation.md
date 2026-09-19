# Window Alignment Drag Investigation

## Finding

- Firefox accepts full-height admission and restart restoration; Ghostty's
  persistent short frame remains a separate native per-window constraint
  candidate.
- `/tmp/dev.log:599,610,621` contain three trace `drag-pull` dispatches with
  no observed callback, verdict, refusal, or `pointer-resize` plan. The script
  issued each D-Bus pull without a synchronous throw, but the trace cannot
  establish endpoint availability, response, loaded binary, or edge outcome.
- The rebuilt-effect warning at `/tmp/dev.log:35-39` is an unconditional
  `justfile:883` staging message, not current effect/service state.
- Reconciliation parked the then-current foreground scope at `:592` before
  the pulls. Same-scope ordinary drift reconciliation is suppressed while
  parked, but pull logs lack domain identity. Parking cannot explain the
  missing callback or prove shared-split adjustment.

## Evidence

- A callback must log `drag-verdict` or `drag-reply-invalid`
  (`kwin/src/drag-oracle-pull.ts:77-101`); only a parsed, non-cancelled
  verdict can reach pointer resize (`plan-adapter-entry.ts:2937-2988`).
- `plan-adapter.ts:1980-1983` suppresses parked ordinary reconciliation;
  interactive start/finish does not reset it, while a successful pointer plan
  does (`:3352-3357`).
- The active effect's `LastVerdict()` endpoint is read-only
  (`kwin/native-effect/dragoracle.cpp:20-35`).

## Next User Diagnostic

Run the second command only if the first returns `true`:

```sh
busctl --user --no-pager call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s org.plasmaautotiler.DragOracle
busctl --user --no-pager call org.plasmaautotiler.DragOracle /org/plasmaautotiler/DragOracle org.plasmaautotiler.DragOracle1 LastVerdict
```

- `NameHasOwner=false` proves no current endpoint owner. A `LastVerdict`
  response proves responsiveness only, not source identity. A session boundary
  is not a selected repair for Firefox, Ghostty, parking, or either edge.

## Verification

- `npm run typecheck` and `npm test` in `kwin/` passed: 777 tests.
