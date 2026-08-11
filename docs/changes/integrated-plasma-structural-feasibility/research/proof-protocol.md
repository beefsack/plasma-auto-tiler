# Staged Reversible Proof Protocol: unit-04/attempt-02

Exact staged state-machine protocol for `unit-04/attempt-02`, a fresh,
separately authorized attempt. This revision supersedes the accepted
single-run unit-03 protocol as the execution protocol for unit-04 only.

`unit-04/attempt-01` is FAILED. Every runtime artifact under `results/` from
that attempt is inadmissible to acceptance, responsiveness, cleanup, or any
feasibility verdict. Those files are preserved untouched for inspection only;
this protocol never cites them as evidence and never executes them.

Status of this document: a reviewed staged design for a fresh, separately
authorized attempt. It is not acceptance evidence, it makes no runtime claim,
and no proof completion is asserted anywhere in it. This document and the
staged harness under `proof/` were produced with no live execution: no KWin,
session, D-Bus, package, configuration, window, or shortcut mutation, and no
proof/harness run.

## 1. Why This Revision

attempt-01 ran one persistent harness in a single session. It reached the
manual T2 checkpoint, waited for a go-signal file that never arrived, timed
out, and aborted. That failure mode is structurally removed here:

- Every stage is one bounded supervisor command. No harness session persists
  across user turns.
- No go files, no chat-ready signals, and no user/coordinator manual external
  signals; the only FIFO is the internal bounded-event capture FIFO, and there
  is no unbounded FIFO wait. No open-ended polling, no background wait, and no
  indefinite Worker wait. The supervisor waits only for an exact matching proof
  event inside a fixed command window.
- The supervisor owns setup, event matching, hard timeouts, evidence capture,
  and cleanup. Every stage command ends in the full reversal on event match,
  timeout, error, signal, or termination.
- No proof state survives a user turn.

## 2. Design Invariants (binding)

1. Every supervisor command is separately invoked and bounded to a fixed
   deadline in the range 60-90 seconds (PRE: 60 s; every live stage: 90 s).
2. No supervisor/harness session crosses a user turn. Each stage is its own
   fresh invocation with its own fresh identifiers and its own fresh
   evidence directory.
3. The supervisor may wait only for an exact matching proof event during its
   fixed command window. A timeout is a failed assertion, never a silent skip
   and never an open-ended wait.
4. Every stage command runs the full reversal on event match, timeout, error,
   signal, or termination: script unload, sentinel removal, proof-window
   close, temporary desktop/topology restoration, capture teardown, and
   verification. No proof state survives a user turn.
5. Every repeated setup uses fresh proof IDs, snapshots, and evidence
   identifiers: fresh sentinel action id, fresh KWin-generated temporary
   desktop id, fresh evidence/snapshot directories, fresh window titles.
6. The two manual actions are separate stages with separate evidence
   attribution: (a) dragging the proof window into an empty leaf (split), and
   (b) starting a drag then pressing Esc (cancel). Their outcomes and
   evidence are never conflated.
7. Real-window exclusion and Krohnkite disabled/not-loaded preconditions are
   enforced at every stage precheck.
8. Preflight (PRE) evidence and attempt-01 evidence remain inadmissible to
   proof success. Only live-stage event evidence plus post-reversal
   verification constitute proof evidence.
9. A stage is `COMPLETE` only after every cleanup and postflight check
   succeeds; any failed unload, shortcut removal, desktop/topology
   restoration, tiling cleanup, window closure, capture shutdown, or invariant
   check is recorded as a failure, accumulates, and blocks completion
   (sections 12, 13).

## 3. State Machine Overview

Stages execute strictly in order. Each stage reaches an end state (pass with
full reversal and verification, or recorded failure with full reversal) before
the next stage starts. Later stages are independent of earlier stage evidence;
a failed stage never fabricates or reuses another stage's evidence.

| Token | Stage title | Command | Kind | Deadline | In-scope tests | Pass evidence (per-stage, unique) |
|---|---|---|---|---|---|---|
| PRE | STAGE-PRE-READONLY-GATE | `run-proof.sh --stage PRE` | read-only gate | 60 s | none | gate report only; INADMISSIBLE to proof success |
| AUT-KEY | STAGE-AUT-KEYBOARD-INSERTION | `run-proof.sh --stage AUT-KEY` | live automated | 90 s | T8(start), T3a, T9, T9b | `proof-ready`; `window-managed,<A>,1`; `sentinel-ready,<id>`; exactly one new `shortcut-invoked`; `keyboard-directed,<A2>,<serial>` |
| AUT-WAY | STAGE-AUT-WAYLAND-REBIND | `run-proof.sh --stage AUT-WAY` | live automated | 90 s | T3b, T6 | distinct `window-managed,<B>`; switch out/back with `current` verified and no re-manage of A |
| AUT-BRANCH | STAGE-AUT-BRANCH-PERSISTENCE | `run-proof.sh --stage AUT-BRANCH` | live automated | 90 s | T5a, T5b, T4 | `window-unmanaged,<B>`; empty leaf retained; `collapse-done`; on-disk `[Tiling]` normalized facts == last in-memory `tree-snapshot` |
| M1 | STAGE-MANUAL-DRAG-SPLIT | `run-proof.sh --stage M1` | live manual | 90 s | T2 | `drag-finished,<A>,...,action=split,...` (exact split event) |
| M2 | STAGE-MANUAL-DRAG-CANCEL-ESC | `run-proof.sh --stage M2` | live manual | 90 s | T7 | `drag-cancel-inferred,<A>,...` (exact cancel event) |

Order: `PRE -> AUT-KEY -> AUT-WAY -> AUT-BRANCH -> M1 -> M2`.

## 4. Stage Common Structure

Every stage command follows the same skeleton:

1. Stage precheck (read-only only; a gate, inadmissible evidence; any failure
   aborts before any mutation). Checks: tools present; KWin Ping; proof
   script not loaded; Krohnkite not loaded AND disabled; no sentinel
   `plasma-auto-tiler-kb-*` action in any component; sentinel sequence
   unbound; no sentinel in `kglobalshortcutsrc`; no leftover test windows; no
   leftover capture; no proof desktop present; desktop count < 25; single
   output `eDP-1`; `node --check` and ASCII on the proof script; no
   `[Plugins]`/`Script-*` proof residue; proof script file present.
2. Fresh identity allocation (section 5).
3. Snapshot (V1-V4, T1, C1, G1 baseline) written to the stage snapshot dir.
4. Setup (first mutation): create and switch to the temporary proof desktop;
   `loadScript`; explicit `start()`; bounded wait for `proof-ready`; spawn
   the stage's sentinel windows; bounded wait for their `window-managed`
   lines.
5. Event matching / assertions for the stage's tests (section 10).
6. Reversal (always runs, section 12): stop capture and remove FIFO; close
   test windows; unload the script; sentinel removal (targeted, G1); restore
   the original current desktop; remove the temporary desktop; delete the
   temporary `[Tiling]` subgroup (the single direct config write, section
   6); final verification (V1-V4, T1-T2, S1, S2, W1, L1, G1, K1, C1). Every
   check must succeed for the stage to be `COMPLETE`.
7. Stage end state recorded in the stage evidence dir.

Every command enforces the absolute deadline internally. There is no
`timeout`/`kill-after` wrapper around the harness; the supervisor invokes
`./proof/run-proof.sh --stage <STAGE>` directly. The harness owns cleanup: it
checks the same absolute deadline internally in every wait loop and traps INT,
TERM, and EXIT so that the full per-stage reversal runs on signal or deadline,
not only on normal completion. SIGKILL or host failure can interrupt the
harness before reversal finishes; that is an acknowledged residual risk
(section 18) and never a cleanup guarantee. Any external invocation of the
harness, if documented, must exceed the action-plus-cleanup bound and live
outside harness logic.

## 5. Identity and Evidence Scheme

Fresh identifiers are allocated at every stage invocation. No identifier is
reused across stages.

| Item | Scheme | Freshness |
|---|---|---|
| Stage run id | `pat-u04a2-<STAGE>-<epoch>-<rand>` | per stage |
| Proof desktop name | `plasma-auto-tiler-proof` (KWin generates a fresh desktop id each `createDesktop`) | desktop id per stage |
| Script proof id | `plasma-auto-tiler-structural-proof` | fixed; precheck requires not loaded |
| Sentinel action id | `plasma-auto-tiler-kb-<random>` generated by the script at each setup | per stage |
| Window A title | `PLASMA-PROOF-WINDOW-A-<runid>` | per stage |
| Window B title | `PLASMA-PROOF-WINDOW-B-<runid>` | per stage |
| Evidence dir | `results/evidence/<STAGE>-<runid>/` | per stage |
| Snapshot dir | `results/snapshot/<STAGE>-<runid>/` | per stage |

Each live stage evidence dir receives `sink.log` (raw capture), `assertions.log`,
`progress.log`, `observations.txt`, `sentinel-visibility.log`,
`component.txt` (the stage's exact discovered KGlobalAccel component), and the
snapshot set. PRE receives only its single local durable preflight report
`gate.txt` under a preflight-only identifier; it is inadmissible to proof
success. The `runid` is printed prominently at stage start so the supervisor
can attribute every line to its stage.

No cross-stage mutable state exists: there is no shared temp-desktop-id file or
similar record. Each stage has its own unique evidence/snapshot directory and
fresh identifiers, snapshots, and desktop id, and a stage never consumes
another stage's mutable state.

## 6. Source Pins and Evidence Method

Unchanged accepted pins, cited without re-derivation:

- KWin repository `https://invent.kde.org/plasma/kwin`, tag `v6.7.3`, commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`. Accepted unit-01
  `research/kwin-api-surface.md` and unit-02 `research/package-composition.md`
  verdicts apply unchanged; capability 5 (keyboard preselection) remains
  runtime-validation required.
- Script carrier facts (pinned source): `Script::registerShortcut` creates a
  `QAction` parented to the `Script` and registers it via
  `KGlobalAccel::self()->setShortcut` (`src/scripting/scripting.cpp:376-395`),
  so unload destruction drives the client's async auto-unregister; the shipped
  `org.kde.KGlobalAccel` D-Bus surface exposes targeted
  `unregister(component, action)` and read-only component/action queries, and
  `org.kde.kglobalaccel.Component.invokeShortcut` dispatches by name
  (`kf6_org.kde.KGlobalAccel.xml:99-104,151-165`,
  `kf6_org.kde.kglobalaccel.Component.xml:59-61,35-53`); `unloadScript` and
  `isScriptLoaded` are `org.kde.kwin.Scripting` surfaces
  (`src/scripting/scripting.cpp:835-845,819-822`); `loadScript` alone does not
  evaluate the script and `start()` runs loaded scripts once
  (`src/scripting/scripting.cpp:861-872,722-744,847-853`).
- Temporary virtual desktop lifecycle (`org.kde.KWin.VirtualDesktopManager`,
  `src/dbusinterface.h:179-249`): `createDesktop` append-at-end with a fresh
  desktop id (`src/virtualdesktops.cpp:448-481`), `current` switch
  (`src/virtualdesktops.cpp:577-606`), `removeDesktop` with renumber-back
  (`src/virtualdesktops.cpp:484-529`).
- Auto-persisted temporary topology residue and its single direct-config
  deletion: `TileManager` auto-saves every desktop root to kwinrc
  `[Tiling][<desktopId>][<outputUuid>]` on a 2000 ms timer and never deletes
  it (`src/tiles/tilemanager.cpp:61-74,390-405`); no runtime API exists to
  delete a `[Tiling]` subgroup, so deletion uses
  `kwriteconfig6 --file kwinrc --group Tiling --group <id> --group <uuid>
  --key tiles --delete` and `... --key padding --delete` after the temp
  desktop is removed and the save timer has elapsed, verified by read-back
  (T2). This is the protocol's one direct config write.
- Real-window exclusion: the proof script only ever manages windows whose
  `resourceClass` is exactly `PlasmaAutoTilerTestWindow` or
  `plasma-auto-tiler-test`, that are `normalWindow` and `managed`, and whose
  desktop set is exactly the proof desktop (accepted `wayland-revalidation.md`
  proves the konsole class; `com.mitchellh.ghostty` and all other real classes
  are structurally excluded). `Tile::manage` re-checks desktop membership
  (`src/tiles/tile.cpp:379-391`).
- KWin liveness: `org.freedesktop.DBus.Peer.Ping` on `org.kde.KWin` `/KWin`.
- Durations use `Date.now()` only (integer-millisecond floor, accepted
  `clock-resolution.md`); no finer resolution is claimed.

### 6.1 `start()` scope (unchanged from accepted protocol)

`Scripting::start()` re-reads the enabled-script set from kwinrc `[Plugins]`
read-only and runs loaded scripts (`src/scripting/scripting.cpp:722-744,
746-794,847-853`). The proof writes no `[Plugins]` and no `Script-<id>` key
and cannot change the user's enabled set; it only triggers KWin's normal
application of that set. The proof cannot enumerate the pre-existing
loaded-script set host-side (`isScriptLoaded` covers only the proof id), so a
user script acting on windows or topology during the proof may fail a proof
assertion; any such failure triggers the standard per-stage abort/reversal.
Post-stage verification re-confirms the proof wrote no `[Plugins]` or
`Script-<proofId>` key (S2).

## 7. Proof Carrier and Artifacts

- Carrier: one repository `.js` (`proof/structural-proof.js`, unchanged from
  the accepted unit-03 draft contract) loaded and unloaded through the
  `org.kde.kwin.Scripting` D-Bus surface by absolute path. No KPackage, no
  install, no plugin/config enablement.
- Host harness: `proof/run-proof.sh`, rewritten for this staged protocol. It
  is a stage dispatcher: `run-proof.sh --stage <STAGE>`. Each stage is one
  bounded, self-contained setup -> event-match -> reversal -> verify command.
  The dbus-monitor + awk demux LogSink capture pattern is unchanged
  (`com.plasmaAutoTiler.LogSink.append`; capture via
  `stdbuf -oL dbus-monitor --session "type='method_call',interface=
  'com.plasmaAutoTiler.LogSink'"` through a FIFO, demuxed by awk; both PIDs
  tracked and killed at teardown; FIFO removed; every awk write flushed).
- Test windows, exactly the stage's sentinel windows, one at a time on the
  proof desktop, holding open via `sleep 3600`, closed by killing each
  `setsid` process group:
  - X11/XWayland: `setsid xterm -class PlasmaAutoTilerTestWindow -title
    PLASMA-PROOF-WINDOW-A-<runid> -e sleep 3600 >/dev/null 2>&1 &`
  - Wayland-native: `setsid konsole --separate --desktopfile
    plasma-auto-tiler-test -title PLASMA-PROOF-WINDOW-B-<runid> -e sleep 3600
    >/dev/null 2>&1 &`
  The `-title` carries the stage run id so the user can identify the exact
  proof window during manual stages.

## 8. Sentinel Shortcut Registration and Targeted Cleanup (G1)

Unchanged sentinel-only route, bounded for staged execution:

1. Registration: at each setup the script generates one fresh sentinel action
   id (`plasma-auto-tiler-kb-<random>`), calls `registerShortcut(<id>,
   "Plasma Auto Tiler Proof", "Meta+Ctrl+Shift+Alt+P", callback)` once
   (`src/scripting/scripting.cpp:376-395`) and logs `sentinel-ready,<id>`.
   The sequence is verified unbound read-only at precheck before any
   registration. Exactly one sentinel is created per stage.
2. Component discovery (every live stage): each stage that registers the
   sentinel dynamically discovers exactly one component whose
   `allShortcutInfos` contains the exact randomized action id (bounded 20 s
   visibility poll; exactly one match required) and stores that component path
   and unique name only in that stage's evidence directory (`component.txt`).
   No guessed or fixed component (never `kwin`) is used anywhere.
3. Dispatch (AUT-KEY only): the harness calls
   `org.kde.kglobalaccel.Component.invokeShortcut` on the stage-discovered
   component for the sentinel action id; the script callback logs
   `shortcut-invoked,<timestamp>`. This is D-Bus dispatch of the registered
   action by name, NOT physical key injection; no keyboard grab, no
   XTEST/uinput, no Wayland key event.
4. Removal (every live stage): unload first (`unloadScript`, which destroys
   the parented `QAction` and drives the client's async auto-unregister); poll
   read-only that the sentinel action id is absent from every component's
   `allShortcutInfos` AND that the semantic `kglobalshortcutsrc` check passes
   (no `[<component>][<actionId>]` group), bounded 20 s; if still present,
   issue the targeted `org.kde.KGlobalAccel.unregister(<stageComponentUnique>,
   <actionId>)` for that exact stage-discovered component and that one action
   only, then re-poll until absent. Never call `Component.cleanUp`, never
   unregister or modify any other component/action, never write
   `kglobalshortcutsrc` directly (the daemon owns and rewrites it; the proof
   only reads it), and never fall back to a guessed component or broad cleanup.

## 9. Real-Window Exclusion and Krohnkite Preconditions

- Real-window exclusion: the script gate (section 7) applies to every
  `windowAdded`, interactive-move, and `windowRemoved` handler. Any window
  failing any check is ignored. The harness's own terminal and the user's
  controlling terminal (`com.mitchellh.ghostty`) are never in the allowlist.
  `Tile::manage` itself re-checks desktop membership
  (`src/tiles/tile.cpp:379-391`).
- Krohnkite precondition (read-only, enforced at every stage precheck; a
  failure aborts before any mutation):
  - `isScriptLoaded("krohnkite")` reads `false`.
  - `kreadconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled` reads
    `false` (disabled, not merely not loaded).
  - No `Krohnkite` proof residue is created by this protocol; the existing
    `[Script-krohnkite]` keys and `Krohnkite*` `kglobalshortcutsrc` entries
    from the prior reconciliation are deliberately untouched and are neither
    an enabled nor a loaded Krohnkite instance.

## 10. Stage Definitions

Each stage below lists setup, event matching, and pass evidence. Every stage
ends with the full reversal of section 12. Bounds are per-wait; every wait is
additionally bounded by the stage's absolute deadline (section 13).

### 10.1 PRE - read-only gate (no live execution)

Read-only checks only. PRE performs no mutation of KWin/Plasma/session state:
it loads/registers/creates no live proof state and creates no reusable
cross-stage identifier. It writes only one local durable preflight report to
`results/evidence/PRE-<runid>/gate.txt` under a preflight-only identifier. On
any failure it aborts and reports. Its results are a gate, never proof
evidence.

1. Required tools present.
2. KWin `org.freedesktop.DBus.Peer.Ping` exit 0.
3. Proof script not loaded (`isScriptLoaded` `false`).
4. Krohnkite not loaded and disabled (section 9).
5. No leftover test windows (`pgrep` sentinel classes empty).
6. No leftover capture (`pgrep` dbus-monitor empty).
7. No proof desktop present in `desktops`.
8. Desktop count < 25.
9. Single output `eDP-1`.
10. `node --check` and ASCII-only grep pass on `proof/structural-proof.js`.
11. No `[Plugins]` `plasma-auto-tiler-structural-proofEnabled` key and no
    `Script-plasma-auto-tiler-structural-proof` group in kwinrc.
12. `org.kde.kglobalaccel` daemon answers Ping; no `plasma-auto-tiler-kb-*`
    action in any component's `allShortcutInfos`.
13. Sentinel sequence `Meta+Ctrl+Shift+Alt+P` unbound
    (`globalShortcutsByKey` empty).
14. No sentinel in `kglobalshortcutsrc` (semantic check, read-only).

### 10.2 AUT-KEY - automatic placement, shortcut dispatch, keyboard insertion

Setup: create and switch to the proof desktop; `loadScript` + `start()`;
wait `proof-ready` (20 s). Spawn window A; wait `window-managed,<A>,1`
(15 s).

Event matching / assertions:
- T3a: `window-managed,<A>,1` observed; the last `tree-snapshot` before and
  after window A's manage is identical (authored structure preserved,
  `src/placement.cpp:34-58`).
- T9: `sentinel-ready,<id>` observed; sentinel present in exactly one
  component's `allShortcutInfos` (20 s visibility poll); the component's
  `isActive` recorded read-only; `invokeShortcut(<id>)` dispatched; exactly
  one new `shortcut-invoked` in the sink (15 s).
- T9b: close window A; `invokeShortcut(<id>)` to arm the preselect flag;
  respawn window A; `keyboard-directed,<A2>,<serial>` for the respawned
  window within 15 s (unit-01 capability 5: `registerShortcut` callback ->
  `workspace.windowAdded` -> `tile.manage`).
- T8(start): `loadScript` returns a non-`-1` id and `proof-ready` arrives.

### 10.3 AUT-WAY - Wayland-native placement and desktop rebinding

Setup: proof desktop; `loadScript` + `start()`; wait `proof-ready` (20 s);
spawn window A; wait `window-managed,<A>` (15 s); spawn window B (konsole);
wait a distinct `window-managed,<B>` (15 s).

Event matching / assertions:
- T3b: window B's manage observed through the normal Wayland path
  (residual: Wayland configure-ack timing, `src/xdgshellwindow.cpp:851-855`).
- T6: switch `current` to the original desktop id, verify `current`; switch
  back to the proof desktop id, verify `current`; assert A's manage line was
  not repeated across the switch (built-in re-requestTile,
  `src/workspace.cpp:1093-1117`).

### 10.4 AUT-BRANCH - empty-branch retention, collapse, persistence

Setup: proof desktop; `loadScript` + `start()`; wait `proof-ready` (20 s);
spawn windows A and B; wait their `window-managed` lines (15 s each).

Event matching / assertions:
- T5a: close window B; `window-unmanaged,<B>` within 10 s; the leaf that held
  B remains present with `windows.length === 0` (no auto-collapse,
  `src/tiles/tile.cpp:34,427-437`).
- T5b: `collapse-done` within 10 s; the single-child layout promoted back to a
  leaf (`CustomTile::remove`, `src/tiles/customtile.cpp:273-343,326-332`),
  gated to an empty removable leaf on the proof desktop.
- T4: wait 5 s after the last mutation (>= the 2000 ms save timer,
  `src/tiles/tilemanager.cpp:61-64`); parse the kwinrc `[Tiling]` section for
  the proof desktop subgroup; assert on-disk normalized structural facts
  equal the last in-memory `tree-snapshot` (`tileToJSon` schema,
  `src/tiles/tilemanager.cpp:342-388`).

### 10.5 M1 - manual drag-to-split (T2)

Setup: proof desktop; `loadScript` + `start()`; wait `proof-ready` (20 s);
spawn window A; wait `window-managed,<A>` (15 s). Print the stage's
prominent user-action banner (section 15).

Event matching: the supervisor waits for exactly
`drag-finished,<A>,P(<x>,<y>),<hitLeaf>,action=split,<finalTile>,<handlerMs>`
in the sink, bounded by the stage deadline (>= 45 s guaranteed by setup and
reversal budgets). On match: record the split evidence
(`drag-started`, ordered `drag-stepped` lines, `drag-finished,action=split`,
`hitLeaf.childCount()` becoming 2 via the post-split `tree-snapshot`), then
reversal. If `drag-cancel-inferred` is the first finish event, M1 is a failed
assertion (its outcome belongs to M2's evidence, never M1's).

Pass evidence (T2): the exact `drag-finished,action=split` line for window A,
plus the post-split `tree-snapshot` showing the hit leaf split into two
children with window A in one of them.

### 10.6 M2 - manual drag + Esc cancel (T7)

Setup: proof desktop; `loadScript` + `start()`; wait `proof-ready` (20 s);
spawn window A; wait `window-managed,<A>` (15 s). Print the stage's
prominent user-action banner (section 15).

Event matching: the supervisor waits for exactly
`drag-cancel-inferred,<A>,<startGeom>,<endGeom>,<tileBefore>,<tileAfter>` in
the sink, bounded by the stage deadline. On match: record the cancel evidence
and reversal. If `drag-finished,action=split` is the first finish event, M2 is
a failed assertion (its outcome belongs to M1's evidence, never M2's).

Pass evidence (T7): the exact `drag-cancel-inferred` line for window A; window
A's `frameGeometry` and tile association unchanged (cancel restore,
`src/window.cpp:1069-1111`; no cancel flag on the signal,
`src/window.cpp:1110`).

## 11. Test Matrix Mapped to Stages

| ID | Test | Stage | Input | Pass evidence |
|---|---|---|---|---|
| T8 | Script lifecycle (load/start/unload) | every live stage | `loadScript`/`start()`/`unloadScript` | id >= 0; `proof-ready`; `unloadScript`; `isScriptLoaded` false (each bounded) |
| T3a | Automatic placement preserves authored structure | AUT-KEY | window A spawn | `window-managed,<A>,1`; `tree-snapshot` unchanged |
| T9 | Keyboard shortcut dispatch | AUT-KEY | `invokeShortcut` | exactly one new `shortcut-invoked`; sentinel in exactly one component |
| T9b | Keyboard-directed insertion | AUT-KEY | close A, arm, respawn A | `keyboard-directed,<A2>,<serial>` |
| T3b | Wayland-native placement | AUT-WAY | window B spawn | distinct `window-managed,<B>` |
| T6 | Desktop rebinding | AUT-WAY | switch out/back | `current` verified both ways; A not re-managed |
| T5a | Empty-leaf retention after close | AUT-BRANCH | close window B | `window-unmanaged,<B>`; empty leaf retained |
| T5b | Empty-branch collapse | AUT-BRANCH | script auto | `collapse-done`; layout promoted back to a leaf |
| T4 | Topology persistence round-trip | AUT-BRANCH | host read | on-disk normalized facts == last `tree-snapshot` |
| T2 | Pointer drag-to-split | M1 | user drag into empty leaf | `drag-finished,action=split` + post-split `tree-snapshot` |
| T7 | Drag cancel / Esc | M2 | user drag + Esc | `drag-cancel-inferred`; geometry/tile unchanged |

## 12. Reversal and Verification (every stage)

The full reversal runs on event match, timeout, error, signal, or
termination, in this exact order:

1. Stop capture: kill monitor and demux PIDs; remove the FIFO (L1).
2. Close test windows: `kill -- -<pid>` per spawned process group; verify W1
   (both sentinel `pgrep` queries empty).
3. Unload the script: `unloadScript <proofId>`; poll `isScriptLoaded` false up
   to 20 s (S1, T8).
4. Sentinel removal (G1, section 8): unload first (step 3 drives the client's
   async auto-unregister); poll sentinel absent from every component's
   `allShortcutInfos` and the semantic `kglobalshortcutsrc` check up to 20 s;
   targeted `unregister` fallback using only the stage's exact discovered
   component and that one action; re-poll. A still-present sentinel or still-
   bound sequence is a recorded failure that blocks completion.
5. Restore the current desktop to the pre-stage id; assert `current` matches
   (V2).
6. Remove the temporary desktop; wait 2 s; assert V1/V3 and V4 semantic
   equality (KWin renumbers back, `src/virtualdesktops.cpp:484-529`).
7. Delete the temporary `[Tiling]` subgroup (section 6); assert T2 absent and
   T1 per-subgroup semantically identical.
8. Final Ping (K1) and full postflight verification of V1-V4, T1-T2, S1, S2,
   W1, L1, G1, C1. Every check must succeed: any failed unload (S1), exact
   shortcut removal (G1), desktop removal or topology restoration (V1-V4),
   tiling cleanup (T2), window closure (W1), capture shutdown (L1), or
   invariant check (K1, C1) is recorded as a failure that accumulates and
   blocks completion.

If KWin itself becomes unresponsive (Ping fails), do not kill or restart
`kwin_wayland`; report to the Lead for a human decision. If the
`org.kde.kglobalaccel` daemon becomes unavailable, the dispatch (T9) and
removal (G1) steps cannot run; do not restart it - crash recovery for
`kwin_wayland` and `kglobalacceld` is outside this run's authorization and
requires a fresh decision (sections 16, 18).

A stage is `COMPLETE` only after all cleanup and postflight checks succeed.
Any cleanup or postflight failure accumulates and forces a nonzero stage exit
without a `COMPLETE` line; the stage records its end state as failed-and-
reversed.

## 13. Duration, Bounds, and Signal-Safe Deadline Cleanup

- Every supervisor command has a fixed deadline: 60 s for PRE, 90 s for every
  live stage, enforced internally by the harness. There is no
  `timeout`/`kill-after` wrapper around the harness (section 4); any external
  invocation of the harness must exceed the action-plus-cleanup bound and live
  outside harness logic.
- Internal per-wait bounds: `proof-ready` 20 s; `window-managed` 15 s;
  sentinel visibility poll 20 s; `shortcut-invoked` 15 s; `keyboard-directed`
  15 s; `window-unmanaged` 10 s; `collapse-done` 10 s; unload poll 20 s;
  sentinel-removal poll 20 s; window close settle 3 s; desktop remove wait
  2-5 s; persistence wait 5 s. A timeout is a failed assertion, never a silent
  skip.
- The manual stages guarantee the user a minimum event window: setup is
  budgeted <= 25 s and reversal <= 20 s, so at least ~45 s of the 90 s window
  remains for the user's drag action before the deadline. If setup or
  reversal exceed their budget, the absolute deadline fires and the
  signal-safe cleanup runs regardless.
- Signal-safe deadline cleanup: on deadline (internal check), INT, TERM, or
  EXIT, the harness runs the full section 12 reversal and records the end
  state. SIGKILL or host failure can interrupt the harness before reversal
  finishes; that is an acknowledged residual risk (section 18) and never a
  cleanup guarantee. Any residue after such an interruption requires the
  post-run verification and, if found, a fresh authorized targeted cleanup
  (section 14).
- Nominal stage runtime: PRE ~5 s; each live stage ~30-45 s including the
  user event window; all strictly below the 90 s deadline.
- Handler durations use `Date.now()` only (1 ms quantization floor, accepted
  `clock-resolution.md`); no finer resolution is claimed.
- Responsiveness evidence is limited to: KWin Ping exit 0 after every phase of
  every stage; no watchdog firing during a clean stage; all stage events
  arriving within their bounds; and the quantized handler-duration report.
  No sustained-workload conclusion is drawn; Q-A/Q-B thresholds and unit
  definitions are not contacted, weakened, or broadened.

## 14. Abort and Recovery (per stage)

- Any assertion failure, Ping failure, watchdog fire during a clean stage, or
  unexpected T1 change: stop immediately, log the failure, run the full
  reversal (section 12), and record the stage end state. Never escalate
  unilaterally.
- The script's watchdog (300000 ms) is longer than any single stage deadline,
  so it can never fire inside a clean stage; a watchdog fire is an assertion
  failure. The watchdog disarms the script's handlers; it does NOT unload the
  script and provides no script-side shortcut unregister.
- Crash residue: if a command is SIGKILLed (section 13), or if `kwin_wayland`
  or `kglobalacceld` dies during a stage, the proof script, the sentinel
  shortcut, the test windows, or the temporary desktop may remain. Cleanup of
  such residue (unload the script; if the sentinel is still present, the
  targeted `unregister` for that one action; close windows; remove the
  temporary desktop and its `[Tiling]` subgroup) is outside the run and
  requires fresh authorization (sections 16, 18). The supervisor runs a
  read-only verification after every stage and reports any residue instead of
  cleaning it unilaterally.

## 15. Manual Stage Choreography (supervisor-owned, exact titles/actions)

The Orchestrator, not the harness, tells the user the manual action
immediately before the user's live stage. No user/coordinator go file,
chat-ready signal, or manual external signal is used; the only FIFO is the
internal bounded-event capture FIFO, and there is no unbounded FIFO wait. The
user acts during the stage command's fixed window; the supervisor waits only
for the exact matching proof event.

- Before dispatching M1, the Orchestrator announces, verbatim:
  "STAGE-MANUAL-DRAG-SPLIT: on the desktop named 'plasma-auto-tiler-proof',
  drag the window titled 'PLASMA-PROOF-WINDOW-A-<runid>' to the CENTER of an
  EMPTY tile (a tile showing no window) and release. The supervisor will wait
  up to 90 seconds for the split event."
- Before dispatching M2, the Orchestrator announces, verbatim:
  "STAGE-MANUAL-DRAG-CANCEL-ESC: on the desktop named 'plasma-auto-tiler-proof',
  START dragging the window titled 'PLASMA-PROOF-WINDOW-A-<runid>', then press
  Esc to cancel WITHOUT releasing. The supervisor will wait up to 90 seconds
  for the cancel event."

The harness prints an identical banner to its stdout at the start of M1/M2 so
the banner is reproducible in `run.out`. The two stages never run
concurrently and never share a window: each stage spawns its own window A with
a fresh title and run id, and reverses it at stage end (repeated-stage
isolation).

## 16. Remaining Prohibited Actions (even after authorization)

Authorization covers exactly the staged unit-04 execution of this protocol. All
of the following remain prohibited unless a fresh, separate authorization is
given:

- Any KPackage installation or package lifecycle action, any plugin/config
  enablement, any `[Plugins]` or `Script-*` kwinrc key, any registry, and any
  persistent script-config mutation.
- Any global-shortcut action beyond the single sentinel shortcut per stage
  (section 8): no second registration, no `Component.cleanUp`, no unregister
  or modification of any other component/action, no whole-component or
  whole-file `kglobalshortcutsrc` rewrite, and no physical key injection. The
  sentinel's `kglobalshortcutsrc` entries are read read-only only.
- Crash recovery for `kwin_wayland` or `kglobalacceld` - restart, kill, or
  logout - is outside this run and requires fresh authorization.
- Any config write beyond the single T2 deletion (section 6); the `[Desktops]`
  group is touched only by KWin's own `save()`.
- Any QML `KWin/Effect`, panel bridge/applet, native plugin, or any package
  beyond the one repository `.js` proof carrier.
- Any dependency or `devenv.nix`/`devenv.yaml` change, and any ad hoc
  installation.
- Restarting or killing `kwin_wayland`, logging out, any output/kscreen
  change, hotplug, or any physical interaction with the host's display
  topology.
- Any proof beyond this protocol's stage matrix, any sustained or repeated
  run, any measurement claiming frame timing or p99, any portal / PipeWire /
  ScreenShot2 capture, and any test window beyond the stage's sentinel
  windows.
- Any change to `spec.md`, `plan.md`, `state.md`, `log.md`, prior research,
  backlog, `sustained-workload-validation`, archive, decisions, technical
  report, or the Cargo scaffold/source. Any commit.
- Any use of `unit-04/attempt-01` runtime artifacts under `results/` as
  evidence, and any modification or deletion of those files.

## 17. Authorization Request (fresh, staged)

This question is valid ONLY for a fresh, separately authorized `unit-04`
attempt, and only after this staged protocol revision is accepted. The proof,
if authorized, will execute exactly this staged machine on your live Plasma
6.7.3 Wayland session on the single `eDP-1` output:

1. One read-only gate stage (PRE, ~5 s, no live execution): verifies tools,
   KWin responsiveness, no loaded proof script, Krohnkite not loaded AND
   disabled, no shortcut/sentinel residue, no test windows, no proof desktop,
   single output, and script syntax. Gate results are not proof evidence.
2. Three automated live stages (AUT-KEY, AUT-WAY, AUT-BRANCH), each a separate
   90-second command: each creates one temporary virtual desktop named
   `plasma-auto-tiler-proof`, loads and starts one temporary repository script
   from this tree over D-Bus (`loadScript` + `start()`, then `unloadScript`),
   registers exactly one fresh sentinel shortcut
   (`plasma-auto-tiler-kb-<random>`, sequence `Meta+Ctrl+Shift+Alt+P`,
   verified unbound first), spawns and closes the stage's sentinel windows
   (xterm `PlasmaAutoTilerTestWindow` / konsole `plasma-auto-tiler-test`, one
    at a time, on the proof desktop only), and then reverses everything: closes
    the windows, unloads the script (driving the sentinel's auto-unregister,
    with a targeted `org.kde.KGlobalAccel.unregister` fallback using that
    stage's exact discovered component for that one action only if needed),
    switches back to your original desktop, removes the
   temporary desktop, deletes the temporary desktop's auto-persisted
   `[Tiling]` subgroup (the one direct config write), stops the log capture,
   and verifies. Your desktop set / current / count / rows, the kwinrc
   `[Desktops]` group, every real-desktop `[Tiling]` subgroup, and every other
   shortcut remain semantically identical.
3. Two manual live stages (M1, M2), each a separate 90-second command. The
   Orchestrator tells you the exact action immediately before each stage:
   - M1: drag the window titled `PLASMA-PROOF-WINDOW-A-<runid>` to the center
     of an empty tile on the proof desktop and release.
   - M2: start dragging that window, then press Esc to cancel without
     releasing.
   Each stage's window has a fresh run-specific title so you can identify it
   unambiguously. After each stage the supervisor reverses everything exactly
   as in item 2 and verifies. No proof state survives a user turn.
4. Keyboard dispatch is NOT a manual keypress: it is exercised over the
   `org.kde.kglobalaccel.Component.invokeShortcut` D-Bus surface in AUT-KEY
   only. The only real keypress you make is the single Esc in M2.

Question (answer exactly one):

**Yes - authorize `unit-04/attempt-02` to execute this exact staged protocol
on the live session, including the read-only gate, the three automated live
stages and the two manual live stages with the two drag actions and the single
Esc described above, a 60-second deadline for the gate and a 90-second fixed
deadline for each live stage with signal-safe cleanup, and the full
per-stage reversal and verification above - or No - leave unit-04 gated and
unexecuted.**

## 18. Risks and Blockers

- Residual shortcut risk (unchanged, bounded): the sentinel-only route's
  residual risks are (a) the client's auto-unregister on QAction destruction
  is asynchronous with latency not source-guaranteed - the stage polls
  read-only until removal is confirmed, bounded 20 s; (b) whether
  auto-unregister alone clears the sentinel is observed at runtime, so the
  targeted `org.kde.KGlobalAccel.unregister` fallback exists for that one
  action using only the stage's exact discovered component; and (c) the
  daemon's scheduled `kglobalshortcutsrc` rewrite is async, so the semantic
  config check is polled and byte equality is never authoritative.
- `invokeShortcut` scope: AUT-KEY proves daemon-to-script callback dispatch
  for the sentinel, not the physical key-to-daemon/Wayland input path.
- The sentinel visibility poll (20 s) in AUT-KEY is a bounded observation; if
  the sentinel is not visible in exactly one component within it, AUT-KEY
  aborts with a recorded assertion failure and full reversal. This is an
  honest bound on a behavior the source does not guarantee.
- A user script enabled in `[Plugins]` may load/run during `start()`
  (section 6.1); the proof cannot enumerate or reverse those, and any
  resulting assertion interference triggers the standard per-stage
  abort/reversal.
- Human drag input is nondeterministic in timing but bounded; a timeout is a
  failed assertion, not a silent skip. If the user performs the wrong action
  for a stage (Esc during M1, or a split during M2), the stage records the
  mismatch as a failed assertion; outcomes are never cross-attributed.
- SIGKILL or host failure can interrupt the harness before reversal finishes
  (sections 4, 13); any residue then requires fresh authorization to clean up
  (section 14). This is an acknowledged residual risk, never a cleanup
  guarantee. No source blocker prevents this protocol's acceptance.

## 19. Scope Compliance

No source application edits. `spec.md`, `plan.md`, `state.md`, `log.md`
(updated only as allowed), unit-01/unit-02 research, backlog,
`sustained-workload-validation`, archive, decisions, technical report,
dependencies, and `devenv.nix` were not edited beyond this protocol, the
staged harness under `proof/`, and the plan/state/log updates authorized for
this attempt. No live interaction occurred: no live-session or host query, no
D-Bus call, no script load, no window, no config or package change, no commit.
`unit-04/attempt-01` runtime artifacts under `results/` are preserved untouched
and are not evidence. No architecture, package manager, or implementation
language was selected.


