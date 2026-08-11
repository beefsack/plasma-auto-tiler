# Live KWin/Plasma Testing Guide

## Purpose

Read this guide before planning, authorizing, or running any live KWin/Plasma
test. It is the authoritative operational contract for this repository. It
does not grant a live-mutation authorization; every attempt still needs one
bounded, explicit authorization.

## Safety Boundary

- Preserve real windows, desktops, outputs, Krohnkite state, and unrelated
  configuration. Record a fresh nonce before any mutation and own only resources
  named by that nonce.
- Never use broad cleanup. Touch only exact plugin IDs, component/action pairs,
  process groups, desktops, and tiling keys recorded after validated ownership.
  Unrelated stale tiling groups are not cleanup targets.
- Do not kill, restart, log out of, or reconfigure KWin. Do not invoke actions,
  create clients or desktops, or modify tiling/configuration outside the one
  authorized scope. Stop immediately on any ownership, parser, diagnostic, or
  baseline surprise. Do not retry a live launch within that authorization.

## Validation Ladder

Run layers in order. Passing one layer never implies a later layer.

1. Static bundle checks: source, generated-artifact policy, hash, typecheck,
   build, tests, and syntax scans.
2. Harmless supervisor proof: prove one nonce-owned, bounded detached launch
   and cleanup without KWin mutation.
3. Read-only parser and collector validation: prove D-Bus signatures, JSON
   envelopes, malformed vectors, and baseline reads.
4. Registration-only smoke: load/run only after all prior gates, require
   diagnostics and valid discovery, then clean up.
5. Window journey: only after registration acceptance, run one prompted,
   bounded journey with exact state evidence.
6. Feature acceptance: only after every required journey and postflight pass.

`failed-clean` proves cleanup, not capability. A D-Bus transport reply, process
exit status, missing error, or visual appearance is never feature evidence.

## Evidence and Baselines

- Before parsing, atomically retain every machine response that gates a mutation.
  Keep the raw file, SHA-256, byte count, parser status, parsed type, and
  cardinality through postflight.
- Require fixed private success diagnostics and an independent, unanchored
  same-KWin-PID, `--user`-scope `QT_CATEGORY=kwin_scripting` error capture.
  Capture success messages with the fixed `plasma-auto-tiler:` prefix
  separately from errors; see Journal and Supervisor for the exact scope,
  identity, and category contract.
- Record exact state evidence, not inference. At relevant registration checks,
  retain t+0/t+1/t+5 results. Keep no personal window, application, title,
  geometry, or user-data payloads in durable evidence.
- Preflight and postflight must compare: bundle hash; KWin PID and `/KWin` plus
  `/Scripting` Peer Pings; loaded scripts and Krohnkite; exact project actions
  and config keys; desktop/output/current-desktop state; former owned group;
  complete tiling groups/fingerprint; non-project shortcut fingerprint; and all
  owned residue.

## KWin Bundle Compatibility

- KWin executes only the generated non-module ES2017 IIFE. Do not ship ESM,
  Node imports, source maps, unsupported syntax, or manually edited generated
  JavaScript.
- Use explicit catch bindings, not `catch {}`. Optional catch binding is ES2019
  and was rejected by this KWin QJSEngine.
- Node checks and static scans are necessary but insufficient. No local same-Qt
  `qml`, `qml6`, or `qjs` parser is available; KWin evaluation is the parser
  acceptance gate.

## Script Lifecycle and Load Parser

- `/Scripting` exposes `loadScript(s) -> i` and `loadScript(ss) -> i`. With
  `busctl --json=short`, require exactly `{"type":"i","data":[ID]}` where
  `ID` is one integral value in `0..2147483647`.
- Atomically write raw `loadScript` stdout to an attempt-owned runtime file,
  then parse it fail-closed. Only parser success permits `/Scripting/Script<ID>`.
  Require read-only introspection of that exact path and `org.kde.kwin.Script`
  before any object method.
- Run only the returned script object. Never guess `Script0`, call global
  `Scripting.start`, or use KPackage as a test path.

## Manual Start Launcher

`scripts/start-test.sh` is a manual lifecycle convenience interface only, with
strict subcommand parsing. It is not a harness and never substitutes for the
validation ladder above.

- `scripts/start-test.sh start` builds the bundle, loads and runs the script
  through the `/Scripting` D-Bus interface, then waits within a bounded window
  for ordered same-KWin-PID `shortcut-registered` and `startup-handlers-ready`
  diagnostics with no `disabled:` diagnostic before it reports success. The
  pre-load journal cursor and `_PID` filter prevent old/unrelated diagnostics
  from being accepted; a disabled diagnostic fails immediately. Running it is a
  live KWin mutation and still requires one explicit, bounded authorization
  under the Safety Boundary.
- `scripts/start-test.sh status` is read-only. It reports the exact plugin load
  state from `isScriptLoaded`, labels controller running/callback delivery as
  unproven, reports whether this KWin process's journal has readiness evidence,
  and lists every persisted project action
  record discovered through the strict all-component KGlobalAccel collector
  (`allComponents` plus `allShortcutInfos("default")`, exact eight-field
  tuples, filtered to exact project action IDs). Persisted records and journal
  history are evidence only: neither proves a live callback. Journal transport
  and JSON failures fail closed rather than reporting missing evidence.
- `scripts/start-test.sh stop` unloads only `plasma-auto-tiler-kwin` through
  the exact `unloadScript` reply contract, verifies it is no longer loaded,
  and is idempotent when it is already unloaded. It never unregisters broadly:
  persisted project KGlobalAccel records are reported read-only and left
  untouched. Stopping and unloading the script do not roll back Custom Tile
  changes it already made.
- `scripts/start-test.sh reconcile-shortcuts` is read-only. It first proves
  the running KGlobalAccel exposes exactly
  `org.kde.KGlobalAccel.setShortcutKeys asa(ai)u -> a(ai)` by introspection,
  then reports, per project action, whether its persisted active sequence
  equals the expected source-default sequence, and counts any missing records
  and any unrelated records (non-project, any component) that already claim an
  expected target sequence. It never mutates.
- `scripts/start-test.sh reconcile-shortcuts --apply` is the only command that
  mutates shortcut records and still requires explicit authorization. It
  applies the expected source-default active sequence through
  `setShortcutKeys` only after the read-only gates pass: the exact setter
  contract above, no missing project record, and zero unrelated conflicts for
  the target sequences. It writes each mismatched record once (one
  `setShortcutKeys` call per action with the four-element actionId and flags
  `SetPresent|NoAutoloading`), verifies each reply confirms the expected key,
  then re-reads the records and reports exact before/after assignments plus
  every deferred record; any setter failure, malformed reply, or verification
  mismatch stops further writes, best-effort restores only the exact captured
  assignments of actions already touched, and reports whether that restoration
  was verified. Any such condition is a hard failure.
  `start`, `status`, and `stop` never mutate shortcut records.
- KGlobalAccelD 6.7.3 (pinned source, sha256
  `cd940d21bb050d6ee689d5962d31292c52f31cfa9211ea789dbed4ff05022f1d`)
  defines the setter flags `SetPresent=2`, `NoAutoloading=4`, `IsDefault=8`;
  `NoAutoloading` forces a change on a non-fresh registered action, and the
  daemon persists through `scheduleWriteSettings()`.


## KGlobalAccel and Collector

- `registerShortcut` returns `bool`. Registration readiness exists only after
  every required registration succeeds; on any false result, disable inertly.
- `allComponents() -> ao`. For each component, read `uniqueName` and
  `friendlyName`, then query `allShortcutInfos("default") -> a(ssssssaiai)`.
  Its exact eight fields are action ID, action label, component unique name,
  component friendly name, context unique name, context friendly name, active
  integer sequence, and default integer sequence.
- The method string argument is a context, not an action ID. Enumerate all
  components with no argument or `default`, validate exact root shape, signature,
  tuple cardinality/types, context, and component identity, then filter exact
  action IDs. Malformed, unknown, or absent data is an abort, never zero matches.
- Persisted records may survive an unloaded script and do not prove a callback.
  Unregister only an exact recorded component/action pair, and only actions
  recorded after validated registration. Do not use unconditional cleanup.

## Journal and Supervisor

- KWin runs as the systemd **user** unit `plasma-kwin_wayland.service`. Its
  messages, including `plasma-auto-tiler:` diagnostics and `kwin_scripting`
  errors, appear only in `journalctl --user` (the unscoped default currently
  matches `--user` but is not a substitute for stating scope explicitly).
  `journalctl --system` returns zero records for the KWin PID and looks
  exactly like "no diagnostics were emitted"; never use `--system` for these
  captures.
- Filter by `_PID=<recorded KWin PID>` only. Corroborating fields are
  `_COMM=.kwin_wayland-w` and `SYSLOG_IDENTIFIER=kwin_wayland`.
  `_SYSTEMD_USER_UNIT` and other cgroup fields are not reliably present on
  every record and must not be required for identity filtering.
- Production `plasma-auto-tiler:` diagnostics carry `QT_CATEGORY=js` at debug
  priority, not `kwin_scripting`. Match the fixed prefix on message text
  independent of category. Keep the separate unanchored
  `QT_CATEGORY=kwin_scripting` error check (warning priority); the two checks
  are independent and neither implies the other. No `QT_LOGGING_RULES` change
  has been needed to observe either category in this session.
- Acquire one journal cursor before mutation. Prefer bounded synchronous
  `--quiet --after-cursor` reads filtered to the recorded KWin PID over
  background followers. Fail closed on cursor, command, or parser failure.
  Exact contract: `journalctl --user --quiet --show-cursor -n 1` immediately
  before `loadScript`; after `run()` returns, one bounded synchronous
   `journalctl --user --quiet --no-pager --after-cursor=<cursor> _PID=<pid>`
   read. Fail closed on cursor acquisition failure, non-zero read status, or
   `-- No entries --` presentation text (requires `--quiet`).
- `--show-cursor` prints a display prefix (`-- cursor: `). Strip that prefix
  before passing the opaque cursor token to `--after-cursor=`; otherwise
  journalctl rejects the cursor. Prove the stripped-token path with the
  required true-positive marker before it gates a live attempt.
- An empty after-cursor read is never proof that a capture contract works.
  Prove any new capture contract against a true positive, such as a benign
  `logger`-written marker, before it gates a live attempt; an empty result
  with no error only proves the read command did not crash.
- Use one `systemd-run --user --collect` launch with an attempt-owned script in
  a nonce XDG runtime directory, invoked through `/bin/sh`. Scripts in
  `/tmp/opencode` have failed with `203/EXEC`.
- Prove detachment with ready/start markers plus active/running MainPID evidence.
  Cleanup is idempotent and exact: no unconditional unload/unregister, bounded
  D-Bus calls, and no broad process matching.
- Supervisor trigger design (heartbeat plus early-trigger, proven by
  `unit-05/attempt-15`): a pure 120-second failsafe with no early-trigger path
  can preempt a still-in-progress attempt when real inter-step elapsed time
  approaches the bound (observed in `unit-05/attempt-13`). Instead, have the
   foreground process or a dedicated writer touch a `heartbeat` file before and
   after every
  significant step, and write a `trigger` file the instant it is done
  (success or fail-fast). The supervisor polls roughly every 0.5-1 second and
  cleans up on whichever comes first: the `trigger` file appears, the
  `heartbeat` file's mtime is stale by more than 120 seconds (crash
  detection), or an internal terminal bound elapses (default up to 900
  seconds; choose the smallest value the attempt actually needs). Set
  `systemd-run --property=RuntimeMaxSec=` a little above the internal
  terminal bound as an outer systemd-level safety net. Cleanup remains
   idempotent and exact-manifest regardless of which condition fired.
- The heartbeat must continue while the supervisor remains responsible,
  including read-only diagnosis and evidence collection after the last
  mutation. A stale heartbeat can otherwise trigger valid cleanup before the
  foreground writes its trigger. A dedicated writer at a bounded cadence is an
  acceptable way to keep this independent of foreground diagnosis.
- Record action-ownership for cleanup as soon as the read-only KGlobalAccel
  collector confirms the exact actions newly exist after `run()` returns,
  independent of the journal-diagnostic readiness gate. Never let a
  diagnostics gate be the sole trigger for recording ownership: a capture
  defect then causes real residue requiring separately authorized recovery.
   Startup diagnostics are supplementary for invocation and window journeys
   when a valid load ID and introspected script object, successful `run()`, the
   exact current project-action fail-closed collector, no same-PID `kwin_scripting`
   evaluation error, and valid supervisor/heartbeat/ownership manifests are
   independently established. Verify product outcomes from authoritative live
   state; an empty diagnostic capture is not a startup failure.
- Retain ready, start, cleanup, and complete evidence, journal/result evidence,
  and postflight proof before removing the runtime directory. `--collect` can
  leave a successful unit as not-found, so markers, journal, and result are the
  proof. Say `systemd-run invocation` rather than implying a persistent launch.
- `rg -c` returns status 1 and empty stdout for no matches. For an absence gate,
  use `rg -q`, accept exactly status 1, and fail on every other status. Background
  children or inherited descriptors can keep command runners blocked. `rg -F`
  treats a `|`-joined pattern as one literal string, not alternation; use plain
  `rg` or separate `-F` calls for multi-pattern searches.

## Window Journeys

- Use only explicitly verified Wayland-native, normal, resizable test clients.
  Before insertion, require observed/eligible/managed diagnostics and validate
  focus, active window, current desktop/output scope, and tile association.
- Prompt one manual event at a time and retain the matching fixed diagnostic and
  state evidence: keyboard completion, directional drag split, Esc cancellation
  with unchanged state, and retained-empty placement. Missing evidence stops the
  journey; it cannot be inferred from the visible layout.
- The current live boundary is narrower than general client eligibility:
  `unit-05/attempt-18` proved Client A's `window-added-eligible` and
  `automatic-placement-managed` path. Client B then reached
  `keyboard-invoked` but fail-fast rejected at
  `keyboard-rejected:target-occupancy-validity`; no claim about keyboard
   insertion, Client C, drag, or Esc follows from Client A's success.

## Temporary Desktop Ownership

- Read `desktops` as exactly `{"type":"a(uss)","data":[[position,id,name],...]}`.
  Reject unexpected envelope keys/type, non-integral positions, empty strings,
  malformed tuples, duplicate positions, or duplicate IDs.
- Before mutation, atomically record the unique requested name and the exact
  validated before-ID set in the supervisor manifest; the requested name must
  be absent. After `createDesktop`, retain and validate the full after envelope.
  Its after-minus-before ID set must contain exactly one ID, and exactly one row
  with the requested name must map to that ID. Atomically augment the manifest
  with that ID before further mutation.
- If interrupted before augmentation, supervisor recovery validates the current
  envelope and removes only the unique requested-name row whose ID is in the
  verified after-minus-before set. Any zero, multiple, duplicate, or malformed
  result is an ownership failure, not a cleanup guess.
- Switching to an owned temporary desktop can itself create one default
  `[Tiling][desktop][output]` group, before any client is launched. Immediately
  after the verified switch, discover and atomically record its exact output ID
  when it is unique; supervisor cleanup must delete those exact keys even if a
  later gate stops before Client A.

## Attempt Lessons

| Observation | Durable rule |
|---|---|
| Invisible go-file after load | Require startup diagnostics and unfiltered same-PID scripting errors. |
| Bare catch parser rejection | Keep production output ES2017 with explicit catch bindings. |
| Former temporary desktop group | Preflight every owned former group; never touch unrelated stale groups. |
| Action used as KGlobalAccel context | Query `default` or unfiltered, then filter exact action IDs. |
| Ignored `registerShortcut` result | Gate readiness on aggregate boolean success. |
| Persisted action after unload | Treat it as residue; target only the exact recorded pair. |
| Failed detachment, 203/EXEC, repeated launch | Use one runtime-directory `/bin/sh` systemd launch with marker proof. |
| Background captures blocked runner | Use synchronous after-cursor reads. |
| Whitespace-split shortcut tuples | Parse JSON with exact schema and tuple checks. |
| `rg -c` absence check | Use `rg -q` and require status 1. |
| Unretained load response | Save raw stdout atomically before a strict parser. |
| `--system`-scope journal cursor hid a real successful run's diagnostics; ownership was gated on that empty capture, leaving five persisted actions requiring authorized recovery | Use `--user` scope for all KWin journal capture; record KGlobalAccel ownership as soon as the collector confirms the actions exist, independent of the diagnostic gate. |
| Pure 120s failsafe preempted a still-in-progress attempt (`unit-05/attempt-13`) | Use a heartbeat-plus-early-trigger supervisor: clean up on trigger file, stale heartbeat (>120s), or an internal terminal bound (default up to 900s), whichever is first. |
| `pgrep -f` self-matched the checking command's own text, falsely suggesting a second KWin process | Identify the KWin PID via `/proc/<pid>/comm` or `pgrep -a` (argv[0]/comm match), never `pgrep -f` against a pattern that could appear in the checking command itself. |
| First live client on a brand-new temporary desktop was `window-added-rejected:eligibility-or-scope`, not `window-added-eligible` (`unit-05/attempt-15`) | Historical diagnosis only: the later fine-grained correction and attempt 18 proved Client A eligible. Do not infer eligibility for a different journey from either result. |
| A host quota interruption killed the foreground Lead process mid-`unit-05/attempt-16` dispatch; the detached supervisor kept running and its own automatic (heartbeat-stale/terminal-bound) cleanup later fired unattended. That cleanup correctly removed the plugin, actions, client process, and the temporary desktop itself, but left the temporary desktop's default `[Tiling]` group entry behind (`kwinrc`, confirmed by exact-timestamp `journalctl` correlation against the supervisor's own service-exit accounting) | KWin does not purge a desktop's `[Tiling]` group entry on desktop removal, so any cleanup path that removes a temporary desktop leaves its stale tiling group behind; this is a real interrupt/automatic-cleanup-path hazard, not observed in the manually-verified-clean `unit-05/attempt-13`/`unit-05/attempt-15` runs. Treat any such leaked group exactly like other unrelated stale tiling groups: never a cleanup target, never modified. If a foreground dispatch is interrupted, expect the detached supervisor's own cleanup to still run unattended and to potentially leave one stale tiling group per temporary desktop it removed; rebaseline the next attempt's postflight target against directly-observed live state rather than an earlier recorded checkpoint. |
| `--show-cursor` output was used verbatim as an `--after-cursor` token | Strip the `-- cursor: ` display prefix and validate the stripped token with a true-positive marker before live gating. |
| Heartbeat lapsed during post-mutation read-only diagnosis in `unit-05/attempt-18` | Keep heartbeat ownership active through trigger writing and completion, or use a dedicated bounded writer; stale-heartbeat cleanup is correct but can preempt evidence collection. |
| `loadScript` returned a valid envelope but the harness rejected it in `unit-05/attempt-20` | Parenthesize and prevalidate jq predicates for the exact strict envelope. A parser failure before `run()` is failed-clean only, even when cleanup succeeds. |

## Current Boundary and Resumption

- The nonce-owned supervisor, corrected `--user` cursor capture, collector, and
  load-ID contract remain reusable operational contracts. The current bundle is
  `513e45d5...`; source typecheck and 147 tests across 23 suites passed. The
  singleton-occupant fallback for the Client B target-occupancy suspicion is
  static-only and has not been live-accepted.
- `unit-05/attempt-18` proved Client A acceptance and automatic placement with
  bundle `e76e...`. Its Client B result is a real functional boundary:
  `keyboard-invoked` reached `keyboard-rejected:target-occupancy-validity`.
  Client C, drag, and Esc were not attempted. The later deferred desktop-scope
  experiment established a decode failure, not a short settling-race remedy;
  it does not establish a general QV4/QJSEngine marshalling conclusion.
- `unit-05/attempt-20` failed-clean before `run()` because a valid load response
  was rejected by jq operator precedence. Its dedicated 10-second heartbeat
  writer advanced 28 times and owned-resource cleanup completed. Retained
  postflight `kwinrc` evidence differs from preflight, so do not claim
  byte-identical configuration restoration for that attempt without new
  evidence. No Client A/B/C result or new diagnostic was obtained.
- Resume only under fresh live authorization: correct and true-positive-test the
  parser predicate, retain ownership before its failure cleanup can race, then
  rerun the bounded Client B gate. Manual drag and Esc remain untested and need
  a future interactive session.

## Agent Discipline

- Give each live package one tightly bounded objective, one subagent at most,
  and proportional hard caps. Never resume host-unknown or malformed agents.
- The Lead inspects actual artifacts and evidence. Noncompliant reports establish
  nothing and cannot support acceptance. Never repeat a live launch within one
  authorization.

## Related Records

- [Active Custom Tile state](changes/custom-tile-vertical-slice/state.md)
- [Active Custom Tile log](changes/custom-tile-vertical-slice/log.md)
- [Active Custom Tile plan](changes/custom-tile-vertical-slice/plan.md)
- [Keyboard navigation archive](changes/archive/2026-08-11-keyboard-navigation-vertical-slice/)
