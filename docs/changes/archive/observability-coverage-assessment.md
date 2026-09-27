# Observability Coverage Assessment

## Goal

- Assess active production observability against the approved principle and
  identify the smallest next diagnostic slice without implementing it.

## Scope

- Inventory current production routes, service boundaries, sinks, capture
  paths, lifecycle evidence, and meaningful existing tests.
- Exclude parked experiments and live/runtime inspection.

## Coverage

| Active component | Normal evidence and sink | Trace/correlation | Main diagnostic limit |
| --- | --- | --- | --- |
| Planner `DescribePlan` | Bounded `plan-summary` ingress/egress and fixed early exits on Planner stderr (`src/planner_service.rs:139-158,283-358`; `src/planner_protocol.rs:447-521`) | `shape` counts/fingerprint only under `PLASMA_AUTO_TILER_TRACE=1`; validated request correlation joins KWin | One terminal summary does not separately name native apply/verify; that truth belongs to KWin. |
| Plan admission, removal, reconcile, directional, resize | KWin `plan:cmd`, bounded transport, reply validation, observation, application/setter, and terminal lifecycle (`kwin/src/plan-adapter.ts:3881-4137,4385-5630,6723-6776`; `kwin/src/entry.ts:51-56`) | Normal lifecycle correlation joins Planner ingress/egress; write constraints and rectangles are trace/failure-only | Ordinary routes have no post-apply ack/verify protocol, so setter completion is not a compositor-state claim. |
| Workspace send and native topology | Embedded production `WorkspaceSendAdapter` has correlated route diagnostics (`kwin/src/workspace-send-adapter.ts:3564-3616`; `kwin/src/plan-adapter-entry.ts:2553-2562,3118-3342`) while `workspace-native` emits always-on displacement/return/navigation/cleanup tokens (`workspace-native.ts:628-719,1200-1352,1682-1752,1980-2466`) | Send correlation is real; ambient topology tokens deliberately have none | Native topology signals cannot truthfully inherit an unrelated or absent send correlation. |
| Native border/group/oracle handoffs | Bounded eligibility/epoch/revision/reason diagnostics (`kwin/native-effect/activewindowborder.cpp:522-568`; `kwin/src/active-border-initial.ts:246-462`; `kwin/src/active-group-highlight.ts:680-811`) | Drag pull failures are normal tokens and verdict detail is trace-only (`kwin/src/drag-oracle-pull.ts:75-109`); group correlation is local | Initial-maximize epoch/revision is freshness, not request lineage; asynchronous signals have no natural shared request ID. |
| Settings and shortcuts | Structured `plasmaautotiler.shortcut op/stage/outcome` KCM logging (`kwin/native-effect/shortcutreconciler.cpp:2173-2224`) | Existing journal query is separate from `just dev` capture | Category and KWin PID differ, so the standard KWin filter intentionally excludes it. |
| Tray publication/service | Bounded KWin publisher send-initiation/failure records reach the KWin journal; endpoint owner/publication/projection records use endpoint stderr (`kwin/src/tray-publisher.ts`; `src/tray_endpoint.rs`; `src/tray.rs`) | Revision is snapshot identity only; no request lineage or panel-visibility claim | `just dev` captures KWin, not the separately owned Rust tray endpoint stderr. |
| Development capture | `just dev verbose` normal summaries; `just dev trace` enables trace at `justfile:851-852` and merges Planner stderr with exact KWin-PID journal records at `justfile:1095-1099` | Prefix-filtered only; no raw D-Bus payload capture | Does not collect shortcut KCM-category messages. |

## Production Boundary

- `kwin/src/entry.ts:1-56` establishes the active KWin production path as the
  Plan adapter entry plus tray publisher. The embedded `WorkspaceSendAdapter`
  is production-reachable through that entry; only its standalone entry helper,
  and standalone focus/movement/resize adapters, are parked.
- Existing geometry evidence is bounded counts, dispositions, and trace/failure
  rectangles (`kwin/src/plan-adapter.ts:6627-6676`); the approved principle
  does not require, and this assessment does not recommend, raw/native D-Bus
  payload capture.
- Planner/status/cancel lifecycle observability is the completed preceding
  slice and is treated as established here, not re-audited.

## Priority Gaps

1. Ambient workspace topology has useful uncorrelated normal records. Its
    output/hotplug signals must not be attributed to a coincident send flight
    without a source-backed causal handle.
2. Drag/oracle signals are correctly local and asynchronous. A new shared ID
   would be fictitious unless a concrete Plan request is dispatched; keep the
   local verdict identity otherwise.

## Completed Recommendation

- Completed normal-level Plan transport lifecycle records at the existing
  KWin `NameHasOwner`, `StartServiceByName`, `GetNameOwner`, owner-pin, and
  Planner request-send boundaries. See
  `docs/changes/archive/plan-transport-activation-observability.md` for the exact
  fields, bounded event/outcome vocabulary, capture commands, evidence, and
  limitations.
- Completed normal-level ordinary Plan reply validation, fresh observation,
  application/setter, and terminal lifecycle records. Ordinary routes have no
  ack/verify protocol; see
  `docs/changes/archive/plan-apply-verify-observability.md` for the exact
  fields, evidence, and limits.
- Completed bounded tray owner/refusal/publication diagnostics. KWin records
  distinguish send initiation from endpoint acceptance; endpoint projection
  records describe SNI signal emission, not panel visibility. See
  `docs/changes/archive/tray-publication-observability.md` for exact fields,
  capture limits, and evidence.

## Decisions And Limits

- No material product, security, API, or policy decision was needed for the
  completed slice.
- Source review only: no live KWin, Plasma, D-Bus, runtime journal, or residue
  inspection occurred. Existing tests were inventoried but not rerun because
  this assessment changes documentation only.
- Meaningful existing evidence includes Planner service summary/auth tests,
  Plan and workspace-send adapter tests, workspace-native tests, drag-oracle
  pull tests, native effect/group tests, shortcut reconciler tests, and Rust
  tray endpoint/lifecycle tests. This is inventory evidence, not a claim that
  those tests establish end-to-end live capture.
