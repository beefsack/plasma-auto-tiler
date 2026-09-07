# POC3 Diagnostic Resize Retry

## Goal

Make the project-owned raw xdg-shell diagnostic client reallocate and commit a
solid-color SHM buffer for each accepted compositor resize, then perform one
host-only diagnostic trio layout retry for user observation.

## Scope

- Exact cleanup only for the currently recorded supervisor and three diagnostic
  clients after PID/start-tick/executable/app-ID validation.
- Record bounded positive toplevel configure dimensions; ack the matching
  surface configure and commit a buffer at that size, retaining 320x240 for
  zero dimensions.
- Keep buffer/pool/file/map lifetime safe through repeated configure and
  `wl_buffer.release` events.
- Focused Rust state/buffer tests, formatter, focused tests, and diagnostic
  Clippy only.
- One fresh host trio, one generated receipt-bound one-shot `H[A,V[B,C]]`
  script with an 8px gap, then exact script unload.

## Non-Goals

- No production tiler resume, planner, focus/move commands, shell-harness
  expansion, Custom Tile, shortcuts, workspace/output/config/dotfile/Nix
  mutation, commit, or push.

## Acceptance

- Resize configures allocate and attach correctly sized bounded SHM buffers;
  invalid/excessive sizes produce bounded diagnostics and do not commit.
- The fresh trio is exactly identity-bound and KWin sees one window per app ID.
- The one-shot layout is applied to only its literal fresh PID/app-ID pairs,
  leaves the trio arranged, and focuses red for manual observation.

## Plan

1. Clean up the current exact trio and verify absence.
2. Implement and statically verify resize/lifetime behavior.
3. Independently review configure ordering and buffer lifetime, then correct
   direct findings.
4. Freeze the corrected binaries, launch one fresh trio, apply one exact
   one-shot layout, unload it, and record machine evidence.

## Outcome

- The old frozen3 supervisor `162156`/`27518169` and clients
  `162172`/`162173`/`162174` (each tick `27518182`, slots/app IDs 1-3) were
  receipt-validated for canonical executable identity and then stopped through
  `poc3-host-trio.sh stop`. Independent `/proc` and `kill -0` checks found all
  four absent. No other PID was signalled.
- The client now retains the latest valid positive configure size, uses
  `320x240` only before any positive size, acks each valid distinct surface
  configure before attaching/committing its matching ARGB SHM buffer, and
  emits nonterminal bounded diagnostics for rejected configures. Its buffer
  tracker retains unreleased stores, reuses only released compatible stores,
  limits live stores to four, and destroys all stores only at terminal cleanup.
- Focused verification passed: `cargo fmt`; `cargo test --test
  poc3_diag_client` (21 passed); `cargo test --lib poc3_diag` (29 passed); and
  `cargo clippy --bin poc3-diagnostic-client -- -D warnings`. An independent
  review found configure-retention, nonterminal-invalid-configure,
  unreleased-buffer reuse, and missing attach failure gaps; these were
  corrected and the same checks passed afterward.
- One post-test build produced frozen, mode-555, content-addressed binaries:
  diagnostic client
  `poc3-diagnostic-client-91652e7f47111a5ca0918e319e6de9b288591e42f9248610efda0ac35242d563`
  and supervisor
  `poc3-diag-supervisor-211b5993e0336385b57b5c356ad4ebe8677383c97eb553e7257934f172da8ec1`.
  No build ran afterward.
- The sole fresh-trio launch stopped before spawn because the fixed
  project-owned host base already contains `host-1.diag.log`; its new receipt
  was never created and there are no fresh client identities or geometry/focus
  writes. A later read-only recovery found multiple stale receipt generations,
  logs newer than their receipts, live nested diagnostic clients, and no public
  KWin API for authoritative POC-script absence. No live process can be proven
  to claim the fixed paths, but that does not authorize deleting ambiguous
  residue. The route remains blocked fail-closed; no retry, KWin script,
  layout, focus, planner, production resume, or cleanup occurred.

## Current POC Setup

- The user authorized a pragmatic fresh host trio and temporary exact-trio
  shortcut POC. The stale receipt's old KWin-owner equality was waived only for
  its recorded supervisor PID `509390`: its start tick, canonical executable,
  executable SHA-256, device/inode, boot ID, and project supervisor command
  matched, so it alone received TERM and was absent within the bounded wait.
  The stale receipt and all residue remain preserved.
- The requested fresh shortcut bundle cannot be prepared before trio launch:
  `poc3-build-host-swap.mjs` embeds the fresh internal IDs, PIDs, start ticks,
  scope, rectangles, chords, and action namespace as compile-time defines, and
  KWin supplies no load-time argument channel. No current prebuilt bundle can
  match a fresh trio. The requested prohibition on builds after trio launch
  therefore prevents loading the required identity-bound script. No new trio,
  geometry write, shortcut mutation, planner action, config write, or
  production action was performed. Awaiting the user's decision to permit one
  exact post-launch bundle-generation invocation or to leave this POC stopped.
- 2026-09-07 learning-first host resize setup: with production
  `plasma-auto-tiler-kwin` still unloaded, an observation-only script selected
  active Ghostty A `{2bed9554-de72-4b29-a627-24cc9190ddb2}` and the only other
  scoped Ghostty B `{8667e61f-974d-42f9-ba16-ce2f4b61aeaa}` (both PID `555222`,
  app ID `com.mitchellh.ghostty`), plus the only scoped normal resizable Kate C
  `{5197aad3-a9e7-424c-9e61-e01ba9f02099}` (PID `571321`, app ID
  `org.kde.kate`). All are on desktop
  `f18245bc-0b73-4cda-9647-091f85aab333`, output `eDP-1`, work area
  `0,44 1536x980`. The old exact shortcut plugin `pat-live-poc-20260907` was
  unloaded and verified absent without direct KGlobalAccel changes. Persistent
  `/tmp/opencode/pat-live-resize-20260907-p554898.js` (SHA-256
  `1a99ef8428467181aa639efb5945aeeda0dcd18d1362ec2a97b0b08fb252f03a`) loaded as
  `pat-live-resize-20260907-p554898`, returned Script object `/Scripting/Script0`,
  registered the four requested runtime chords, and read back initial
  `H[A,V[B,C]]` geometry with 8px gaps: A `0,44 764x980`, B `772,44 764x486`, C
  `772,538 764x486`; focus is A. No resize chord was invoked. The test plugin is
  intentionally left loaded for user latency observation; visual evidence is
  pending. Exact cleanup is `unloadScript("pat-live-resize-20260907-p554898")`
  followed by `isScriptLoaded` false verification. No production resume,
  configuration write, planner, diagnostic client, receipt framework, broad
  test, commit, or push occurred.

## Pointer Resize POC

### Goal

- Replace the temporary keyboard-resize script with one persistent, test-only,
  identity-bound KWin script. During only a top-edge pointer resize of Kate C,
  it reflows the neighboring Ghostty B in real time while Ghostty A is an
  unchanged control.

### Scope And Non-Goals

- The literal host A/B/C identities are the only eligible windows. A and B
  intentionally share PID `555222`; identity binding also requires their exact
  internal IDs and app IDs. C requires its exact ID, PID `571321`, and app ID.
- The script owns no C geometry during the gesture: native KWin owns C and the
  script writes only B's frame geometry when a validated split boundary changes.
- No production tiler, planner, polling/timers, Custom Tiles, drag/drop
  restructuring, shortcuts, config, workspace/output mutation, broad harness,
  pointer gesture, commit, or push is in scope.

### Acceptance And Plan

1. Read-only checks revalidate the exact eligible trio, common scope, normal
   resizable state, and production-not-loaded state. The old plugin
   `pat-live-resize-20260907-p554898` is exactly unloaded and verified absent.
2. A fresh initial `H[A,V[B,C]]` projection has 8px gaps and equal B/C shares;
   C is focused after its readback.
3. The persistent replacement connects only to C's interactive resize start,
   step, and finish signals. It rejects every non-top-edge gesture and touches
   no window except B on an accepted changed boundary.
4. Focused pure geometry/signal coverage, typecheck, and an independent live
   safety review pass before load. Setup evidence records only loading and the
   initial readback; the user alone performs any pointer gesture.

### Current Blocker

- The authorized first read-only `revalidate` attempt stopped before any
  geometry, focus, or plugin mutation. Its temporary observer ran and was
  exactly unloaded, but KWin reported no window matching literal A
  `{2bed9554-de72-4b29-a627-24cc9190ddb2}` with PID `555222` and app ID
  `com.mitchellh.ghostty`. The old keyboard plugin remains loaded, production
  remains unloaded, and no pointer plugin was loaded. The supplied literal
  enrollment cannot be refreshed without new exact user target authorization.
