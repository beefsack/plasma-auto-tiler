# Active Group Highlight

## Delivered

- Rust owns the focused-domain retained-tree query: it resolves only the
  focused leaf's immediate parent split group, recursively collects descendants,
  and projects member geometry and union bounds with the engine projector.
  Native/client rectangles never supply topology.
- The existing `DescribePlan` route accepts `{"op":"active-group"}` and
  returns either the current bounded identity and engine union bounds or a
  fail-closed `no-group`. The read-only query returns its current retained
  revision, including for an initial or lagging request.
- The KWin script refreshes the bounded payload at startup and on focus,
  domain, tree, and fullscreen lifecycle changes. It clears before an async
  refresh, numerically orders the bridge `-g<seq>` suffix for equal revisions,
  and drops superseded replies without erasing a newer result.
- The active-border effect retains its existing outline and adds one temporary
  automatic-lifetime group `OutlinedBorderItem`. Rust owns the group effect
  payload parser/validation, stream order, focus/visibility policy, and POD
  state behind a panic-contained byte/POD C ABI. C++ is only the QObject/D-Bus
  QString-to-UTF-8 boundary, native identity and signal observation, and
  automatic-lifetime outline/repaint shim. An effect-owned D-Bus object
  exposes `org.plasmaautotiler.ActiveBorder` /
  `/org/plasmaautotiler/ActiveBorder` /
  `org.plasmaautotiler.ActiveBorder1` with `SetGroupHighlight(QString)` and
  `ClearGroupHighlight()`. This is not a `/Effects` method.
- The group outline is visible only after passive public
  `EffectsHandler::mouseChanged` reports Meta held. It hides on release and
  suppresses invalid, changed-focus, fullscreen, minimized, hidden, deleted,
  non-OpenGL, malformed, stale, and endpoint-unavailable state. Before the
  first public modifier signal, held state is unknown and the group stays
  hidden. No timer fallback, polling, input interception, shortcut change, or
  broad scene rendering was added.

## Static Evidence

- `npm --prefix kwin run typecheck && npm --prefix kwin test`: 562 tests in 71
  suites passed.
- `devenv shell --impure -- rustc --test kwin/native-effect/group_highlight.rs`:
  13 policy/FFI tests passed.
- The offline native build compiled `plasma-auto-tiler-active-border`; focused
  CTest `native-effect-(logic|group-highlight|group-highlight-rs|metadata-factory-validation)`
  passed 4/4. The group test poisons D-Bus before Qt setup.
- `nix build .#native-effect --no-link` passed with the Rust FFI sources in
  `nativeEffectSource`.
- `devenv shell --impure -- just build` passed and staged the three native
  artifacts into the offline `target/kwin-native-effect-stage` directory.

## Limits

- No live KWin/Plasma, Qt/QtDBus session-bus, script lifecycle, `/Effects`,
  KCM, active-session loading, or session action ran. D-Bus argument
  demarshalling, service-name ownership, modifier-only delivery, scene
  behavior, and actual cost remain live-unverified.
- The effect cannot observe Meta before its first public `mouseChanged` signal.
  A loaded effect has at least normal KWin effect dispatch cost; zero compositor
  cost and runtime acceptance are not claimed.

## Held Refresh Incident

- The named `NvUxKK` combined log and `lqQA8R` Planner log are the same Planner
  conversation; `sBN2nR` is a separate later run. The first run proves the
  retained route returned the nested right-side group at `g18` and the script
  submitted its setter call, but not effect receipt or rendering.
- Two static defects explained the missing held update: active-group resolution
  compared the retained focus leaf with a valid current native focus without
  first synchronizing focus, and completed geometry writes had no bridge edge
  to re-query the highlight when focus was unchanged. The fullscreen
  `window-out-of-bounds` snapshot rejection remains a separate fail-closed
  suppression path.
- The retained query now performs only guarded focus synchronization before
  resolving its tree. The KWin bridge refreshes once after completed admit,
  move, remove, or keyboard-resize geometry plans. It adds no retry, polling,
  geometry subscription, timed fallback, or C++ policy.
- `group-highlight:setter-submitted` replaces `group-highlight:applied`.
  It means only that the fire-and-forget script setter call returned locally;
  native endpoint receipt, D-Bus demarshalling, Meta visibility gating, and
  rendering remain live-only evidence.

## Incident Pickup

1. For this Rust/TypeScript-only correction, cleanly stop the current developer
   session with Ctrl-C, then run `just dev verbose`. No new logout is needed.
2. Hold Meta while focusing either member of `H[W1,V[W2,W3]]`, then swap the
   two right-side members. The group outline should remain/update only while
   Meta is held; releasing Meta hides it. No timed flash is expected.
3. Build before the next new Plasma session only if native artifacts have also
   changed. This correction did not change native artifacts.

## User Pickup

1. Run `devenv shell --impure -- just build` from the repository and confirm it
   stages the native binaries at `target/kwin-native-effect-stage`.
2. Before logout, configure the existing `plasma-workspace/env` delivery
   mechanism with that stage directory's absolute path. A shell-only
   `QT_PLUGIN_PATH` does not configure the next Plasma session.
3. Complete a full Plasma logout/login. Do not use `/Effects` to replace a
   same-path loaded native binary: it cannot hot-replace it.
