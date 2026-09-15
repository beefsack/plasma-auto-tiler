# Active Group Highlight Design

## Outcome

- User-approved lifetime: highlighting is temporary only. KWin Script workspace
  exposes only cursor position (`src/scripting/workspace_wrapper.h:149` /
  `.cpp:61,148`), with no modifier signal, so the preferred Meta-held lifetime
  is not available through supported Script facilities alone. The native public
  `EffectsHandler::mouseChanged(...)`
  (`/tmp/opencode/kwin/src/effect/effecthandler.h:914-916`, documented at
  901-913) can passively observe modifier transitions; it connects
  InputRedirection modifier changes and emits at
  `/tmp/opencode/kwin/src/effect/effecthandler.cpp:229-236`, with a
  current-state snapshot at 207-209 and Qt Meta mapping in
  `/tmp/opencode/kwin/src/xkb.cpp:799-813` (source checkout KWin 6.7.3 per
  `/tmp/opencode/kwin/CMakeLists.txt:5`). The observed public signal carries no
  source-observed requirement for polling, grabs, interception, filters/spies,
  or consuming input. Whether the existing native-boundary exclusion of "input"
  covers this public passive subscription is an undecided narrow
  governance/boundary choice; grabs, interception, and private InputRedirection
  spy/filter remain excluded with no silent expansion. Until that choice is
  explicitly decided, use the selected approximately one-second highlight after
  a relevant tiling opening, moving, or closing change. The Meta-held variant
  is technically feasible only after that choice and is not approved as
  temporary-only.
- This is an implementation brief only. No feature, live KWin, D-Bus, Qt probe,
  build, script lifecycle, configuration, or backlog change is authorized.

## Source Findings

- KWin Script workspace exposes only cursor position
  (`src/scripting/workspace_wrapper.h:149` / `.cpp:61,148`), with no key or
  modifier signal in this source slice. This confirms Script-side absence for a
  Meta-held lifetime, not a claim about native Effects availability.
- The native public `EffectsHandler::mouseChanged(pos, oldpos, buttons,
  oldbuttons, modifiers, oldmodifiers)`
  (`/tmp/opencode/kwin/src/effect/effecthandler.h:914-916`, documented at
  901-913 with `@since 4.7` and a stale `startMousePolling` reference) connects
  InputRedirection modifier changes and emits at
  `/tmp/opencode/kwin/src/effect/effecthandler.cpp:229-236`; the current
  modifiers snapshot is available at 207-209, and Qt Meta mapping is in
  `/tmp/opencode/kwin/src/xkb.cpp:799-813` (checkout KWin 6.7.3 per
  `/tmp/opencode/kwin/CMakeLists.txt:5`). The public signal has no
  source-observed requirement for polling, grabs, interception, filters/spies,
  or consuming input; construction installs no such connections under
  `NoCompositing` (`effecthandler.cpp:119-122`). It is a public passive Effects
  subscription, not private input. Whether the existing
  [Native Active Border](../decisions.md#native-active-border) exclusion of
  "input" covers it is undecided; grabs, interception, and private
  InputRedirection spy/filter stay excluded.
- The engine stores one retained `Node` tree per domain and the focused domain
  and leaf (`src/session.rs:615-618`). `direct_parent_of_leaf`
  (`src/session.rs:4662-4679`) supplies the immediate `Node::Group`; recursive
  members come from that subtree with `find_subtree` and `collect_leaves`
  (`src/session.rs:4701-4716,5706-5721`). Group rectangles are derived from
  engine projections/leaf geometry, not native state (`src/geometry.rs:1-33`,
  `src/session.rs:402-422,5282-5358`).
- The active-border effect owns exactly one `OutlinedBorderItem`
  (`kwin/native-effect/activewindowborder.h:26-28`) and one active-window rect
  (`activewindowborder.cpp:85-102`). The approved scene exception permits that
  one automatic-lifetime item only. It already hides for absent, deleted,
  minimized, or fullscreen windows (`activeborderlogic.h:31-37`).
- The drag oracle proves only a parameterless effect-owned D-Bus read:
  `Q_SCRIPTABLE QString LastVerdict()` plus `registerService`/`registerObject`
  (`kwin/native-effect/dragoracle.cpp:14-35`) called by script `callDBus`
  (`kwin/src/drag-oracle-pull.ts:163`). KWin Script can issue an argument call
  by converting JavaScript values to `QVariant` and asynchronously calling the
  session bus (`/tmp/opencode/kwin/src/scripting/scripting.cpp:301-352`), but
  that does not prove an effect setter's payload demarshalling, authorization,
  or live behavior.

## Approved Lifetime And Triggers

- After an accepted/applied `admit`, `move`, or `remove` plan that changes the
  focused domain's tiling, resolve the then-active immediate group and show it
  for about one second. These are the opening, moving, and closing tiling
  changes; `src/planner_protocol.rs:1381-1402` distinguishes them from
  `focus`, `resize`, `pointer-resize`, `reconcile`, `toggle-float`, and
  `send-to-workspace`.
- A later qualifying change replaces the visible set and restarts its local,
  one-shot visual expiry. A rejected, failed, stale, or non-changing plan never
  displays or restarts it. Expiry sends one clear and is not a transport timeout,
  retry, heartbeat, or polling loop.
- While visible, clear rather than retarget on focus or focused-domain change.
  Clear immediately on fullscreen, hidden/minimized, or deletion. Those
  invalidations do not themselves start a new one-second lifetime. The current
  effect observes fullscreen/minimized but not hidden/domain changes, so their
  handling is required implementation work.
- Fullscreen remains suppressed. The effect must retain no polling loop or
  unsupported zero-cost claim: its loaded render path has residual per-frame
  cost. This one-shot visual timer is distinct from prohibited transport
  retries/timeouts.
- Prospective Meta-held variant, pending only the narrow public-Effects
  governance/boundary choice above: observe modifier transitions through the
  effect `mouseChanged` signal; show only while Meta is held after a qualifying
  accepted/applied tiling change; clear on Meta release and on the existing
  fullscreen/minimize/hidden/deletion/focus-domain invalidations; read current
  modifiers on effect setup for held-before-load without synthesizing a missed
  press; a later qualifying change while held updates/replaces the group with
  no one-second expiry started. No polling, retry, config fallback, or
  transport claim is made. No focus/resize/general-geometry trigger expansion.

## Proposed Technical Design

- Membership is an ordinary technical proposal, not a user-approved product
  decision: from `trees[focused_domain]`, find `focused_leaf`'s immediate
  `Node::Group` parent and recursively collect its leaf descendants. With no
  parent or a stale domain/leaf, clear. The engine owns membership, geometry,
  and intent; the adapter maps native identities; the effect renders only the
  resolved rectangle.
- Proposed payload: an effect-owned `Q_SCRIPTABLE`
  `SetTemporaryGroupHighlight(QString payload)` and matching `Clear...`, using
  one JSON string containing a generation/correlation, group bounding rectangle,
  and expiry token. `QString` is the only directly source-grounded D-Bus payload
  precedent here. This is proposed and live-unverified; opaque member identities
  need not cross the boundary when the effect renders the engine-derived rect.
- The existing drag-oracle endpoint establishes call direction only. A writable,
  argument-carrying effect endpoint is a material transport/authorization
  decision, not an approved extrapolation from the read-only oracle. Do not
  substitute config writes or `reconfigureEffect` if transport fails; that route
  is unapproved and its script callability is unproven.
- A group bounding rectangle can reuse the sole existing item only by temporarily
  replacing the normal active-window border for the highlight interval. Preserving
  that border while drawing a separate group outline requires an additional
  `OutlinedBorderItem`, which exceeds the current one-item scene exception.

## Material Decision Required

- Recommendation: keep the one-item exception and temporarily replace the
  active-window border during the approximately one-second group highlight. It
  avoids extra scene items, tabs/stacks, all-group outlines, drag overrides,
  and configuration expansion. One `OutlinedBorderItem` temporary replacement
  versus a simultaneous extra group item remains a material renderer choice.
- User choice remains required before implementation: a narrow explicit
  governance interpretation/exception for passive public effects modifier
  observation through `EffectsHandler::mouseChanged`, authorization of the
  narrow writable script-to-effect endpoint (proposed, live-unverified), and
  selection of the renderer option above. No private APIs or interception are
  required for the prospective Meta-held variant.

## Limits And Evidence

- COSMIC content supports tree-contained groups and focused/group indicators,
  but not this active-window-group membership outline
  (`/tmp/opencode/cosmic-comp/src/shell/layout/tiling/mod.rs:5459-5535`). Its
  supplied checkout revision remains unverified.
- Grouped/tabbed compositor behavior, tabs, stacks, drag override, all-groups
  outline, and configurability are out of scope. The previous static
  group-outline flash is not live evidence
  ([grouped-windows](grouped-windows.md#scope-and-dependencies)).
- No rendering, performance, fullscreen, payload, D-Bus authorization, or
  transport result is claimed without a separately authorized live gate.

## Next Action

User decides the narrow governance interpretation/exception for passive public
effects modifier observation, the writable endpoint, and the renderer option;
implementation remains unauthorized.
