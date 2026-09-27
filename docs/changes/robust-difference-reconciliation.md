# Robust difference reconciliation - design draft (2026-09-28)

## Goal and boundary

Converge portable membership, flags, allocation and observed native geometry from
complete observations, regardless of which event caused the observation. A client
that holds an unexplained size should eventually keep that size while its tiled
neighbours are replanned; learning expires when that client changes. Design only;
no new runtime behavior is approved here. Preserve the existing owner, identity,
revision, scope, reply-boundary and no-post-setter-replay fences.

## Current state and failure modes

| What is compared today | Source | Consequence |
| --- | --- | --- |
| KWin collects fresh per-domain frames, flags, min/max hints; incomplete foreground or hidden domains cannot prove departures. Foreground and hidden each compare a carried snapshot against per-id applied geometry/flags and per-domain bounds/gaps to choose quiet, reproject or dispatch. | `kwin/src/plan-adapter-entry.ts:1604-1674,1728-1781`; `kwin/src/plan-adapter.ts:4729-4946,4971-5051,5094-5319` | Two partially duplicated comparison paths, including sticky multi-home and work-area exceptions; they can diverge. Quiet equality is an optimization, not proof of a completed native write. |
| Rust `Engine` converges complete membership/floating observations before ordinary operations, retaining topology; `reconcile` projects it. Minimum hints borrow slack from siblings; hint-explained clamp and overconstraint skip writes. | `crates/tiler-core/src/session/world.rs:671-988`; `crates/tiler-core/src/engine.rs:278-340,601-674`; `crates/tiler-core/src/size_hints.rs:9-58,251-305`; `crates/tiler-core/src/boundary.rs:677-698,706-808`; `kwin/src/plan-adapter.ts:7469-7497` | Hints are ephemeral; unhinted Ghostty shortfalls remain drift. Existing maximums *do not* redistribute spare space, and step/increment is not observed on the wire (`size_hints.rs:26-43`). |
| An applied reply records *planned* rectangles, including fullscreen/maximized slots, not confirmed compositor frames; overlay frames are replaced by carried slot rectangles for Plan. Three pure-drift reassertions then accept exact client-held rectangles as applied evidence. | `kwin/src/plan-adapter.ts:2200-2285,4444-4485,4917-4946,7770-7873` | Interim A stops repeated writes but can leave a visible gap or reassert the accepted rect when a neighbour drifts (`docs/decisions.md:541-552`; `docs/backlog.md:145-151`). It never replans around the short window. |

| Signal / special trigger relied on | Source | Failure when missed or unavailable |
| --- | --- | --- |
| `frameGeometryChanged`, `windowAdded/Removed/Activated` and `screensChanged/currentDesktopChanged` drive the debounced Plan refresh; geometry/scope and lifecycle subscriptions are required. | `kwin/src/plan-adapter-entry.ts:2293-2319,2970-3004,3039-3050`; `kwin/src/plan-adapter.ts:4565-4660` | A state change without any subscribed edge is invisible until a later event/command. An unreadable subscription can stop attach. Sleep without a native edge is idle (`docs/changes/archive/recovery-process-sleep-audit.md:20-24,43`). |
| Per-window `fullScreenChanged`, `maximizedChanged`, `desktopsChanged` refresh flags; missing per-window maximize is soft, but list-level maximize subscription failure refuses attach. Fresh observations reread `maximizeMode`. | `kwin/src/plan-adapter-entry.ts:2335-2436,2453-2481,3006-3038,1670-1674` | Signal-less maximize stays tiled and an unseen transition stays unknown until a later observation (decision I, `docs/decisions.md:471-482`). Fullscreen/sticky changes similarly await another observation if their best-effort signal is absent. |
| Exact-reference maximize/sticky write echoes, pointer neighbour echo, interactive drag/resize finish, and send/R4 terminal force are separate gates around automatic refresh. | `kwin/src/plan-adapter.ts:4337-4434,4600-4648,4849-4907`; `kwin/src/plan-adapter-entry.ts:3758-3798` | Losing a finish can defer drag restoration; omitting terminal forced source/target refresh can leave otherwise equal applied evidence unexamined. Echoes guard user actions and must not be dropped merely because ordinary refresh is unified. |
| Native effect seeds maximize/fullscreen on load, then follows native maximize/fullscreen signals for border/group visibility. Drag oracle uses a matched modifier press; absent press falls back to a 64 px interior classifier. | `kwin/native-effect/activewindowborder.cpp:383-435,766-795`; `kwin/src/drag-oracle-pull.ts:110-119,140-196` | Script-level geometry comparison cannot attest rendered pixels or invent effect transitions. The 64 px gate can misclassify a border/scale case; it is a drag-intent issue, not a size limit (`docs/decisions.md:1020-1039`). |

Concrete size evidence: `p13` bottom edge short by 36 px
(`docs/backlog.md:33-40`); W3 requested `502x1092`, held `502x1036`
(`docs/backlog.md:387-401`); R4 Ghostty requested `1012x1092`, held
`1012x1036` (`docs/backlog.md:450-463`). Recorded hints do not explain the 56 px cases; native cause
remains unknown. No inference from those examples alone establishes a maximum,
minimum, increment, output-scale cause or compositor acceptance. A single
observed size is consistent with several of them.

## Options (rough production scope, before tests)

| Option | Mechanism and learned-size handling | Replace/delete; rough size | Risks and observability |
| --- | --- | --- | --- |
| 1. Keep current per-signal + interim A | Each signal queues existing foreground/hidden refresh; no durable size learning. | No change. | Lowest migration cost; Ghostty gap and unseen signal-less change remain. Existing `reconcile-accepted`, constraint trace and write dispositions identify symptoms, not their cause. |
| 2. One event-driven difference path (recommended foundation) | Any existing native event, explicit command, configuration change or terminal flight requests fresh complete observations. One comparator classifies membership/flags/scope/geometry for foreground and hidden; portable convergence remains in Rust. Treat all signals as *hints to observe*, not facts to patch state. Phase 2 adds per-live-window effective size constraints from held-size evidence; project siblings from retained topology, without adopting observed rects as shares. | Consolidate duplicated `refreshForegroundNow`/`hiddenIntentFor` equality, scope and drift selection; remove redundant per-signal reassert/quiet shortcuts only after equivalence tests. Keep native echo/drag/flight/transport fences. Phase 1 likely a few hundred lines changed, aiming net deletion; learning/projector phase a few hundred more, offset by deleting interim A accounting. | No event still means no detection. Transient asynchronous frames must not be learned. Correlated normal-level classification (`equal/change/uncertain`, reason and terminal), learned/expired/reprojected transition and per-window write outcomes; high-volume rect/hint details only in redacted trace. |
| 3. Periodic complete observations | Option 2 plus a justified idle cadence while active to discover changes with **no** signal or command. Same evidence rules for learning; no second reconciler. | Option 2 plus timer lifecycle, dedup, hidden-domain budgeting and tests (hundreds more lines); cannot delete native input/echo fences. | Load/latency, session wake storms and fighting asynchronous clients; bound by measured CPU/IPC and stale-frame tests before setting a cadence. Log changed state and bounded idle health, not every poll. |

## Recommended scope and acceptance

1. **Small shippable first phase: event-driven comparison only.** Unify the
   common foreground/hidden applied-vs-complete-observed classification, with
   explicit exceptions for hidden sticky multi-home, overlay carried slots,
   initial fullscreen hold, work-area reprojection and explicit complete empty.
   Run it on all existing refresh/command/terminal edges; pass one classification
   to the existing Rust `reconcile` or `update-gaps` path. Delete duplicate
   comparisons and obsolete signal-specific *policy* as proved by tests; keep
   signal subscriptions as inexpensive wakeups and keep exact echo/flight
   safety and interactive suppression. No new polling, wire shape, or learning
   yet. Acceptance: foreground/hidden equality dispatches nothing; membership,
   flags, valid scope change, raw out-of-bounds and client drift dispatch the
   proper operation; unreadable domains do not imply departure; overlay and
   sticky windows do not ping-pong; pending replies never act on a changed
   scope; post-command/send refresh preserves the existing single-flight and
   once-only follow. CI's KWin tests/typecheck and Rust tests/fmt/Clippy stay
   green; production-path diff is net deletion or explicitly justified.
2. **Learn and replan only on size evidence.** In the portable policy, compare
   desired vs fresh observed rects after a known geometry attempt has ended,
   outside interactive gestures and pending writes, with stable identity/scope,
   repeatable client-held evidence and no explanatory native min/max hint.
   Do not infer a true min/max/step from a single result:
   record the tested desired/held axis as an *effective* constraint for this
   window. Repeated independent desired/held pairs can support a minimum,
   maximum or increment; ambiguous evidence retains interim per-window
   acceptance without fabricating a constraint. Project with a feasible
   learned lower or upper limit and redistribute the surplus/deficit to
   siblings; keep topology/shares and observed-vs-desired distinct. Clear
   learning on changed client-held size or native identity, and reconsider it
   on changed hints, mode or scope; do not erase it on our own unchanged
   setter echo. When infeasible, retain overconstrained/skip behavior rather
   than fight the client. Replace interim three-strike acceptance *only for*
   explained learned differences; remove its obsolete counter once all cases
   have a defined no-fight fallback. Acceptance: a repeatable Ghostty-class
   shortfall can give neighbours the spare height without a write loop or
   visible unallocated strip where feasible; spontaneous client size change
   invalidates learning and reprojects; hint-clamped and overconstrained cases
   still work; no position-drift learning, false step inference, permanent park,
   setter replay, or revision/share change from a pure observation.

Live test outline (user-executed after implementation, not run for this draft):
follow `docs/live-kwin-testing.md`, capture exact project-only baseline and
restore it; start `just dev trace` with two adjacent normal windows, reproduce
the 56 px Ghostty and `p13` shortfalls on the relevant output, compare fresh
window frames, bounds, hints and correlated planned/write/post-observation
records. Then resize the client itself, resize/move a neighbour, change
work area/output, maximize/unmaximize with and without the per-window signal,
and revisit a hidden workspace. Look for one converged replan, filled available
area when feasible, expiration on client change, no oscillation and usable
subsequent command. Test a genuinely signal-less change with a *later unrelated
event* separately from idle detection. Native effect border pixels and drag
64 px classification need separate visual/oracle tests; Plan logs alone do not
prove them. No live claim yet.

## Open decisions for the user

| Decision | Options and consequences | Recommendation |
| --- | --- | --- |
| 1. Idle signal-less detection | A: event/next-command only - no timer or idle guarantee. B: measured periodic complete read - detects while idle, adds IPC load/wake churn and possible write fighting. | **A** for first implementation; choose B only if a reproduced user-visible idle failure justifies measured cadence. |
| 2. Size inference threshold and fallback | A: treat one held rectangle as proven min/max/step - fast, can steal space on transient frames. B: use stable tested desired/held evidence for an effective bound, require independent pairs for step, retain no-fight acceptance for ambiguity - slower to learn, safer. | **B**; a shortfall is evidence of a held size, not its cause. Determine settled evidence by observed lifecycle, not a new arbitrary timer/count. |
| 3. Who owns redistribution on upper limits | A: Rust projects around *learned* effective limits, preserving existing hint-max behavior unless separately approved. B: redistribute around all native maximums too - simpler single projection rule but changes AR12's approved maximum behavior (`docs/decisions.md:52-56`). | **A**; keep unrelated native-hint semantics until live evidence motivates B. |
| 4. Native effect scope | A: KWin script/portable tiling reconciliation; effect retains its own committed-mode seed and signals. B: also redesign effect border/group/oracle reconciliation - wider native ABI/render acceptance and no proof of pixels from script state. | **A**; native renderer and press classification require separate evidence and should not block geometry convergence. |

Next action: user selects the decisions and first implementation scope; then
write a bounded implementation change, verify offline and arrange the live gate.
