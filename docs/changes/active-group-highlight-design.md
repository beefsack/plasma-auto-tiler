# Active Group Highlight Design (corrected brief)

## Status

- Design only. No implementation, build, live KWin/Plasma/session/D-Bus/Qt
  action, dependency install, stash enumeration, commit, push, backlog,
  principles, or VISION change is authorized. Selective inspection/staging of
  these two docs after review is user-authorized for this unit. Autonomous
  mode remains off.
- Decisions below are user-approved. Proposals/live-unverified are labeled as
  such. Ordinary Rust/shim detail is not a gate; the one material unresolved
  implementation choice is the writable transport.

## Decisions (user-approved)

- Meta-held observation is the selected lifetime, not rejected/not technically
  possible.
  `I permit the modifier observation.` This authorizes only passive public
  `EffectsHandler` modifier observation. It authorizes no grabs,
  interception, filters/spies, private InputRedirection, input consumption, or
  polling.
- On a recognized Meta press, show the current valid active immediate group;
  while held, update/clear the group on qualifying tiling/focus/domain
  changes; clear on Meta release. First visibility does not require a tiling
  mutation.
- Alternative one-second fallback only if Meta-held proves unavailable or
  impractical, never automatically when Meta is not held: after
  accepted/applied opening/moving/closing tiling changes, show about one
  second. Focus, resize, and general geometry never start the timer.
  Qualifying tiling changes during hold update the current visual without
  starting the timer. Focus/domain changes during hold may update or clear
  valid state but never independently start a timed flash.
- Separate group visual coexists with the active border. Selected renderer is
  group outline via a second effect-owned automatic-lifetime
  `OutlinedBorderItem` (one active border plus one temporary group outline).
  Group visual does not replace the active border and active border remains
  during group visual; fullscreen hides the group visual while the active
  border retains its existing fullscreen/state behavior (precedent
  `activeborderlogic.h:31-37`). No broad new scene mechanism is authorized.

## Source Findings (static, version-limited)

- KWin Script workspace exposes only cursor position
  (`src/scripting/workspace_wrapper.h:149` / `.cpp:61,148`), with no key or
  modifier signal in this source slice. Script alone cannot observe Meta hold.
- Native public `EffectsHandler::mouseChanged(pos, oldpos, buttons,
  oldbuttons, modifiers, oldmodifiers)`
  (`/tmp/opencode/kwin/src/effect/effecthandler.h:901-916`) emits for
  modifier-only changes (`.cpp:229-236`). `startMousePolling` is stale
  documentation and no such API exists. EffectsHandler has only public
  `cursorPos`; `m_cursor.modifiers` is protected with no public input getter.
  Do not assert a public initial modifiers snapshot. Qt Meta mapping is in
  `/tmp/opencode/kwin/src/xkb.cpp:799-813`. Checkout is KWin 6.7.3 per
  `/tmp/opencode/kwin/CMakeLists.txt:5`; exact commit unverified.
- Held-before-first-public-signal source limitation / proposed handling (not
  user-approved): minimal state, no polling. Last modifier state is unknown
  until the first public `mouseChanged`; do not assume Meta held. The missed
  held-before-first-signal edge is real and unresolved.
- No simple supported backdrop route within selected renderer/C++ restrictions
  was established; custom scene/rendering would broaden scope, so use the
  user-permitted second-outline fallback. `Workspacescene`
  renders background then stacking windows then overlay
  (`src/scene/workspacescene.cpp:710-763`); `BackgroundEffectItem` is
  non-rendering (`backgroundeffectitem.h:17-21`); effect
  overlays/OffscreenQuickView are above windows. An overlay can cover
  unrelated windows/panels, and occlusion culls background before it.
  Below-window custom drawing/scene items needing excluded shader/GL/QPainter/
  texture or scene-restriction work remain unselected.
- Multiple `OutlinedBorderItem`s technically coexist (`decorationitem.h:110`,
  `outlinedborderitem.cpp:49-98`); the project exception allows at most the
  authorized two above. All other scene exclusions stand.
- The engine stores one retained `Node` tree per domain and the focused domain
  and leaf (`src/session.rs:615-618`). `direct_parent_of_leaf`
  (`src/session.rs:4662-4679`) supplies the immediate `Node::Group`; recursive
  members come from that subtree with `find_subtree` and `collect_leaves`
  (`src/session.rs:4701-4716,5706-5721`). Rectangles derive from engine
  projections/leaf geometry (`src/geometry.rs:1-33`,
  `src/session.rs:402-422,5282-5358`).
- COSMIC supplied source `cosmic-tiling-mod.rs:5459-5535` renders group
  backdrops through its compositor-owned `BackdropShader` render-element path.
  Its checkout/revision is unverified. Compare source content only; no parity
  claim.
- The drag oracle proves only a read-only parameterless effect-owned D-Bus
  endpoint (`kwin/native-effect/dragoracle.cpp:14-35`). KWin Script argument
  calls via `QVariant`/async session bus
  (`/tmp/opencode/kwin/src/scripting/scripting.cpp:301-352`) do not prove an
  effect setter's payload demarshalling, authorization, or live behavior.

## Proposed / live-unverified (not decisions)

- Smallest split, no cxx-qt or full border port: portable Rust engine owns
  immediate-parent `Node::Group` membership with recursive leaves, engine
  projection/bounds, intent/generation and trigger policy; Rust native-effect
  policy may own pure validity/lifetime state if FFI integration is later
  selected; required C++ owns KWin plugin factory/moc/Qt signal connections,
  KWin-to-POD projections, passive `mouseChanged` latch, invalidation
  observation, `OutlinedBorderItem` lifetime/overlay/repaint and the
  version-locked ABI. Existing drag-oracle-precedent constraint: POD-only C ABI and every Rust callback catches panics before returning to KWin. No Qt/KWin types cross FFI.
- Proposed writable transport: one bounded effect-owned `Q_SCRIPTABLE`
  setter with a QString payload (generation/correlation, rect, expiry token)
  plus clear. Live-unverified and unaccepted; do not turn it into approved
  architecture. Do not substitute config writes or `reconfigureEffect`.
- Timer/expiry semantics (one-shot visual expiry, one clear, no
  transport timeout/retry/heartbeat/polling) and fullscreen/minimized/hidden/
  deletion handling beyond the current effect's fullscreen/minimized
  observation are ordinary implementation detail, not another decision gate;
  implementation is currently unauthorized.

## Material unresolved choice

- Bounded writable script-to-effect endpoint with QString payload:
  proposed/live-unverified, user has not accepted it.

## Limits, non-actions, next

- Out of scope: tabs, stacks, shared tiles, all-groups outlines, drag
  overrides, configurability, grouped/tabbed compositor behavior. The prior
  static group-outline flash is not live evidence
  ([grouped-windows](grouped-windows.md#scope-and-dependencies)). No
  rendering, performance, payload, D-Bus authorization, or transport result is
  claimed without a separately authorized live gate.
- Non-actions: no implementation, build, live probe, script lifecycle,
  configuration, or backlog change.
- Next: user decides only the writable transport; implementation remains
  unauthorized.
