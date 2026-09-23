# AR3: Typed Engine behind DescribePlan

## Goal and non-goals

Introduce a typed, portable world-level Engine and a thin typed serde codec while preserving every existing DescribePlan wire shape, rejection fence, pending send/R4 transaction, diagnostic, and KWin route. Keep admit/remove observation diffing, layout policy and transaction semantics unchanged. No live KWin or host mutation. No KWin TypeScript changes.

## Approach

- Inventory command and reply shapes, validation ordering, retained state transitions, paired-session behavior and golden test coverage before editing.
- Implement coherent, separately green slices: typed codec; portable engine state/orchestration; world-level state if behavior-neutral. Preserve the legacy `Value` envelope until after the complete existing validation and pending/binding boundaries: parsing an internally tagged enum at ingress would change missing-op rejection and owner/pending side effects. Stop and report if a safe world-model replacement demands an unselected product or transaction decision.
- Document the Planner single-flight `busy` coupling without adding queueing.

## Material finding

A single permanent `Session` cannot replace the per-domain sessions without changing independent revisions/fingerprints, divergence isolation, pending scope, node identity and outer-gap handling. Decision: core Engine owns the existing per-domain sessions and pending/pair state without merging them. Eliminating the transient pair/split machinery is deferred to AR11, whose transaction model awaits the user decision. Porting the remaining JSON-coupled production logic into dependency-free core needs a typed request/reply boundary; preserve the original envelope and transaction fences until that boundary is ready.

## Outcome

- The committed first slice (`0a5c1f4`) strictly decodes all 19 tagged commands behind the established envelope and dispatch boundaries, records Planner's non-queuing `busy` coupling, and pins synchronous and workspace/R4 valid/malformed replies in byte-exact goldens. Verify echoes decode after the original `verified` gate; an attempted `RawValue` carrier failed because internally tagged `from_value` cannot deserialize it, so the protocol retains the deferred `RawEcho` carrier and converts to portable typed echoes at the original boundary.
- The second slice adds serde-free `CoreEvent`/`CoreCommand`/`CoreReply` and typed success plans in `tiler-core::boundary`. `Engine::handle` owns all synchronous and workspace/directional request orchestration, canonical per-domain maps, near-layout fitting, seeding, hotplug relocation/reprojection, pair assembly/split, pending transactions, and ack/verify/cancel outcomes. `Engine::inspect(&self)` owns read-only status outcomes. The transient pair and independent per-domain Session revisions, fingerprints, divergence, node identities, pending scope and gaps remain intact. Pair elimination awaits AR11. The protocol retains envelope/fence validation, strict tagged decoding, deferred verify echo parsing, ordered dispatch/binding, wire serialization and observability summaries; KWin TypeScript and diagnostics are unchanged.
- Shared portable bounds and pure predicates now have one source in `tiler-core::bounds`; protocol keeps the public wire limits as aliases. Approximately 2,000-2,500 production lines of seeding, world/transaction state and orchestration moved out of `planner_protocol.rs` into core; the remaining protocol production code is validation, codec, serialization, and fence adapters. No serde or platform dependency was added to core.

## Verification and review

- Offline commands: `cargo fmt --check`, `cargo check --workspace --offline`, `cargo clippy --workspace --all-targets --offline` (passes with style warnings), `cargo test --workspace --offline --quiet` (585 pass, up from the committed 529), `just check-portable` (zero normal core dependencies, no platform leaks). In `kwin/`: `npm run typecheck && npm test && npm run build` (715 pass). No live KWin/Plasma or host mutation.
- Existing byte-exact goldens remained green through each migration step: `typed_sync_codec_*`, `typed_transaction_codec_workspace_wire_golden`, `verify_echo_typed_boundary_wire_golden`, `r4_typed_codec_ack_verify_status_cancel_wire_golden`, `r4_verify_echo_typed_boundary_wire_golden`. New typed-reply choke-point tests compare every outcome shape to the established legacy serialization. Independent Worker review compared the final diff to `0a5c1f4` and found no production wire, fence, transaction, gap, or per-domain regression.
- Residual low-risk internal details: defensive standalone `Engine::handle` workspace checks have a different precedence from the preceding protocol scope validation for an invalid direct-call event; production cannot reach that combination. `TiledPlan` kinds without a fixed capability are never sent to the fixed-capability serializer. Clippy's moved nested conditions and older style warnings do not fail the check.

## Completion

AR3 is complete at the typed core/protocol seam. The dated research review remains unchanged; AR4 observation sync, AR5 policy seam, and AR11 transaction-model changes remain separate backlog work.
