# State: Sustained Workload Validation (KWin transform animation, extension-point asymmetry, GC behaviour)

- Current major unit / attempt: unit-01 (Q-A extension-point asymmetry
  research) accepted after source-only completion. No later unit has been
  dispatched.
- Execution status: paused pending the active
  [integrated-plasma-structural-feasibility gate](../integrated-plasma-structural-feasibility/),
  which implements the archived audit's scoped strong-justification next gate.
  Its active status does not resume this change. This does not alter accepted
  Q-A, the approved Q-B amendment, thresholds, or unit definitions.
- Completed units: unit-01. `research/extension-point-asymmetry.md` now has
  an explicit Q-A verdict: no decisive or narrow native-only capability is
  established. `.js` ScriptedEffect provides paint transforms; QML declarative
  effects provide continuous touchpad/touchscreen swipe progress. Their
  co-use in one effect remains an implementation-feasibility caveat, not an
  API asymmetry.
- Governance: `spec.md` and `plan.md` are user-approved. Stale pending-
  confirmation wording for the already-approved Q-B and Q-C thresholds was
  corrected without changing their values, acceptance criteria, sequencing,
  or scope.
- Q-B amendment: user approved `ScriptedEffect` paint transforms as the
  transform-first primary workload, based on accepted unit-01 evidence. A
  read-only, authoritative presentation-timestamp source is now a mandatory
  prerequisite; without it, Q-B is not measurable under the approved criteria
  without C++ compositor instrumentation. A one-time final geometry commit is
  separate, while per-frame geometry writes are controls only and not
  native-vs-JS evidence. The 10% p99 threshold and three-consecutive-dropped-
  frames failure remain unchanged and are now computed from presentation
  intervals.
- Required artifacts: `log.md` was missing despite this active Expanded
  change. It was created with this Lead-owned reconciliation checkpoint.
- Live-session safety: directly verified during reconciliation. Known KWin
  test script plugin names report `isScriptLoaded=false`; no xterm or konsole
  harness test-window processes or LogSink capture remain; KWin answered
  `org.freedesktop.DBus.Peer.Ping`.
- Next dispatch: none while paused. The active feasibility gate must complete
  before this change can be reconsidered. Unit-02 and all Q-B/Q-C work remain
  unstarted; Q-B unit-03 must complete the presentation-timestamp prerequisite
  before a harness is scoped, and every live-session unit retains its
  stop-before-dispatch gate.
