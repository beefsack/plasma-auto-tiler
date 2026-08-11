# JS Baseline Measurement - Variant A (stateless) script and log contract

This change measures KWin `windowAdded` dispatch cost and overhead (spec
`docs/changes/js-baseline-measurement/spec.md`, Q1/Q2). Two instrumented KWin
scripts are measured on the same harness with identical instrumentation:

- **Variant A (stateless)** - this directory's deliverable (`script/variant-a.js`).
  A single stateless `windowAdded` handler: derive a trivial deterministic
  rectangle, write it once, log one timing line. Clean floor for the measurement.
- **Variant B (stateful)** - a managed-window state model with full layout
  reconciliation on every window add and remove, representative of a real
  tiler's workload. Written by unit-03 (`script/variant-b.js`); it reuses the
  exact log line format and the exact D-Bus log-sink contract documented
  below.

Neither variant is loaded into the live session by this unit; the load/unload
commands below are for unit-05/unit-06 to run during the live sweeps.

## Files

- `script/variant-a.js` - the Variant A KWin script.
- `script/variant-b.js` - the Variant B KWin script (unit-03).
- `README.md` - this file: load/unload commands, log contract, and known
  API-precision caveats.

## Variant B (stateful) script

`script/variant-b.js` maintains its own managed-window state model (a JS
object mapping `internalId` to the window reference plus its captured output
geometry), populated and depopulated via `workspace.windowAdded` and
`workspace.windowRemoved`, filtered with the same `window.normalWindow &&
window.managed` test as Variant A plus the same `managedResourceClass` scope
restriction (see "Terminal-protection scope restriction"). On every
`windowAdded` and every
`windowRemoved` for a tracked window it runs a full layout reconciliation
over its own model (it never re-derives the window set from
`workspace.windowList()`), writes geometry to every currently managed window,
and logs exactly one line per triggering event to
`/tmp/plasma-auto-tiler/variant-b.log` using the identical line format and
the identical D-Bus log-sink contract (`com.plasmaAutoTiler.LogSink` service,
`/com/plasmaAutoTiler/LogSink` path, `append` method, one string argument)
documented below. On removal the window is dropped from the state model first
and reconciliation runs over the remaining entries, so the model is
authoritative regardless of whether the window is still present in
`workspace` at `windowRemoved` time.

Layout algorithm choice: **plain columns**. N managed windows become N
equal-width vertical columns spanning the full height of the layout area.
Chosen over master-stack because it is a single O(N) pass with one uniform
formula per window (no per-window master/stack branch), so the measurement
stays focused on the reconciliation and geometry-write cost rather than on
layout arithmetic. The layout area is the triggering window's output
(captured at add time and stored in the state model, so no live output read
is needed at removal time). This is deliberate: multi-monitor handling is a
specified non-goal, and the harness is single-output, so all managed windows
land on that one area. The number of geometry writes per event is exactly N
(the count of currently managed windows), for both add- and remove-triggered
events.

`windowRemoved` event-type choice: removal-triggered events are logged with
the distinct event-type value **`windowRemoved`** (addition-triggered events
use `windowAdded`, as in Variant A). The first CSV field is an event-type
value, not a fixed literal, so keeping the two values distinct preserves
whether each line came from an add or a remove; this also leaves the
pooled-vs-separate reporting decision for the findings report (spec
Unresolved Questions) open by keeping the distinction in the raw data.

Load and unload (D-Bus, for unit-06), mirroring Variant A but with plugin
name `plasma-auto-tiler-variant-b`:

```
qdbus org.kde.KWin /Scripting loadScript \
  /home/beefsack/Development/plasma-auto-tiler/docs/changes/js-baseline-measurement/script/variant-b.js \
  plasma-auto-tiler-variant-b
```

**Then start it** (see "loadScript does not run the script" note below --
this step is required, not optional):

```
qdbus org.kde.KWin /Scripting start
```

Check:

```
qdbus org.kde.KWin /Scripting isScriptLoaded plasma-auto-tiler-variant-b
```

Unload:

```
qdbus org.kde.KWin /Scripting unloadScript plasma-auto-tiler-variant-b
```

The plugin name `plasma-auto-tiler-variant-b` must not be shared with any
other script. Only one variant is loaded at a time during measurement.

## Loading and unloading (D-Bus, for unit-05/unit-06)

Load:

```
qdbus org.kde.KWin /Scripting loadScript \
  /home/beefsack/Development/plasma-auto-tiler/docs/changes/js-baseline-measurement/script/variant-a.js \
  plasma-auto-tiler-variant-a
```

**Then start it** (see "loadScript does not run the script" note below --
this step is required, not optional):

```
qdbus org.kde.KWin /Scripting start
```

Check:

```
qdbus org.kde.KWin /Scripting isScriptLoaded plasma-auto-tiler-variant-a
```

Unload:

```
qdbus org.kde.KWin /Scripting unloadScript plasma-auto-tiler-variant-a
```

Notes:

- The short method names (`loadScript`, `isScriptLoaded`, `unloadScript`,
  `start`) resolve to the `org.kde.kwin.Scripting` interface on
  `/Scripting`; the fully-qualified forms `org.kde.kwin.Scripting.loadScript`
  etc. also work.
- `loadScript` returns the script id (int), or `-1` if a script with that
  plugin name is already loaded. `isScriptLoaded` and `unloadScript` return
  booleans. The plugin name `plasma-auto-tiler-variant-a` must not be shared
  with any other script.
- **`loadScript` does not run the script's top-level code.** This was
  discovered and empirically verified during the live clock-resolution probe
  (`research/clock-resolution.md`, section 5): the file is only parsed and
  registered by `loadScript`; `workspace.windowAdded.connect(...)` (and
  therefore all event handling) does not take effect until
  `org.kde.kwin.Scripting.start` is called, which runs the top-level code of
  every loaded-but-not-yet-started script exactly once. Calling `start`
  again after a script has already run does not re-run it. The harness
  (unit-04) and every live sweep (unit-05/unit-06) must call `loadScript`
  then `start`, in that order, for each run; a `loadScript`-only sequence
  silently loads a script that never does anything.
- Reverse order after a sweep: `unloadScript`, then verify
  `isScriptLoaded` is `false` and that `kwin_wayland` still answers
  `org.freedesktop.DBus.Peer.Ping` on `org.kde.KWin`.

## What the script does

On every `workspace.windowAdded` (KWin 6 documented signal):

1. Skips the window unless it matches the configured `managedResourceClass`
   (exact `===` match; see "Terminal-protection scope restriction"), then
   unless it is a normal, manageable window: `window.normalWindow &&
   window.managed`. `normalWindow` is true only for `WindowType::Normal`
   (KWin source `Window::isNormalWindow()`), so docks, panels, menus, popups,
   tooltips, notifications, splash, dialogs, desktop windows, and other
   specialized types are all skipped, as a real tiler would. `managed` is true
   for windows KWin itself manages (excludes override-redirect popups).
2. Records a start timestamp: `Date.now()` (epoch milliseconds).
3. Computes the rectangle in O(1): the left half of the window's output
   (`window.output.geometry`), full output height. It reads only the
   triggering window's own `output.geometry` and `frameGeometry`; it does
   not iterate or read any other window, and it maintains no persistent
   counter or state across events.
4. Writes the geometry exactly once by assigning `window.frameGeometry`.
   In KWin 6 the `frameGeometry` property's WRITE accessor is
   `Window::moveResize` (KWin source `src/window.h`), so one assignment is
   one move/resize request. The rectangle is copied into a plain object with
   `Object.assign({}, window.frameGeometry)`, mutated, and assigned back -
   the pattern confirmed working by a KWin developer; direct per-field
   mutation of the value-type wrapper writes through per field and is
   avoided so the event causes exactly one geometry write.
5. Records an end timestamp: `Date.now()`.
6. Emits one log line (format below) as a single string argument of one
   `callDBus` to the log sink described next.

The handler is fully synchronous; the only deferred work is the bus delivery
of the log line, which happens after the measured start/end interval has
already been recorded. There are no queues, timers, layout framework,
persistence, or D-Bus calls other than the single log-sink `callDBus` per
event.

## Log output

### File path

`/tmp/plasma-auto-tiler/variant-a.log`

Variant B (unit-03) must use the identical line format with the path
`/tmp/plasma-auto-tiler/variant-b.log`. The harness truncates/rotates the
file at the start of each sweep run so per-tier data is clean.

### Line format

One line per event, CSV, no header, no quoting needed (values contain no
commas). Each line records, in order: event type, window identifier, start
timestamp, end timestamp, elapsed time.

```
<event-type>,<window-internal-id>,<start-ms>,<end-ms>,<elapsed-ms>
```

The first field is the event type: Variant A logs `windowAdded`; Variant B
logs `windowAdded` on addition and `windowRemoved` on removal (see the
Variant B section above for the choice). `<window-internal-id>` is the string
form of the window's `internalId` UUID, KWin's documented unique per-window
identifier. Timestamps are `Date.now()` epoch milliseconds. Example line:

```
windowAdded,7e2f1a4b-9c3d-4e5f-8a1b-2c3d4e5f6a7b,1723234567890,1723234567890,0
```

Parseable with standard CLI tools, e.g. `cut -d, -f5` for elapsed time or
`awk -F, '{print $1}'` for event type.

### How a line reaches the file

KWin's plain `loadScript` environment (QJSEngine) exposes **no filesystem
API** and no `Qt` global: the globals installed by KWin are `workspace`,
`options`, `KWin`, `QTimer`, `console`, `callDBus`, `readConfig`, the
`register*` helpers, and the assert functions. There is no `fs`, no
`XMLHttpRequest`, and no synchronous file write. The only outbound channel
is `callDBus`.

The script therefore emits each log line as a method call to a fixed,
reserved sink interface:

- Service: `com.plasmaAutoTiler.LogSink`
- Path: `/com/plasmaAutoTiler/LogSink`
- Interface: `com.plasmaAutoTiler.LogSink`
- Method: `append`
- Arguments: exactly one `string`, the full log line (format above)
- No callback argument (fire-and-forget, keeps the handler synchronous)

The call traverses the session bus; the capture side (unit-04 harness)
observes it and appends the string verbatim to the log file at the path
above. Two capture options for the harness, per the repo's shell-tooling
preference (prefer existing CLI tools):

1. `dbus-monitor --session "interface='com.plasmaAutoTiler.LogSink'"` and
   extract the single `string "..."` argument of each `method call`
   record, appending it to the file. The method call is observable even if
   no service owns the reserved name (the bus monitors every message).
2. Register a small service that owns `com.plasmaAutoTiler.LogSink` and
   appends each received string to the file.

D-Bus method calls from one client to one destination are delivered in
order, so lines are appended in event order even when windows are spawned in
a burst. Because the write is async and occurs after the synchronous
handler returns, the file-write latency is outside the measured start/end
interval and does not contaminate the measurement.

## Timestamp precision caveat (empirically resolved by the clock-resolution probe)

Timestamps use `Date.now()` (millisecond resolution, wall clock). This was
originally an open question pending live confirmation; it is now resolved
empirically by a dedicated live clock probe -- see
`research/clock-resolution.md` for the full evidence. Verdict: **no
higher-resolution clock exists in KWin's `loadScript` QJSEngine.**
`performance`/`performance.now`, `process`/`process.hrtime`, and `globalThis`
are all absent; a full 127-name enumeration of the global object found only
`Date` (1 ms resolution) and `QTimer` (a callback scheduler, not a clock) as
timing-related globals. An empirical 100,000-call loop showed every observed
step was exactly 1 ms, never sub-millisecond.

Consequence: the spec's decision thresholds (~0.83 ms / ~1.67 ms) fall
inside a band that a 1 ms clock cannot resolve. Per-event `Date.now()`
timing is retained as the real-dispatch distribution (it can still detect
the native-justifying case, p95 > 1.67 ms, and can still establish
negligibility via consistent 0 ms readings), and is supplemented by a
separate, clearly-labeled synthetic amplification measurement (see below)
that estimates a precise per-operation compute figure by dividing an
adaptively-bounded repeated-execution wall time by the repeat count. The two
are never pooled into the same distribution. This must be reported as a
measurement-validity caveat in unit-07.

## Synthetic amplification measurement (calibration-only, OFF by default)

Because no higher-resolution clock exists, a single handler invocation is far
faster than 1 ms and its real elapsed time reads 0. To get a usable
per-operation figure, both scripts can emit a second, separate measurement:
when enabled, the script repeats the exact same compute+write body (Variant
A: the rect computation plus the `frameGeometry` assignment; Variant B: a
`reconcile(output)` call) in a bounded synchronous loop, times the whole loop
with `Date.now()`, and divides by the iteration count.

This measurement is **OFF by default** (`readConfig("amplify", "0")`) and is
intended to be enabled only for a short, separate calibration pass run once
per variant. It must stay off for the main 5/20/50/100 sweep: it repeats
N-window reconciliation up to thousands of times per event, which at N=100
would stall the compositor unacceptably. It is a *synthetic* figure that
isolates compute+write cost, not the per-event dispatch path, and is never
merged into the real-dispatch distribution.

### Config keys (readConfig, `~/.config/kwinrc`)

Each of the three `amplify*` keys is read via `readConfig` once per handler
invocation, after the real log line is emitted and outside the measured
start/end interval, so the real-dispatch measurement is unchanged and gains
only one cheap config read per event when amplification is disabled.

| Key | Default | Meaning |
|---|---|---|
| `amplify` | `"0"` | When `"0"` (default), no amplification runs and no loop executes. Any other value enables it. |
| `amplifyMaxMs` | `"20"` | Wall-clock cap for the whole amplification loop, in ms. The guard is checked every 64 iterations (not every iteration), so the guard check itself does not dominate the measurement. |
| `amplifyMaxIterations` | `"5000"` | Hard upper bound on loop iterations, independent of the wall-time cap, as a safety net. |
| `managedResourceClass` | `"__unset__"` | Terminal-protection scope restriction (see that subsection): the exact `resourceClass` a window must match for the script to act on it, compared with `===`. The sentinel default `"__unset__"` cannot match any real window, so an unconfigured script is inert (acts on nothing), not permissive. Set this to the harness test-window class before any live sweep. |
| `watchdogMaxLifetimeMs` | `"300000"` | Fail-safe watchdog deadline (see that subsection): milliseconds after script start at which the script disconnects its window handlers and stops acting on windows, even if the harness died and never called `unloadScript`. A non-positive value falls back to the default. |

The two safety keys (`managedResourceClass`, `watchdogMaxLifetimeMs`) are read
**once at script start** (top-level, not per event): the configured class
cannot change during a script's lifetime, and the watchdog deadline is a fixed
lifetime, so reading them per event would add pointless overhead to every
measured dispatch.

The `reconfigure` step is required for the freshly written keys to be
visible; this mirrors the tutorial's own `kwriteconfig6` + `reconfigure`
pattern for enabling scripts.

### Log file and line format (separate from the real-dispatch log)

Amplification lines go through the same D-Bus log sink
(`com.plasmaAutoTiler.LogSink`, `/com/plasmaAutoTiler/LogSink`, `append`, one
string argument) but must land in different files from the real-dispatch
log:

- `/tmp/plasma-auto-tiler/variant-a-amplified.log`
- `/tmp/plasma-auto-tiler/variant-b-amplified.log`

The sink contract carries only the line text and does not encode a target
file, so the demux is by a source tag in the first CSV field. This changes
how the harness must handle its single `dbus-monitor` stream: lines whose
first field is `amplified-a` are routed to `variant-a-amplified.log`, lines
whose first field is `amplified-b` to `variant-b-amplified.log`, and every
other line to the real-dispatch file (`variant-a.log` / `variant-b.log`).
Real-dispatch lines never carry these tags, so the split is unambiguous.
Watchdog lines (`watchdog-a`/`watchdog-b`, see "Fail-safe watchdog") fall
under the default "every other line" route and land in the real-dispatch
file.

Line format, CSV, no header:

```
<source>,<internal-id>,<iterations>,<total-ms>,<per-operation-ms>,<cap>
```

- `<source>`: `amplified-a` or `amplified-b` (the demux tag).
- `<internal-id>`: string form of the triggering window's `internalId`, so
  the calibration figure can be correlated with that window's real-dispatch
  line.
- `<iterations>`: count of loop iterations actually completed.
- `<total-ms>`: `Date.now()` end minus start for the whole loop (integer ms).
- `<per-operation-ms>`: `total-ms / iterations` as a decimal (for example
  `0.000488`); `0` when the loop elapsed 0 ms, guarding the division so it
  never throws.
- `<cap>`: `wallcap` if the wall-time cap bound the loop, `iterationcap` if
  the iteration-count cap bound it (the findings report can note which bound
  was binding at each tier).

Example line:

```
amplified-a,7e2f1a4b-9c3d-4e5f-8a1b-2c3d4e5f6a7b,5000,17,0.0034,iterationcap
```

### Idempotency: why repeated execution is safe

Both variants' compute bodies are idempotent, so a calibration pass leaves
every window exactly where the real-dispatch path would have put it, with no
drift or position corruption:

- **Variant A:** every iteration recomputes the identical half-output rect
  from `window.output.geometry` and assigns it to `window.frameGeometry`
  (one `moveResize` request to the same geometry each time).
- **Variant B:** `reconcile(output)` iterates the script's own managed-window
  model and assigns each window a position derived only from `output` and the
  current window count. It reads no live `workspace` state and mutates
  neither the model nor `output`, so calling it K times writes identical
  geometry K times.

### Constraint note

The amplification loop is a bounded synchronous loop, not a `QTimer`, and it
runs only when explicitly enabled by config. It therefore preserves the
real-dispatch path's "no queues, no timers" property. This mirrors the
reasoning already used for the live-sweep's mandatory watchdog exemption:
measurement/safety instrumentation, not tiling logic.

## Terminal-protection scope restriction

Both variants now act only on windows whose `resourceClass` exactly matches the
config key `managedResourceClass` (`===` match, not substring/regex). This is a
deliberate deviation from the originally-scoped "any normal/managed window"
behavior, made for the live-sweep's safety per the Orchestrator's
authorization: the controlling terminal (and every other real application
window) must never be resized, moved, or otherwise managed by the test scripts.
Each script's managed set is restricted to harness-spawned test windows
identified by a distinctive `resourceClass`, so reconciliation still operates
across all managed test windows and the N-geometry-writes-per-event workload of
the Variant B amendment is unchanged.

The default for `managedResourceClass` is the sentinel `"__unset__"`, which
cannot match any real window. **Unconfigured means inert, not permissive**: if
an operator loads a variant without setting this key, the script acts on
nothing. The key is read once at script start (top level), not per event, since
it cannot change during a script's lifetime.

To configure (the same `kwriteconfig6` + `reconfigure` pattern as the
amplification keys; substitute the harness's actual test-window class for
`<value>` and the variant's plugin name for `<pluginName>`):

```
kwriteconfig6 --file kwinrc --group Script-<pluginName> --key managedResourceClass <value>
qdbus org.kde.KWin /KWin reconfigure
```

Validity implication, to be recorded in the findings report (unit-07) and not
just here: measured events are only ever caused by harness-spawned test windows
matching one specific `resourceClass`. This is realistic for the harness's own
synthetic windows (which is what is being measured anyway, per the spec's own
harness-realism caveat), but it means any OTHER real window opened during a
live sweep run (by the user, accidentally, or by any other running application)
is guaranteed to be ignored by the script. That is the intended safety property,
not a measurement artifact.

Note on stability: `resourceClass` is a documented read-only `Window` property,
but KWin does have a `windowClassChanged` signal ("Emitted whenever the window
class name or resource name of the window changes", per the official API
docs), so in theory a window's class could change between `windowAdded` and
`windowRemoved`. Variant B therefore also gates `handleWindowRemoved` on an
explicit `resourceClass` check. This is defense in depth: removal already only
acts on windows already present in the maintained `managedWindows` map, which
is populated exclusively by the (now resourceClass-filtered) add handler, so it
is already implicitly scoped; the explicit check covers the edge case of a
class changing between add and remove.

## Fail-safe watchdog (bounded lifetime self-disarm)

Both variants self-disarm after a bounded lifetime even if the harness dies and
never calls `unloadScript`, so a wedged or crashed harness cannot leave window
management captured indefinitely. This is a safety watchdog, not tiling logic,
and does not conflict with the design doc's no-timers rule (which is about
tiling behavior; this is fail-safe instrumentation, the same exemption already
recorded for the amplification loop above).

Mechanism: a single-shot `QTimer`, constructed as `new QTimer()`, started once
at script start with interval `watchdogMaxLifetimeMs` (default `"300000"`, 5
minutes). When it fires, the script disconnects its `windowAdded` (and, for
Variant B, `windowRemoved`) handlers and stops the timer, which is what
"self-unload" means operationally: a script cannot call `unloadScript` on
itself. That method exists only on the `org.kde.kwin.Scripting` D-Bus object;
it is not exposed to the script's own JS global scope (confirmed from the KWin
6.7.3 source, which installs `readConfig`, `callDBus`, `QTimer`, `workspace`,
`options`, `KWin`, the `register*`/`unregister*` helpers, and the assert
functions as globals, and never the Scripting object or an `unloadScript`
global). Disconnecting the handlers is therefore the correct and only
in-script mechanism.

The `QTimer` global in KWin's `loadScript` engine is KWin's own `ScriptTimer`
class (a `QTimer` subclass whose constructor is `Q_INVOKABLE`), exposed via
`m_engine->newQMetaObject(&ScriptTimer::staticMetaObject)` in
`src/scripting/scripting.cpp` (verified against the v6.7.3 source). That is why
`new QTimer()` is constructible and why the instance exposes `QTimer`'s
properties (`singleShot`), slots (`start(ms)`, `stop()`), and signal (`timeout`)
to JS. The static `QTimer.singleShot` shortcut is absent in this build
(clock-probe finding) and is not used. The timer instance is JS-owned, so it is
destroyed with the script's engine on unload; no orphan timer can outlive the
script.

On fire the script emits one log line through the same D-Bus log sink:
`watchdog-a,fired,<elapsed-ms>` / `watchdog-b,fired,<elapsed-ms>`, where
`<elapsed-ms>` is milliseconds since script start. The line routes like any
non-amplified line (see the demux rule above), so it lands in the respective
real-dispatch log (`variant-a.log` / `variant-b.log`) as a run-level event,
recognizable by its first field (`watchdog-a`/`watchdog-b`) and 3-field shape,
distinct from the 5-field measurement lines. The harness and any parser must
tolerate it (it is never a measurement line).

Caveat: the watchdog is an event-loop timer. If the compositor's event loop is
blocked (e.g. a handler is stuck in a synchronous loop), the watchdog cannot
fire until the loop unwinds; it protects against an abandoned script, not
against a script deadlocking the compositor (the manual-recovery section below
covers that case).

## API usage notes and residual uncertainty

- `workspace.windowAdded` (signal), `window.normalWindow`, `window.managed`,
  `window.output`, `output.geometry`, `window.frameGeometry` (read-write),
  `window.internalId`, and `window.resourceClass` (read-only QString) are all
  present in the official KWin 6.0 scripting API documentation.
- KWin's `Window` has a `windowClassChanged` signal ("Emitted whenever the
  window class name or resource name of the window changes"), per the official
  API docs; `resourceClass` is therefore not guaranteed stable across a
  window's lifetime, which is why Variant B's removal handler re-checks it.
- The `QTimer` global is KWin's `ScriptTimer` (a `QTimer` subclass with a
  `Q_INVOKABLE` constructor) exposed via `newQMetaObject`, verified in the
  KWin 6.7.3 source (`src/scripting/scripting.cpp`); `new QTimer()` is
  therefore constructible and exposes `QTimer`'s properties, slots, and
  `timeout` signal, but not the static `QTimer.singleShot` shortcut
  (clock-probe finding). A script cannot unload itself: `unloadScript` exists
  only on the `org.kde.kwin.Scripting` D-Bus object, never in the script's JS
  global scope.
- `frameGeometry`'s WRITE accessor being `Window::moveResize`, and the
  value-type wrapper behavior (read returns a lazy reference wrapper whose
  per-field writes pass through to the window; copying via `Object.assign`
  and assigning back performs one write) are established from KWin and Qt
  source, not from the public scripting docs. The `Object.assign` pattern is
  confirmed working by a KWin developer on KWin 6.
- No KWin API name used in this script is guessed: every identifier above is
  either in the official API docs or directly verified in the KWin source
  for this version.
- `node --check` validates only ECMAScript syntax; it does not check that
  KWin globals (`workspace`, `callDBus`) exist. A live load/unload smoke
  test is unit-05, not part of this unit.

## Manual recovery (non-GUI)

If the graphical session becomes unresponsive while a script is loaded,
`kwin_wayland` is still reachable over the user's D-Bus session bus from any
shell in the login session (TTY or graphical), via systemd-logind; this does
not depend on the GUI being responsive. Force-unload a script with either
command form:

```
qdbus org.kde.KWin /Scripting unloadScript <pluginName>
```

```
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s <pluginName>
```

Both reach the `org.kde.kwin.Scripting` interface on `/Scripting`. Both
return `false` (exit 0) when the plugin name is not currently loaded, which
confirms the command syntax and bus reachability work. After unloading,
verify recovery with `isScriptLoaded` (expect `false`) and

```
busctl --user call org.kde.KWin /KWin org.freedesktop.DBus.Peer Ping ""
```

(exit 0 confirms `kwin_wayland` is still answering).

Plugin names in use by this change:

- `plasma-auto-tiler-variant-a` (Variant A script)
- `plasma-auto-tiler-variant-b` (Variant B script)
- `plasma-auto-tiler-clock-probe` (clock-resolution probe script, unit:
  research/clock-resolution.md)

Caveat: TTY-independence is inferred from systemd-logind session-bus
semantics, not directly tested from a second TTY (none is available in this
environment). Both commands above were verified from a shell inside the live
graphical session against a plugin name that is not currently loaded.
