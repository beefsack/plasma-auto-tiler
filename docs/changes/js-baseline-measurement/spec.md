# Specification: JS Baseline Measurement (KWin windowAdded pop-in and overhead)

Ownership and approval:
- Owner: Lead (lead-anthropic)
- Status: Approved 2026-08-09 by user (via Orchestrator), with the
  stateful-variant amendment below applied

## Intent and Desired Outcome

Produce measured evidence, before any native C++/Rust KWin plugin work begins,
that either justifies or kills the proposed native architecture described in
`Project Technical Report and Implementation Plan.md` (the "design doc").
This is a validation milestone, not a feature. Two questions must be answered
with numbers, not estimates:

- **Q1 (pop-in):** Does a visibly incorrect-placement frame ever reach the
  display between KWin's own initial placement and the tiler's corrective
  `moveResize`?
- **Q2 (overhead):** Is JavaScript compute/dispatch a meaningful fraction of
  the frame budget at realistic window counts, and what is its memory cost?

Design doc L328-357 establishes that `Workspace::windowAdded` fires *after*
KWin's own placement decision, for both scripted and native (C++) listeners
alike. Therefore Q1's answer transfers directly to the native design: a
native plugin hooking the same `windowAdded` signal sees the same
already-placed window at the same point in the lifecycle. If JS shows
pop-in, native does not fix it (a different, out-of-scope lifecycle hook
would be required, per design doc L446). If JS shows none, native does not
improve on it either. **Q1 is not a differentiator for the native-vs-JS
decision below; it is reported as an independent finding about the KWin
lifecycle itself**, relevant to whether *any* windowAdded-based
implementation (JS or native) can meet a "no pop-in" bar.

**Amendment (user-approved, recorded here per governance):** Test A alone is
a single stateless handler; it measures dispatch cost, not tiler cost. The
user's actual concern is latency, overhead, and memory when all
window-management logic -- state tracking and reconciliation across every
managed window, not just the one just added -- lives in JavaScript. As
originally drafted, this change would most likely have concluded "JS
sufficient on compute" while leaving that question itself unmeasured. Two
variants are therefore measured on the same harness with identical
instrumentation (see Scope):

- **Variant A (stateless):** unchanged from the original draft, matching
  design doc L388-405. Serves as a clean floor.
- **Variant B (stateful):** a real managed-window state model that performs
  a full layout reconciliation on every window add and remove, writing
  geometry for every affected window, not just the one that triggered the
  event. Representative of what an actual tiler does: N geometry writes per
  event, cross-window bookkeeping, and per-event allocation/GC pressure in
  QJSEngine. The layout algorithm itself stays simple (a plain columns or
  master-stack split) -- the point is the reconciliation workload and state
  maintenance, not layout sophistication.

## Scope and Non-Goals

In scope:

- Two minimal instrumented scripts on identical instrumentation:
  - Variant A (stateless): exactly the design doc's Test A (L388-405):
    `windowAdded -> compute trivial deterministic tiled rectangle -> set
    frameGeometry/moveResize immediately`. No queues, timers, layout
    framework, persistence, or DBus inside the script beyond what is needed
    to log timing.
  - Variant B (stateful): maintains a managed-window map and, on every
    `windowAdded`/`windowRemoved`, recomputes and writes geometry for every
    currently managed window using a simple columns or master-stack split.
    Same timing/logging instrumentation as Variant A, applied per triggering
    event (not per individual geometry write).
- A repeatable harness that creates and destroys a controlled number of
  windows (5, 20, 50, 100) to drive both scripts.
- Measurement of triggering-event wall-clock time (`windowAdded` or
  `windowRemoved` through the last `moveResize` call it causes) as a full
  distribution (min, median, p95, p99, max) at each window-count tier, for
  each variant separately.
- An attempt to observe, not infer, whether a pre-corrective frame is
  actually presented to the display, using a workable capture method
  determined during implementation (see Unresolved Questions). If no
  reliable method exists, that is reported honestly rather than silently
  substituted with a timing-based proxy.
- RSS delta of the `kwin_wayland` process with and without the script
  loaded, at each window-count tier, for each variant separately. Variant
  B's RSS delta is the primary evidence for the memory question (GC
  pressure from per-event reconciliation is the realistic memory risk);
  Variant A's RSS delta is retained as the baseline it is compared against.
- Measurement of the host's actual display refresh rate and the resulting
  frame budget, and comparison of all timing results against it.
- A findings report applying the decision rule in this spec to the
  collected data for both variants, reported separately, each with an
  explicit verdict.

Non-goals:

- No tiling tree, stacking, multi-monitor handling, persistence, config, or
  UI beyond Variant B's minimal columns/master-stack split, which exists
  only to generate a representative reconciliation workload, not as a real
  layout feature.
- No C++ plugin (design doc Test B) and no Rust code in this change.
- No Krohnkite or Polonium comparison (design doc L438-440, Test C-equivalent
  work). Deferred: those are third-party JS tiling scripts with their own
  architecture; comparing against them is a separate, larger measurement
  exercise that depends on this baseline existing first, and is not needed
  to answer Q1/Q2 for this project's own design.
- No compilation of any kind, no `devenv.nix` changes, no system
  configuration changes.
- No change to the user's live Plasma session state beyond the reversible
  load/unload of the two test scripts (one at a time) during measurement.

## Applicable Principles and Decisions

- No `docs/principles.md` or `docs/decisions.md` exist in this repository
  yet; there is no formal project governance to cite.
- Repo `AGENTS.md`: system/toolchain dependencies belong in `devenv.nix`,
  Rust deps in `Cargo.toml`. Neither applies here since zero new
  dependencies are required (screencast/RSS tooling already present on the
  host, confirmed during scoping: `ffmpeg`, `obs`, `gst-launch-1.0`,
  `pw-record`, `pw-cat`, `qdbus`, `busctl` all resolve on `PATH` already).
- Design doc L118-120, L328-357, L374-378, L388-405, L432-442: cited above
  and below; these are the technical basis for this measurement, not
  project governance.

## Constraints

- Zero compilation. Zero `devenv.nix` changes. Zero system configuration
  changes.
- Must not leave the user's live Plasma session in a broken state. Script
  load/unload must be reversible and the reversal verified (e.g.
  `isScriptLoaded` false after unload, `kwin_wayland` still answers
  `org.freedesktop.DBus.Peer.Ping` on `org.kde.KWin`, no leaked test
  windows). Any step that risks disrupting the live session is flagged to
  the Orchestrator before it runs.
- Shell tooling preference: combine existing CLI tools (`jq`, `qdbus`,
  `busctl`, `ps`/`smem`, `ffmpeg`/`pw-record`, etc.) over scripting
  languages; fall back to a scripting language only if the transformation
  exceeds what these tools can do.
- ASCII only in all authored files.

## Acceptance Criteria

- [ ] The refresh rate of the host's active output is measured (not
      assumed) and the corresponding frame budget is stated in the findings
      report. (Scoping already confirms 60.00 Hz / ~16.67 ms via
      `kscreen-doctor -o`; the findings report must restate this as
      measured, not copied from scoping.)
- [ ] Triggering-event wall-clock time is reported as a full distribution
      (min, median, p95, p99, max) at each of 5, 20, 50, and 100 windows,
      **for Variant A and Variant B separately** (8 distributions total).
- [ ] A frame-presentation capture method is either (a) implemented and
      used to produce an observed yes/no answer to Q1 at each window-count
      tier, or (b) documented as unavailable/unreliable with the specific
      reason, with no silent substitution of a timing proxy in its place.
      (Q1 is measured once against the representative variant; it is a
      lifecycle finding independent of variant, so it is not required to be
      duplicated across both unless the capture method itself reveals a
      variant-dependent difference.)
- [ ] RSS delta of `kwin_wayland` (script loaded vs. not loaded) is
      reported at each of the 5, 20, 50, 100 window-count tiers, **for
      Variant A and Variant B separately**, with Variant B's figures
      identified as the primary evidence for the memory question and
      Variant A's as the baseline comparator.
- [ ] The findings report applies the decision rule below to the collected
      data **separately for Variant A and Variant B** and states an
      explicit verdict for each: build native, do not build native (on
      this axis), or inconclusive.
- [ ] Script load/unload reversibility is verified and recorded at least
      once per variant after the full measurement sweep, with
      `kwin_wayland` confirmed responsive afterward.
- [ ] The findings report documents measurement-validity caveats: QJSEngine
      JIT warmup/first-run effects, whether synthetic harness-created
      windows are representative of real application windows, the clock-
      resolution limit and the terminal-protection scope restriction (both
      defined in the Timing Resolution and Live-Session Safety Amendment
      below).
- [ ] The findings report explicitly notes the Krohnkite/Polonium
      comparison as deferred, with the reason stated above.

## Decision Rule (proposed by Lead, user-confirmed for the thresholds; scope
extended per the amendment to cover both variants)

This rule addresses **Q2 only** (compute/dispatch overhead and memory), and
is applied **separately to Variant A and Variant B**, producing two
independent verdicts.

Per design doc L140-144, the project's actual native-vs-JS hypothesis rests
on *state model, batching, and reconciliation architecture*, not raw
arithmetic speed. Variant A is a single stateless handler and does not
exercise that hypothesis at all; Variant B does exercise it (full
reconciliation, N geometry writes, per-event allocation), which is why it
was added. **A JS-sufficient result on Variant A alone can rule out "native
is faster because JS dispatch is slow" but says nothing about
reconciliation cost. A JS-sufficient result on Variant B is much stronger
evidence against native, because it directly measures the workload the
architectural hypothesis is about.** This distinction must be stated
explicitly in the findings report, not left implicit.

Proposed thresholds (user-confirmed as proposed), evaluated at the
realistic tier (20-50 windows) unless stated otherwise, applied
independently to each variant's own measured data:

- **Native-justifying (on this axis, for the variant in question):**
  handler p95 wall time exceeds 10% of the frame budget (> ~1.67 ms at the
  measured 60 Hz), OR RSS delta exceeds 15 MB at 20-50 windows. Either
  indicates JS overhead consumes a non-trivial share of available budget or
  memory, and native compute is a plausible lever.
- **JS-sufficient (kills the compute-speed justification for native, for
  the variant in question):** up to 100 windows, handler p95 stays below 5%
  of frame budget (< ~0.83 ms) and p99 stays below 10% (< ~1.67 ms), and
  RSS delta stays below 5 MB. This shows compute/memory overhead is
  negligible across the realistic range for that variant, so a native
  rewrite would not yield a perceptible improvement on this axis alone.
- **Inconclusive:** any result that falls between these bands is reported
  as inconclusive on Q2 for that variant, not forced into either bucket.

Memory evaluation: Variant B's RSS delta is the primary evidence used
against the 15 MB / 5 MB thresholds above, since GC pressure from per-event
reconciliation, not script-load cost, is the realistic memory risk.
Variant A's RSS delta is reported and compared against Variant B's as the
baseline it sits on top of, but is not itself the primary basis for the
memory verdict.

Combined interpretation for the overall Q2 conclusion: if Variant A is
JS-sufficient but Variant B is native-justifying, the finding is that
dispatch cost is negligible but reconciliation cost is not -- evidence for
native on architectural grounds specifically, not on raw language speed. If
both variants are JS-sufficient, that is the strongest evidence available
from this change against building native on the compute/overhead axis
(though, per the caveat above, still not dispositive of every possible
architectural benefit, since Variant B's reconciliation algorithm is
deliberately simple). If Variant A is already native-justifying, Variant
B's result is still collected and reported, but the Variant A finding alone
is sufficient to conclude native is justified on this axis.

Q1 (pop-in) does not feed this rule. It is reported as an independent
finding: whether observed or not, it says the same thing about JS and
native, and if observed, it establishes that fixing it requires a lifecycle
change out of scope for this change (design doc L446 onward), not a
language choice.

## Timing Resolution and Live-Session Safety Amendment (Lead-proposed,
Orchestrator-approved 2026-08-09)

This amendment records, as a governance matter, the outcome of a live,
empirical investigation into the clock available to KWin scripts, and the
live-session safety measures required before any script touched the user's
real desktop. Full evidence is in
`research/clock-resolution.md`, `script/clock-probe.js`, and `README.md`
(sections: "Timestamp precision caveat", "Synthetic amplification
measurement", "Terminal-protection scope restriction", "Fail-safe
watchdog", "Manual recovery (non-GUI)"). This is not a new open question;
it is resolved, and is recorded here so the resolution is part of the
change's approved scope rather than only implementation detail.

**Clock-resolution finding.** A live, one-shot diagnostic script was loaded
into the running KWin 6.7.3 and empirically probed the `loadScript`
QJSEngine's global object (127-name enumeration) and `Date.now()`'s
behavior (100,000-call bounded loop). Finding: **no higher-resolution clock
exists.** `performance`/`performance.now`, `process`/`process.hrtime`, and
`globalThis` are all absent; `Date.now()` is the only time source and is
strictly 1 ms integer resolution (every observed step exactly 1 ms across
the probe, never sub-millisecond). This confirms and closes the caveat
originally flagged in `README.md`'s pre-amendment "must be confirmed in
unit-05" note -- it was confirmed via a dedicated non-invasive-adjacent
live probe rather than deferred to the first sweep run.

**Consequence for the Decision Rule above.** The thresholds ~0.83 ms (5%)
and ~1.67 ms (10%) of the measured 60 Hz frame budget fall inside a band
(approximately 0.4-1.5 ms) that a 1 ms-resolution clock cannot resolve.
This does not invalidate the Decision Rule: p95 > 1.67 ms (native-
justifying) remains clearly visible on a 1 ms clock, and a distribution
reading consistently 0 ms across all sampled windows at a tier remains
valid evidence of negligibility (JS-sufficient). What a 1 ms clock cannot
do is distinguish, say, 0.5 ms from 1.2 ms -- both would read as "0 ms" or
"1 ms" with no finer gradation. The findings report (unit-07) must state
this plainly wherever the real-dispatch distribution is presented, not
imply a precision the data does not have.

**Synthetic amplification figure.** To give a more precise per-operation
compute estimate despite the clock limit, both variant scripts gained an
opt-in, off-by-default measurement mode: on explicit config (`readConfig`,
disabled unless set), the handler's compute+write body is repeated in a
bounded synchronous loop (wall-time-capped and iteration-capped, never
unbounded) and the total loop time is divided by the completed iteration
count. This produces a separate, clearly-labeled synthetic figure
(`amplified-a`/`amplified-b` in the raw logs), reported in the findings
report **as a distinct, separately-labeled metric, never merged into or
presented as part of the real per-event dispatch distribution** required
by the Acceptance Criteria above. It is calibration evidence about
compute+write cost, not a substitute for the real-dispatch distribution,
which remains the primary Q2 evidence per the existing Decision Rule.

**Terminal-protection deviation (live-session safety).** For the live
sweep (unit-05/unit-06), both variant scripts were restricted to act only
on windows whose `resourceClass` exactly matches a specific, harness-
controlled value (default: an inert sentinel that matches no real window,
so an unconfigured script does nothing). This is a deliberate deviation
from the originally-scoped "any normal, managed window" behavior,
required by the Orchestrator's live-session authorization to guarantee the
scripts can never resize, move, or otherwise manage the user's real
windows (including the terminal running this agent session) during
measurement. Validity impact, to be stated in the findings report: measured
events are caused exclusively by harness-spawned synthetic test windows of
one distinctive class. This is consistent with the spec's own existing
harness-realism caveat (synthetic windows may not be fully representative
of real application windows) and does not narrow that caveat further, but
it does mean the scope restriction itself is not evidence of anything about
real-world window population -- it is a safety control, not a sampling
choice, and must be described as such rather than conflated with the
harness-realism caveat's own reasoning.

A fail-safe watchdog (bounded-lifetime self-disarm) and a documented
manual, non-GUI script-unload recovery procedure were also added/verified
as live-session safety infrastructure per the Orchestrator's mandatory
conditions; both are operational safeguards, not measurement methodology,
and do not change what is measured or how it is interpreted.

## Unresolved Questions

- **Frame-capture method for Q1.** Candidate: PipeWire ScreenCast (via
  `xdg-desktop-portal-kde`, driven by `ffmpeg`, `obs`, or `pw-record`/
  `pw-cat`), which mirrors frames as actually presented by the compositor,
  not a synthetic sample. Known limitations, to be confirmed or refuted
  during implementation (see plan.md for the relevant unit): (a) portal-based capture
  normally requires interactive one-time consent, which affects
  repeatability of an unattended sweep; (b) capture is itself bounded to
  the output's presentation rate, so if KWin coalesces the placement and
  correction into a single composited frame, no separate frame will exist
  to capture -- that is a valid negative *finding*, not a tooling failure,
  but the two cases (true negative vs. capture missed a real transient)
  must be distinguished, not conflated; (c) no attempt has yet been made to
  script this end to end. If no reliable method is found, the spec's
  acceptance criterion for Q1 is satisfied by documenting that fact and the
  specific reason, per the constraint against silent proxy substitution.
- **Window-creation realism.** The harness needs a concrete window-spawning
  mechanism (candidates: minimal Wayland/X11 client instances such as
  `xterm`/a lightweight Qt or GTK demo app under XWayland, or a purpose
  built minimal client). Whether harness-spawned windows are realistic
  enough (surface type, decoration, placement-eligibility) to trigger the
  same KWin placement path as real applications is unverified until the
  harness and sweep units in plan.md run, and is called out again in the
  findings report per the acceptance criteria above.
- **JIT warmup / first-run effects.** QJSEngine may JIT-warm across
  repeated `windowAdded` invocations within one script load. Whether the
  first few windows in each tier should be excluded from the distribution,
  or a separate warmup-vs-steady-state comparison is warranted, is left to
  the Worker implementing the measurement-sweep units in plan.md, with the
  choice and rationale recorded in the findings report rather than
  silently discarding data.
- **Synthetic spam vs. real usage.** Rapidly creating 100 windows via a
  harness does not represent how a user actually opens windows over time.
  The findings report must state this as a validity limit on generalizing
  the p95/p99 numbers to real-world session behavior, not just on raw
  throughput.
- **Variant B layout algorithm choice.** Columns vs. master-stack is left to
  the implementing Worker; either is acceptable since the point is
  reconciliation workload, not layout quality. The specific choice and its
  effect on the number of geometry writes per event (which scales
  differently with window count depending on the algorithm) must be stated
  plainly in the findings report so the p95/p99 numbers are not read as
  algorithm-independent.
- **Variant B removal handling.** `windowRemoved` also triggers full
  reconciliation per the amendment ("on every window add and remove"). The
  harness's teardown phase therefore also produces measurable events for
  Variant B; whether removal-triggered timings are pooled with
  addition-triggered timings or reported separately is left to the
  implementing Worker, with the choice stated in the findings report.

## Consequential Decisions

- Krohnkite/Polonium comparison deferred out of this change (see Non-Goals);
  recorded here so it is not silently dropped from the backlog.
- The Q2 decision-rule thresholds above are a Lead proposal, confirmed by
  the user as proposed (Orchestrator communication approving this spec with
  the stateful-variant amendment). They now apply independently to Variant
  A and Variant B per the amendment.
- Q1 is scoped as an independent lifecycle finding, not a native/JS
  decision input, based on the design doc's own L328-357 analysis. This
  reasoning, not just its conclusion, is stated in this spec so the user
  can dispute the reasoning rather than only the number. User-endorsed as
  drafted.
- **Amendment:** the user required a second, stateful script variant
  (Variant B) alongside the original stateless one (Variant A), because
  Variant A alone measures dispatch cost, not tiler cost, and would likely
  have produced a "JS sufficient" conclusion that left the actual
  reconciliation workload unmeasured. Both variants are now required
  throughout Scope, Acceptance Criteria, and the Decision Rule. Krohnkite/
  Polonium comparison remains deferred (unaffected by this amendment).

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
