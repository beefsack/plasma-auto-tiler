# Findings: JS Baseline Measurement (KWin windowAdded pop-in and overhead)

**FINAL (2026-08-09): this report supersedes an earlier CONTESTED state.**
An initial pass (same date) concluded Variant A "JS-sufficient" and Variant
B "native-justifying" on Q2 timing. `research/timing-attribution.md` then
showed the amplification cross-check behind the Variant A call was
methodologically invalid (it measures an idempotent no-op write, not a
genuine geometry change) and that the Variant B "native-justifying" call
attributed cost to KWin's own compositor/X11-protocol round-trip work --
cost a native plugin calling the same C++ API would incur identically, not
JavaScript overhead native code would eliminate. Two further research
passes then closed the remaining open questions:
`research/geometry-batching.md` (source-verified: no cross-window geometry
batching primitive exists in KWin, X11 or Wayland, in either the C++ or JS
API) and `research/wayland-revalidation.md` (live re-measurement under
genuinely Wayland-native clients -- the platform that matches the user's
actual session -- showing Variant B's large figures vanish entirely,
collapsing to the 1 ms clock floor). Sections 4.1, 4.2, and 7 below are
rewritten accordingly and are now this project's final verdict, not a
provisional one layered under a contested notice. `research/
popin-observation.md` (unit-E) records a live attempt at Q1 that could not
reach a measurement, for a specific, stated tooling reason (Section 8).

Status: Q2 (compute/dispatch overhead and memory) complete for both
variants, all four tiers, live-measured, with the corrected attribution
above applied. Q1 (pop-in) was attempted live, with the user present and
ready to interact; the attempt did not reach the point of asking the user
to interact with anything (Section 8) and is recorded as not measurable
for a specific tooling reason, not as a substitute negative.

All raw data cited below is in `results/variant-a/` and `results/variant-b/`
(per-tier logs and RSS files, plus one amplification-calibration log per
variant), produced by live sweeps against the running KWin 6.7.3 Wayland
session on 2026-08-09, using the harness at `harness/run.sh` and the
scripts at `script/variant-a.js`/`script/variant-b.js`. This report
presents summary statistics computed from that raw data; it does not
re-paste raw log lines (see the cited files for those).

## 1. Measured refresh rate and frame budget

Measured (not assumed, and re-confirmed specifically for this report, not
only carried over from earlier scoping) via `kscreen-doctor -o`: the
active output `eDP-1` runs mode `1920x1280@60.00` (marked active with `*`).

**Frame budget = 1000 / 60.00 = 16.667 ms.** The spec's thresholds derive
from this: 5% = 0.833 ms, 10% = 1.667 ms.

## 2. Clock-resolution caveat (governs how every number below must be read)

Per `research/clock-resolution.md` (empirical, live-probed): KWin's
`loadScript` QJSEngine has no clock finer than `Date.now()`, which is
strictly 1 ms integer resolution. Consequently:

- A reading of `0` reliably means "well under 1 ms."
- A reading of `1` or `2` ms could represent a true elapsed time anywhere
  from just above 0 ms to just under 3 ms, because `Date.now()` truncates
  to the millisecond and a call pair straddling a millisecond boundary can
  read a value 1-2 ms higher than the true elapsed time.
- The spec's 0.833 ms / 1.667 ms thresholds fall inside a band
  (approximately 0.4-1.5 ms) that this clock cannot resolve at the level
  of a single event.
- The synthetic amplification figure (Section 5) exists specifically to
  give a precise per-operation compute+write estimate despite this limit,
  by dividing a wall-time-capped repeated-execution total by the iteration
  count. It is reported separately and is never merged into the
  real-dispatch distributions below.

This caveat is applied explicitly in the interpretation of Variant A's
results (Section 4.1), where it materially changes the honest verdict.

## 3. Q2 real-dispatch distributions (primary evidence)

All values in ms, computed directly from the raw per-tier logs' 5th CSV
field (`end - start`, `Date.now()` milliseconds). Percentile = nearest-rank.

### 3.1 Variant A (stateless), `windowAdded` only (Variant A has no removal handler)

| Tier (N) | min | median | p95 | p99 | max | 0 ms events | >=1 ms events |
|---|---|---|---|---|---|---|---|
| 5   | 1 | 1   | 2  | 2  | 2  | 0 | 5   |
| 20  | 1 | 1   | 2  | 2  | 2  | 0 | 20  |
| 50  | 0 | 1   | 2  | 2  | 2  | 1 | 49  |
| 100 | 0 | 1   | 2  | 2  | 2  | 4 | 96  |

Source: `results/variant-a/tier-5.log` through `tier-100.log`. Every event
across all 175 total windowAdded events, all four tiers, read 0, 1, or 2
ms; none ever exceeded 2 ms.

### 3.2 Variant B (stateful), `windowAdded` and `windowRemoved` separately and pooled

Percentile method: nearest-rank, index = ceil(p * N) into the ascending-
sorted sample, 1-indexed (standard definition; verified against known
index values by hand for several tiers before trusting the automation).
**These numbers were independently recomputed by the Lead directly from
the raw per-tier logs via `awk`/`sort` after the reporting Worker's own
percentile arithmetic was found to be wrong at several tiers** (notably
N=100 windowAdded: Worker reported p95=95/p99=526; verified correct
values are p95=88/p99=149 -- the Worker's method drifted from standard
nearest-rank at larger N). The corrected table below is the one this
report relies on.

| Tier (N) | Event type | min | median | p95 | p99 | max | 0 ms | >=1 ms |
|---|---|---|---|---|---|---|---|---|
| 5   | windowAdded   | 2 | 3   | 4  | 4   | 4   | 0  | 5   |
| 5   | windowRemoved | 0 | 0   | 1  | 1   | 1   | 3  | 2   |
| 5   | pooled        | 0 | 1.5 | 4  | 4   | 4   | 3  | 7   |
| 20  | windowAdded   | 1 | 7.5 | 14 | 14  | 14  | 0  | 20  |
| 20  | windowRemoved | 0 | 0   | 1  | 3   | 3   | 11 | 9   |
| 20  | pooled        | 0 | 1.5 | 14 | 14  | 14  | 11 | 29  |
| 50  | windowAdded   | 1 | 21  | 42 | 90  | 90  | 0  | 50  |
| 50  | windowRemoved | 0 | 1.5 | 3  | 8   | 8   | 9  | 41  |
| 50  | pooled        | 0 | 3   | 39 | 62  | 90  | 9  | 91  |
| 100 | windowAdded   | 0 | 11.5| 88 | 149 | 526 | 7  | 93  |
| 100 | windowRemoved | 0 | 2   | 7  | 9   | 14  | 14 | 86  |
| 100 | pooled        | 0 | 2   | 63 | 109 | 526 | 21 | 179 |

Source: `results/variant-b/tier-5.log` through `tier-100.log` (exactly N
`windowAdded` + N `windowRemoved` lines confirmed present at every tier,
200 lines at N=100). Max values (including the 526 ms outlier) are
independent of percentile method and were re-confirmed directly against
the raw file (`grep`).

**Bimodal-cost mechanism (verified against the algorithm's source code, not
only inferred from the shape of the distribution):** Variant B's layout is
N equal-width columns, width = `floor(outputWidth / count)`
(`script/variant-b.js`, `reconcile()`). At many consecutive window counts
this integer division yields the *same* column width as the previous
count (e.g. `floor(1536/50) == floor(1536/51) == 30`), so an add/remove at
that transition writes identical geometry to the already-correctly-placed
windows -- KWin's `moveResize` is close to a no-op and the event reads near
0-1 ms. At a width-changing transition, all N windows receive a real
geometry change and the event carries the full N-write cost. This
qualitative mechanism is confirmed by reading the layout formula; the
exact split of how many of the 100 add-events at N=100 were
same-width-adjacent versus width-changing was not independently re-derived
by the Lead for this report (the reporting Worker's own such breakdown is
not cited here, since its percentile arithmetic was already found to be
unreliable elsewhere and the breakdown numbers were not separately
re-verified) -- the mechanism is stated with confidence, the precise
event-by-event split is not. What the corrected table does establish
directly: the *median* (11.5 ms at N=100) is well below the *p95/p99*
(88/149 ms) and far below the *max* (526 ms, over 31 frame periods), a
genuinely long right tail, consistent with a minority of events carrying
disproportionate cost. **Practical consequence: the p95/p99 figures, not
the median, are the numbers that matter for the Decision Rule**, because a
real user's window count changes unpredictably and will cross
width-changing boundaries during ordinary use, not only at the sampled
tier boundaries. Do not read the median as representative of typical cost.

Removal timings are, separately, likely undercounted for the same-burst
reason: the harness tears down all N windows back-to-back, so most
`windowRemoved` events fire against a rapidly-shrinking, transiently
inconsistent set. This is stated as a caveat, not corrected for, since
correcting it would require a different (non-burst) teardown procedure
outside this change's scope.

## 4. Q2 verdict per variant (spec's Decision Rule, evaluated at 20-50 windows)

### 4.1 Variant A (revised; supersedes the original "JS-sufficient" call)

**Literal threshold reading:** p95 = 2 ms at both the 20-window and
50-window tier. 2 ms > 1.667 ms (the native-justifying threshold), so a
mechanical application of the Decision Rule would read "native-justifying."

**The original basis for overriding this literal reading is retracted.**
The original report dismissed the literal reading in favor of a synthetic
amplification figure (0.0066 ms mean, Section 5.1), judged more credible.
`research/timing-attribution.md` Section 5 shows this amplification loop is
methodologically invalid as a calibration of genuine write cost:
`runAmplified()` runs strictly *after* the real dispatch's log line is
emitted, i.e. after the real write has already placed the window at the
target geometry, and then repeats the *identical* geometry computation
against a window already at that geometry. Every iteration lands in the
same no-op-skip path KWin uses for unchanged geometry (`X11Window::
updateServerGeometry()` skips the X11 protocol round trip when the new
geometry matches what was last configured -- `research/
timing-attribution.md` Sections 2-3, corroborated by public KWin commit
history for this code path, not a byte-verified 6.7.3 read). The
amplification figure therefore measures **no-op-skip cost**, not
genuine dispatch-and-write cost, and cannot be used to override the literal
reading.

**This does not flip Variant A to "native-justifying" either.** Unlike
Variant B (Section 4.2), Variant A's real-dispatch window was never
independently attributed to compositor-protocol cost versus JS compute --
that specific analysis was done for Variant B's CHANGE/SAME natural
experiment, which Variant A's single-window, always-genuine-write workload
does not have an equivalent control for. The literal 1-2 ms reading remains
inside the clock's own stated ~0.4-1.5 ms unresolvable band (Section 2) and
could still be pure `Date.now()` quantization of a sub-millisecond true
cost, exactly as the Timing Resolution amendment anticipated. **Also
unlike Variant B, Variant A was never revalidated under genuinely
Wayland-native clients** -- `research/wayland-revalidation.md` (unit-D)
re-measured only Variant B at N=20/50, not Variant A, so there is no direct
Wayland-native evidence for Variant A's real-dispatch cost either way. Given
that Variant B's equivalent X11 real-dispatch cost was shown to collapse
entirely under Wayland-native clients, it is plausible Variant A's would
too, but this is an inference from a different variant's result, not a
direct measurement of Variant A, and is not treated as evidence here.

**Verdict: inconclusive on timing.** Neither the original "JS-sufficient"
call (its stated basis is unsound) nor a "native-justifying" call (no
attribution evidence supports it, and the reading is inside the clock's
unresolvable band) is supported. A corrected, non-idempotent calibration
pass (alternating between two distinct target rects each amplification
iteration, so every iteration forces a genuine write) or a Wayland-native
revalidation of Variant A specifically would be needed to resolve this;
neither was attempted (see Section 9).

**RSS:** the true script-load cost (loaded-zero-windows minus baseline) is
**~250 KB at every tier** (248-252 KB), far below the 5 MB JS-sufficient
threshold. This figure is not affected by the timing attribution dispute
above -- it measures the script's own load footprint, independent of any
window-geometry-write mechanism. The larger raw deltas in Section 6
(18-344 MB) are per-window KWin/xterm state growth, not script cost -- see
Section 6.

**Combined Variant A verdict: inconclusive on timing, JS-sufficient on the
clean (script-load) RSS figure.** Per the spec's Decision Rule, a
JS-sufficient verdict requires both timing and RSS to clear their
respective thresholds; since timing is inconclusive here, the combined
per-variant verdict for Variant A is **inconclusive**, not JS-sufficient,
carried forward into Section 7.

### 4.2 Variant B (revised; reverses the original "native-justifying" call)

**X11/XWayland timing (original sweep, `xterm` test clients):** at the
realistic tier, p95 = 14 ms (N=20) and p95 = 42 ms / p99 = 90 ms (N=50,
windowAdded); at N=100, p95=88 ms, p99=149 ms, max=526 ms. These magnitudes
are far too large to be `Date.now()` quantization artifacts (a 1-2 ms
ceiling at most) -- that part of the original reading stands. **What does
not stand is the attribution of this cost to JavaScript reconciliation.**
`research/timing-attribution.md` re-derived the CHANGE/SAME split first
noted in Section 3.2 directly from the raw N=100 log and ran the critical
control: the SAME group (no-op geometry writes) does *more* JS loop
iterations per event on average (76.2 vs 35.4) than the CHANGE group
(genuine geometry writes), yet costs **12.7x less** (3.4 ms vs 42.9 ms
mean). If JS compute scaling with iteration count were the dominant cost,
the group doing more iterations should cost more, not less. It costs less.
Cross-referenced against KWin's own source (`X11Window::
updateServerGeometry()`, corroborated via public commit history for KWin
6.7.3's code path, not a byte-verified read of the installed source), the
mechanism is: a CHANGE event issues real XCB `ConfigureWindow` round trips
to the X server (via Xwayland, since the test harness used `xterm`/X11
windows) for every managed window; a SAME event only compares in-memory
geometry and skips the round trip. **The dominant measured cost is KWin's
own compositor/X11-protocol work, not JavaScript dispatch or reconciliation
overhead** -- a native C++/Rust plugin calling the same `moveResize` API on
the same real X11 windows would incur the same round trips, since the X
server does not process `ConfigureWindow` requests faster because the
caller is compiled code.

**Wayland-native revalidation (unit-D, `research/wayland-revalidation.md`):
the X11 attribution above is directly confirmed, and the cost vanishes
entirely under the platform that matches the user's actual session.** The
same `variant-b.js`, same harness structure, same N-window reconcile
workload, re-measured live at N=20 and N=50 using genuinely Wayland-native
clients (`konsole`, surface type verified by absence from `xlsclients`, not
by application reputation): every `windowAdded` and `windowRemoved` event,
for both CHANGE and SAME classifications, collapsed to the 0-1 ms clock
floor (tier-20: median 0, p95/p99/max 1 ms; tier-50: median 0, p95/p99/max
1 ms) -- versus the X11 figures of median 7.5/21 ms and max 14/90 ms at the
same tiers. The bimodal CHANGE/SAME pattern itself disappears under
Wayland, because both groups now measure at the same sub-1-ms floor. This
matches `research/geometry-batching.md`'s independent source finding (its
Q4) that the Wayland/`xdg-shell` geometry path defers each window's
configure event to the compositor's idle point and sends no protocol round
trip per write, unlike the X11 `ConfigureWindow` path.

**Timing verdict: JS-sufficient**, applying the spec's Decision Rule to the
Wayland-native measurement (the platform that matches the user's real
session, per `research/wayland-revalidation.md`): median 0 ms, p95/p99/max
1 ms at both N=20 and N=50 is clearly below both the 0.833 ms and 1.667 ms
thresholds. The original X11-based "native-justifying" reading is not
treated as this variant's answer -- it measured KWin's own X11-specific
compositor cost, confirmed architecture-independent (Sections above), not a
property of Variant B's JavaScript reconciliation logic. This reverses the
original Section 4.2 verdict.

**RSS:** delta (loaded-N minus baseline) is 24.2 MB at N=20 and 25.0 MB at
N=50 under X11, and a comparable 31.4 MB / 28.9 MB under Wayland -- all
above the 15 MB native-justifying threshold by the letter of the Decision
Rule's RSS clause. **This is not treated as native-justifying evidence
either, for the same category of reason the timing reversal above rests
on.** Section 6 already established this delta is confounded by
Variant B's window sizes changing with N (the columns layout narrows each
window as N grows) -- it measures per-window Qt/xterm/konsole client-side
backing-store footprint, which a native plugin computing the same target
geometries for the same windows would produce identically, not a cost a
language choice could change. `research/wayland-revalidation.md` reinforces
this: RSS stayed comparable or slightly higher under Wayland despite the
timing collapsing to nothing, confirming the RSS figure and the timing
figure are not measuring the same thing and the RSS figure is not itself
evidence of reconciliation GC pressure. The one clean, uncontaminated
figure available -- pure script-load cost, ~250 KB at every tier (Section
6) -- is negligible and does not support native-justification.

**Verdict: JS-sufficient**, on timing (robustly, via the Wayland-native
revalidation) and on the one RSS figure that is not confounded (script-load
cost). The larger RSS deltas are not read as native-justifying because the
same architecture-independence reasoning that reversed the timing verdict
applies to them.

## 5. Synthetic amplification figures (separate, labeled, not pooled with Section 3)

Per the spec's Timing Resolution amendment: these are calibration figures
from a one-off pass with `amplify=1`, each window's compute+write body
repeated in a bounded loop, timed as a whole and divided by the iteration
count. They estimate true per-operation cost, not per-event dispatch
latency, and were captured once per variant on a small number of
calibration windows (not one per tier).

### 5.1 Variant A (`results/variant-a/amplified-calibration.log`, 3 windows)

Per-operation mean 0.006632 ms (min 0.006250, max 0.007267), all bound by
the 20 ms wall-time cap (2752-3200 iterations per window, well under the
5000-iteration cap). This is the figure used in Section 4.1's judgment.

### 5.2 Variant B (`results/variant-b/amplified-calibration.log`, 5 windows,
10 lines: fires on both windowAdded AND windowRemoved per `logEvent`'s hook)

Per-operation cost scales with the then-managed window count (this is a
full `reconcile()` pass per iteration, i.e. N geometry writes, not a
single-window operation -- **not directly comparable to Variant A's
per-window figure without this distinction**): 0.00601 ms at 1 managed
window, rising to 0.026042 ms at 5 managed windows on the growing (add)
side, then falling back down through the shrinking (remove) side to
0.006563 ms at 1 remaining window. Cross-check: the 1-window reconcile
figure (0.00601 ms) is consistent with Variant A's single-window figure
(0.006632 ms mean), which is the expected result since a 1-window
reconcile and a 1-window direct write do essentially the same work.

This scaling (per-op cost rising roughly linearly with N in the
calibration range) is directionally consistent with the real-dispatch
tail growth seen in Section 3.2, and supports reading Variant B's
real-dispatch tail as genuine reconciliation cost rather than a clock
artifact -- unlike Variant A, where the amplification figure argues
against the real-dispatch reading.

## 6. RSS delta detail and the cross-variant confound

| Tier | Variant A delta (KB) | Variant B delta (KB) |
|---|---|---|
| 5   | 18,168  | 15,672 |
| 20  | 66,952  | 24,156 |
| 50  | 173,840 | 24,960 |
| 100 | 344,048 | 28,880 |

Variant A's delta grows roughly linearly with N (~3.4-3.5 MB/window);
Variant B's delta is flat from N=20 onward (~24-29 MB total, not
per-window). This is the opposite of what a naive "more writes means more
GC pressure means more memory" model would predict, and the explanation is
architectural, not about JS: Variant A always places each window at
half the output width (~768 px); Variant B's columns layout makes each
window narrower as N grows (1536/100 = 15 px wide at N=100), so each
individual xterm's client-side rendering/backing-store footprint shrinks
sharply as N increases. The two variants are therefore not creating
windows of comparable size, and the RSS comparison is confounded by that
difference, not a clean measurement of "script memory cost" in isolation.
This is a validity limit stated plainly rather than resolved: this change
did not attempt to control for window size across variants, and doing so
would require a different harness design. It does not change Section 4.2's
verdict, which rests on the timing evidence independent of this RSS
ambiguity.

Pure script-load cost (loaded-zero-windows minus baseline, isolated from
any window-count effect) is consistent at ~250 KB for both variants at
every tier -- this is the cleanest, uncontaminated memory figure available
from this data, and it is negligible for both variants.

## 7. Combined Q2 interpretation (revised; supersedes the original "native
justified" conclusion)

**Final verdict, scoped to discrete window management: no accepted
evidence from this milestone supports building a native C++/Rust KWin
plugin for discrete window management** (the `windowAdded`/`windowRemoved`
add-and-remove event workload this milestone actually measured, at
window-count tiers 5/20/50/100). Variant A is inconclusive on timing,
JS-sufficient on the one clean RSS figure available (Section 4.1).
Variant B is JS-sufficient on timing, robustly, once measured against
genuinely Wayland-native clients -- the platform that matches the user's
real session -- and its larger RSS deltas are not treated as
native-justifying evidence because they are confounded by window-size
effects that are architecture-independent, not reconciliation cost
(Section 4.2). Neither variant, on any axis, produces a result this
report treats as native-justifying, for this workload.

**Scope of this verdict.** This milestone tested one workload class only:
discrete, event-driven window add/remove reconciliation, triggered at the
rate real window-management events occur (not per-frame). It did not test,
and this verdict says nothing about, the following, in descending order of
relevance to a PaperWM-style tiling design:

- **Sustained per-frame repositioning** (e.g. PaperWM-style continuous
  scrolling, where N windows are repositioned on every compositor frame
  rather than on discrete add/remove events). This is a fundamentally
  different cost regime -- sustained, frame-budget-gated, high-frequency --
  from the low-frequency discrete events measured here, and the
  distributions in Section 3 do not transfer to it.
- **Tight polling loops** (any workload that queries or acts on window/
  pointer state on a fixed short interval rather than in response to a
  KWin signal). Not exercised by either variant.
- **Garbage-collection behaviour under sustained allocation pressure.**
  Both variants' measured workloads are low-allocation and event-driven;
  neither exercises the QJSEngine's GC under sustained, high-frequency
  allocation, so this milestone has no evidence on whether GC pauses could
  drop frames under such a load.

These three are explicitly out of scope and unmeasured by this milestone
and are left for a follow-on milestone (see `docs/changes/
sustained-workload-validation/`).

This is a full reversal of the original combined interpretation ("dispatch
cost is negligible, but full reconciliation cost is not -- evidence for
native on architectural grounds"). The reversal rests on three pieces of
evidence, not one:

1. **Compute/dispatch speed (closed):** `research/timing-attribution.md`
   shows Variant B's large real-dispatch figures were KWin's own X11/
   XWayland compositor-protocol round-trip cost, not JavaScript overhead --
   a natural-experiment control (the SAME group does more JS work per event
   than the CHANGE group but costs 12.7x less) rules out JS compute as the
   dominant cost directly from the experiment's own data. `research/
   wayland-revalidation.md` then confirmed this live: under Wayland-native
   clients, the same workload collapses entirely to the 1 ms clock floor.
   Variant A's own compute-speed evidence was never soundly established
   either way (its calibration was invalid and it was never Wayland-
   revalidated), so no variant in this change provides valid evidence *for*
   native on this axis.
2. **Memory (closed):** the RSS deltas that crossed the spec's 15 MB
   threshold are confounded by per-window client-side backing-store size
   (Section 6), which is a function of what geometry is computed and how
   large the resulting windows are, not of which language computed it -- a
   native plugin producing the same geometries would carry the same
   backing-store cost. The one uncontaminated figure, pure script-load
   cost (~250 KB, both variants, every tier), is negligible.
3. **Cross-window geometry batching asymmetry (closed):** `research/
   geometry-batching.md`, working from a source-verified (git tag v6.7.3,
   `nm`-checked against the running `libkwin.so`) reading of KWin's code,
   found no cross-window geometry batching, deferral, or transaction
   primitive anywhere in KWin 6.7.3, in either the X11 or Wayland backend,
   and in neither the C++ nor the JS-facing API. The one candidate
   mechanism (`X11GeometryUpdatesBlocker`) is a per-window-only RAII
   helper, unreachable from JS but also unreachable in any way that would
   help a cross-window tiling workload -- so the JS/native asymmetry that
   would have been the strongest remaining architectural argument for
   native does not exist to begin with.

**What this does and does not establish.** "No accepted evidence supports
building native for discrete window management" is the honest summary; it
is not the same claim as "native would provide no benefit under any
circumstances," and it is silent on sustained per-frame workloads (see
"Scope of this verdict" above). This milestone's scope was two specific
stateless/stateful test scripts driven by discrete add/remove events, four
window-count tiers, X11 and (for Variant B only) Wayland-native test
clients, and KWin 6.7.3. It does not rule out benefits from workloads,
APIs, or KWin versions this change did not exercise -- most notably the
three named above. Within the discrete-event scope actually measured,
though, every argument for native that this change's evidence base could
speak to -- compute speed, memory, and batching asymmetry -- is closed
against native, not merely untested.

Q1 (pop-in) does not feed this conclusion, per the spec's own scoping
(Section 8): it is an independent lifecycle finding, and unit-E's attempt
to observe it did not reach a measurement (Section 8) for a specific
tooling reason unrelated to the native-vs-JS question.

## 8. Q1: pop-in (independent lifecycle finding, does not feed the Decision Rule)

**Not measurable, for a specific tooling reason -- attempted live, with the
user present and ready to interact.** Full method and evidence in
`research/popin-observation.md` (unit-E). The attempt followed `research/
capture-method.md`'s Section 9 sketch: negotiate the PipeWire ScreenCast
portal (`CreateSession` -> `SelectSources` -> `Start`) with ASCII-only
tokens (avoiding unit-01's known token-validation crash), then attach
`gst-launch-1.0 pipewiresrc` to the resulting node. Negotiation stalled at
the first call: `CreateSession` returned a valid request object path with
no error, but the associated `Request.Response` signal never arrived (a
broad, pre-registered `dbus-monitor` listener confirmed this was not a
race), and the request object subsequently disappeared. The
`ScreenChooserDialog` never appeared and the user was never asked to click
anything -- the attempt did not get far enough to need their input.

**Diagnosis (reasoned, not source-verified):** this matches the general,
documented property of `org.freedesktop.portal.Request` objects being tied
to the D-Bus connection of the client that created them; `busctl call`
(and every other CLI D-Bus tool on this host) opens a new connection per
invocation and disconnects immediately after the synchronous method reply,
before the portal backend can complete the asynchronous negotiation. No
scripting-language D-Bus binding (`python3`, `perl`, `ruby`, `node`, all
checked live) is available on this host to build a persistent-connection
client without installing a new package, and writing one in Rust was
rejected as out of `spec.md`'s explicit Non-Goals ("no Rust code in this
change"). This is a tooling-availability finding, not a pop-in observation
of any kind -- it says nothing about whether KWin presents an intermediate
incorrect-placement frame, and per the spec's own constraint it is recorded
as "not measurable" rather than replaced with a timing-based proxy.

Per `spec.md`'s own framing (design doc L328-357), Q1's answer -- whenever
and however obtained -- applies identically to JS and native
implementations, since `Workspace::windowAdded` fires after KWin's own
placement decision for both. Q1 remaining unmeasured therefore does not
weaken this report's Section 7 conclusion, which never depended on it.

**Closure (formal, per user decision):** Q1 is closed as **not
measurable**, for the specific tooling reason documented above and in
`research/popin-observation.md`. No further attempts at this
observation are authorized within this change's scope.

**Available inference (labelled as inference, not observation, and not a
substitute for it):** across every Q2 measurement in this report, the
`windowAdded` handler's own execution -- placement-relevant logic included
-- completes within the 1 ms `Date.now()` clock floor established in
Section 2, against a 16.667 ms frame budget (Section 1). This makes it
unlikely that a script-driven correction is itself slow enough to be
presented as a separate, visibly incorrect frame before the corrected
geometry lands. This is an inference from handler-completion timing, not
an observation of what the compositor actually presents to the display,
and per the spec's own constraint (Section 8, above) it is not treated as
a substitute for the unobtained direct observation. It is recorded here so
the inference is visible without being confused for the closed
measurement.

## 9. Validity caveats (consolidated)

- **Clock resolution (Section 2):** `Date.now()` is 1 ms integer
  resolution; the spec's thresholds fall inside an unresolvable
  0.4-1.5 ms band. Materially affects Variant A's timing verdict (Section
  4.1); does not affect Variant B's (magnitudes too large to be
  quantization).
- **JIT warmup / first-run effects:** not separately isolated in this
  sweep -- each tier's log is one continuous run from the first spawned
  window, and no first-N-events-discarded comparison was performed. Given
  Variant A's uniformly flat 0-2 ms readings across all tiers and Variant
  B's cost being driven by the column-width bimodal mechanism (Section
  3.2) rather than by event ordinal position, warmup effects are not
  visually evident in the raw data, but this was not rigorously tested
  and is reported as an open item, not a ruled-out one.
- **Harness-window realism:** all measured events are caused by
  `xterm`-under-XWayland test windows of one fixed class
  (`PlasmaAutoTilerTestWindow`), not native-Wayland or GUI-toolkit
  application windows. Whether these exercise the same KWin placement/
  geometry-write path as a real GTK/Qt application is not independently
  verified beyond the smoke test's confirmation that `frameGeometry`
  writes visibly take effect (`log.md`, smoke-test entry).
- **Terminal-protection scope restriction (deliberate deviation, per the
  spec's Timing Resolution amendment):** both scripts act only on windows
  matching one specific `resourceClass`, a safety control required by the
  Orchestrator's live-session authorization, not a sampling choice. It
  guarantees no real window (including the controlling terminal) was ever
  touched; it also means every measured event in this report comes from
  the harness's own synthetic windows exclusively, reinforcing (not adding
  to) the harness-realism caveat above.
- **Synthetic spam vs. real usage:** all 100-window tiers were created by
  a rapid scripted burst (0.5 s between spawns), not organic user behavior
  over time. The p95/p99 figures should not be read as representative of
  a typical user's window-opening cadence, only of KWin's/the script's
  behavior under that specific synthetic load pattern.
- **Variant B layout algorithm and removal-handling choices:** the columns
  algorithm's integer-division width bucketing directly causes the
  bimodal timing pattern in Section 3.2; a different (e.g. master-stack)
  algorithm would very likely show a different -- not necessarily smaller
  or larger -- pattern. The p95/p99 numbers are specific to this
  algorithm choice and are not claimed to generalize to all possible
  reconciliation algorithms. Removal timings are pooled from a burst
  teardown (Section 3.2) and likely undercount steady-state single-window
  removal cost.
- **RSS cross-variant confound (Section 6):** Variant A and Variant B
  produce differently-sized test windows by construction (half-output-
  width vs. shrinking columns), so the RSS delta comparison between them
  is not a clean isolation of "script/reconciliation memory cost." The
  ~250 KB script-load-only figure is the one clean cross-variant
  comparison available.
- **Q1 not measurable** (Section 8): a live attempt, with the user present
  and ready, stalled on portal negotiation tooling before reaching the
  point of asking for user interaction. Not a substitute for, and not
  evidence about, whether pop-in actually occurs.
- **Wayland-native revalidation coverage is partial:** `research/
  wayland-revalidation.md` (unit-D) re-measured Variant B only, and only at
  N=20 and N=50 (not N=5 or N=100). Variant A was never re-measured under
  Wayland-native clients at any tier (Section 4.1). The Wayland-native
  test client used was `konsole` exclusively -- one Qt/KDE toolkit, one
  application -- not a range of toolkits or real applications.
- **The corrected (non-idempotent) amplification calibration was never
  run:** the amplification methodology's flaw (Section 4.1, `research/
  timing-attribution.md` Section 5) was identified but a fix (alternating
  between two distinct target rects each iteration, forcing a genuine write
  every time) was never implemented or measured, for either variant. This
  is why Variant A's timing verdict remains inconclusive rather than
  resolved in either direction.
- **The amplification cross-check as originally run measures no-op-skip
  cost, not genuine write cost**, for both variants (Section 4.1, 5.1,
  5.2) -- this reclassifies what Section 5's figures represent without
  changing the raw numbers themselves.

## 10. Krohnkite/Polonium comparison

Deferred out of this change's scope, as recorded in `spec.md`'s Non-Goals
and Consequential Decisions: those are third-party JS tiling scripts with
their own architecture, and comparing against them is a separate, larger
measurement exercise that depends on this baseline existing first. Not
attempted here.
