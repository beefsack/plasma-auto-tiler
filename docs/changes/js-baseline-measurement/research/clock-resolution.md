# Clock Resolution in KWin loadScript QJSEngine (clock-probe)

Live-session empirical probe. A one-shot KWin script (`script/clock-probe.js`)
was loaded into the live `kwin_wayland` (Plasma 6.7.3), ran once at
`org.kde.kwin.Scripting.start`, logged 201 findings through the same D-Bus
log-sink contract as variant-a.js/variant-b.js, and was unloaded with the
session verified responsive before and after. No window was spawned, no
`workspace.windowAdded`/`windowRemoved` connection was made, and no window
management state was touched at any point.

## 1. Verdict

**There is NO usable higher-resolution clock in KWin's `loadScript`
QJSEngine environment. `Date.now()` is the only time source and it is
strictly millisecond-integer resolution (empirically: every observed step
exactly 1 ms, never any sub-millisecond value).**

- `performance` and `performance.now`: absent (`undefined`).
- `process` and `process.hrtime`: absent (`undefined`). `process` is a
  Node.js global, as the Lead's known-APIs list already stated.
- `globalThis`: absent (`undefined`) in this engine, despite being an
  ECMA-262 feature since ES2020. The probe fell back to top-level `this`,
  which is the global object in a script context.
- Full enumeration of the global object's 127 own property names (section 4)
  found no timing/clock global other than `Date` (1 ms resolution) and
  `QTimer` (a timer factory, not a clock - it schedules callbacks and
  exposes no timestamp reading).

Implication for the spec's Q2 thresholds: the 5% (~0.83 ms) and 10%
(~1.67 ms) of a 60 Hz frame bands cannot be resolved by JS-side wall-clock
timing in this environment. The variant scripts' `Date.now()`-derived
elapsed values will read `0` for any handler that completes within the same
millisecond, and the smallest measurable nonzero value is 1 ms. The Q2
distribution still discriminates "fast" (all or mostly 0) from "slow"
(1 ms or more) but cannot resolve values between 0 and 1 ms, nor
0.83 ms vs 1.67 ms. This must be reported as a measurement-validity caveat
in unit-07; the RSS-delta evidence is unaffected by clock resolution.

## 2. Globals tested and actual presence

Each candidate was resolved from the global object (`typeof
globalObject[name]` walk). Values are the empirical `typeof` in the live
engine:

| Global | Actual type | Notes |
|---|---|---|
| `globalThis` | `undefined` | absent despite ES2020; fell back to top-level `this` |
| `performance` | `undefined` | absent |
| `performance.now` | `undefined` | absent |
| `process` | `undefined` | absent (Node-only) |
| `process.hrtime` | `undefined` | absent |
| `console` | `object` | present - README claim CONFIRMED |
| `console.log` | `function` | present |
| `console.time` | `function` | present |
| `QTimer` | `function` | present - README claim CONFIRMED |
| `QTimer.singleShot` | `undefined` | the injected QTimer has no `singleShot` property in this build |
| `Qt` | `undefined` | absent |
| `Date` | `function` | present |
| `Date.now` | `function` | present |
| `callDBus` | `function` | present and functional (the probe emitted all 201 facts through it) |
| `print` | `function` | present (documented KWin global) |
| `workspace` | `object` | present (documented) |
| `options` | `object` | present (documented) |
| `KWin` | `function` | present (documented) |
| `readConfig` | `function` | present (documented) |
| `registerShortcut` | `function` | present (documented) |
| `registerScreenEdge` | `function` | present (documented) |

Both unverified README claims are now confirmed against a live engine:
`console` (object, with `log` and `time` functions) and `QTimer` (function)
both exist. They are not clocks: `console.log`/`console.timeEnd` write to
KWin's stderr/journal and cannot be read programmatically, and `QTimer`
schedules callbacks without exposing a timestamp.

## 3. Empirical Date.now() resolution

Bounded loop: 100,000 `Date.now()` calls, capped at 5 s of wall time by a
`Date.now()`-based guard. Results from the live engine:

- Total iterations: 100,000
- Loop wall time: 28 ms (measured with Date.now() itself, so ~280 ns per call)
- Distinct values observed: 28
- Runs (consecutive same-value segments): 29
- Minimum observed step: 1 ms
- Maximum observed step: 1 ms
- Minimum run of identical values: 467 calls
- Maximum run of identical values: 3,981 calls
- Average calls per distinct millisecond value: 3,448.28

Run-length histogram (len = calls returning the same ms value, count =
number of such runs): len 467,1282,1958,3002,3394,3412,3458,3460,3547,3613,
3635,3668,3674,3698,3707,3710,3738,3818,3824(x2),3846,3867,3878,3905,3916,
3922,3933,3981 (29 runs total).

Every value change was exactly 1 ms. **No sub-millisecond behavior was ever
observed.** The clock is integer-millisecond `QDateTime::currentMSecsSinceEpoch`
semantics, as Qt documents.

## 4. Global object enumeration

`Object.getOwnPropertyNames(G)` where G is top-level `this` returned 127
own property names. This set is CONTAMINATED by the probe's own top-level
`var` declarations (G, facts, addFact, candidates, clockHits, all loop
variables, etc.), because top-level `var` attaches to the global object;
every engine-native global is still visible among them. Excluding probe
artifacts, the engine globals are:

- Standard ECMA-262 builtins: Array, ArrayBuffer, Atomics, Boolean, DataView,
  Date, Error, EvalError, Float32Array, Float64Array, Function, Infinity,
  Int16Array, Int32Array, Int8Array, JSON, Map, Math, NaN, Number, Object,
  Promise, Proxy, RangeError, ReferenceError, Reflect, RegExp, Set,
  SharedArrayBuffer, String, Symbol, SyntaxError, TypeError, URIError,
  Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray, WeakMap, WeakSet,
  decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, escape, eval,
  isFinite, isNaN, parseFloat, parseInt, unescape, undefined.
- Non-standard but present in this build: URL, URLSearchParams.
- KWin scripting globals: assert, assertEquals, assertFalse, assertNotNull,
  assertNull, assertTrue, callDBus, console, KWin, options, print,
  readConfig, registerScreenEdge, registerShortcut, registerTouchScreenEdge,
  registerUserActionsMenu, unregisterScreenEdge, unregisterTouchScreenEdge,
  workspace, QTimer.

Clock-name scan (`/(time|clock|now|mono|hrtime|perf|nano|epoch|micro|date)/i`)
over the 127 names matched only: Date, QTimer, and probe-artifact variables.
No hidden or undocumented high-resolution clock exists among the globals.

## 5. Discovery: loadScript does not run the script; start() does

`org.kde.kwin.Scripting.loadScript` LOADS the script file but does NOT
evaluate its top-level code. `org.kde.kwin.Scripting.start` runs all loaded
scripts. Evidence:

- After `loadScript` alone, `isScriptLoaded` returned `true` but zero
  LogSink calls were captured: the probe's top-level code had not run.
- After `qdbus org.kde.KWin /Scripting start`, all 201 facts were emitted.
- Calling `start()` a second time emitted nothing more (the probe ran
  exactly once across two `start()` calls: 1x `probe_complete`, 1x
  `probe_flush`), so re-calling `start()` does not re-run an already-run
  script.

Direct consequence for unit-05/unit-06 and the README: the variant scripts
connect their handlers at top level, so the documented load-only commands in
this change's README are INCOMPLETE. The harness must call `start()` once
after `loadScript` for the `windowAdded`/`windowRemoved` handlers to be
connected. Loading once and calling `start()` once is the correct sequence;
re-calling `start()` was verified harmless (does not double-run), but the
harness should not rely on that unverified-under-repeat-load behavior beyond
the single observed no-op.

## 6. Fail-safe unload condition

The probe body connects to no signals and touches no windows. After the
one-shot load-time probe runs, the script holds no handlers and has no
code path that can fire, so it is inert for as long as it stays loaded. The
"fail-safe unload" requirement is satisfied trivially: there is no
window/event handling state that a failed unload could leave behind. This
was still exercised operationally: unload returned `true`, `isScriptLoaded`
returned `false`, and `kwin_wayland` answered `org.freedesktop.DBus.Peer.Ping`
(exit 0) afterward.

## 7. Commands actually run (exact command lines and outcomes)

Probe file syntax and text checks (no live session):

```
node --check docs/changes/js-baseline-measurement/script/clock-probe.js
```
Outcome: exit 0 (syntax valid; does not validate KWin globals).

```
grep -Pn '[\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}\x{00A0}]' script/clock-probe.js
```
Outcome: no matches (ASCII-only, exit 1 = clean).

Manual-recovery command verification (before any load, against a name that
is not loaded):

```
qdbus org.kde.KWin /Scripting isScriptLoaded plasma-auto-tiler-clock-probe
```
Outcome: `false`, exit 0.

```
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s plasma-auto-tiler-clock-probe
```
Outcome: `b false`, exit 0.

```
qdbus org.kde.KWin /Scripting unloadScript plasma-auto-tiler-clock-probe
```
Outcome: `false`, exit 0 (no error; syntax and bus reachability confirmed).

```
busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting unloadScript s plasma-auto-tiler-clock-probe
```
Outcome: `b false`, exit 0.

Capture-start (background, output to a temp file):

```
dbus-monitor --session "type='method_call',interface='com.plasmaAutoTiler.LogSink'" > /tmp/plasma-auto-tiler/clock-probe.raw 2>&1 &
```
Outcome: process alive; the controlled capture-path test below proved the
filter captures LogSink-interface method calls.

Live load/start/unload cycle:

```
qdbus org.kde.KWin /Scripting loadScript /home/beefsack/Development/plasma-auto-tiler/docs/changes/js-baseline-measurement/script/clock-probe.js plasma-auto-tiler-clock-probe
```
Outcome: `0` (script id), exit 0; `isScriptLoaded` then `true`; zero LogSink
calls captured (code not yet run).

```
qdbus org.kde.KWin /Scripting start
```
Outcome: exit 0; all 201 facts captured and parsed to
`/tmp/plasma-auto-tiler/clock-probe.log`.

Capture parse (one line per fact, the string argument of each LogSink
`append` method call):

```
awk '/interface=com.plasmaAutoTiler.LogSink; member=append/{getline; gsub(/^ +string "/, "", $0); gsub(/"$/, "", $0); print}' /tmp/plasma-auto-tiler/clock-probe.raw > /tmp/plasma-auto-tiler/clock-probe.log
```
Outcome: 203 lines including one deliberate `capture-path-test` artifact
(dropped from the final log; 202 clean lines remain).

Controlled capture-path proof (dbus-monitor sees LogSink method calls even
with no service owning the name):

```
dbus-send --session --print-reply --dest=com.plasmaAutoTiler.LogSink /com/plasmaAutoTiler/LogSink com.plasmaAutoTiler.LogSink.append string:capture-path-test
```
Outcome: D-Bus error `org.freedesktop.DBus.Error.ServiceUnknown: The name is
not activatable` (expected - no owner), but the method call was captured by
dbus-monitor as a `method call` record with `string "capture-path-test"`,
proving the monitor-based capture works live.

Re-run test (second bounded cycle, inert probe):

```
qdbus org.kde.KWin /Scripting loadScript .../clock-probe.js plasma-auto-tiler-clock-probe
qdbus org.kde.KWin /Scripting start
qdbus org.kde.KWin /Scripting start
```
Outcome: `loadScript` returned `0`; after two `start()` calls the probe ran
exactly once (1x `probe_complete`, 1x `probe_flush`).

Reversal (both cycles):

```
qdbus org.kde.KWin /Scripting unloadScript plasma-auto-tiler-clock-probe
```
Outcome: `true`, exit 0.

```
qdbus org.kde.KWin /Scripting isScriptLoaded plasma-auto-tiler-clock-probe
```
Outcome: `false`, exit 0.

```
qdbus org.kde.KWin /KWin org.freedesktop.DBus.Peer.Ping
busctl --user call org.kde.KWin /KWin org.freedesktop.DBus.Peer Ping ""
```
Outcome: both exit 0 (`kwin_wayland` responsive).

Post-cleanup state check:

```
ps aux | grep '[d]bus-monitor'
```
Outcome: no dbus-monitor process remains.

```
for n in plasma-auto-tiler-variant-a plasma-auto-tiler-variant-b plasma-auto-tiler-clock-probe; do qdbus org.kde.KWin /Scripting isScriptLoaded $n; done
```
Outcome: `false` for all three. `variant-a.js` and `variant-b.js` were never
loaded or modified.

## 8. Anomalies and notes

- `globalThis` is absent from this engine despite being ES2020-standard.
  Any future script that needs the global object must use top-level `this`
  instead.
- `QTimer.singleShot` is not a property of the injected QTimer; scripts that
  rely on `QTimer.singleShot` must be written against the actual injected
  API shape (verified present only as a callable `QTimer`, not probed
  further - QTimer is out of scope for the clock question).
- The 127-name enumeration includes the probe's own top-level `var`s; the
  engine-native set is listed in section 4 with artifacts excluded.
- `start()`-after-`loadScript()` requirement is a change to the documented
  load procedure in this change's README (section 5); unit-05/unit-06 and
  the harness must follow load-once + start-once.
- No incidents. KWin remained responsive throughout; every cycle was fully
  reversed and verified.
