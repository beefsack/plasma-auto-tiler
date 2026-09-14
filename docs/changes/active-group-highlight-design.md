# Active Group Highlight Design

## Goal

Select a design for the first-class group highlight required by `VISION.md:13-16`:
show the active window's group as a native KWin effect overlay. This record is
static-only. It defines the active window's group in the Rust engine and in the
COSMIC source, decides the highlight lifetime, selects the script-to-effect
transport direction, and proposes (does not apply) a `docs/decisions.md`
replacement. No feature code changes.

## Scope And Non-Goals

- In scope: group identity and membership, COSMIC indicator evidence, trigger
  model, transport, transient-versus-persistent choice, effect-versus-script
  alternatives, constraints, and ordered slicing.
- Non-goals: no implementation, no live KWin/Plasma action, no D-Bus setter, no
  script lifecycle, no Qt/QtDBus probe or live bus, no KWin fork, no edit to
  `docs/decisions.md`, `docs/backlog.md`, or feature code. Group tabs/stacks
  remain unselected (`docs/decisions.md:443-445`, `:461-462`).

## Verified Facts

### Rust Engine: The Active Window's Group

- A group is not a first-class object. It is a `Node::Group { id, axis,
  children, shares }` in an ordered N-ary split tree; a window is a
  `Node::Leaf { id }` (`src/directional.rs:113-123`). Leaves and groups share one
  `NodeId` namespace (`src/directional.rs:74-77`).
- The session retains one optional tree per logical domain:
  `trees: BTreeMap<DomainKey, Option<Node>>` (`src/session.rs:615`).
- The active window is the session's focused leaf, held as
  `focused_domain: Option<DomainKey>` plus `focused_leaf: Option<NodeId>`
  (`src/session.rs:617-618`); `focused_window_for` resolves the leaf to a
  `WindowId` (`src/session.rs:1904`).
- Therefore the active window's group is the `Node::Group` ancestor of
  `focused_leaf` inside `trees[focused_domain]`. There is no dedicated
  "active group" accessor; group resolution is tree traversal. `find_group`
  locates a group by id and returns its children, axis, and id
  (`src/session.rs:4595`); `parent_of_group` returns a group's parent
  (`src/session.rs:4682`).
- Group geometry is computed for drag previews, not for a live highlight:
  `GroupLayout { id, axis, rect, child_starts }` (`src/session.rs:5282-5287`),
  built by `drag_group_layouts` (`src/session.rs:5289-5293`) and
  `collect_group_layouts` (`src/session.rs:5295-5358`). `group_rep_window`
  picks a representative member window (`src/session.rs:5363-5383`).
  Pointer group membership uses `pointer_group_origin` (`src/session.rs:5875`)
  and `collect_pointer_group_leaves` (`src/session.rs:5898`).
- In the planner protocol the active window is the request's
  `focused_window: String` (`src/planner_protocol.rs:193`). Replies carry
  per-leaf `desired_geometry` and a `desired_focus` leaf
  (`src/planner_protocol.rs:198-243`); no group identity is serialized. A
  highlight set therefore must be derived engine-side and pushed separately.

### COSMIC: Equivalent Tiling Tree And Indicators

- The COSMIC equivalent group is `Data::Group { orientation, sizes,
  last_geometry, alive, pill_indicator }` (`src/shell/layout/tiling/mod.rs:149-157`)
  in a `Tree<Data>`. Group membership is tree containment; `new_group`
  (`:177-191`), `add_window` (`:219-244`), `remove_window` (`:255-282`), and
  `map_to_tree` (`:548`) edit it. A focused container is a
  `KeyboardFocusTarget::Group(WindowGroup { .. })`
  (`src/shell/layout/tiling/mod.rs:1288`, `:1885-1886`).
- COSMIC DOES render a focus/active indicator. `IndicatorShader::focus_element`
  expands the element rectangle outward by `thickness` and draws a border
  (`src/backend/render/mod.rs:209-234`). Its colour is `active_window_hint`,
  which is `theme.window_hint` or the accent colour
  (`src/theme.rs:15-21`), gated by the `active_hint` config field
  (`src/shell/mod.rs:283`, `:3807-3811`).
- In the tiling render path the indicator is drawn only for the focused node
  or the swap target (`src/shell/layout/tiling/mod.rs:5459-5462`). Group nodes
  use thickness 4 and a `Key::Group` identity, windows use `indicator_thickness`
  (`:5514-5535`). A focused `Data::Group` additionally gets a group backdrop
  (`BackdropShader::element`, `:5483-5506`). The floating path
  (`src/shell/layout/floating/mod.rs:1615-1617`) and the move grab
  (`src/shell/grabs/moving.rs:142`) draw the same indicator.
- COSMIC also has a transient drag-time `Usage::PotentialGroupIndicator`
  (`src/backend/render/mod.rs:143`), used at
  `src/shell/layout/tiling/mod.rs:4869`.
- Direct statement: COSMIC does NOT render a persistent outline around the
  active window's group of sibling members as a group-membership indicator.
  It renders a focus indicator for the focused window, or for the focused
  group node itself, plus a drag-time potential-group indicator. No
  active-window-group membership outline exists in the pinned source.

### KWin Native Effect And Transport

- The existing effect tracks exactly one window and renders exactly one
  outline: `OutlinedBorderItem m_borderItem` and
  `QPointer<EffectWindow> m_trackedWindow`
  (`kwin/native-effect/activewindowborder.h:26-28`). It connects
  `windowActivated` and `windowDeleted`
  (`kwin/native-effect/activewindowborder.cpp:30-39`), tracks the active
  window's frame/minimized/fullscreen changes (`:69-83`), and in `updateBorder`
  reads `effects->activeWindow()` and sets one inner rect and one visibility
  (`:85-102`). It has no group input and no multiple-outline path.
- The outline hides when there is no window, or the window is deleted,
  minimized, or fullscreen (`kwin/native-effect/activeborderlogic.h:31-37`).
- The effect reads its colour/width/radius from config on construction and on
  `reconfigure` (`kwin/native-effect/activewindowborder.cpp:17-22`, `:45-67`).
  The native KCM triggers that by calling
  `org.kde.KWin /Effects org.kde.kwin.Effects.reconfigureEffect`
  (`kwin/native-effect/activeborderconfig_module.cpp:71-106`).
- Proven script-to-effect transport already exists in the drag oracle: the
  effect registers a session D-Bus service `org.plasmaautotiler.DragOracle` and
  object `/org/plasmaautotiler/DragOracle` exporting scriptable contents
  (`kwin/native-effect/dragoracle.cpp:31-39`), exposing a `Q_SCRIPTABLE`
  `LastVerdict()` slot (`:14-26`). The KWin script calls it with `callDBus`
  (`kwin/src/drag-oracle-pull.ts:163`). The direction is script calls effect;
  `docs/decisions.md:42-44` records that the effect never pushes into the
  script.
- Direction conclusion: group-highlight push is the SAME direction as the
  proven drag-oracle pull (script to effect), not a reversal. It is a new
  method with arguments, not a read. It is UNVERIFIED as implemented: the
  active-border effect registers no D-Bus object today, and no source proves a
  script can call `reconfigureEffect` or pass a highlight set.
- The existing native-effect investigation recommends keeping a minimal C++
  shim and moving portable membership/intent to Rust, with a bounded
  set-or-clear push from the engine to the effect
  (`docs/changes/native-effect-rust-and-group-highlighting.md:5-7`,
  `:100-123`). The exact identity encoding and transport remain ungrounded
  (`:129-132`).
- The grouped-windows record confirms no group carrier, controls, bindings, or
  shared border behavior is selected and that a live multi-window Custom Tile
  stability proof is required first for compositor grouping
  (`docs/changes/grouped-windows.md:10-12`). It also records that a focused
  group-outline static implementation was accepted but its live flash did not
  appear after reload, so that static harness is not live evidence
  (`docs/changes/grouped-windows.md:13-15`). The active-group outline chosen
  here is an active-window-group highlight on top of the existing single-outline
  effect, not compositor tab/stack grouping.

### Trigger Model And Plan Kinds

- The planner dispatches ops at `src/planner_protocol.rs:1381-1402`:
  `send-to-workspace` (`:1382`), then `admit` (`:1389`), `remove` (`:1390`),
  `move` (`:1391`), `focus` (`:1392`), `resize` (`:1393`),
  `pointer-resize` (`:1394`), `reconcile` (`:1395`), and `toggle-float`
  (`:1396`).
- The KWin script triggers those on `windowAdded` (`kwin/src/plan-adapter-entry.ts:751`,
  `:1195`), `windowRemoved` (`:845`, `:1197`), `windowActivated` (`:1198`),
  geometry via `moveResizedChanged` (`:745`, `:1131`), scope via
  `screensChanged`/`currentDesktopChanged` (`:1138-1139`), fullscreen
  (`:1163-1168`), maximize (`:1170-1184`), desktops/sticky (`:1186-1191`), and
  shortcut rows (`:200-297`).
- Current toggles: `SessionCommand::ToggleFloat` is the stateful intentional
  float transition (`src/session.rs:268-271`), reached through the
  `toggle-float` op (`src/planner_protocol.rs:1396`). Observed exception flags
  are `floating`, `fullscreen`, `maximized`, `sticky`
  (`src/session.rs:213-221`; flag predicate `src/session.rs:200`). The
  controller registers float `Meta+G`, sticky `Meta+Shift+G`, and maximize
  `Meta+M` with ops `float`/`sticky`/`maximize`
  (`kwin/src/plan-adapter-entry.ts:278-297`); the durable behavior is recorded
  at `docs/decisions.md:232-248` and `:287-294`.
- A highlight set has a well-defined change trigger: the same
  `windowActivated`/`windowAdded`/`windowRemoved`/geometry/scope signals the
  adapter already subscribes to, plus the fullscreen and sticky subscriptions.

## Design Decision: Persistent Active-Group Highlight

- Selected: a persistent, configurable highlight of the active window's
  immediate group. The effect shows one group outline while a group is active,
  hides it on fullscreen/minimized/deleted using the existing predicate
  (`kwin/native-effect/activeborderlogic.h:31-37`), and updates it on
  focus/tree/scope change.
- Justification:
  - `VISION.md:13-16` makes group highlights first-class, not a drag-only
    affordance.
  - COSMIC's active hint is a persistent focus indicator gated by config
    (`src/shell/mod.rs:283`, `:3807-3811`; `src/theme.rs:15-21`), not a
    drag-only element. The drag-only `PotentialGroupIndicator`
    (`src/backend/render/mod.rs:143`) is a separate, transient affordance.
  - The active group has a stable, observable lifetime: it changes only on
    focus, tree, or domain change, all already observed by the adapter
    (`kwin/src/plan-adapter-entry.ts:1138-1198`).
- This is a proposed product choice, not an applied decision. Applying it
  requires the user to accept the proposed `docs/decisions.md` replacement
  below.

## Transport

- Selected direction: script to effect, a bounded set-or-clear method on a
  session D-Bus object the border effect registers, mirroring the drag oracle
  (`kwin/native-effect/dragoracle.cpp:31-39`, `kwin/src/drag-oracle-pull.ts:163`).
  The script resolves the active window's group engine-side and pushes opaque
  native window identities plus the group outline rectangle.
- Not selected: assuming the drag oracle reverses. Its proven direction is
  already script to effect (`docs/decisions.md:42-44`); the new work is an
  argument-carrying push, which is unproven.
- Not selected as the primary route: script writes config and triggers
  `reconfigureEffect`. The KCM uses that path
  (`kwin/native-effect/activeborderconfig_module.cpp:71-106`) and the effect
  rereads config on `reconfigure` (`kwin/native-effect/activewindowborder.cpp:45-50`),
  but no source proves a KWin script can call it, and it couples highlight
  data to configuration state. UNVERIFIED as a script route.
- The engine stays the membership/intent owner; the effect owns only native
  identity tracking and rendering, consistent with
  `docs/changes/native-effect-rust-and-group-highlighting.md:113-123` and
  `docs/decisions.md:32-36`.

## Alternatives And Costs

- Script-only: rejected. There is no KWin script overlay/border rendering path
  in this repository; the only renderer is the C++ effect
  (`docs/changes/native-effect-rust-and-group-highlighting.md:100-106`), and
  the project limits C++ to public-API adapters/effects with one
  `OutlinedBorderItem` scene exception (`docs/decisions.md:26-30`). A script
  cannot draw the border.
- Native effect, existing single outline extended: selected. Costs are the
  documented ones: per-frame paint pass and `isActive()` virtual call
  (`docs/changes/rust-first-edge-drag-route.md:35-41`), KWin ABI recompile
  coupling (`docs/decisions.md:67-68`), and a logout/login after every effect
  rebuild (`README.md:470`; `docs/changes/dev-command-unification.md:27-28`;
  `docs/dev-loop.md:37`).
- KWin fork: hard rejected (`docs/decisions.md:430-433`, `:575`).

## Constraints

- Fullscreen must not be overlaid: the effect hides on fullscreen
  (`kwin/native-effect/activeborderlogic.h:31-37`), and fullscreen/gaming must
  not be impacted (`VISION.md:41-48`).
- Zero-impact target is aspirational; any loaded effect has nonzero per-frame
  cost (`VISION.md:46-48`; `docs/changes/rust-first-edge-drag-route.md:35-41`).
  The effect is `isActive()`-gated and must not add a polling loop; the
  reliability record shows no adapter polling loop today
  (`docs/changes/reliability-condition-investigation.md:146-164`).
- User-owned live verification and every session boundary require user action
  (`docs/decisions.md:151-159`; `docs/live-kwin-testing.md:12-14`).
- Native effect iterations require logout/login; this record performs no live
  action.

## Proposed Decisions.md Replacement (Not Applied)

- The backlog cites `docs/decisions.md:358-360` for the group decision
  (`docs/backlog.md:71-76`). That reference is stale. The group decision is
  currently `docs/decisions.md:443-445` (confirmed by `git blame`); at
  `docs/backlog.md:71-76` authoring time it was at 358-360 in
  `1c22308:docs/decisions.md`. No file was edited.
- Current block (`docs/decisions.md:443-445`):
  `Grouped/tabbed windows remain deferred pending compositor-owned KWin support`
  `and a live multi-window Custom Tile stability proof. No group carrier,`
  `controls, bindings, or shared active-border behavior is selected.`
- Proposed replacement (for user approval only):

```text
- Grouped/tabbed windows remain deferred pending compositor-owned KWin support
  and a live multi-window Custom Tile stability proof. No tab or stack carrier,
  controls, or bindings are selected. Tabs and stacks remain unselected.
- Active-group highlighting is selected as a persistent, configurable native
  effect overlay for the active window's immediate split-tree group. The Rust
  engine owns group membership and highlight intent; the KWin script pushes a
  bounded set-or-clear of opaque native window identities and the group outline
  to a session D-Bus method the effect registers, the same direction as the
  proven drag-oracle pull. The overlay hides for fullscreen, minimized, or
  deleted members and never reshapes window textures.
```

## Ordered Slicing

1. Smallest useful first: persistent single-outline highlight of the active
   window's immediate group. The script derives the group from the retained
   session and pushes a set/clear to a new effect D-Bus method; the effect
   renders one outline with the existing `OutlinedBorderItem` and hides it
   under the existing fullscreen/minimized/deleted predicate. This validates
   the riskiest transport (script-to-effect push with arguments) and the
   rendering trigger, and is human-observable. Static tests only until a user
   live gate.
2. Transient drag override: during an active drag, highlight the target group
   using the existing drag signals, matching COSMIC's drag-time potential-group
   indicator (`src/backend/render/mod.rs:143`).
3. Configurability: colour/width and enable/disable through the existing KCM and
   `reconfigureEffect` path (`kwin/native-effect/activeborderconfig_module.cpp:71-106`).

## Approvals And Resolved

- User-approved: this docs-only design record, and committing and pushing only
  this new `docs/changes` file to `origin/main`.
- Resolved by this record: the Rust active-group definition; the COSMIC
  equivalent and its absent active-group outline; the persistent lifetime
  choice; the script-to-effect push direction; rejection of a KWin fork and of
  a script-only renderer; the stale `docs/decisions.md:358-360` reference.
- Pending user decision: accept the proposed `docs/decisions.md` replacement;
  select the exact D-Bus payload/identity encoding; run the user-owned live
  gates.

## Biggest Risk

- The script-to-effect push is unproven for arguments. The only proven
  script-to-effect use is a parameterless pull (`kwin/src/drag-oracle-pull.ts:163`,
  `kwin/native-effect/dragoracle.cpp:20-25`). If KWin scripting cannot reliably
  call an argument-carrying method on an effect-owned object, the selected
  transport fails and slice 1 must fall back to the config+`reconfigureEffect`
  path, whose script-callability is UNVERIFIED. This risk is front-loaded by
  making slice 1 a transport-validation slice.

## Overruled Hypotheses

- Transient-only highlight first: overruled. It would not satisfy the
  first-class group highlight (`VISION.md:13-16`) and would duplicate COSMIC's
  separate drag-time indicator (`src/backend/render/mod.rs:143`).
- Assume the drag oracle must be reversed: overruled. Its direction is already
  script to effect (`docs/decisions.md:42-44`).
- Script-only rendering: overruled. No script rendering path exists; the effect
  is the only renderer (`docs/changes/native-effect-rust-and-group-highlighting.md:100-106`).
- Highlight the whole tree root or all groups: overruled. The requirement is the
  active window's group; COSMIC outlines only the focused node/group
  (`src/shell/layout/tiling/mod.rs:5459-5462`).

## Limits

- Static only. No live KWin/Plasma action, no D-Bus call or setter, no script
  lifecycle, no Qt/QtDBus probe or live bus, no build.
- The COSMIC checkout at `/tmp/opencode/cosmic-comp` has no Git metadata (only
  `.git/info/exclude`), so the pinned commit
  `81cd5fdbaa41c3973369ae85bccf829137836e20` is UNVERIFIED there. This matches
  the existing record at `docs/decisions.md:249-256`. All COSMIC citations are
  content-based against that checkout.
- Exact native identity encoding, D-Bus payload, and whether a KWin script can
  call `reconfigureEffect` are UNVERIFIED.
- No live rendering, fullscreen, or performance result is claimed.

## Next Action

None. Applying the proposed `docs/decisions.md` replacement, implementing slice
1, and any live gate require separate user authorization.
