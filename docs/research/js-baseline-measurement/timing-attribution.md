# Research: Timing Attribution for Q2 Real-Dispatch Measurements

Status: New analysis, non-invasive (source reading + re-analysis of existing
raw log files only; no new live captures). Written to resolve the
four-orders-of-magnitude contradiction between `findings.md`'s real-dispatch
distributions and its synthetic amplification figures. **This document
contests `findings.md`'s per-variant verdicts
in Sections 4.1 and 4.2; those verdicts should be treated as not settled
until this analysis has been reviewed.**

## 1. What the instrumented window actually encloses

Direct source reading, both variants (`script/variant-a.js:98-118`,
`script/variant-b.js:67-80`):

```
var start = Date.now();
<compute + N x window.frameGeometry = rect>   // reconcile() for variant B
var end = Date.now();
<build log line>
callDBus(...)                                  // AFTER end is captured
```

**Item 3 (logging overhead) is definitively excluded from the measured
window in both variants** -- `end` is captured before the log line is built
or `callDBus` is invoked. This is confirmed by direct code reading, not
inferred. Logging overhead is not part of the four-orders-of-magnitude
contradiction and can be ruled out entirely.

**Item 4 (anything else):** nothing else is inside the window. The
`start`/`end` pair brackets exactly: for Variant A, one `Object.assign` +
one `frameGeometry` write; for Variant B, `reconcile()`'s loop of N
`Object.assign` + N `frameGeometry` writes. So the only two candidates for
where the time goes are item 1 (pure JS compute: the loop, `Object.assign`,
arithmetic) and item 2 (the `frameGeometry` setter's round-trip into KWin).

## 2. Natural-experiment separation of item 1 vs item 2

Variant B's `reconcile()` (`script/variant-b.js:49-65`) always iterates over
every managed window and always calls `win.frameGeometry = rect` for each
one, regardless of whether the computed rect differs from the window's
current geometry. The JS-side work (loop, `Object.assign`, arithmetic,
property assignment call) is therefore identical whether or not the target
geometry actually changes. `findings.md` Section 3.2 already noted a
bimodal pattern correlated with whether the columns layout's integer-
division width changed between consecutive window counts, but the previous
analysis did not independently re-verify the reported breakdown numbers
("not independently re-derived ... not separately re-verified"). That
re-derivation was done here, directly from
`results/variant-b/tier-100.log` (`windowAdded` events only, in spawn
order), classifying each event as `CHANGE` (columns width differs from the
previous window count) or `SAME` (width unchanged) using the same
`floor(1536/count)` formula as `script/variant-b.js:55`:

| Group | n (events) | mean n (windows/event) | min | median | p95 | p99 | max | mean elapsed |
|---|---|---|---|---|---|---|---|---|
| CHANGE (geometry differs) | 63 | 35.4 | 1 | 29 | 107 | 526 | 526 | 42.9 ms |
| SAME (geometry unchanged) | 37 | 76.2 | 0 | 1 | 5 | 88 | 88 | 3.4 ms |

This reproduces the previous unverified breakdown numbers exactly
(n=63/37, median 29/1, p95 107/5, p99 526/88, max 526/88), now independently
confirmed against the raw file rather than taken on trust.

**The critical control:** the SAME group has a *higher* mean window count
per event (76.2 vs 35.4) -- i.e., on average it does *more* JS loop
iterations, *more* `Object.assign` calls, *more* property-assignment calls
than the CHANGE group -- yet it is ~12.7x *cheaper* in wall time (3.4 ms vs
42.9 ms mean). If item 1 (JS loop/compute cost, scaling with iteration
count) were the dominant cost, the SAME group should cost *more*, not less,
given it does more iterations on average. It costs less. This is strong,
direct evidence against JS compute being the dominant cost, using the
experiment's own data as a natural control (same code path, two outcomes),
not an external assumption.

## 3. What differs between CHANGE and SAME: confirmed via KWin source

The only thing that differs between a CHANGE and SAME event is what happens
inside KWin's C++ handling of the `frameGeometry` property setter. KWin's
own source (invent.kde.org/plasma/kwin, confirmed via public commit
history, e.g. commit `21a45c27` and the `updateServerGeometry()` mechanism
referenced in commit `dfa08f22`) implements exactly this optimization for
X11/XWayland windows (the class of window used by this change's `xterm`
test harness, per the Terminal-protection scope restriction and
`research/capture-method.md`): `X11Window::updateServerGeometry()` tracks
the last-configured geometry per window (frame, wrapper, and client X
windows) and **only issues XCB configure requests to the X server when the
new geometry differs from what was last configured; matching geometry is
skipped**. This is a longstanding, general KWin optimization pattern (the
same "skip if `newGeom == frameGeometry()`" idiom recurs at multiple call
sites in the codebase per the same source search), not something specific
to one KWin version, so it is reasonable to expect it is present in the
KWin 6.7.3 build this project measured against, though the exact 6.7.3
source was not fetched and diffed line-by-line in this pass -- **stated as
a corroborating-but-not-line-verified source claim**, distinguished from
the directly-source-read claims in Section 1.

This gives a specific, source-grounded mechanism: a CHANGE event triggers
real X11 protocol round trips (ConfigureWindow requests to the frame,
wrapper, and client X windows, potentially x3 per window) for every managed
window; a SAME event triggers the property setter and an internal geometry
comparison for every window, but no protocol traffic, for any window whose
geometry didn't change.

## 4. Consequence for Variant B's "native-justifying" verdict

`findings.md` Section 4.2 attributes Variant B's large p95/p99/max figures
to reconciliation cost and concludes "native-justifying... robust... too
large to be measurement artifacts," implicitly treating this as evidence
that JavaScript-based reconciliation is too slow and a native rewrite would
fix it.

**This attribution is not supported by the evidence above.** The dominant
cost (Section 2-3) is KWin's own compositor-side handling of genuine
geometry changes -- X11 protocol round trips triggered by the
`frameGeometry`/`moveResize` C++ property setter, the same setter a native
C++/Rust KWin plugin would call to reposition the same windows. A native
plugin invoking `window->moveResize(rect)` (or the equivalent) N times to
reposition N real windows pays the same `X11Window::updateServerGeometry()`
path and the same X server round-trip cost; the X server does not process
`ConfigureWindow` requests faster because the caller is compiled code. On
this evidence, Variant B's large timings measure a compositor/protocol cost
that is **architecture-independent**, not a JavaScript-dispatch cost that
native code would eliminate.

This matches exactly the decisive scenario: "If the time is dominated by (2)
[moveResize round
trip], we measured KWin's own compositor work, which a native C++/Rust
plugin pays identically. In that case 'Variant B justifies native' is
wrong."

**One open question this analysis does not resolve:** whether native code
has access to a batching/deferral primitive not exposed to the KWin
scripting API that could coalesce the N per-window round trips into fewer
server round trips. KWin's source includes a `GeometryUpdatesBlocker`
RAII helper (surfaced during this research's source search) that appears to
defer/batch geometry commits for a *single* window across multiple
mutations within its scope; whether an equivalent exists or could be
extended to batch *across* multiple windows within one signal handler, and
whether it is reachable from `loadScript`-based JS at all, was **not
investigated** in this pass. If such a facility exists and is native-code-
only, that would be a genuine (if narrower and differently-reasoned)
architectural case for native -- not "JS is slow," but "the scripting API
lacks a batching primitive the C++ API has." This is flagged as an open
question, not resolved either way.

**Assessment: Variant B's "native-justifying" verdict, as reasoned in
`findings.md` Section 4.2, is not supported by the attribution evidence and
should be treated as reversed-or-inconclusive on the compute-speed
rationale it currently states**, pending resolution of the batching-API
question above. The raw magnitudes (up to 526 ms) are real and not clock
artifacts, but they are evidence about KWin's own compositor/X11-protocol
cost for repositioning many real windows, not about JavaScript being an
insufficiently fast implementation language.

## 5. Consequence for Variant A's "JS-sufficient" verdict

`findings.md` Section 4.1 dismisses Variant A's literal p95 = 2 ms reading
(which nominally crosses the 1.667 ms native-justifying threshold) in favor
of the synthetic amplification figure (0.0066 ms mean, ~300x smaller),
judging the amplification figure more credible.

**This amplification methodology is invalid as a calibration of genuine
write cost, for the same reason established in Sections 2-3.**
`runAmplified()` (`script/variant-a.js:41-84`) and
`runAmplifiedReconcile()` (`script/variant-b.js:101-137`) run strictly
*after* the real dispatch's log line is emitted -- i.e., after the real
write has already placed the window(s) at the target geometry -- and then
repeat the *identical* geometry computation against window(s) already at
that geometry. Every amplification iteration after the first (and, for a
deterministic computation against unchanged inputs, the first too, since
the real write immediately prior already applied it) lands in the SAME/
no-op path identified in Section 3: `Xcb::Window`'s last-configured-
geometry cache matches, so KWin skips the X server round trip. The
amplification figure is therefore a measurement of the **no-op-skip cost**,
not of genuine dispatch-and-write cost. It is corroborated by, not
independent of, this document's SAME-group figure: Variant A's
amplification mean (0.0066 ms/op, single-window) and Variant B's SAME-group
figure (0.034 ms per write, N averaged ~76) and Variant B's own low-N
amplification figures (0.006-0.026 ms per full small-N reconcile pass) are
all measuring the same quantity -- the cost of a `frameGeometry` write that
KWin recognizes as a no-op -- at different N. They agree with each other
for exactly that reason, not because they represent "true compute cost" in
general.

`findings.md`'s own explicit code comment basis for the amplification
design (`script/variant-b.js:92-93`: "`reconcile()` is idempotent, so
repeated calls write the same geometry and mutate no script state") was
written to justify safety/side-effect-freedom of the calibration loop, but
that same idempotency is exactly what makes it non-representative of a
genuine geometry-changing write.

**Assessment: the amplification cross-check `findings.md` Section 4.1 used
to override Variant A's literal reading is unsound, and the stated basis
for the "JS-sufficient" verdict should be retracted.** This does not
automatically make Variant A "native-justifying" -- the literal p95 = 2 ms
reading for a single genuine geometry change is itself within the clock's
stated ~0.4-1.5 ms unresolvable band (`findings.md` Section 2) and could
still be quantization-inflated -- but the specific argument previously used
to dismiss it is no longer valid. **Variant A's Q2 timing verdict should
be treated as inconclusive** (not JS-sufficient, not confidently native-
justifying) until a calibration that actually exercises a genuine,
non-idempotent geometry change (e.g. alternating between two distinct
target rects each amplification iteration) is run. That would require a
new live measurement and was not attempted in this pass (see Section 6).

## 6. What would resolve this further (not done in this pass)

- A corrected amplification/calibration pass where each iteration writes a
  *different* geometry from the previous one (e.g. toggling between two
  rects), so every iteration forces a genuine XCB round trip, would give a
  trustworthy per-genuine-write cost figure directly comparable to the
  literal real-dispatch numbers. This requires a new live script load and
  sweep; not attempted here (non-invasive analysis only, per this stint's
  scope).
- Whether `GeometryUpdatesBlocker` (or an equivalent) is reachable from the
  KWin scripting API, and whether using it would measurably reduce
  Variant B's CHANGE-group cost, is unresolved (Section 4) and would need
  either KWin scripting API documentation review or a live experiment.
- The exact 6.7.3 source for the geometry-skip guard was not fetched and
  diffed; the claim in Section 3 rests on public commit history for the
  same code path across nearby KWin versions, not a byte-verified 6.7.3
  read.

## 7. Summary

| Item | Verdict | Evidence |
|---|---|---|
| 1. Pure JS compute | Not the dominant cost | Section 2: SAME group does more iterations on average but costs 12.7x less |
| 2. `moveResize`/`frameGeometry` round trip | The dominant cost | Sections 2-3: bimodal pattern tracks exactly with genuine-vs-no-op geometry change, source-corroborated |
| 3. Logging overhead | Excluded entirely | Section 1: direct source read, `end` captured before `callDBus` |
| 4. Anything else | None found | Section 1: nothing else is inside the `start`/`end` window |

**Bottom line for the milestone's central question:** the measured Variant
B cost is real KWin/X11-protocol work that a native plugin would incur
identically via the same C++ API, not JavaScript overhead a native rewrite
would eliminate. `findings.md`'s Variant B "native-justifying" verdict and
Variant A's "JS-sufficient" verdict both rest on reasoning this document
finds unsound (Sections 4-5) and neither should be treated as settled. This
is not the same as concluding the opposite (JS-sufficient for B, or
native-justifying for A) -- the honest state is that this instrumentation,
as designed, cannot cleanly separate "compositor cost inherent to any
implementation" from "a batching opportunity only native code could take,"
and the amplification methodology cannot separate "no-op cost" from
"genuine-write cost." Both gaps are actionable (Section 6) but unresolved
in this pass.
