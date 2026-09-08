# Rust Engine Direct Geometry Migration

## Goal

Migrate structural tiling authority from the legacy KWin Custom Tile runtime to
a portable Rust engine with a thin KWin direct-geometry adapter, preserving
production behavior through incremental opt-in promotion.

## Decision And Boundaries

- Rust owns IDs, normalized snapshots, ordered N-ary topology/groups/shares,
  `cosmic_v1` policy, logical workspaces/outputs, focus/navigation, movement,
  plans/preconditions/capabilities, geometry projection, reconciliation, and
  trace replay.
- KWin owns native observation, direct geometry/focus actuation, lifecycle,
  permissions, signal delivery, native exceptions, and effects. It is never a
  second topology authority, and no KWin fork or patch is allowed.
- Direct geometry writes are sequential, not atomic. The adapter records
  applied and acknowledged divergence, minimizes visible intermediate frames,
  and makes no atomicity promise.

## Accepted POC Reference

- Manual/visual three-window evidence accepted: `H[A,V[B,C]]` with consistent
  8px internal gaps; directional focus; B/C keyboard swap with retained focus;
  keyboard split-share resize and neighbor reflow; continuous pointer C resize
  with B reflow; and final move/resize distinction where B stayed fixed, C
  followed the pointer, and C snapped back at release. Screenshot reference:
  `/home/beefsack/Pictures/Screenshots/Screenshot_20260907_172658.png`.
- User reports no material jank, unrelated movement, focus/gap failure, or A
  movement. A rare single-frame pink-wallpaper flash is accepted as an observed
  sequential-geometry artifact, not proof of cause or atomicity.

## Limits And Non-Evidence

- The POC is manual/visual only. It does not prove production parity,
  generalized lifecycle, measured latency, native acknowledgement, persistence,
  workspace/output handling, drop reorganization, or reliability.
- The earlier `EvaluatePoc3` Rust D-Bus call returned EIO. No service integration
  may be relied upon until a minimal authenticated read-only round trip passes.
- Generated pointer zero-write, journal-marker absence, QUuid coercion mismatch,
  lagging-frame guard, and a pure move-model assertion error are harness or
  diagnostic failures, not architecture evidence.
- Deferred product behavior includes floating/fullscreen/maximize/sticky,
  add/remove, drag placement, settings, border/tray boundaries, and all
  logical-workspace/output behavior until each incremental slice is promoted.

## Ordered Migration Slices And Gates

1. Checkpoint the intended worktree: review status and diff, then explicitly
   select only the POC/reference/core/docs groups: POC KWin adapters/tests and
   scripts, Rust model/contract/reconciliation/trace modules and tests, locked
   POC fixtures, and the decision/backlog/change/archive records. Exclude
   secrets, `/run` or `/tmp` runtime evidence, generated bundles
   `dist/plasma-auto-tiler-kwin.kwinscript*` and
   `kwin/contents/code/main.js`, unrelated controller/conformance/research/tray
   work, and mode-only script changes unless separately justified. Commit and
   push that reviewed checkpoint. This is the first action of the next
   autonomous session.
2. Stabilize the Rust core module boundaries and portable model: `ids`, snapshots,
   ordered N-ary model, `cosmic_v1` policy, plans/preconditions/capabilities,
   geometry projection, reconciliation, and trace replay. Gate with deterministic
   unit, conformance, and property-style tests.
3. Repair/select the production Rust service transport and thin KWin JS adapter.
   First prove one authenticated, read-only request/reply with strict identity,
   schema, correlation, timeout, and fail-closed behavior. Gate with adapter
   contract fault tests and a read-only host journey.
4. Add one opt-in shadow direct-geometry projection for a bounded topology. KWin
   signals drive observation and pointer resize; no polling. Compare desired,
   applied, and acknowledged state without changing legacy authority. Gate with
   trace replay, static adapter tests, and user-owned manual layout/focus journey.
5. Promote small direct-geometry slices one at a time: focus/navigation; R1-R4
   movement; keyboard resize; pointer resize; drag reconciliation/placement; and
   add/remove. Each promoted path replaces its legacy path with no fallback while
   other production paths remain legacy.
6. Add native exception and domain slices: floating, fullscreen, maximize,
   sticky, logical workspaces/outputs, settings, and border/tray boundaries.
   Implement N-ary groups solely in Rust, independent of Custom Tile limits.
7. Expand opt-in coverage to production replacement only after behavior,
   divergence, fault, performance, and user-owned host gates pass. Suspend/resume
   only the relevant production path with a small identity-bound procedure;
   avoid further nested-session/recovery investment unless it tests a unique risk.

## Performance And Rollout Gates

- Before native promotion, measure plan latency and stale/divergence rates under
  event bursts. The provisional core target is p99 under 5 ms for a bounded
  256-window snapshot; each adapter slice defines its own bounded event-to-plan
  and plan-to-write target. Observe pointer resize through KWin signals only and
  record sequential flash and applied/acknowledged divergence.
- Use feature-gated opt-in, shadow, and diagnostic modes before replacement.
  Keep rollback as an exact production suspend/resume boundary, not the POC's
  broad harness. Do not run direct geometry and Custom Tiles as dual topology
  authorities.
- Test with Rust deterministic/conformance/property-style suites, adapter fault
  contracts, trace replay, KWin adapter static tests, and user-owned host manual
  journeys. Do not overinvest in nested recovery unless it covers a unique risk.

## Current Outcome

- Slice 2 Rust-core stabilization completed 2026-09-08: session
  owner/generation/correlation IDs are bounded opaque types; observations and
  plans use the immutable typed contract; ordered N-ary directional groups
  require explicit positive integer shares; `cosmic_v1` is the versioned R1-R4
  policy entry point; and the portable integer geometry projector is
  deterministic, gap-aware, and fail-closed on malformed or unrepresentable
  topologies. Reconciliation retains one pending plan and commits only after
  exact acknowledgement plus verified post-observation. Bounded redacted trace
  replay and all accepted planner/trace fixtures remain byte-stable and pass
  through `cosmic_v1`. Deterministic unit and property-style matrix coverage,
  `cargo fmt`, `cargo check --all-targets`, and full `cargo test` pass.
   Full-target Clippy has only the pre-existing accepted `src/tray.rs` test
   lints (`assertions_on_constants` and `type_complexity`). The next minimal
   gate is slice 3: one authenticated read-only Rust/KWin request/reply with
   strict identity, schema, correlation, timeout, and fail-closed behavior.
- Slice 3 static implementation completed 2026-09-08: the session-D-Bus
  planner service route replaces `EvaluatePoc3` with `DescribeAdvisoryPlan`, a bounded JSON
  v1 request/reply for exactly three normalized opaque windows. It delegates
  deterministically through `cosmic_v1`, has no native execution fields or
  mutation, tracks owner/generation/revision/correlation fail-closed, and
  consumes its one advisory request until an explicit service restart. It
  retains existing KWin sender identity verification. The standalone KWin
  client validates the same bounded envelope, resolves the planner well-known
  name, pins its `:N.M` owner for dispatch, revalidates that owner before
  accepting a reply, and enforces one flight with timeout. Rust and adapter
  static tests pass. Public KWin scripting cannot attest the resolved
  same-UID planner service binary, and no live KWin/Plasma request/reply was
  attempted. The first authenticated read-only host round trip plus stale and
  service-loss evidence remain pending separate authorization.
- The authorized 2026-09-08 read-only host verification stopped during static
  preflight before any host baseline, planner service, or KWin script lifecycle
  action. The standalone advisory entry, deterministic ES2017 IIFE builder, and
  namespaced exact-script loader are now statically complete: they bind exact
  source/input/bundle identity, accept returned Script ID 0, run and clean up
  only the recorded Script object, and parse bounded correlated diagnostics.
  Production coexistence is limited to this independently checked read-only
  advisory route, which has no topology authority, actuation, shortcut, Custom
  Tile, controller, or production-startup path. Focused Rust, standalone
  KWin-query, entry/builder, and lifecycle shell tests passed. The first
  authenticated read-only host request/reply, stale-refusal, service-loss,
  zero-mutation, and restoration evidence remain pending fresh authorization
  after this static unit is committed.
- The later authorized 2026-09-08 read-only host preflight verified the KWin
  identity and public `/KWin` surface, production plugin loaded, advisory test
  plugin absent, Planner name unowned, and generated advisory artifacts absent.
  `org.kde.KWin /KWin queryWindowInfo` timed out. No planner service or advisory
  script lifecycle action, production action, or host mutation occurred. The
  lifecycle authorization is unspent.
- The static bounded observation prerequisite completed 2026-09-08: the
  standalone entry passes lexical `workspace` to a direct-public-API observer.
  It accepts only every eligible normal managed resizable non-popup,
  non-minimized, non-fullscreen, unmaximized, non-sticky, non-interactive,
  non-floating window in the active window's current output and desktop scope;
  it fails closed unless that set is exactly three with valid opaque session IDs
  and frame/work-area geometry. It emits a flat advisory-only v1 snapshot with
  explicit `swap_neighbor` capability only, retains native references inside the
  adapter, and recaptures the same native identity, membership, tile, geometry,
  and focus precondition immediately before pinned planner dispatch. KWin has
  no public native generation/revision API for this scope, so the adapter makes
  no such native-version claim; the existing injected generation/revision remain
  strictly bound through the request/reply contract. It has no signal,
  controller, shortcut, tile operation, focus/geometry write, or production
  startup path. Static adapter, entry/query, builder, schema, and source-bound
  bundle checks pass. The first host success, stale-request, service-loss,
  zero-mutation, and restoration evidence remain pending fresh authorization
  after this static unit is committed.
- The authorized 2026-09-08 host journey stopped during read-only preflight
  before any planner service or advisory Script object was created. Focused
  Rust, standalone KWin-query, builder, and loader checks passed; the committed
  observer/entry/builder/loader binding, KWin identity, loaded production
  plugin, absent advisory plugin and Planner name/process, and configuration
  diagnostic were established and remained unchanged after the stop. The public
  `queryWindowInfo` baseline request again exceeded its bounded timeout, so an
  exact eligible-three snapshot was unavailable. No request/reply, stale,
  service-loss, or mutation evidence is claimed; lifecycle authorization is
  unspent. A future attempt requires fresh authorization and a safe read-only
  exact-three baseline route. The accepted public-KWin limitation remains only
  that initial same-UID planner-binary identity cannot be attested; this run
  makes no hostile same-UID resistance claim.
- Static correction and bounded host preflight, 2026-09-08: the interactive
  `queryWindowInfo` baseline dependency is removed. The standalone advisory
  entry captures the first exact-three lexical-workspace observation on its
  exact run, revalidates before pinned dispatch, and emits an opaque,
  correlation-bound after-equality verdict after the terminal result. A false
  verdict forces `reject:advisory-stale-snapshot`; the host loader requires an
  after marker that follows the result and creates a receipt only for
  `could-execute` plus after true. Drift and all refusal pairs exact-clean with
  no receipt. Focused KWin typecheck/advisory, builder, loader, Rust advisory
  contract/service, format/check, and focused Clippy verification pass; the
  only Clippy warnings remain unrelated tray test lints. The one standing-
  authorized preflight confirmed production loaded and advisory/planner absent,
  then stopped before planner or Script creation because canonical KWin
  executable readback was unavailable. A fresh project runtime directory had
  already been created, but its generated identity was not retained. It is
  ambiguous residue, no broad cleanup occurred, and no further live attempt is
  authorized until the user directs its handling. No success, stale,
  service-loss, zero-mutation, production-continuity, or exact-restoration live
  claim is made. The accepted transport limit remains owner-pinned
  same-session evidence only, not resistance to a hostile same-UID planner.
- Resource-order correction and bounded host preflight, 2026-09-08: the
  advisory loader now performs all source/tool checks and its complete
  read-only KWin owner/PID/start-tick/executable identity route before its
  deterministic rebuild scratch space, receipt, or Script lifecycle. It uses
  only the reviewed systemd fallback, with the direct-parent route available
  only for the exact documented MainPID mismatch. Production must be loaded;
  the advisory plugin and Planner name must be absent; owner, PID, tick,
  executable, and identity source are captured twice and must agree. Planner
  absence uses a strict `NameHasOwner` false reply, so transport or malformed
  replies fail closed. Focused loader tests prove no resource for identity,
  fallback, production, collision, planner-diagnostic, malformed-output, and
  tool/source failures; shell identity tests, KWin advisory tests, Rust
  advisory/service tests, format/check/test, and focused Clippy pass. The
  user's unidentified prior advisory runtime residue is explicitly preserved:
  it was not searched, inspected, identified, modified, or deleted. One fresh
  resource-free host preflight stopped because the current KWin identity did
  not satisfy the reviewed fallback route and Planner absence returned an
  unexpected diagnostic. No planner, advisory Script, runtime directory,
  artifact, receipt, or service was created. No success, stale, service-loss,
  zero-mutation, production-continuity, or restoration live evidence is
  claimed; the transport gate remains open.
- Checkpoint gate completed 2026-09-08: reviewed portable Rust
  model/contract/reconciliation/trace foundation, generic KWin POC adapters and
  reference tooling/tests, locked fixtures, and related governance/archive
  records were committed and pushed. Generated bundles, `main.js`, controller,
  conformance/research/tray, nested-harness, host-literal pointer/pilot, and
  runtime evidence remain excluded. P1 advances to slice 2 Rust core
  stabilization.
- POC cleanup completed 2026-09-07: exact temporary scripts unloaded and
  recorded POC processes were absent. Live source resolution selected
  `/nix/store/5z7pcqklpk9x037k9b933snc3a4zq6rw-plasma-auto-tiler-kwin-0.1.0/share/kwin/scripts/plasma-auto-tiler-kwin/contents/code/main.js`;
  `loadScript` returned `2`, `run` succeeded, and
  `isScriptLoaded("plasma-auto-tiler-kwin")` returned true. This is an
  operational resume observation, not a new receipt or exact in-memory source
  attribution proof.
