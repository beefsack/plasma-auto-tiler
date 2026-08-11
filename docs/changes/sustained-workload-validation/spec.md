# Specification: Sustained Workload Validation (KWin transform animation, extension-point asymmetry, GC behaviour)

Ownership and approval:
- Owner: Lead (lead-anthropic)
- Status: Approved. User confirmed the proposed Q-B thresholds (frame
  time within 10% of budget at the 99th percentile; 3 consecutive
  dropped frames is failure) and Q-C threshold (GC pauses above 1 ms
  disqualifying) as binding, not merely proposed.

## Intent and Desired Outcome

`docs/changes/js-baseline-measurement` (milestone 1) measured discrete,
event-driven window add/remove reconciliation and found no accepted
evidence for a native C++/Rust KWin plugin **for that workload**
(`js-baseline-measurement/findings.md` Section 7). The user correctly
identified that this says nothing about workloads that are compute- or
latency-heavy in a different way: a tiling design that includes
PaperWM-style continuous scrolling repositions windows on every
compositor frame, not on discrete events, and milestone 1's evidence base
does not transfer to that regime.

This milestone answers three questions needed before any decision on
sustained, per-frame workloads can be made, in descending order of
decision impact:

- **Q-A (extension-point asymmetry, source research only, no live
  session):** milestone 1 established that every geometry write pays a
  KWin round-trip that native code cannot avoid by being compiled
  (`js-baseline-measurement/research/timing-attribution.md`,
  `wayland-revalidation.md`). The alternative to writing geometry at all
  is not writing it: GNOME's PaperWM scrolls by transforming actors in the
  compositor's own scene graph. Does KWin have an analogous extension
  point (the effects API: `prePaintWindow`/`paintWindow`/per-frame
  transforms), is it reachable from JS at all, from KWin's JS effects API,
  or only from native code, and is any resulting asymmetry decisive for
  PaperWM-style scrolling or merely convenient?
- **Q-B (sustained per-frame workload, live session):** animate N
  Wayland-native windows every compositor frame through `.js`
  `ScriptedEffect` paint transforms, sustained over a meaningful period, and
  measure presentation-interval consistency and dropped frames. This tests
  the geometry-write-avoiding path Q-A established in
  `research/extension-point-asymmetry.md` Finding 1, rather than treating
  per-frame geometry repositioning as the primary workload.
- **Q-C (GC behaviour, live session, scope-first):** whether QJSEngine
  garbage collection introduces pauses that could drop frames under
  sustained allocation pressure, a regime milestone 1's low-allocation
  discrete-event workload could not surface.

A fourth, smaller question is addressed by design reasoning rather than
measurement: whether a tight polling loop is actually required by any
planned feature, or whether KWin's event signals cover the cases (pointer
position during interactive drag being the likely genuine exception). This
is scoped up front because it may make Q-C's applicability narrower, and
because building instrumentation for a workload nothing actually needs
would be wasted effort.

## Scope and Non-Goals

In scope:

- Q-A: source-controlled research against the KWin 6.7.3 source already
  cloned at `/tmp/opencode/kwin-src` (git tag `v6.7.3`,
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`) and the installed build at
  `/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`, extending
  milestone 1's `research/geometry-batching.md` methodology (cite exact
  files/lines, cross-check against `nm`/installed headers, do not infer
  from prose documentation alone). Distinguishes three surfaces
  explicitly and does not conflate them: (1) the JS scripting API
  (`org.kde.kwin.Scripting`, what milestone 1 measured), (2) KWin's
  JavaScript effects API (a separate loader/API surface for
  `.js`-based effects), (3) a native `KWin::Plugin` or C++ effect.
- Q-B: first discover and validate a read-only, authoritative source of actual
  presentation timestamps. Only if that prerequisite succeeds, use a
  live-session harness to animate N Wayland-native windows through
  `ScriptedEffect` paint transforms every compositor frame, sustained over a
  fixed duration at one or more window counts. Measure presentation intervals
  and dropped frames from that source, not handler duration. Wayland-native
  test clients only, consistent with `js-baseline-measurement/research/
  wayland-revalidation.md`'s finding that X11/XWayland clients measure a
  different, non-representative cost.
- Q-B may commit persistent final geometry once after animation only when the
  workload requires it; report that commit as a separate phase. Per-frame
  geometry writes may be retained only as an explicitly labelled control and
  are not evidence for a native-vs-JS conclusion.
- Q-C: determining, before promising a number, whether GC pauses are
  observable from within the QJSEngine script engine at all (what
  instrumentation, if any, KWin's scripting environment exposes for this),
  then measuring if a method exists.
- The polling-loop design question: identify, from `Project Technical
  Report and Implementation Plan.md` and this project's actual planned
  features, whether any feature needs a fixed-interval poll rather than a
  KWin signal handler, and specifically evaluate pointer-position-during-
  drag as the candidate genuine exception.
- Falsifiable, user-confirmable decision rules for Q-A, Q-B, and Q-C,
  stated in this spec before any measurement is taken (see Decision Rules
  below), so interpretation is not left to be settled after numbers
  arrive (the mistake milestone 1's first pass made and had to correct).

Non-goals:

- No tiling tree implementation, no PaperWM feature implementation.
- No C++ or Rust code written.
- No `devenv.nix` changes without a fresh Orchestrator decision and the
  session restart the repo `AGENTS.md` requires.
- No Q1 (pop-in) or portal/PipeWire work -- closed in milestone 1, per
  `js-baseline-measurement/findings.md` Section 8 (formally closed, no
  further attempts authorized).
- No attempt to build a persistent-connection D-Bus client or install new
  scripting-language D-Bus bindings (same constraint milestone 1 operated
  under).
- No comparison against Krohnkite/Polonium (deferred in milestone 1,
  still deferred).

## Applicable Principles and Decisions

- `js-baseline-measurement/spec.md`'s Timing Resolution and Live-Session
  Safety Amendment: the only clock available inside KWin's `loadScript`
  QJSEngine is `Date.now()`, 1 ms integer resolution. This milestone
  inherits that constraint; see Constraints and Q-B's decision rule below
  for how it is handled at a 60 Hz (16.667 ms) or higher frame rate.
- `js-baseline-measurement/findings.md` Section 7's corrected, scoped
  verdict: no accepted evidence for native for discrete window
  management; sustained per-frame workloads explicitly out of scope
  there and the reason this milestone exists.
- Live-session safety protocol from milestone 1 (resourceClass sentinel
  defaulting to `"__unset__"`, watchdog self-disarm, verified reversal
  after every run, exception-storm guards, immediate stop-and-report on
  compositor unresponsiveness) applies unchanged to any live-session unit
  in this milestone. `Scripting.start()` is required to actually execute
  a loaded script.

## Constraints

- Q-B timing: `Date.now()` is a 1 ms integer-resolution handler clock
  (confirmed empirically, `js-baseline-measurement/research/
  clock-resolution.md`) and is not a presentation measurement. Before the
  Q-B harness is finalized, discovery and validation must establish a
  read-only, authoritative source of actual presentation timestamps. If none
  exists, Q-B is not measurable under this specification without C++ compositor
  instrumentation. The criterion must not be weakened or replaced with handler
  duration, timer cadence, or another proxy.
- No KWin devel headers are installed on this host and nixpkgs' `kwin.dev`
  output is currently unmaterialized (`js-baseline-measurement/research/
  geometry-batching.md` Q3). Q-A's native-reachability sub-question
  (practical reachability: exported symbols, installed headers, or a full
  source-tree build) must work within this constraint, extending rather
  than repeating Q3's existing finding.
- Escalation beyond the live-session safety protocol (system config
  changes, restarting/killing `kwin_wayland`, logging out, installing
  packages) requires a fresh Orchestrator decision, per this session's
  standing instruction.

## Decision Rules (falsifiable, stated in advance)

Each rule below states, in advance, what result revives the native case
and what result closes it, per question. The Q-B 10%/99%/three-frame and
Q-C 1 ms thresholds were user-confirmed as binding; no replacement values
were supplied.

### Q-A: extension-point asymmetry

- **Closes against native (no revival):** compositor-level per-frame
  transforms without geometry writes are reachable from the JS scripting
  API or KWin's JS effects API (i.e. some non-native surface can do what
  PaperWM does), OR no such extension point exists at all in KWin 6.7.3
  for any caller including native (the asymmetry argument does not exist,
  same conclusion shape as milestone 1's batching-asymmetry finding).
- **Revives native (on API-access grounds, not compute grounds -- report
  this distinction explicitly if it triggers):** a decisive, per-frame,
  geometry-write-avoiding transform extension point exists in KWin's
  effects/scene-graph layer, AND it is reachable only from a native
  `KWin::Plugin`/C++ effect, AND it is practically buildable on this host
  within the constraints above (or a concrete, scoped path to making it
  buildable is identified), AND source or documentation evidence
  indicates it is not merely convenient but decisive for maintaining
  frame budget at the target window counts and refresh rate (i.e. the JS
  scripting-API alternative would plausibly miss frame budget by a
  margin bigger than this milestone's own measurement uncertainty).
- **Ambiguous/partial result:** if reachable in principle from native but
  buildability is blocked the same way Q3 already found (no devel headers,
  version pinning), this is reported as "revives the case on paper, not
  practically actionable without further host changes," not silently
  rounded to either close or revive.

### Q-B: sustained per-frame workload (user-confirmed thresholds)

- **Closes against native (no revival):** across a sustained run at the
  target window count(s), the JS `ScriptedEffect` paint-transform workload
  keeps p99 presentation interval at or below 18.3337 ms (110% of the
  16.667 ms budget), with no failure under the dropped-frame computation
  below.
- **Dropped-frame computation, fixed before measurement:** order the validated
  presentation timestamps as `t[i]`; for each interval `d[i] = t[i] -
  t[i-1]`, compute `missed[i] = max(0, floor(d[i] / 16.667 ms + 0.5) - 1)`. A
  nonzero `missed[i]` represents that many consecutive unpresented frame
  periods between two observed presentations. Any `missed[i] >= 3` is the
  user-confirmed three-consecutive-dropped-frames failure. The measurement
  report must preserve the intervals and this calculation.
- **Revives native:** the paint-transform workload exceeds the above bound in
  a way that correlates specifically with JS animation work, not with KWin's
  compositor cost that native code would also incur, at a window count within
  the range this project intends to support. Per-frame geometry-write controls
  cannot establish this conclusion.
- **Prerequisite finding, stated before measuring:** discovery and validation
  of a read-only, authoritative presentation-timestamp source. If none exists,
  report Q-B as not measurable under the approved criteria without C++
  compositor instrumentation; do not substitute `Date.now()` or another proxy.
- **Separate final-geometry phase:** if animation must persist a final layout,
  commit that geometry once after the transform run and report its outcome
  separately. It is not part of the presentation-interval workload.

### Q-C: GC behaviour (user-confirmed threshold)

- **Closes against native (no revival):** either no GC pause is
  observable from within the script engine under sustained allocation
  pressure at the target workload's allocation rate, or observable pauses
  are consistently under 1 ms (below the clock's own resolution, i.e.
  indistinguishable from no pause given Constraints).
- **Revives native:** GC pauses are observable and occur at a frequency
  and duration that would plausibly cause dropped frames at the target
  refresh rate, independent of the write-cost mechanism Q-B measures.
- **Prerequisite finding, stated before measuring:** whether GC pauses
  are observable from within the script engine at all. If no
  instrumentation surfaces this, Q-C is reported as "not measurable, for
  a specific tooling reason" (the same honest category milestone 1 used
  for Q1), not answered with an inferred number.

## Acceptance Criteria

- [ ] Q-A answered with source-cited evidence distinguishing all three
      surfaces (JS scripting API, KWin JS effects API, native
      `KWin::Plugin`/C++ effect), stating whether a decisive asymmetry
      exists and, if so, its practical native-reachability status on this
      host.
- [ ] The polling-loop design question is answered: whether any planned
      feature needs a fixed-interval poll, with the pointer-drag case
      specifically evaluated, and whether this makes Q-C's scope
      narrower.
- [ ] A read-only, authoritative presentation-timestamp source is discovered
      and validated before Q-B's harness is finalized, or Q-B is documented as
      not measurable under the approved criteria without C++ compositor
      instrumentation.
- [ ] Q-B answered: either a live sustained `ScriptedEffect` paint-transform
      measurement against the Decision Rule above, or the prerequisite's
      documented not-measurable result, following the live-session safety
      protocol inherited from milestone 1. Any final geometry commit is
      reported as a separate phase; per-frame geometry writes, if run, are
      explicitly labelled controls only.
- [ ] Q-C answered: either GC-pause observability is confirmed and
      measured against the Decision Rule above, or documented as not
      measurable for a specific tooling reason.
- [ ] Every decision-rule threshold used to produce a verdict is either
      the user-confirmed value, or a revised value the user supplied,
      recorded in Consequential Decisions before findings are finalized.
- [ ] Findings report scopes its own verdict as explicitly as milestone
      1's corrected verdict does (per `js-baseline-measurement/findings.md`
      Section 7's "Scope of this verdict"), stating what this milestone
      did and did not test.

## Unresolved Questions

- Exact target window count(s) and refresh rate(s) for Q-B's sustained
  run -- proposed: reuse the measured 60 Hz output (`js-baseline-
  measurement/findings.md` Section 1) and a window count in the 5-50
  range consistent with milestone 1's tiers, pending Lead scoping in
  `plan.md` and Orchestrator sign-off.
- Exact sustained-run duration for Q-B and allocation-pressure profile for
  Q-C -- to be scoped in `plan.md`, not fixed here.
- Whether Q-A's answer (once known) changes what is worth measuring in
  Q-B/Q-C at all -- this is why Q-A is sequenced first in `plan.md`; a
  decisive Q-A result may narrow or reshape the later units before they
  are dispatched.

## Consequential Decisions

- User confirmed the Q-B 10%/99%/three-frame and Q-C 1 ms thresholds as
  binding. No replacement values were supplied.
- User approved Q-B's transform-first amendment: `ScriptedEffect` paint
  transforms are the primary workload because unit-01
  (`research/extension-point-asymmetry.md` Finding 1) established that they
  avoid geometry writes. Actual presentation timestamps from a read-only,
  authoritative source are mandatory; without one, Q-B is not measurable under
  these criteria without C++ compositor instrumentation. A one-time final
  geometry commit is a separate phase, and per-frame geometry writes are
  controls only.
- (pending) User/Orchestrator authorization of the specific live-session
  unit(s) for Q-B and Q-C, per the inherited live-session safety
  protocol, following the same stop-before-dispatch pattern milestone 1
  used for its own live-session units.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
