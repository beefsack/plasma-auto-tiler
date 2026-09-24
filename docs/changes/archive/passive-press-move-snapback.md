# Passive resize press and move-drop snap-back

## Goal and scope

User-approved 2026-09-24: observe the configured modifier-resize button press
passively in the unified native effect, classify that press by KWin 6.7.5
thirds, and use the 64 px Started-pointer gate only when no fresh matching
press exists. Keep frame-edge nearest-edge and 16 px corner behavior. For
interactive tiled moves, hold ordinary reconciliation until finish and restore
the retained domain on drop using the existing coalesced one-shot marker;
floating moves remain untouched. Drag-to-reorganise is a later backlog item.

## Approach and acceptance

- Use a public passive input spy for press position/button/modifiers and the
  public effective modifier-resize binding, with a logged default only when
  that binding is unavailable. Match the exact native window at resize start,
  with a bounded monotonic press-to-start lifetime and single use; otherwise
  log and use the old 64 px classifier. Include the matched press in the
  existing oracle verdict, so one D-Bus reply carries atomic geometry,
  correlation and press evidence. Keep native identifiers out of logs.
- On a tiled move, suppress competing ordinary reflow during the gesture and
  arm one correlated domain restore at drop; no retry after failed dispatch.
  A floating move remains native-only.
- Regress trace drags 27/28/32/33/35 and physical corners 24/25; missing,
  stale and wrong-window press fallback; trace Kate moves 29-31 with no
  mid-move reconcile or parking and one drop restoration; floating moves.
- Verify host-matched native build and native tests; Rust workspace tests,
  format, Clippy, portable check; KWin typecheck, tests and build. Independent
  native-to-adapter/freshness/marker review. No live mutation, Git staging or
  commit.

## Outcome and evidence

Read-only trace diagnosis: all five Meta+right corner misses started 40-54 px
from the nearest frame edge, so the 64 px gate chose one axis while KWin moved
left and bottom. Physical corners 24/25 remained within 16 px of both edges.
Kate's moves 29-31 were ignored by the oracle route after ordinary mid-move
reconciles parked; a later three-window reconcile restored it. Separate p13
36 px bottom-edge shortfall is not investigated in this change.

The native effect now observes only public passive `InputEventSpy` press edges,
reading KWin's effective `commandAllModifier` and resize mouse-button slot.
Only when options are unavailable does it use and log the KWin 6.7.5 source
default (Alt+right). One overwritten candidate must match the same live
effect window and internal identity within two monotonic seconds, preceding
the resize start; it is consumed once. The existing `DragOracle1.LastVerdict`
JSON carries optional finite press coordinates and a bounded binding token
atomically with the verdict correlation, avoiding a second asynchronous
endpoint read. Coordinates and native identities never enter normal logs.
Strict malformed verdicts remain fail-closed rather than being treated as a
missing optional press; valid verdicts without usable press fall back with a
correlated log. Regressions use exact trace rectangles and Started pointers
for drags 27/28/32/33/35 and physical corners 24/25.

The adapter holds ordinary reconcile during a tiled move, then lifts that
move's hold and binds an `ok-moved` verdict to the existing coalesced marker
(`move-dropped`). A bounded unavailable-verdict release uses normal
resync without fabricating a correlated terminal. Simultaneous moves share
one marker; an idle pump dispatches it after the last hold clears, including
when no ordinary plan was required. Moves starting floating are not held or
restored, even when the native float state changes mid-gesture. Tests replay
actual movement during Kate 29-31 and verify no mid-move reconcile or parking.

Independent review confirmed native/FFI layout and correlated consumption,
identified strict malformed-press behavior (retained intentionally) and
floating transition ownership (resolved with start-state binding, single-use
release and regressions). Live KWin press-to-effect delivery is unverified.
Checks: Rust workspace 593 passed; cargo fmt, Clippy (pre-existing warnings
only), portable check passed; KWin typecheck/build and 808 tests passed;
host-matched native build and 27 native CTests passed. No session/native
installation, host mutation, Git staging or commit. For live acceptance, deliver
the rebuilt unified effect using the reviewed project dev path, log out and
back in (no native hot reload), then check Meta+right shallow left+down,
physical corners, configured binding/fallback logs, tiled Kate move snap-back
without parking, floating move freedom, and focus retention.
