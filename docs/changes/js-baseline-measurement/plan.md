# Plan: JS Baseline Measurement (KWin windowAdded pop-in and overhead)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-09 by Orchestrator (amendment for Variant B and
  invasive/non-invasive unit split applied per Orchestrator instruction)

## Technical Approach

Two instrumented `.js` files, both loadable directly via
`org.kde.kwin.Scripting.loadScript`/`unloadScript` over D-Bus (no
`.kwinscript` packaging needed for direct-load testing):

- **Variant A (stateless):** design doc Test A (L388-405). `windowAdded ->
  compute trivial deterministic tiled rectangle -> moveResize`. Logs
  per-event wall-clock time to a plain file.
- **Variant B (stateful):** maintains a managed-window map; on every
  `windowAdded`/`windowRemoved`, reconciles the full layout (simple columns
  or master-stack split) and writes geometry for every managed window. Logs
  per-triggering-event wall-clock time (covering all geometry writes it
  causes) to a plain file, same log format as Variant A.

A shell-tool harness (per repo shell-tooling preference: combine existing
CLI tools, avoid scripting languages unless necessary) drives window counts
of 5/20/50/100 using a minimal spawnable client, samples `kwin_wayland` RSS
via `ps`/`smem` before and after script load at each tier, and orchestrates
script load/unload around each run. The harness is variant-agnostic: it
takes a script path as a parameter.

**Invasive vs. non-invasive split (per Orchestrator's mandatory stop
instruction):** units that only write code, do research, or run in a
dry-run mode that never loads a script into the live `kwin_wayland` or
spawns a test window are dispatched immediately. Units that load a script
into the live compositor or spawn/close real windows are not dispatched
until the Lead has stopped, described concretely what will happen and how
it is reversed, and the Orchestrator has authorized it. Frame-presentation
capture-method research (unit-01) is research/tooling validation against
ordinary, already-happening desktop activity (e.g. cursor movement) or
generic portal capability checks; it must not spawn a test window or load
a script, and if it hits a GUI consent dialog requiring human interaction,
it stops and reports rather than attempting to interact with it.

Every invasive unit ends by unloading its script and/or closing spawned
windows and confirming `kwin_wayland` still responds to
`org.freedesktop.DBus.Peer.Ping`, so session-safety is checked
incrementally, not only once at the very end.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|
| unit-01 | Research and validate a frame-presentation capture method for Q1 (PipeWire ScreenCast via ffmpeg/obs/pw-record, or an alternative found during research) using only generic/already-happening compositor activity; determine feasibility and document limitations. Must not spawn a test window, load the tiler script, or interact with a GUI consent dialog (stop and report if one appears) | - | `docs/changes/js-baseline-measurement/research/capture-method.md`; throwaway capture artifacts kept only if small and cited, otherwise discarded | No | Documented pass/fail: either a reproducible capture procedure is demonstrated against generic activity (with the specific plan for how it will be pointed at a real pop-in scenario in unit-05), or the attempt is documented as unreliable/infeasible with the specific technical reason (e.g. mandatory interactive consent). No devenv/system changes. |
| unit-02 | Write the Variant A (stateless) script: `windowAdded` handler computes a trivial deterministic tiled rectangle and calls `moveResize` immediately, logging per-event wall-clock time (start/end via a monotonic clock) to a file | - | `docs/changes/js-baseline-measurement/script/variant-a.js`; `docs/changes/js-baseline-measurement/README.md` with exact load/unload D-Bus commands and the log format, shared by both variants | No | Static review only in this unit: code reviewed for correctness against the spec's Variant A description, valid JS syntax confirmed by a syntax-only check (no live KWin load). Live load/unload smoke test happens in unit-05, not here. |
| unit-03 | Write the Variant B (stateful) script: managed-window map, full reconciliation (simple columns or master-stack split) on every `windowAdded`/`windowRemoved`, geometry write for every managed window, same per-event timing log format as Variant A | - | `docs/changes/js-baseline-measurement/script/variant-b.js`; README updated with Variant B's chosen layout algorithm and removal-handling choice (per spec Unresolved Questions) | No | Static review only in this unit: code reviewed against the spec's Variant B description (full reconciliation, N geometry writes per event, add and remove both trigger it), valid JS syntax confirmed by a syntax-only check. Live load/unload smoke test happens in unit-06, not here. |
| unit-04 | Build the window-creation-and-teardown harness with an RSS sampling step, supporting a `--dry-run` mode that prints the exact sequence of actions (spawn commands, teardown commands, RSS sample points, script load/unload points) for N in {5,20,50,100} without executing any of them against the live session | - | `docs/changes/js-baseline-measurement/harness/run.sh` (or a small set of scripts under `harness/`) | No | `--dry-run` output reviewed for N=5, 20, 50, 100: correct window counts, correct teardown counts, RSS sample points placed before/after script load, no command in the dry-run trace actually invoked. Live execution happens in unit-05/unit-06, not here. |
| unit-04a | **[Live-session, non-invasive apart from one bounded probe]** Timing-resolution amendment: (1) empirically probe what clocks the KWin `loadScript` QJSEngine actually exposes via a one-shot, no-window-touching live diagnostic script; (2) if no sub-ms clock exists, add an opt-in, off-by-default synthetic amplification measurement to both variant scripts, kept strictly separate from the real per-event distribution; (3) add the Orchestrator-mandated live-session safety infrastructure required before unit-05/unit-06 can run: a terminal-protection `resourceClass` filter (fail-inert default) and a fail-safe watchdog (bounded-lifetime self-disarm) in both variant scripts, plus a documented and verified manual non-GUI recovery command | unit-02, unit-03 | `script/clock-probe.js`, `research/clock-resolution.md`, `script/variant-a.js`, `script/variant-b.js` (amended twice: amplification, then safety filter/watchdog), `README.md` (multiple new sections), `spec.md` (Timing Resolution and Live-Session Safety Amendment section) | Partially -- the clock probe is a one-shot script with no signal connections and touches no window, authorized as bounded live-session work; no test window was spawned by this unit | Clock probe loaded/started/unloaded with `isScriptLoaded` false and `kwin_wayland` Ping succeeding afterward, evidence in `research/clock-resolution.md`; real-dispatch measurement blocks in both variant scripts hash-verified byte-for-byte unchanged by both amendments; `node --check` and ASCII-only checks clean on every touched file; safety filter defaults verified inert (sentinel value matches no real window) and watchdog mechanism verified against KWin 6.7.3 source, not assumed |
| unit-05 | **[Live-session, stop before dispatch]** Load Variant A into live `kwin_wayland`, run a 1-window smoke test (validates script behavior and, using unit-01's method if viable, whether a pop-in frame is observed for a real event), then run the full sweep (5/20/50/100 windows) via unit-04's harness, collecting the timing distribution, RSS delta, Q1 observation, and synthetic amplification figure per tier; unload the script and verify `kwin_wayland` responsiveness | unit-01, unit-02, unit-04, unit-04a | `docs/changes/js-baseline-measurement/results/variant-a/` (raw per-tier data files only, no interpretation) | Yes | Four result records exist (one per tier), each containing: full timing distribution (min/median/p95/p99/max), RSS delta, a Q1 observation outcome (observed / not observed / not measurable, with reason), and the synthetic amplification figure (separately labeled); `isScriptLoaded` false and `kwin_wayland` Ping succeeds after unload, recorded in the run log |
| unit-06 | **[Live-session, stop before dispatch]** Same procedure as unit-05, for Variant B | unit-01, unit-03, unit-04, unit-04a, unit-05 (run after unit-05 so the live-session risk is taken once at a time, not concurrently) | `docs/changes/js-baseline-measurement/results/variant-b/` | Yes | Same evidence shape as unit-05, for Variant B |
| unit-07 | Write the findings report: state measured refresh rate and frame budget; present each variant's per-tier distribution against the frame budget; apply the spec's Q2 decision rule separately to Variant A and Variant B and state an explicit verdict for each, plus the combined interpretation; report the Q1 finding and its non-bearing on the native/JS decision; report the synthetic amplification figures as a separate, clearly-labeled metric per the spec's Timing Resolution amendment; document validity caveats (JIT warmup, harness-window realism, synthetic spam vs. real usage, Variant B's algorithm/removal-handling choices, the clock-resolution unresolvable band, the terminal-protection scope restriction); state the Krohnkite/Polonium deferral | unit-05, unit-06 | `docs/changes/js-baseline-measurement/findings.md` | No | Findings report reviewed by Lead against every spec acceptance criterion; each criterion traced to a specific number, table, or statement in the report |

Only the Lead mutates plans and state. Semantic unit IDs are stable;
execution slices use `unit-<n>/attempt-<n>`.

## Live-Session Stop Points

Per Orchestrator instruction, unit-05 and unit-06 are not dispatched until
the Lead stops and reports to the Orchestrator, concretely describing what
will happen (script(s) to be loaded, number of windows to be spawned, what
capture tooling if any will run) and how each step is reversed, and the
Orchestrator authorizes it. This authorization was explicitly withheld in
the current instruction and must be requested fresh before unit-05 is
dispatched.

## Progress

- [x] unit-01 Capture-method research and non-invasive validation
- [x] unit-02 Variant A (stateless) script
- [x] unit-03 Variant B (stateful) script
- [x] unit-04 Harness (dry-run mode)
- [x] unit-04a Timing-resolution and live-session safety amendment
      (Orchestrator-approved 2026-08-09; formalized into this table and into
      `spec.md`'s new "Timing Resolution and Live-Session Safety Amendment"
      section on the same date)
- [x] unit-05 Variant A live sweep (smoke test + 4-tier sweep + amplification
      calibration complete, 2026-08-09; `results/variant-a/`)
- [x] unit-06 Variant B live sweep (4-tier sweep + amplification calibration
      complete, 2026-08-09; `results/variant-b/`)
- [x] unit-07 Findings report, first pass (`findings.md` written 2026-08-09
      with Q2 verdicts later found unsound; superseded by unit-F below,
      same day)

Follow-on investigation phase (not in the original Work Units table above;
opened because unit-07's first-pass Q2 verdicts were found methodologically
unsound and required resolution before the change could conclude; semantic
IDs assigned by the Leads who ran them, tracked here for a complete record):

- [x] unit-A `state.md` created (successor-Lead housekeeping; had been
      missing across three prior Lead attempts)
- [x] unit-A (cont.) Q2 attribution analysis prompted a CONTESTED notice on
      `findings.md` Sections 4.1/4.2/7, pending further research
- [x] unit-B Timing-attribution research (`research/timing-attribution.md`):
      found the amplification calibration invalid (idempotent no-op) and
      Variant B's large real-dispatch figures attributable to KWin's own
      X11/XWayland compositor cost, not JS
- [x] unit-C Geometry-batching research (`research/geometry-batching.md`):
      source-verified (KWin 6.7.3 tag) no cross-window geometry batching
      primitive exists in KWin, closing the batching-asymmetry argument
- [x] unit-D Wayland-native revalidation (`research/
      wayland-revalidation.md`): live re-measurement of Variant B under
      genuinely Wayland-native clients confirms the X11 attribution and
      shows the large figures vanish entirely under Wayland
- [x] unit-E Q1 frame-presentation capture attempt (`research/
      popin-observation.md`): live attempt, user present and ready;
      recorded as not measurable for a specific portal-tooling reason
      before the user was ever asked to interact with anything
- [x] unit-F Findings rewrite (this stint): `findings.md` Sections 4.1, 4.2,
      and 7 rewritten to a final, non-contested verdict integrating
      unit-B/C/D/E; this Progress section and the Final Outcome section
      below reconciled against each other
- [x] unit-G Verdict-scoping correction (Orchestrator-approved, next stint):
      `findings.md` Section 7 verdict narrowed to explicitly scope it to
      discrete window management (the only workload this milestone
      measured), with a new "Scope of this verdict" statement naming three
      untested workloads (tight polling loops, sustained per-frame
      repositioning, GC under sustained allocation pressure) now handed to
      `docs/changes/sustained-workload-validation/`; Q1 formally closed as
      not measurable with no further attempts authorized, and the
      handler-completion-vs-frame-budget inference recorded, explicitly
      labelled as inference, in `findings.md` Section 8

## Pending User Decisions

- None outstanding. Q2 thresholds, Q1 scoping, and the Krohnkite/Polonium
  deferral were confirmed by the user with the Variant B amendment; see
  spec.md Consequential Decisions.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Refresh rate measured, frame budget stated | findings.md Section 1 (60.00 Hz, 16.667 ms, measured via `kscreen-doctor -o` during the live sweeps) |
| Triggering-event timing distribution at 5/20/50/100 windows, both variants | unit-05/unit-06 results files (`results/variant-a/`, `results/variant-b/`); summarized in findings.md Section 3 |
| Frame-presentation capture method implemented-and-used, or documented as unavailable/unreliable with the specific reason | unit-01 `research/capture-method.md` (feasibility research); unit-E `research/popin-observation.md` (live attempt, user present and ready; recorded not-measurable for a specific portal-tooling reason before any user interaction was needed); findings.md Section 8 |
| RSS delta at 5/20/50/100 windows, both variants, Variant B primary for memory verdict | unit-05/unit-06 results files; unit-D `research/wayland-revalidation.md` (Wayland-native RSS at N=20/50); findings.md Sections 4.1, 4.2, 6 (memory-confound reasoning that closes the RSS argument for native, see unit-F) |
| Findings apply decision rule separately per variant with explicit verdicts | findings.md Sections 4.1 (inconclusive on timing, JS-sufficient on clean RSS), 4.2 (JS-sufficient, reversed from the original native-justifying call), 7 (combined: no accepted evidence for native); rests on unit-B `research/timing-attribution.md`, unit-C `research/geometry-batching.md`, unit-D `research/wayland-revalidation.md` |
| Script load/unload reversibility verified at least once per variant after the sweep, `kwin_wayland` responsive afterward | unit-05/unit-06 run records (responsiveness checks); unit-E additionally re-verified live-session cleanliness (isScriptLoaded false, Ping OK, no leaked processes) even though its attempt never reached the point of loading a script |
| Validity caveats documented (JIT warmup, harness-window realism, clock resolution, terminal-protection scope) | findings.md Section 9, extended by unit-F with the Wayland-coverage-is-partial and uncorrected-amplification-calibration caveats |
| Krohnkite/Polonium deferral stated | findings.md Section 10 (unchanged, not disputed by any research file) |

## Residual Risks

- Frame-capture method may prove infeasible without interactive,
  unattended-unfriendly consent flows (portal-based ScreenCast); if so, Q1
  is answered as "not measurable" per spec, which is an acceptable outcome
  under the acceptance criteria but weakens the overall evidence package.
- Harness-spawned windows may not exercise the same KWin placement path as
  real applications, limiting how far the results generalize; flagged as a
  validity caveat rather than silently ignored.
- All measurement runs in unit-05/unit-06 execute against the user's live
  Plasma session; each such unit includes an explicit reversibility check,
  but a crash or hang during a run is still a real risk, which is why
  those units are gated on a fresh Orchestrator authorization rather than
  proceeding automatically once earlier units are accepted.
- Variant B's reconciliation algorithm is deliberately simple; a
  JS-sufficient result on Variant B narrows but does not eliminate every
  possible architectural argument for native (see spec.md Decision Rule
  caveat).

## Final Outcome

**Corrected 2026-08-09 (unit-F) -- this section previously contradicted the
Progress checklist above** (it read "unit-04 not yet dispatched, unit-05/06
unauthorized, unit-07 not started," evidently never updated by the Lead(s)
who actually ran those units; flagged as a discrepancy in `state.md` by an
intervening Lead and left uncorrected until now, per that Lead's own scope
limits).

**Actual final outcome:** unit-01 through unit-07 (the original Work Units
table) all completed and accepted, live-measured against the user's real
Plasma 6.7.3 Wayland session on 2026-08-09. unit-07's first-pass verdicts
(Sections 4.1/4.2/7 of `findings.md`) were subsequently found
methodologically unsound (the amplification calibration was invalid; the
Variant B "native-justifying" reading attributed KWin's own compositor
cost to JavaScript) and were carried under a CONTESTED notice pending
review. The follow-on units (unit-A through unit-F, see Progress above)
resolved this: `research/timing-attribution.md`, `research/
geometry-batching.md`, and `research/wayland-revalidation.md` together
established that none of the three arguments this change's evidence base
could speak to for a native C++/Rust KWin plugin -- compute/dispatch
speed, memory, and cross-window geometry-batching asymmetry -- survive;
`research/popin-observation.md` (unit-E) attempted Q1 live, with the user
present and ready, and recorded it not-measurable for a specific
portal-tooling reason without ever needing the user's interaction;
unit-F rewrote `findings.md` Sections 4.1, 4.2, and 7 into a final,
non-contested verdict and reconciled this section against the Progress
checklist. The change's milestone question -- does measured evidence
justify or kill the proposed native architecture -- is answered: **no
accepted evidence from this change supports building it**, within the
scope and caveats stated in `findings.md` Section 9. This is the change's
terminal technical outcome; remaining administrative steps (Orchestrator
alignment review, user result approval, archive/completion transaction)
are outside a Lead's authority and are for the Orchestrator per the
completion transaction procedure.
