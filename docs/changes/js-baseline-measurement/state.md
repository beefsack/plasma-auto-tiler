
# State: JS Baseline Measurement (KWin windowAdded pop-in and overhead)

- Current major unit / attempt: unit-G (verdict-scoping correction),
  completed this stint, Orchestrator-approved. `findings.md` Section 7's
  verdict is now explicitly scoped to discrete window management (the
  only workload this milestone measured), with a new "Scope of this
  verdict" statement naming three untested workloads (tight polling
  loops, sustained per-frame repositioning/PaperWM-style scrolling, GC
  under sustained allocation pressure) now owned by the new change
  `docs/changes/sustained-workload-validation/` (unit-H/unit-I, same
  stint). Q1 is formally closed as not measurable, no further attempts
  authorized, with the handler-completion-vs-frame-budget inference
  recorded and explicitly labelled as inference (not observation) in
  `findings.md` Section 8. **This change stays open, not archived,
  pending milestone 2** (`sustained-workload-validation`) per explicit
  instruction -- do not run the completion transaction until milestone 2
  reports and the user reviews both together.
- Completed units (plan.md IDs, all `[x]` in the Progress checklist):
  unit-01 through unit-07 (original Work Units table), plus the follow-on
  investigation phase unit-A (state.md housekeeping), unit-B
  (timing-attribution research), unit-C (geometry-batching research),
  unit-D (Wayland-native revalidation), unit-E (Q1 capture attempt, this
  stint), unit-F (findings/plan rewrite, this stint). `plan.md`'s Progress
  checklist and Final Outcome section are now reconciled with each other
  (the previous contradiction, flagged by an earlier successor Lead, is
  corrected).
- Blockers: none. Q1 was attempted live this stint (user present and
  ready) and is recorded as not measurable for a specific tooling reason
  (see below) -- this is a closed, documented outcome per the spec's own
  fallback, not an open blocker requiring further live-session work.
- Final technical verdict (see `findings.md` Sections 4.1, 4.2, 7 for full
  reasoning): **no accepted evidence from this change supports building a
  native C++/Rust KWin plugin.** All three arguments the evidence base
  could speak to are closed against native:
  1. Compute/dispatch speed: Variant B's large real-dispatch figures were
     KWin's own X11/XWayland compositor-protocol cost
     (`research/timing-attribution.md`), confirmed by collapsing entirely
     under genuinely Wayland-native clients -- the platform matching the
     user's real session (`research/wayland-revalidation.md`). Variant A's
     own timing evidence is inconclusive (invalid calibration, never
     Wayland-revalidated), so no variant provides valid evidence FOR
     native either.
  2. Memory: the RSS deltas that nominally cross the spec's 15 MB
     threshold are confounded by per-window client backing-store size
     (architecture-independent); the one clean figure (script-load cost,
     ~250 KB) is negligible for both variants.
  3. Cross-window geometry-batching asymmetry: `research/
     geometry-batching.md` (source-verified against KWin 6.7.3 tag) found
     no cross-window batching/deferral/transaction primitive anywhere in
     KWin, X11 or Wayland, C++ or JS API -- the asymmetry argument does not
     exist to begin with.
  This is "no accepted evidence supports X," not "X is proven impossible" --
  `findings.md` Section 7 states this distinction explicitly and states the
  scope this milestone's evidence does and does not cover.
- Q1 (pop-in) result: **closed, not measurable**, for a specific tooling
  reason (`research/popin-observation.md`, unit-E; formally closed this
  stint per unit-G, `findings.md` Section 8). A live attempt was made in an
  earlier stint with the user present and ready to interact with the
  ScreenChooserDialog; the portal negotiation stalled at `CreateSession`
  (no `Request.Response` signal ever arrived, most likely because every
  CLI D-Bus tool on this host opens a new connection per call and
  disconnects before the portal's async negotiation completes, and no
  scripting-language D-Bus binding is available without a new package
  install) before the user was ever asked to click anything. No further
  attempts are authorized. `findings.md` Section 8 additionally records,
  explicitly labelled as inference and not observation, that handler
  completion inside the 1 ms clock floor against the 16.667 ms frame
  budget makes a separately-presented pre-correction frame unlikely --
  this is not a substitute for the closed observation.
- Next dispatch: **held open pending milestone 2, not a completion
  handover.** Per explicit instruction this change is not archived and the
  completion transaction is not run yet; `docs/decisions.md` is also not
  created yet, since the user is holding that decision until milestone 2
  (`docs/changes/sustained-workload-validation/`) reports. When milestone 2
  concludes, the Orchestrator should review both changes' findings
  together, obtain one combined user result approval, and only then direct
  a Lead to run the completion transaction for this change (promote
  lasting documentation, remove transient artifacts, archive the change,
  remove its backlog entry, verify links/repo status) per the
  processed-beef-orchestrate skill's Complete section.

## Key artifacts (for a successor's or the Orchestrator's quick orientation)

- `spec.md`: approved, Variant A (stateless) + Variant B (stateful)
  amendment, Q1/Q2 decision rules, Timing Resolution and Live-Session
  Safety Amendment (clock is 1ms-resolution `Date.now()` only). Not edited
  this stint (edits were proposed-to-Orchestrator only per standing
  instruction; none were proposed, since no spec-level change was needed
  to reach the final verdict).
- `plan.md`: unit table + Progress checklist, now including the follow-on
  units A-F; Acceptance-Criterion Evidence table rewritten to cite
  corrected sources; Final Outcome section rewritten to state the actual
  final technical outcome and reconciled with the Progress checklist.
- `findings.md`: **FINAL**, no longer CONTESTED. Sections 1-3, 5, 6, 10
  unchanged from the original report (not disputed by any research file).
  Sections 4.1, 4.2, 7 rewritten this stint to the final verdict described
  above. Section 8 (Q1) and Section 9 (caveats) updated to reflect
  unit-E's result and the Wayland-coverage/amplification-calibration
  caveats.
- `research/timing-attribution.md` (unit-B), `research/geometry-batching.md`
  (unit-C, source-verified against KWin 6.7.3 tag
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`), `research/
  wayland-revalidation.md` (unit-D, live Wayland-native re-measurement of
  Variant B): the three research files whose combined findings drove the
  `findings.md` rewrite. Each still stands as written; not edited this
  stint.
- `research/popin-observation.md` (unit-E, new this stint): the Q1 live
  attempt, its diagnosis, and the not-measurable verdict.
- `results/variant-a/`, `results/variant-b/`, `results/variant-b-wayland/`:
  raw per-tier data underlying all of the above; unchanged this stint.
- `script/variant-a.js`, `script/variant-b.js`, `script/clock-probe.js`,
  `script/window-enum-probe.js`; `harness/run.sh`, `harness/run-wayland.sh`:
  all implementation artifacts from earlier units, unchanged this stint.

## Live-session safety state (as of this stint's close)

Verified directly by this Lead after unit-E's Worker attempt (not assumed
from the Worker's own report): `kwin_wayland` responds to
`org.freedesktop.DBus.Peer.Ping` (exit 0); `xdg-desktop-portal` (the portal
frontend) also responds to `Ping` (exit 0) and did not crash during unit-E's
attempt (unlike unit-01's earlier SEGV); both `plasma-auto-tiler-variant-a`
and `plasma-auto-tiler-variant-b` report `isScriptLoaded=false`; no leaked
`konsole`/`dbus-monitor`/`gst-launch-1.0` processes (`pgrep`, all no match);
no leftover portal `request` objects in `org.freedesktop.portal.Desktop`'s
object tree. unit-E never loaded a script or spawned a test window, so
there was nothing invasive to reverse beyond the portal negotiation
artifacts checked above. No `devenv.nix` change, no package installed, no
Rust code written this stint.
