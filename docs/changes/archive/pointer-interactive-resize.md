# Pointer Interactive Resize

## Goal

Resize tiled windows by adjusting shared split boundaries or ratios and
reflowing neighbouring tiles.

## Scope And Non-Goals

- Static behavior and focused regression coverage must preserve tile topology
  and neighboring reflow.
- This record covers pointer resize, not keyboard layout expansion or
  multi-output proof.

## Acceptance

- A pointer drag adjusts a shared split boundary or ratio, reflows neighbouring
  tiles, and preserves the Custom Tile tree.
- Live acceptance requires a disposable layout, fresh user authorization, and
  manual confirmation of pointer behavior.

## Approach And Dependencies

- The static path depends on stable Custom Tile topology and may be accepted
  from static evidence without live proof. Live acceptance remains gated on
  L-01 and separate bounded authorization.

## Outcome And Next Action

- The static implementation and review are accepted. The live L-01 proof is
  unrun.
- 2026-09-07 host setup stopped fail-closed before the initial layout write.
  The exact selected trio resolved on `eDP-1` / desktop
  `f18245bc-0b73-4cda-9647-091f85aab333`: A
  `{2bed9554-de72-4b29-a627-24cc9190ddb2}` / PID `555222` /
  `com.mitchellh.ghostty`; B
  `{8667e61f-974d-42f9-ba16-ce2f4b61aeaa}` / PID `555222` /
  `com.mitchellh.ghostty`; C
  `{5197aad3-a9e7-424c-9e61-e01ba9f02099}` / PID `571321` /
  `org.kde.kate`. The generated bundle was not loaded. The exact old keyboard
  POC `pat-live-resize-20260907-p554898` was unloaded and verified absent.
  KWin exposes `window.internalId` as a QUuid object; strict string equality
  in the revalidate/layout scripts, `findExact`, and `connectOnC` therefore
  reported the enrolled A as missing. The temporary scripts unloaded cleanly;
  no geometry or focus write occurred, and
  `pat-pointer-resize-20260907-r571321` is absent.
- Next action: separately authorize and review a QUuid-to-string identity
  comparison correction, then begin a fresh bounded setup with a new identity
  query.
- 2026-09-07 correction: every test-only pointer POC lookup/revalidation path
  now compares `String(window.internalId)` with the enrolled string, with one
  focused QUuid-like coercion regression. Focused typecheck and pointer tests
  passed. The newly authorized one-shot `revalidate` then stopped because its
  required `pat-revalidate-ok` journal marker was not observed. Its temporary
  script unloaded in-process; no layout, focus, persistent pointer script, or
  gesture was performed. Production remains unloaded. Do not retry this failed
  host step without fresh authorization.
- 2026-09-07 learning-first host setup: under a separate authorization that
  explicitly bypassed the unavailable `pat-revalidate-ok` marker route, a
  minimal temporary D-Bus one-shot script matched only literal A/B/C by
  `String(internalId)`, PID, and app ID. `loadScript` returned `i 0` and its
  exact `/Scripting/Script0` `run` returned success. It applied A-left,
  B-upper-right, and C-lower-right rectangles `0,44 764x980`, `772,44 764x486`,
  and `772,538 764x486` with 8px gaps and focused C. The persistent generated
  pointer bundle then loaded as `i 1`, `/Scripting/Script1` ran successfully,
  and `isScriptLoaded("pat-pointer-resize-20260907-r571321")` returned `b true`.
  No marker/status query, gesture, production resume, or further host
   validation occurred. The prepared layout and loaded pointer plugin remain
   for user observation; manual pointer acceptance is still pending.
- 2026-09-07 correction: KWin 6.7's `interactiveMoveResizeStepped` carries
  Kate C's proposed geometry before an xdg-shell client necessarily applies
  its configure. The prior handler required the lagging live frame geometry to
  have moved, refused the first valid top-edge step, and disabled its lifecycle.
  The corrected handler validates the stepped payload and only checks the live
  C frame remains in the right column within a 2px tolerance; its final
  reconcile uses the last proposed boundary while C still lags. It writes only
  B and retains the reentrancy guard. One focused synthetic start, lagging
  fractional step, ack, finish sequence passes, along with pointer tests and
  typecheck. The exact old pointer plugin was unloaded. One reset/load attempt
  stopped after its temporary layout script ran because the required
  `pat-layout-ok` journal marker was absent; its temporary script unloaded and
   production and the pointer plugin are currently not loaded. The corrected
   generated bundle is present but has not been loaded. No gesture occurred.
- 2026-09-07 user-physical retry of the corrected pointer POC: Kate C resized,
  but Ghostty B remained frozen during the drag and after release; no B write
  was observed. Production remains suspended. The corrected pointer plugin may
  remain loaded; do not mutate current runtime state. Source investigation of
  the locally pinned KWin 6.7.4 tree found that the current POC connects only
  C `interactiveMoveResizeStarted`, `interactiveMoveResizeStepped(RectF)`, and
  `interactiveMoveResizeFinished`; it has no `frameGeometryChanged` or
  workspace fallback. Those are Window-only signals: untiled resize emits the
  stepped geometry before Wayland may apply the client geometry, while
  `frameGeometryChanged(oldGeometry)` reports an applied change and may occur
  only at resize end. No workspace stepped equivalent exists. The zero-write
  cause is indeterminate: lifecycle delivery, a fail-closed guard, duplicate or
  clamp suppression, and B write failure remain unseparated without retained
  signal diagnostics. Independent review rejects a
  `frameGeometryChanged`-only retest as decisive because its argument is the
  old geometry and end-only delivery is allowed. No decision or principle
  changed. Any further live diagnostic, marker/status query, script lifecycle,
  cleanup, gesture, production action, or retest requires fresh separate
  authorization.
- 2026-09-07 terminal pointer POC cleanup: the exact inert
  `pat-pointer-resize-20260907-r571321` plugin unloaded through KWin Scripting
  with a `true` reply. Post-unload `isScriptLoaded` returned `false`, and
  `/Scripting/Script2` was absent when introspected. No gesture, window action,
  production resume, trace deletion, crash-data inspection, or other cleanup
  occurred. Production remains suspended and the current A/B/C layout was not
  changed.
- 2026-09-07 accepted manual pointer observation: in normal mode, the user
  dragged Kate C's top edge with the minimal lexical-workspace Script2 reported
  loaded. Ghostty B reflowed continuously in real time; the interaction was
  subjectively smooth with a tiny acceptable lag. No unrelated A movement, gap,
  or focus anomaly was reported. This is direct visual evidence that the
  minimal handler attached and executed its B geometry writes, but supplies no
  retained machine evidence for Script2 identity, enrollment/scope, event or
  write counts, geometry/focus readback, latency, or atomicity. It does not
  supersede the earlier generated-plugin zero-write result, prove Custom Tile
  tree preservation, or accept lifecycle, drop reconciliation, workspace/output,
  persistence, Rust transport/runtime integration, or production behavior.

## Verification

- Focused pointer tests (24/24), `npm run typecheck`, and
  `bash scripts/pat-pointer-resize.test.sh` passed before the latest manual
  retry. The user then observed C resize with B frozen and no B write; this is
  a failed live result, not source proof of its cause. No investigation-time
  live action or runtime query occurred.

## Material Decisions And Accepted Evidence

- Shared split boundaries and ratios remain the selected resize behavior;
  neighbouring reflow is required.
- The static path is accepted. The minimal lexical-workspace path now has one
  accepted manual/visual top-edge C-drag observation of continuous B reflow;
  this does not establish the generated-plugin path or full L-01 acceptance.
- 2026-09-07 instrumented one-gesture setup: bounded trace instrumentation now
  emits only tagged event classes, geometry, and refusal codes for shell
  capture into one exclusive `/tmp/opencode` trace. Focused typecheck, 26
  pointer tests (including accepted/refused event sequence), and the pointer
  static check (141 assertions) passed. The exact existing
  `pat-pointer-resize-20260907-r571321` plugin was already absent and its
  absence was verified. The one authorized `start-layout` attempt then stopped
  fail-closed because `pat-layout-ok` was not observed. No trace path was
  created, no instrumented bundle/persistent plugin was loaded, no initial
  geometry/focus readback was established, and no gesture occurred. Production
  remains suspended. Do not retry this setup without fresh authorization.
- 2026-09-07 final learning-first move-versus-resize setup stopped before
  typecheck or script lifecycle: the sole focused pure event-sequence command
  had an assertion error in its move-model check, which compared the unchanged
  captured C rectangle against itself. Its failure is not an execution result
  for the handwritten `kwin/src/pat-pointer-reconcile-entry.js` handler. Before
  that check, production reported `b false`; exact
  `pat-pointer-debug-20260907` reported `b true`, unloaded with `b true`, and
  then reported `b false`; exact `pat-pointer-resize-20260907-r571321` already
  reported `b false`. The new generated IIFE was not loaded, no Script ID
  exists, and no geometry, focus, or gesture action occurred. The prior
  user-normal-mode top-edge-C observation remains recorded above; no
  move-versus-resize observation is claimed. Production remains suspended. Do
  not retry this setup without fresh authorization.
