# Full COSMIC Movement Parity Architecture

## Goal

Assess every credible non-fork architecture for the user-selected full COSMIC
movement/navigation contract on KWin 6.7.4 while preserving accepted Custom
Tile behavior. The user has rejected a KWin fork or patch. Implement and
evaluate a smallest additive Rust engine POC as an offline, platform-neutral
foundation; it does not replace the KWin runtime or select other platforms.

## Scope And Non-Goals

- R2b/R2c occupied structural moves, R3 reparenting, ordered child insertion,
  group restructuring, R4 cross-output movement, focus, resize, drag
  placement, persistence, and recovery are in scope.
- The accepted bounded script adapter remains intact and fail-closed for these
  paths until a replacement is explicitly authorized.
- Grouping means only an ordered nested split tree. Tabs, stacks, shared tiles,
  and compositor groups are out of scope.
- The Rust POC is authorized as an additive offline library only. It authorizes
  no KWin/Plasma mutation, package replacement, fork, commit, or push.

## Confirmed Evidence

- Target resolution and host runtime are KWin 6.7.4. The flake pins nixpkgs
  `54ba4bcec4043e72a4006d825e0d7aff5562008f`; `nix eval` resolves its KWin
  package to 6.7.4.
- KWin `v6.7.4` source commit
  `8438567a741826da8b7536a8b10eb3af8fc8820d` exposes to scripts window
  `frameGeometry` writes, activation, desktop assignment, output moves,
  lifecycle and passive interactive-move/resize signals, plus Custom Tile
  `split`, `remove`, `manage`, and geometry writes. The exact binding surface
  is source-verified at that pin.
- Custom association is intentionally forgotten during output moves
  (`src/window.cpp:3896-3897`). Per-output managers and the unacknowledged
  two-second persistence timer prevent a composed script operation from being
  transactional. Direct layout-tile assignment can orphan a window; script
  `remove` plus `split` is crash-class.
- No script API provides indexed insert-child, reparenting, a tile constructor,
  a multi-window transaction or rollback, a Custom Tile save/flush completion,
  a Wayland configure completion barrier, programmatic interactive control, a
  cancellation result, or a stable script-visible output UUID. The protected
  tile operations remain private (`src/tiles/tile.h`), and tile headers are not
  an installed public out-of-tree plugin API.
- `Window.frameGeometry` calls `moveResize` without creating a tile association
  (`src/window.h:479`; `src/window.cpp:3412-3420`). Under Wayland, geometry and
  tile requests complete only after client configure acknowledgement
  (`src/xdgshellwindow.cpp:822-831,851-855`). A project-owned geometry tree
  therefore cannot use KWin's tile-aware resize, special-state geometry,
  association, persistence, output evacuation, or restore semantics.
- A project-owned ordered N-ary tree remains valid as a pure planner and test
  model. It can compute COSMIC shares, focus routes, insertion/removal, and
  reparenting without KWin mutation, but direct geometry projection does not
  make those operations durable or compositor-atomic.
- The existing adapter and archive accurately record bounded parity only:
  [conformance](../cosmic-move-conformance.md#kwin-production-adaptations-and-named-gaps)
  and [archive](archive/cosmic-directional-movement.md#outcome-and-evidence).

## Preserved Behavior And Evidence Gates

- The accepted floating, fullscreen, maximize, workspace-mode, pointer
  resize/reflow, nested-placement, shortcut, border, and tray behavior remains
  the baseline. Direct geometry projection would need to replace or reconcile
  KWin tile association for the first six and would add new live Wayland,
  XWayland, hotplug, workspace, and failure-recovery gates.
- No live KWin/Plasma action occurred for this assessment. Source evidence does
  not accept the existing pending live gates.

## Options

| Option | Full parity | Relative cost and risk | Consequence |
|---|---|---|---|
| Retain bounded Custom Tile adapter | No - R1/R2a and existing accepted paths only | Lowest | KWin remains the layout authority; unsupported reparent, indexed insertion, group restructuring, and cross-output moves remain fail-closed |
| Project-owned logical tree with direct `frameGeometry` projection | No | High | It can model all tree edits, but loses tile association and has no atomic reflow, configure completion, script persistence write, stable output identity, or reliable interactive cancellation/recovery. It conflicts with accepted tile-aware behavior and must not be called full parity |
| Hybrid logical tree plus Custom Tiles | No | Highest script-only | Retains every Custom Tile structural and cross-output limit while adding two sources of truth, dual interaction paths, and mirror divergence; it gains no missing transaction |
| External service or public native effect/plugin | No | High for no movement gain | Stock D-Bus, Plasma window-management, and public effect APIs expose neither tile authority nor safe other-window management. A private-header bridge is version-coupled and rejected; a service may persist snapshots only |

## Recommendation

No credible stock-KWin architecture provides full COSMIC parity. Do not migrate
the accepted adapter to a direct-geometry or hybrid runtime in order to claim
parity. Retain the bounded Custom Tile adapter and project-owned planner as the
safe stock-KWin baseline. A companion persistence service cannot repair the
missing transaction, association, Wayland completion, interactive-control, or
output-identity boundaries.

The rejected fork/patch would have been the only architecture with a plausible
route to add a compositor-owned transaction; it is not an available option.

## Recommended Boundary

- KWin Custom Tiles remain the runtime authority for the accepted bounded
  tiling, grouping, movement, geometry, and output behavior. The adapter uses
  only the source-evidenced operations and fails closed before an unsupported
  multi-step structural mutation.
- Project-owned N-ary state remains a pure planner/reference-test model. It may
  calculate intended COSMIC structure, shares, and focus routes, but it does
  not project geometry, retain a competing persistent tree, or control windows
  through an external process or public native effect.
- KWin continues to own geometry application, Wayland configure lifecycle,
  floating/fullscreen/maximize exceptions, workspace/output handling, and tile
  persistence. The existing shortcut, border, and tray boundaries are unchanged.

## Authorized Rust POC

- Rust is the intended end-state language for the portable tiling engine. This
  authorizes a smallest reusable Rust library POC now, not a test-only
  TypeScript experiment.
- The engine owns deterministic logical outputs, workspaces, windows, ordered
  N-ary split topology, sizing, focus/navigation, movement, placement policy,
  and desired transitions. Platform adapters own native identity, observation,
  capabilities, actuation/batching, validation, recovery, and effects/UI.
- The engine has no KWin concepts and makes no atomic-realization assumption.
  Plans carry preconditions and capability requirements so an adapter can refuse
  a transition before native mutation.
- The current KWin Custom Tile adapter remains the runtime authority and its
  accepted behavior remains intact. This neither claims stock-KWin parity nor
  authorizes a KWin runtime replacement, a KWin fork/patch, or Windows/macOS
  delivery decisions.

## Long-Term Direction

- A deterministic, platform-neutral policy/model engine owns logical
  topology, group/split semantics, placement/navigation/movement intent,
  policy, and desired state.
- Per-platform adapters would own native identity, observation,
  workspace/output geometry, focus, actuation/batching, and
  validation/recovery.
- Optional platform services/effects would own overlays/borders,
  permission/onboarding, and UI.
- KWin remains the current runtime authority. Stock KWin 6.7.4 cannot safely
  atomically mutate Custom Tile structure, so direct geometry never proves or
  claims exact parity.

## Smallest POC Boundary

- Add one pure module to the existing Rust crate. It consumes platform-neutral
  normalized snapshots and emits immutable plans; it performs no native
  observation, mutation, batching, recovery, IPC, persistence, or UI work.
- Mechanically translate the pure TypeScript directional planner's source-backed
  R1-R4 rules and use its vectors as the authoritative behavioral evidence.
  Include tree-relative focus/navigation and only source-evidenced fraction
  sizing. Do not infer pixel geometry, rounding, or resize behavior.
- Test native-shaped but platform-neutral snapshots, unordered/reordered
  children, stale or nonreciprocal associations, malformed/cyclic/shared
  topology, deterministic plans, zero engine-state mutation on failure, and
  capability refusal before plan emission. A capability-gated structural
  operation unavailable to stock KWin proves the boundary without KWin wiring.
- This POC does not test live KWin atomicity, exact stock-KWin parity,
  Windows/macOS feasibility, platform actuation/recovery, geometry projection,
  persistence, or effects/workspace behavior.

## Platform Assessment Limits

- Windows has public geometry/focus/output APIs and batch approximation, but
  no public full virtual-desktop enumeration/switch/events.
- macOS needs Accessibility (and often Screen Recording) and has no public
  Spaces control, with no public AX-window identity bridge.
- Both remain future feasibility work, not a support commitment.

## Migration And Risk

- Staying bounded requires no material architecture migration. It retains the
  current KPackage and Nix delivery model and the existing planner/test corpus.
- Relative risk/effort: the bounded Rust POC is low (offline pure library,
  static evidence only); cross-platform runtime extraction is high. Migration
  implication: additive only, with no runtime migration; later adapter
  extraction happens only after an explicit user decision and supporting
  evidence.
- Direct geometry migration is large and high-risk: replace Custom Tile
  executors and decoding with a per-output/per-desktop projector, own all
  floating/fullscreen/maximize/workspace/drag/resize exceptions, introduce
  persistence and recovery ownership, and replace the current acceptance
  harness with a Wayland acknowledgement and hotplug matrix.
- A hybrid is larger and riskier than direct projection because it additionally
  requires a no-transaction reconciliation policy between the logical and KWin
  trees. Public native and external architectures have no viable migration path
  for movement semantics.

## Rust POC Outcome

- `src/directional.rs` is an additive, pure Rust module in the existing crate.
  It provides typed logical ids, outputs/workspaces/window associations, ordered
  N-ary topology, R1-R4 transition plans, explicit preconditions and adapter
  capabilities, tree-relative focus, and source-evidenced fraction sizing.
- The module imports no platform concepts. It has no actuation, mutation,
  batching, recovery, IPC, persistence, UI, FFI, or geometry projection.
  Cyclic topology is impossible by construction with its owned tree; globally
  unique logical node ids reject the representable sharing analogue.
- Tests mechanically translate the pure TypeScript planner's R1-R4 vectors and
  cover reordered children, normalized window links, stale/nonreciprocal links,
  malformed topology, duplicate/share equivalents, deterministic plans,
  immutable error paths, focus, share policy, and capability refusal before a
  plan is emitted. The adapter capability matrix remains outside the engine.
- `cargo fmt --check`, `cargo test` (79 library, 9 endpoint, and 21 lifecycle
  tests), `cargo clippy -- -D warnings`, `git diff --check`, and `npm run
  typecheck` pass. The TypeScript test script was not run because it rewrites
  the separately modified generated KWin bundle; this POC changes no TypeScript
  source, fixture, or behavior.
- One independent adversarial review found engine-layer platform naming,
  incomplete plan context, and validation/documentation gaps. The final module
  removed platform-specific policy, carries the originating intent in every
  plan, adds empty-workspace and cross-output-identity checks, and documents
  its intentional owned-tree invariants. Reverification passed.
- No live KWin/Plasma action, KWin runtime wiring, commit, or push occurred.

## POC2 Decision Package - Selected And Static Implemented

### Direct Recommendation

- The implemented second layer is a read-only transport and adapter-boundary
  POC: a separately started Rust session-D-Bus planner service, with a
  separately built and manually loaded KWin one-shot script probe that observes
  one bounded Custom Tile scope, normalizes it, requests an advisory plan,
  re-observes it, and logs whether the current bounded adapter could execute
  that plan. The ordinary KWin entry point neither imports nor starts the probe.
- This POC makes no window, tile, geometry, focus, workspace, output, shortcut,
  persistence, package, autostart, tray, or KWin configuration mutation. It is
  not an actuation POC. A live window action adds no transport, observation, or
  staleness evidence and only adds compositor risk.

### Integration Options

| Option | Verdict | Reason |
|---|---|---|
| Separate Rust session-D-Bus planner service with thin KWin JS client | Viable and recommended for POC2 | KWin 6.7.4 scripts expose asynchronous session-bus `callDBus`; this is the smallest real Rust/KWin transport seam. KWin remains the observer, capability authority, revalidator, and sole future actuator. |
| Offline sidecar/golden harness | Retain as a baseline, insufficient alone | It validates schemas and planner conformance without compositor risk, but cannot prove KWin script marshalling, asynchronous replies, ordering, or lifecycle behavior. |
| Public native effect/plugin with Rust linking | Reject for planner | It is a separate in-process native delivery path with per-KWin-version ABI coupling and compositor crash authority. Public effect APIs do not add missing Custom Tile transaction authority. |
| Rust-to-WASM or generated JS | Reject for live wiring | KWin's stock `QJSEngine` script environment has no WebAssembly runtime or loader; generated synchronous JS would not prove a Rust runtime boundary. |
| CLI or subprocess from a KWin script | Reject | Stock KWin script globals have no process-spawn API. A blocking child process would also be unsafe on the compositor event loop. |
| Extend the tray process or bridge | Reject | The tray is an optional, outbound, snapshot-only StatusNotifier carrier with no helper-to-KWin action route. Coupling planner availability or requests to it violates its selected authority and lifecycle boundary. |

### Exact Vertical Slice

- Scope only an active, single-output, single-workspace Custom Tile tree with
  at most two occupied direct child leaves under one split root. The positive
  case is `H[A,B]`, focused `A`, moving right, which the planner reports as R2a
  and the existing adapter capability matrix reports as executable. A fixture
  only negative case such as an occupied R2b path must report non-executable.
- A disabled-by-default, one-shot script probe is the only eventual live
  trigger after separate authorization. It sends nothing unless the exact
  bounded scope decodes successfully. It does not register a shortcut, call
  back from Rust to KWin, queue retries, or invoke a controller movement path.
- KWin reads native state and maps it to opaque output, workspace, leaf, and
  window identifiers. Rust receives only its existing platform-neutral logical
  model, intent, and declared capabilities. Native handles, captions, geometry,
  tile types, KWin terminology, and execution commands do not cross the
  boundary.
- Rust returns an advisory typed outcome, rule, required capability, and
  preconditions. KWin discards the reply unless its correlation, load
  generation, and request revision match the one in flight. It then decodes a
  fresh scope and rechecks every referenced logical id, adapter capability, and
  precondition before logging `could-execute` or a fail-closed reason. It never
  trusts an echoed snapshot fingerprint as freshness proof.
- A single safe live action is not necessary. The eventual authorized live run
  is observation and advisory logging only; no `split`, `remove`, `manage`,
  `unmanage`, assignment, geometry, activation, desktop, or output write is
  reachable from the POC path.

### Proposed Boundary And Contract

- Use a new service identity, object, interface, and method, separate from the
  tray: `org.plasmaautotiler.Planner`, `/org/plasmaautotiler/Planner`,
  `org.plasmaautotiler.Planner1`, and `EvaluateMove`.
- Use one bounded JSON string argument and one JSON string reply:
  `EvaluateMove(s request_json) -> (s verdict_json)`. This avoids assuming a
  lossless `QJSValue`/`QVariant` mapping for nested D-Bus structures. The
  service rejects malformed JSON, values over a fixed POC size bound,
  unsupported schema versions, unknown enum values, duplicate or invalid ids,
  and topology that cannot become a valid `directional::Snapshot`.
- Request v1 contains `v`, opaque `correlation_id`, per-script `generation`,
  monotonic `revision`, `snapshot`, `intent`, and the KWin-declared bounded
  adapter capability matrix. Reply v1 echoes `v`, `correlation_id`,
  `generation`, and `revision`, then contains only `outcome`, `rule` when
  planned, `capability`, `preconditions`, and a bounded diagnostic.
  Unknown fields are rejected rather than silently defaulted. A checked-in
  cross-language corpus owns this wire compatibility; `directional.rs` itself
  continues to promise no JSON compatibility contract.
- KWin permits one request in flight. A short `QTimer` deadline clears that
  request; KWin's script API provides no JS error callback for a D-Bus error,
  so timeout is the failure signal. Late, duplicate, mismatched, unload-time,
  or owner-change replies are ignored. There is no automatic retry or queue.
- The Rust service is stateless and never calls KWin. It requests its name with
  `DoNotQueue`, exits on name loss, and verifies that the D-Bus caller is the
  current `org.kde.KWin` owner using the existing tray bridge's unique-owner,
  uid, and executable-identity pattern. The KWin script cannot equivalently
  attest the Rust executable; a same-session process can spoof a planner name.
  POC2 limits that remaining exposure by sending no captions, geometry, or
  handles and by accepting no authority beyond advisory logs. It makes no
  confidential-channel or hostile-same-uid security claim.

### Likely Implementation Boundary

- Rust additions only: `src/planner_contract.rs`, `src/planner_service.rs`,
  and a `planner-service` mode in `src/main.rs`; `src/directional.rs`,
  `src/tray*.rs`, and tray identities remain separate. `src/lib.rs` exports
  the new boundary modules only as needed by tests and the binary.
- KWin additions only: `kwin/src/planner-shadow.ts` holds the pure normalizer,
  guarded native reader, strict reply decoder, and asynchronous advisory
  client; `kwin/src/planner-shadow-probe-entry.ts` is a separately built manual
  one-shot entry. The ordinary `kwin/src/entry.ts`, controller mutation modules,
  and `cosmic-move-adapter.ts` remain outside the POC path.
- POC2 uses a manually launched planner service in the existing development
  environment. It adds no Home Manager, NixOS, `flake.nix`, KPackage, systemd,
  autostart, KCM, or tray lifecycle delivery. Packaging and durable service
  ownership are a later decision, not an implicit POC2 consequence.

### Acceptance And Failure Behavior

- Rust tests cover strict request/reply decoding, version and size rejection,
  one R2a advisory plan, bounded-capability refusal, and immutability. KWin
  tests cover native-to-neutral normalization, correlation/revision matching,
  timeout and late-reply discard, stale fresh-decode rejection, and advisory
  verdict records. Shared golden vectors prove the contract at both ends.
- Static verification is `cargo fmt --check`, `cargo test`, `cargo clippy --
  -D warnings`, `npm run typecheck`, relevant KWin unit tests, and `git diff
  --check`.
- A separately authorized live read-only check follows
  `docs/live-kwin-testing.md`: absent service, malformed reply, timeout,
  valid two-leaf R2a reply, and state changed while awaiting reply must all
  produce bounded diagnostics and leave the pre/post native topology identical.
- No service owner, sender identity, schema, decoding, scope bound,
  correlation, generation, revision, capability, precondition, or fresh
  revalidation failure may cause a retry, fallback execution, or native write.
  It clears the request and records only a redacted fail-closed diagnostic.

### Evidence And Limits

- POC2 statically establishes the bounded contract, Rust service, and separate
  KWin shadow client needed to test whether stock KWin's asynchronous script
  D-Bus surface can carry a platform-neutral observation to Rust and back. It
  does not yet prove that transport, service lifecycle/error/timeout behavior,
  or KWin's live stale/capability rejection.
- POC2 does not prove native actuation, atomicity, Custom Tile structural
  authority, Wayland configure completion, rollback/recovery, persistence,
  full COSMIC parity, service delivery/security against hostile same-uid
  processes, Windows/macOS feasibility, or a migration from the existing
  adapter. No result may be described as native execution readiness.
- Relative scope and risk are medium compared with the offline POC: a small
  additive service/client and cross-language wire corpus, but an asynchronous
  compositor boundary with lifecycle, staleness, and session-bus identity risk.
  It is far smaller and safer than native actuation or direct geometry because
  it cannot mutate a window.

## Exact Next Action

No further action is authorized in this slice. Any future POC2 live action
requires separate authorization after independently resolving the current
read-only preflight blockers; do not reuse this slice's baseline or retained
diagnostic artifacts as restoration or transport evidence.

## Assessment Verification

- Five fresh, sequential, disposable investigations examined the KWin 6.7.4
  public/script surface, direct logical-tree projection, alternatives, option
  tradeoffs, and an adversarial review. The authoritative source pin is
  `8438567a741826da8b7536a8b10eb3af8fc8820d`.
- This POC2 decision package used six fresh, sequential, disposable
  investigations for the existing seam, KWin script transport, bridge options,
  vertical slice, contract/lifecycle, and adversarial failure review.
- POC2 static implementation adds the manually invoked `planner-service`, a
  strict 64 KiB JSON v1 contract with a shared R2a golden vector, bounded
  owner-pinned service verification, and a separate manual KWin probe. The
  probe declares only `swap-neighbor`, checks R2a advisory replies, and anchors
  root/output/workspace/desktop/leaf/window/focus object identity across the
  fresh decode before a log-only `could-execute` result.
- Static verification passed: `cargo fmt --check`, `cargo test`, `cargo clippy
  -- -D warnings`, `npm run typecheck`, `npm test`, `npm run
  build:planner-probe`, and `git diff --check`. `cargo clippy --all-targets --
  -D warnings` remains blocked only by existing unmodified `src/tray.rs` test
  lints.
- One authorized current-session `[Tiling]` gate wrote a disposable
  `gate=gate-ok` sentinel only under
  `[Tiling][plasma-auto-tiler-poc2-gate-7f3a9c2e]`. It read the sentinel, then
  restored `/home/beefsack/.config/kwinrc` from its exact preimage. Independent
  post-checks matched its whole-file SHA-256, mode, owner, group, size, and
  nanosecond mtime; `[Tiling]*` remained 111 headers, 444 lines, 17831 bytes,
  with SHA-256 `0c75c825d4001916f2a4722bfd6d70b42589a6ecb6797e46dcd08d06a65b22d1`.
- One exact planner service process acquired
  `org.plasmaautotiler.Planner`; one uniquely named disposable KWin probe was
  loaded as the returned `Script1`, introspected, and run once. It emitted only
  `plasma-auto-tiler:planner-shadow-probe-ready`. No authenticated
  `EvaluateMove` request/reply, eligible `H[A,B]` observation,
  correlation/generation/revision/precondition evidence, or advisory result
  occurred. This establishes only partial service/script lifecycle mechanics,
  not D-Bus transport or Tier 2/Tier 3 POC2 evidence.
- The planner was stopped by its exact PID; the exact returned probe was
  unloaded and its disposable file removed. KWin owner/PID/start tick and
  `plasma-kwin_wayland.service` identity were unchanged; the original
  controller remained loaded; the planner was absent; and the probe was absent.
  The native three-desktop topology and enabled `eDP-1` output were identical
  before and after. No configuration, process, service, or probe residue
  remains. Retained `/tmp/opencode` diagnostic captures are
  `w3-load-reply.json`, `planner-w3.log`, `planner-w3.log.pid`, and
  `w3-cursor-before.txt`; no commit or push occurred.
- The ready-only result identified a static trigger-installation defect:
  KWin's `loadScript` QJSEngine has `globalThis` absent, while the probe used
  it as its only global acquisition route. The manual entry now falls back to
  the script global via `Function("return this")`; an unavailable binding logs
  `planner-shadow:trigger-unavailable` instead of readiness. Focused bundled
  VM coverage proves installation with `globalThis` absent and no load-time
  D-Bus call, while the package/startup suite remains green. This is static
   evidence only. No live attempt is authorized or performed; a separate new
   bounded POC2 live slice must be authorized before invoking the corrected
   manual trigger.
- One separately authorized corrected-probe POC2 slice captured a read-only
  current-session baseline, then stopped before service start or probe lifecycle.
  The accepted preflight failed on stale persisted tiling state
  (`setup_ready=false`) and one project KGlobalAccel drift
  (`plasma-auto-tiler-focus-right` active `469762124`, expected `268435532`).
  Existing retained `/tmp/opencode` `w3-*`/`planner-w3.log` artifacts were not
  reused as evidence or removed.
- Independent review accepts that no planner process started, no probe loaded,
  ran, or unloaded, no manual trigger or `EvaluateMove` request/reply occurred,
  and no native window, topology, configuration, shortcut, workspace, output,
  or Custom Tile mutation was claimed. The observed `kwinrc` baseline was
  SHA-256 `5e6fb76e94a616ef0bfdd0f26229116eb77804442ae8330aeb5634e878914abe`
  (111 `[Tiling]` headers); restoration is not applicable because no lifecycle
  mutation began. This is fail-closed preflight evidence only, not transport,
  valid-planning, or restoration proof.
