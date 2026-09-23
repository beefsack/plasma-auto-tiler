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

## Read-Only Native Diagnostic

- `org.plasmaautotiler.ActiveBorder1` additionally exposes the read-only,
  no-argument `GetGroupHighlightStatus() -> QString` method on its existing
  service and object. It has no setter, repaint, input, timer, or scene side
  effect. The status is fixed-order ASCII, never includes a native identifier,
  caption, bounds, payload, or error: `v=1;rx=...;ok=...;parse_rej=...;focus_mm=...;stale=...;clr=...;has=...;ord=...;first=...;meta=...;foc=...;ep=...;gl=...;vis=...`.
- `rx` is the Rust policy's received setter-payload count. Its partition is
  `ok` accepted, `parse_rej` malformed/empty payload rejection, `focus_mm`
  native active-identity mismatch, and `stale` ordering rejection. `clr`
  counts all effect display-clear requests, including lifecycle clears; it is
  not an indication that a D-Bus clear alone occurred. All counters saturate.
  `has` and `ord` are the Rust display/order flags.
- `first` and `meta` are the existing passive `mouseChanged` observation;
  `first=0` means modifier state is unknown. `foc` is native active-window
  eligibility (not deleted, minimized, fullscreen, or hidden). `ep` records
  the existing endpoint registration gate, `gl` the existing OpenGL renderer
  gate, and `vis` the selected `OutlinedBorderItem` visibility. `vis=1` proves
  only effect selection, never a composited or user-visible frame.
- After the user has rebuilt, delivered, and started a fresh Plasma session,
  first introspect the exact endpoint, then take a baseline with its typed
  no-argument query:

  ```sh
  busctl --user introspect org.plasmaautotiler.ActiveBorder /org/plasmaautotiler/ActiveBorder
  busctl --user call org.plasmaautotiler.ActiveBorder /org/plasmaautotiler/ActiveBorder org.plasmaautotiler.ActiveBorder1 GetGroupHighlightStatus
  ```

- The first command must list `GetGroupHighlightStatus` with no input and one
  string output before the second is used. Counters are cumulative from the
  current effect instance, so compare the baseline with one controlled capture.
  Start this one delayed, single read-only query from a terminal, refocus the
  nested-group member, then hold Meta until the query completes:

  ```sh
  sleep 3; busctl --user call org.plasmaautotiler.ActiveBorder /org/plasmaautotiler/ActiveBorder org.plasmaautotiler.ActiveBorder1 GetGroupHighlightStatus
  ```

- This is not polling or simulated input: it makes one exact query after a
  bounded delay while the user manually holds Meta. A growing `rx` after script
  `setter-submitted` proves native policy receipt; `ok` proves parsing and a
  native focus match for at least one receipt. `focus_mm>0` is historical and
  does not by itself establish a current refusal. During the controlled capture,
  `has=1` is also required for a display candidate. If `has=1` and `vis=0`, any
  false gate among `first`, `meta`, `foc`, `ep`, or `gl` is a current suppression
  fact, but several gates may be false and the status cannot prove a unique
  cause. With `vis=1`, compositor output remains a user-owned visual check.

## Current Session Read-Only Evidence

- This troubleshooting performed bounded reads against one current KWin 6.7.4
  session only. The existing `org.plasmaautotiler.ActiveBorder` service was
  owned by that KWin process; its exact object introspected with the existing
  `SetGroupHighlight(QString)` and `ClearGroupHighlight()` methods; and
  `/Effects` reported `plasma-auto-tiler-active-border` loaded. Current-PID
  journal lines included script `setter-submitted` entries.
- This establishes the then-current existing endpoint ownership/signature,
  loaded-effect state, and script submission only. It does not prove native
  receipt, the new status method's marshalling, modifier delivery, selected
  visibility, composited output, or cost.

## Static Evidence

- `npm --prefix kwin run typecheck && npm --prefix kwin test`: 562 tests in 71
  suites passed.
- `devenv shell --impure -- rustc --test kwin/native-effect/group_highlight.rs`:
  15 policy/FFI tests passed.
- The offline native build compiled `plasma-auto-tiler-active-border`; focused
  CTest `native-effect-(logic|group-highlight|group-highlight-rs|metadata-factory-validation)`
  passed 4/4. The group test poisons D-Bus before Qt setup.
- `nix build .#native-effect --no-link` passed with the Rust FFI sources in
  `nativeEffectSource`.
- `devenv shell --impure -- just build` passed and staged the three native
  artifacts into the offline `target/kwin-native-effect-stage` directory.

## Original Static Limits

- The original implementation's static verification ran no live KWin/Plasma,
  Qt/QtDBus session-bus, script lifecycle, `/Effects`, KCM, active-session
  loading, or session action. The later bounded read-only evidence above does
  not retroactively make its original runtime claims passed.
- The status method's native D-Bus marshalling, runtime counter values, and
  selected visibility are likewise live-unverified until a rebuilt effect is
  delivered through a new Plasma session.
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

## Historical Held Refresh Pickup

1. This historical Rust/TypeScript-only correction required a clean developer
   restart with `just dev verbose`; it did not change native artifacts and did
   not require logout.
2. Hold Meta while focusing either member of `H[W1,V[W2,W3]]`, then swap the
   two right-side members. The group outline should remain/update only while
   Meta is held; releasing Meta hides it. No timed flash is expected.
3. Build before the next new Plasma session only if native artifacts have also
   changed. This correction did not change native artifacts.

## User Pickup

1. Run `devenv shell --impure -- just build-native-effect` from the repository
   and confirm it stages the native binaries at
   `target/kwin-native-effect-stage`.
2. The exact existing project env script at
   `$XDG_CONFIG_HOME/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh`
   (defaulting `XDG_CONFIG_HOME` to `$HOME/.config`) currently points to that
   stage path. Do not overwrite it. The current KWin environment was unreadable
   due to permission denial, so its active delivery path is unproven. If the
   script no longer points to this stage, use the documented target-stage route
   in the README rather than switching to the separate `effect-install` route.
3. Complete a full Plasma logout/login. The configured env script is sourced
   when the new Plasma session starts. Do not use `/Effects` to replace a
   same-path loaded native binary: it cannot hot-replace it.

## Moved Evidence (from docs/decisions.md)

- Modifier-observation source proofs: public `EffectsHandler::mouseChanged(...)`
  (`/tmp/opencode/kwin/src/effect/effecthandler.h:901-916`, emits for
  modifier-only changes at `.cpp:229-236`); only public `cursorPos` exists,
  `m_cursor.modifiers` is protected with no public input getter; checkout KWin
  6.7.3 per `/tmp/opencode/kwin/CMakeLists.txt:5`, exact commit unverified.
  KWin Script workspace cursor position at
  `src/scripting/workspace_wrapper.h:149` / `.cpp:61,148`.
- Renderer source proofs: `itemrenderer_opengl.cpp:181-188,328-334`,
  `workspacescene.cpp:710-723`; COSMIC `cosmic-tiling-mod.rs:5459-5535`
  (checkout/revision unverified).
