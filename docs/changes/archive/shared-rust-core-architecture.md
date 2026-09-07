# Shared Rust Core Architecture

## Goal

Define and prove the Stage 2 transport-free adapter contract for a deterministic
Rust tiling core shared by KDE/KWin, Windows, and macOS. The core owns logical
tiling, grouping, navigation, movement policy, and reconciliation; adapters
retain native authority. This change does not resume POC3, select a runtime,
or authorize native actuation.

## Decision

- A shared Rust planner/reconciler is technically and product-wise sensible.
  A shared native window manager is not. The product must expose platform
  capability differences rather than emulate unavailable authority.
- Retain `src/directional.rs` and `src/planner_contract.rs` as frozen POC1
  evidence. Retain `src/poc3.rs` and `src/poc3_contract.rs` as a separate,
  disposable geometry experiment; do not generalize either into the durable
  core.
- Implement Stage 2 in the existing crate without a premature crate split:
  `src/contract.rs` provides the bounded transport-free envelope and
  `src/reconcile.rs` provides the deterministic state machine. The test-only
  fake compositor remains under `tests/` and is not a runtime abstraction.
- Do not select a daemon, D-Bus, FFI, or packaging model. The existing KWin
  planner service remains an advisory POC, not shared-core infrastructure.

## Durable Boundary

| Core owns | Adapter owns |
| --- | --- |
| Opaque session-scoped ids, revisions, correlations, and immutable normalized observations | Native handles and identity lifetime, process/permission authority, and redaction before the core boundary |
| Logical output and workspace scopes when the adapter can observe them | Native output/workspace discovery, mapping, hotplug, desktop/Space limitations, and usable work areas |
| Ordered N-ary split-tree topology, share fractions, grouping semantics, placement, navigation, and movement policy | Eligibility, native grouping/tile association, focus policy, geometry rounding/DPI/minimum sizes, stacking, and special window states |
| Capability-gated semantic plans, preconditions, desired logical placement, and desired focus target | Capability declaration, command sequencing/batching, native writes, fresh re-observation, acknowledgement interpretation, rollback envelopes, and cleanup |
| Single-flight dispatch, stale owner/generation/revision rejection, completion state, and fail-closed divergence | Event subscription/coalescing, event sequence numbers, timeout/deadline enforcement, and reporting applied versus divergent completion |
| Deterministic conformance and trace replay | IPC, FFI, D-Bus, services, persistence, effects, overlays, shortcuts, UI, onboarding, and packaging |

`DesiredGeometry` is deliberately adapter-local: the core produces logical
fractions and a target window/focus state, while an adapter projects them into
pixels against its current work area. Pixel geometry is not durable core state
and is never a KWin Custom Tile execution promise.

## Proposed Rust Shape

```text
tiler_core/
  ids        SessionId, generation, opaque logical ids, Revision, CorrelationId
  snapshot   immutable normalized Observation and validation
  model      output/workspace scopes and ordered N-ary Tree
  policy     sealed pure Policy interface; cosmic_v1 is the first implementation
  plan       semantic commands, capability requirements, preconditions, outcomes
  reconcile  pending-plan, completion, divergence, and deterministic sequencing
  contract   bounded versioned DTOs and golden vectors, separate from transport
```

Stage 2 realizes the `contract` and `reconcile` boundary in-place. The
remaining module split is direction, not a required extraction before a real
adapter proves its observation-to-verification loop.

- `Observation + Intent + PolicyId + Capabilities -> Planned | Noop | Rejected`
  is pure and deterministic. Policy receives no native handles, clocks, I/O, or
  mutable session state.
- `Plan` is non-atomic and always requires adapter postcondition verification.
  A plan carries its base revision, owner/generation, semantic commands, and
  capability/precondition requirements. Dispatch records one pending plan;
  only a matching `Applied` completion advances state. Timeout, stale input,
  partial application, missing windows, geometry mismatch, or unverified focus
  produces a typed divergence and blocks further dispatch.
- `LogicalState` is in-memory and session-scoped. There is no core persistence,
  restart recovery, native rollback interpretation, or competing persistent
  layout tree. An adapter may retain opaque rollback material under its own
  versioned contract.
- Core invariants are not policy extensions: unique ids, scoped reciprocal
  window links, valid groups, bounded inputs, single pending plan, redacted
  diagnostics, and declared-capability refusal.

## Policy Boundary

- Define one sealed, pure Rust `Policy` interface and one hardcoded
  `cosmic_v1` implementation. Keep POC1's current COSMIC R1-R4 implementation
  frozen as conformance evidence; a durable implementation must be proven
  against the same vectors rather than imported as implicit platform policy.
- The policy owns tree edits, COSMIC share math, and tree-relative navigation.
  The adapter owns pixel gaps, output mapping, focus raising, and native
  operation selection.
- Use a closed `PolicyId`, an explicit policy version, and separate contract
  and capability-schema versions. A behavior change creates a new policy
  version and golden corpus; it never silently changes an existing layout.
- A switch is permitted only while quiescent. It revalidates the current
  snapshot under the target policy and never rewrites a live tree implicitly.
- Do not add dynamic plugins, WASM, data-driven layout languages, tabs, stacks,
  shared groups, per-window scripts, or extensible capability strings now.

## Platform Capability Matrix

| Platform | Publicly usable authority | Major blocker and required product boundary |
| --- | --- | --- |
| KWin 6.7.x | Scripts can observe windows, outputs, desktops, lifecycle and geometry events; write `frameGeometry`, activate windows, and use session D-Bus. Public Custom Tile operations support only bounded existing paths. | No multi-window transaction, configure completion barrier, indexed child insertion, safe reparenting, stable script-visible output UUID, or safe cross-output Custom Tile transfer. KWin remains tile/layout authority; unsupported structural moves stay fail-closed. Direct geometry is non-durable and not full parity. |
| Windows 11 | Win32 provides HWND observation, WinEvent notifications, geometry/output APIs, DWM bounds, and best-effort focus. `IVirtualDesktopManager` publicly identifies a window's desktop and can move a process-owned top-level window. | UIPI and foreground-lock rules can refuse actuation/focus. Public virtual-desktop APIs do not enumerate, switch, create/delete, or notify desktop changes. Do not promise a uniform workspace model or cross-app desktop movement. |
| macOS | Accessibility can observe and best-effort position, size, and raise windows after TCC approval. Quartz and ScreenCaptureKit provide complementary observation subject to Screen Recording permission. | No public Spaces enumeration, switching, or movement API, no universal AX-window identity bridge, and app/window actions can refuse. No private SkyLight/CGS APIs, Dock automation, or SIP workarounds. Scope actuation to one observable Space. |

Authoritative public references are KDE's [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/), Microsoft [IVirtualDesktopManager](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager), [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook), and [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow), and Apple [Accessibility trust](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted), [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)), and [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit). KWin documentation is generated for 6.0; exact 6.7.x behavior remains pinned to the existing source evidence in `full-cosmic-parity-architecture.md`.

## Deployment Position

- Now: keep the Rust core offline and transport-free. Do not promote the
  KWin D-Bus planner, create a service, or select IPC/FFI before a platform
  proves its own observation-to-verification loop.
- KWin later: a thin script adapter plus an optional out-of-process planner is
  only a candidate after measured D-Bus/revalidation behavior. A native bridge
  would be ABI- and KWin-version-coupled and is not selected.
- Windows later: evaluate a single user-session manager that owns the Win32
  message loop and embeds or calls the Rust core. Do not use a Windows service
  for interactive desktop control and do not inject into other processes.
- macOS later: evaluate one signed app containing the adapter and Rust core to
  avoid splitting Accessibility/TCC identity. A helper or XPC split is not
  selected.

## Evidence Ladder

1. Completed: POC1's COSMIC R2a golden fixture and representative policy plan
   are byte-locked and deterministically replayed. This proves structural
   policy evidence, bounds, rejection, and stable outcomes, never native
   actuation.
2. Completed: a headless adapter-contract harness with a test-only fake
   compositor accepts normalized metadata, adapter-declared capabilities, a
   complete semantic dispatch payload, acknowledgement, and fresh verification.
   It injects stale revisions, owner/generation/correlation mismatches,
   capability refusal, partial application, operation or precondition mismatch,
   duplicate/out-of-order acknowledgement, and adapter loss. Every failure
   rejects or diverges without a retry or a revision advance.
3. Replay redacted, versioned real-observation traces through that harness.
   Captures are read-only, per-platform fixtures, not a live harness dependency.
   They contain no captions, native handles, PIDs, or service identities.
4. Independently authorize minimal native actuation per platform only after the
   first three stages pass: KWin bounded R1/R2a with fresh re-observation;
   Windows two-window `SetWindowPos` with focus denial treated as divergence;
   macOS two-window AX position/size/raise in one Space with TCC denial treated
   as unsupported. No stage claims atomicity, workspace parity, or recovery.

The Stage 2 harness acceptance criteria are met: no platform imports; POC1
golden replay remains byte-stable; injected faults fail closed; one pending
plan blocks dispatch; and malformed or oversized contract metadata remains
bounded and redacted.

## Non-Goals

- No POC3 retry, nested KWin recovery, live process/workdir/config/coredump
  action, KWin fork/patch, private platform API, or direct-geometry migration.
- No shared workspace/Space controller, atomic multi-window promise, native
  effects abstraction, UI abstraction, durable layout persistence, tab/stack
  groups, plugin system, daemon selection, or platform delivery commitment.

## Quality Bar

- All policy golden vectors and malformed-topology cases pass deterministically;
  failure leaves verified logical state unchanged.
- The adapter contract permits zero native writes after stale correlation,
  generation, revision, missing precondition, or timeout; late/duplicate events
  are discarded.
- Before native promotion, measure plan latency and stale/divergence rates under
  event bursts. A provisional planner target is p99 under 5 ms for a bounded
  256-window snapshot; no latency target substitutes for native verification.
- Every public release states its capability matrix and disables unsupported
  commands with a reason rather than silently degrading or invoking private
  APIs.

## Material Decisions

- The user-authorized durable direction is a shared Rust deterministic core
  with platform-owned operational authority.
- The user authorized and this change completed the transport-free Stage 2
  headless adapter-contract harness. It establishes no runtime topology,
  platform packaging, first live adapter, IPC/FFI/service selection, native
  rollback, or atomicity promise.
- The user authorized and this change completed the offline Stage 3 observation
  trace contract. JSON v1 fixtures carry only bounded opaque session identity,
  structural policy data, and typed adapter outcomes; replay runs the existing
  planner and reconciler, not a parallel model. This establishes no recorder,
  live trace, native adapter, runtime selection, IPC/FFI, packaging, rollback,
  or atomicity promise.

## Evidence

- Eight fresh sequential research units audited the existing Rust/KWin seam,
  public platform APIs, core and policy boundaries, deployment, evidence
  ladder, feasibility, and adversarial risks.
- Fresh sequential implementation and review units added the portable
  `contract`/`reconcile` state machine, a test-only fake compositor, POC1
  vector lock, and invariant tests. Independent adversarial review corrected
  plan consistency, dispatch identity, exact verified operation/precondition
  binding, and malformed metadata classification.
- `cargo fmt --check`, focused harness/vector/invariant tests, full `cargo
  test` (244 passed), `cargo clippy -- -D warnings`, and `git diff --check`
  passed. TypeScript typechecking passed before the final Rust-only correction;
  no shared TypeScript fixture or contract changed in this Stage 2 work.
- No live KWin action, POC3 residue/process/workdir/coredump action, or host
  state mutation occurred.
- Stage 3 added eight redacted canonical trace fixtures: nested N-ary R2b
  convergence, stale dispatch observation, partial apply, capability refusal,
  duplicate and mismatched acknowledgement, adapter loss, and postcondition
  mismatch. Their checked-in byte length/SHA-256 and independently expected
  replay results are locked. The success vector is derived from
  `directional::tests::r2b_midpoint_even_perpendicular_target_s1_08_s3_13_u2`.
- The final Stage 3 checks passed: `cargo fmt --check`, `cargo test trace`,
  `cargo test` (196 library tests plus all integration tests), `cargo clippy --
  -D warnings`, and `git diff --check`. An independent adversarial review
  corrected initial-observation session binding, optional escape-parent
  normalization, and lock digest strength. No shared TypeScript fixture changed.

## Exact Next Action

None. A recorder boundary, platform adapter, live trace collection, runtime,
IPC/FFI, packaging, or native operation requires a separately scoped decision
and authorization.
