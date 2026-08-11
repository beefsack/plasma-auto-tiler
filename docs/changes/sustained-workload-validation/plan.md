# Plan: Sustained Workload Validation (KWin transform animation, extension-point asymmetry, GC behaviour)

Ownership and approval:
- Owner: Lead
- Status: Approved.

## Technical Approach

Three questions, sequenced by decision impact and live-session risk, cheapest
and highest-impact first:

1. **Q-A (extension-point asymmetry)** is pure source research against the
   KWin 6.7.3 clone already at `/tmp/opencode/kwin-src` (tag `v6.7.3`) and
   the installed build at `/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-
   kwin-6.7.3`, extending milestone 1's `research/geometry-batching.md`
   methodology (cite files/lines, cross-check `nm` on the installed
   `libkwin.so.6.7.3` against source declarations, do not infer from
   prose docs alone). No live KWin/D-Bus interaction. Sequenced first
   because a decisive result here may reshape or narrow what is worth
   measuring in Q-B/Q-C.
2. The **polling-loop design question** is a small, source/design-doc
   reasoning task, also no live session, run alongside Q-A since neither
   depends on the other.
3. **Q-B (sustained per-frame workload)** first discovers and validates a
   read-only, authoritative source of actual presentation timestamps before
   any harness is built. If no source exists, Q-B is reported as not measurable
   under its approved criteria without C++ compositor instrumentation; no
   handler-duration or timer proxy is substituted. Only if the source is
   validated does the full `ScriptedEffect` paint-transform sweep proceed,
   following milestone 1's live-session safety protocol and stop-before-
   dispatch pattern for the invasive step.
4. **Q-C (GC behaviour)** first determines whether GC pauses are
   observable from within the QJSEngine scripting environment at all
   (a small research/probe unit) before committing to build a full
   allocation-pressure measurement harness, per the spec's own
   "prerequisite finding, stated before measuring" clause.
5. A findings report reconciles all three against the spec's Decision
   Rules, with any threshold the user revised recorded in
   `spec.md`'s Consequential Decisions before the report is finalized.

## Execution Status

- Paused pending the active
  [integrated-plasma-structural-feasibility gate](../integrated-plasma-structural-feasibility/),
  which implements the archived audit's scoped strong-justification next gate.
  Its active status does not resume this change. This pause preserves accepted
  unit-01 Q-A, the approved Q-B transform-first amendment, all thresholds,
  and every unit definition in this plan. No later unit has started.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|
| unit-01 | Q-A: determine whether KWin 6.7.3 has a compositor-level per-frame transform extension point that avoids geometry writes (the effects API: `prePaintWindow`/`paintWindow` and related per-frame transform mechanisms), and for each of the three surfaces (JS scripting API, KWin JS effects API, native `KWin::Plugin`/C++ effect) state what is reachable, source-cited against the cloned tag and cross-checked with `nm` on the installed `libkwin.so.6.7.3` where relevant. Extend, do not repeat, milestone 1's `research/geometry-batching.md` Q3 (native-plugin reachability) rather than re-deriving it | - | `docs/changes/sustained-workload-validation/research/extension-point-asymmetry.md` | No | Report cites specific files/lines from `/tmp/opencode/kwin-src` for each surface's reachability claim; native-reachability claims cross-checked against `nm` output or installed headers, not asserted from prose docs alone; explicit verdict against the Q-A Decision Rule in `spec.md`, including the "ambiguous/partial" case if that is what the evidence shows |
| unit-02 | Polling-loop design question: determine from `Project Technical Report and Implementation Plan.md` and this project's actual planned features whether any feature needs a fixed-interval poll rather than a KWin signal handler, specifically evaluating pointer-position-during-drag as the candidate genuine exception; state whether this narrows Q-C's scope | - | `docs/changes/sustained-workload-validation/research/polling-necessity.md` (or a short section folded into the findings report if the answer is brief enough not to warrant a standalone file -- Lead's call at write time) | No | Explicit answer: which features (if any) need polling, whether pointer-drag is confirmed as the exception or also covered by a signal, and the resulting effect (if any) on Q-C's scope, stated before Q-C's live units are dispatched |
| unit-03 | Q-B prerequisite: discover and validate a read-only, authoritative source of actual presentation timestamps. Establish its authority, timestamp semantics, access path, and whether it can observe the target output without changing compositor behavior. `Date.now()`, handler duration, and timer cadence are excluded. If no source exists, document Q-B as not measurable under the approved criteria without C++ compositor instrumentation and do not scope unit-04 | - | `docs/changes/sustained-workload-validation/research/presentation-timestamp-source.md` | No, unless a read-only live observation is required; stop before dispatch for that observation | Source-cited and, if needed, read-only-observation-cited validation that timestamps represent actual presentation intervals for the target output; or a specific documented absence. The report defines `d[i] = t[i] - t[i-1]`, `missed[i] = max(0, floor(d[i] / 16.667 ms + 0.5) - 1)`, and failure at `missed[i] >= 3` before unit-04 is scoped |
| unit-04 | **[Live-session, stop before dispatch, conditional on unit-03 validation]** Build and run a sustained `ScriptedEffect` paint-transform harness: animate N Wayland-native windows every compositor frame for a fixed duration at the window count(s) and duration settled in `spec.md`'s Unresolved Questions (Lead scopes exact values here, Orchestrator authorizes before dispatch). Record actual presentation timestamps and evaluate p99 presentation interval against 18.3337 ms plus the predefined dropped-frame computation. If persistent final geometry is required, commit it once after animation and report it as a separate phase. Per-frame geometry writes, if exercised, are explicitly labelled controls and cannot support a native-vs-JS conclusion; unload/close everything and verify `kwin_wayland` responsiveness afterward, per the inherited live-session safety protocol | unit-01, unit-03 | `docs/changes/sustained-workload-validation/harness/`, `docs/changes/sustained-workload-validation/script/`, `docs/changes/sustained-workload-validation/results/q-b/` | Yes | Validated-source presentation intervals, p99, and `missed[i]` results are recorded against the approved Q-B threshold; any final geometry phase and every geometry-write control are separately labelled; `isScriptLoaded` false and `kwin_wayland` Ping succeeds after unload/close, recorded in the run log; explicit verdict against the Q-B Decision Rule |
| unit-05 | Q-C prerequisite: determine, via research and/or a small bounded live probe, whether GC pauses in the KWin `loadScript` QJSEngine are observable from within the script engine at all (e.g. via timing gaps around a sustained allocation loop, or documented QJSEngine/Qt GC instrumentation) before committing to a full measurement | unit-02 | `docs/changes/sustained-workload-validation/research/gc-observability.md` | Partially, only if a bounded live probe is needed and only after the same stop-before-dispatch pattern as unit-03 | Explicit answer: GC pauses observable or not, and by what method; if not observable, Q-C is closed as "not measurable, for a specific tooling reason" per spec, and unit-06 is skipped, recorded as such in Progress |
| unit-06 | **[Live-session, stop before dispatch, conditional on unit-05 finding GC pauses observable]** Measure GC-pause frequency/duration under sustained allocation pressure at the workload profile settled in `spec.md`'s Unresolved Questions, against the Q-C Decision Rule | unit-05 | `docs/changes/sustained-workload-validation/results/q-c/` | Yes | GC-pause distribution recorded, or explicit non-dispatch note if unit-05 closed Q-C; `kwin_wayland` responsiveness verified after; explicit verdict against the Q-C Decision Rule |
| unit-07 | Findings report: reconcile Q-A/Q-B/Q-C against `spec.md`'s Decision Rules (with any user-revised thresholds recorded in `spec.md` Consequential Decisions first), state the polling-loop design answer, state an explicit "Scope of this verdict" statement per milestone 1's corrected-verdict pattern, document validity caveats and unit-03's presentation-timestamp-source finding | unit-01, unit-02, unit-04, unit-05 (unit-06 if run) | `docs/changes/sustained-workload-validation/findings.md` | No | Findings report reviewed by Lead against every spec acceptance criterion; each criterion traced to a specific statement, table, or citation in the report |

Only the Lead mutates plans and state. Semantic unit IDs are stable;
execution slices use `unit-<n>/attempt-<n>`.

## Live-Session Stop Points

Per the inherited protocol from `js-baseline-measurement`, any unit-03
read-only live observation, unit-04, unit-05's probe (if needed), and unit-06
are not dispatched until the Lead stops and reports to the Orchestrator,
concretely describing what will happen (script(s) to be loaded, windows to be
spawned if any, duration) and how each step is reversed, and the Orchestrator
authorizes it. No such authorization has been requested or granted yet.

## Progress

- [x] unit-01 Q-A extension-point asymmetry research
- [ ] unit-02 Polling-loop design question
- [ ] unit-03 Q-B presentation-timestamp-source prerequisite
- [ ] unit-04 Q-B sustained `ScriptedEffect` paint-transform live sweep
- [ ] unit-05 Q-C GC-observability prerequisite
- [ ] unit-06 Q-C live GC-pause measurement (conditional)
- [ ] unit-07 Findings report

## Pending User Decisions

- Exact target window count(s), sustained-run duration for Q-B, and
  allocation-pressure profile for Q-C (`spec.md` Unresolved Questions) --
  proposed defaults given in `spec.md`, Lead to scope exact values in this
  plan before unit-04/unit-06 dispatch, Orchestrator to authorize.
- Authorization for each live-session unit (a unit-03 read-only observation if
  required, unit-04, unit-05's probe if needed, unit-06), per the inherited
  stop-before-dispatch protocol.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Q-A answered with source-cited evidence across all three surfaces | `research/extension-point-asymmetry.md` (unit-01; KWin 6.7.3 source citations for D-Bus scripting, `.js` ScriptedEffect, QML declarative effects, and native effects) |
| Polling-loop design question answered | pending unit-02 |
| Authoritative presentation-timestamp source validated before Q-B harness finalized, or Q-B documented as not measurable without C++ compositor instrumentation | pending unit-03 |
| Q-B answered against its transform-first Decision Rule, or documented as not measurable by the prerequisite | pending unit-03/unit-04 |
| Q-C answered against its Decision Rule, or documented as not measurable | pending unit-05/unit-06 |
| Every decision-rule threshold used is user-confirmed or user-revised, recorded in spec.md Consequential Decisions | user confirmation recorded in `spec.md` Ownership and approval and Consequential Decisions |
| Findings report states an explicit "Scope of this verdict" statement | pending unit-07 |

## Residual Risks

- Q-A found no native-only extension point. Whether QML gesture progress and
  `.js` paint transforms can be co-used in one effect remains an
  implementation-feasibility caveat, not an API asymmetry.
- A read-only, authoritative presentation-timestamp source may not be exposed
  to the permitted Q-B environment. In that case Q-B is unmeasurable under the
  approved criteria without C++ compositor instrumentation; `Date.now()` and
  other proxies are prohibited, so unit-04 is not dispatched.
- Live-session units (unit-04, unit-06) run sustained workloads against
  the user's live Plasma session for longer than milestone 1's discrete
  events did, which is a materially different risk profile; each such
  unit's stop-before-dispatch description must state the sustained
  duration explicitly so the Orchestrator authorizes with that in mind.
- Q-B and Q-C verdicts must use the user-confirmed thresholds recorded in
  `spec.md`; exact workload parameters remain unresolved.

## Final Outcome

- Pending. Plan approved. Execution is paused pending the active
  [integrated-plasma-structural-feasibility gate](../integrated-plasma-structural-feasibility/);
  unit-01 is accepted and no later unit has been dispatched.
