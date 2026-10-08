# Workspace-local layout selection (R-LAY-04) research

## Accepted row

[Consensus Table A](reference-wm-consensus.md#table-a-strong-cross-family-consensus-where-ours-differs-24-consolidated)
columns (`docs/research/reference-wm-consensus.md:138`):
`Row | Consensus | Count | COSMIC | Ours KDE / Windows | Deliberate vs feature absence | Recommendation | Decision 2026-10-07`.

> `| R-LAY-04 | alternative layout selected at per-workspace scope, order preserved | scope-6/8 (B,I,S,X,Q,A), 3/4 fam | n/a (global config only) | no / no (no select verb in any Engine/adapter layer) | Ownership differs per profile (desktop/parent/workspace/group/tag); H partial, C global-only | Add workspace-local layout selection | Accepted 2026-10-07: add workspace-local layout |`
> (`docs/research/reference-wm-consensus.md:153`)

Batch acceptance: [backlog](../backlog.md), "Adopt reference-consensus additions"
(`docs/backlog.md:247-266` at `59572c7`). The [normative requirement](../spec/functional-spec.md#layout)
leaves choices unselected (`docs/spec/functional-spec.md:128`, REQ-LAY-04).
The [matrix scenario](../spec/reference-outcomes/layout-commands.md#r-lay-04-select-a-native-alternative-layout-on-ws2-return-to-ws1)
(`:180-233` at `59572c7`) explicitly excludes
tile/floating toggles (they stay R-FLT-04); L1/L2 are real named alternatives
with native ownership.

## Pinned source roots

Reference paths below are repository-prefixed, resolved under
`/home/beefsack/Development/` at the listed pin (verified with
`git rev-parse HEAD`; all match the matrix pins). Product paths are relative
to `plasma-auto-tiler` at `59572c7`. Findings are source-only, not live tests.

| Repo (local root) | Pin verified |
|---|---|
| `cosmic-comp` | `3d55cba0` |
| `Hyprland` | `19fb395d` |
| `sway` | `1652c54b` |
| `i3` | `903bcd51` |
| `niri` | `ed22699d` |
| `awesome` | `0a5e50cf` |
| `qtile` | `83c697a5` |
| `xmonad` | `284dd52` (+ `xmonad-contrib` `5097a457`) |
| `bspwm` | `e11eff4` |

## What the sources actually do

- COSMIC: no per-workspace layout selector.
  `WorkspaceLayout` Vertical/Horizontal
  (`cosmic-comp/cosmic-comp-config/src/workspace.rs:11,41`) is a single
  global value driving workspace-navigation gesture/direction mapping
  (`cosmic-comp/src/input/mod.rs:1230-1231`,
  `cosmic-comp/src/input/actions.rs:215-219`), not a tiled algorithm.
  `TileBehavior` Global/PerWorkspace
  (`cosmic-comp/cosmic-comp-config/src/lib.rs:91-93,161-164`) scopes tiling
  *enable*, not algorithm selection. `PinnedWorkspace.tiling_enabled`
  (`cosmic-comp/cosmic-comp-config/src/workspace.rs:62-66`) is pinned-
  workspace *config* enable state, consumed into the runtime workspace's
  `tiling_enabled` flag (`cosmic-comp/src/shell/workspace.rs:109,387-399,433`)
  - still enable state, not a named layout.
- Hyprland: per-workspace tiled-algorithm override. Registered algos
  dwindle/master/scrolling/monocle
  (`Hyprland/src/layout/supplementary/WorkspaceAlgoMatcher.cpp:31-34`);
  `tiledAlgoForWorkspace` prefers a workspace rule's layout override over
  `general:layout` (`:104-110`); `updateWorkspaceLayouts` swaps the
  workspace's tiled algorithm on mismatch (`:116-143`). Switching moves
  each tiled target from the old to the new algorithm
  (`Hyprland/src/layout/algorithm/Algorithm.cpp:196-215`); no
  window-ordering guarantee found in the inspected path, so the matrix
  order-TBD stands.
- bspwm: per-desktop `tiled`/`monocle` via `desktop -l/--layout`
  (`bspwm/doc/bspwm.1.asciidoc:505`,
  `bspwm/src/messages.c:765-780`, `set_layout` per desktop in
  `bspwm/src/desktop.c:120-135`).
- i3: per-container layout verbs
  `layout default|stacked|stacking|tabbed|splitv|splith`
  (`i3/parser-specs/commands.spec:146-149`; both `stacked` and `stacking`
  spellings accepted). `cmd_layout` (`i3/src/commands.c:1599-1624`) retargets
  the focused window's parent via `con_set_layout`
  (`i3/src/con.c:1997-2013`, same children). Single-parent fixture, not a
  general whole-workspace selector.
- sway: `layout default|tabbed|stacking|splitv|splith`
  (`sway/sway/commands/layout.c:10-28`; `stacking` spelling only, mapping to
  `L_STACKED` in `sway/include/sway/tree/container.h:13-19`). Operates on the
  parent split like i3, with single-child flatten and a workspace-level
  fallback (`sway/sway/commands/layout.c:117-199`). Same single-parent
  caveat as i3.
- xmonad: each workspace carries its own layout - "a workspace is just a
  tag, a layout, and a stack"
  (`xmonad/src/XMonad/StackSet.hs:157`). Shipped choice
  `layout = tiled ||| Mirror tiled ||| Full` with `Tall` defaults
  (`xmonad/src/XMonad/Config.hs:135-143`);
  mod-space sends `NextLayout` rotating the current workspace's algorithms
  (`xmonad/src/XMonad/Config.hs:193`), and `setLayout`/`updateLayout` write
  only the viewed/matching workspace
  (`xmonad/src/XMonad/Operations.hs:534-546`). Per-workspace stack layouts,
  not tag-membership switching.
- qtile: each group keeps its own `layouts` list plus `current_layout`
  index (`qtile/libqtile/group.py:15-45,77-98`); `next_layout`/`prev_layout`
  accept an optional group name targeting that group's index
  (`qtile/libqtile/core/manager.py:1274-1302`). L1 Columns / L2 Max.
  Order qualifier: `use_layout` (`qtile/libqtile/group.py:94-102`) only
  flips the index and re-shows; the window list is untouched, so order is
  preserved by construction on the switch itself.
- awesome: `layout.set` writes one tag's layout
  (`awesome/lib/awful/layout/init.lua:177-181`,
  `t.layout = l` defaulting to the selected tag). L1 tile / L2 tile.left
  (`awesome/lib/awful/layout/suit/tile.lua:328-337,370-372`).
- niri: no workspace layout-select verb in the Action inventory
  (`niri/niri-ipc/src/lib.rs:194-946`, matrix `S-nir-acts`). `SwitchLayout`
  switches *keyboard* layouts (`:768-773`); it also supports
  per-column normal/tabbed display (`niri/niri-ipc/src/lib.rs:449-456,1007`),
  not a workspace-level layout.

## Is another layout policy necessary?

- Current engine has independent `(OutputId, WorkspaceId)` trees but one
  engine-wide policy carried into every session
  (`crates/tiler-core/src/engine.rs:1-11,57-62`). `CosmicV1Policy` is the only implementation
  (`crates/tiler-core/src/policy.rs:6-8,93-95,186-190`).
- The accepted R-LAY-04 meaning requires a *real alternative*
  (per the matrix: named L1/L2 with native ownership, not tile/float), but
  there is no established requirement for a second Rust struct. The
  `LayoutPolicy` trait covers planning/admission/shares/resize/drop
  semantics, not exhaustive layout rendering; local container display/tab
  modes or a selectable tree arrangement could share the policy. No
  architecture is prescribed here. A selectable horizontal/vertical tree
  arrangement could avoid a second policy type, but still needs new semantics:
  one-shot rearrangement vs persistent admission preference, root vs all splits,
  and preservation of order/shares/focus. None was selected by generic R-LAY-04.
- These do not qualify as L2 today: parent orientation flip is R-LAY-01
  (delivered `toggle_orientation` op); tiled/floating toggle is REQ-FLT-04
  (`docs/spec/functional-spec.md:179`,
  [delivery](../changes/archive/windows-workspace-tiling.md)); existing different
  per-workspace trees are content differences, not selectable named
  alternatives. Nothing implemented is selectable as L1/L2.

## Options (estimates only, not commitments)

- A. Park R-LAY-04 until a second layout exists (recommended; dropping it
  outright would require rescinding the normative REQ-LAY-04 requirement).
  Cost now: docs-only amendment, less than a day. Later selector work
  (workspace choice, core/adapter plumbing, settings/catalogs/tests) is roughly
  days to weeks, separate from the unselected alternative's implementation.
  Consequence: retain a pending requirement without speculative machinery.
- B. Narrow acceptance to the delivered workspace tile/float toggle, only
  with explicit user amendment. Cost: docs-only, less than a day. Consequence:
  remove the alternate-tiled-layout requirement; this changes the accepted
  scope, rather than fulfilling the matrix's expressly different fixture.
- C. Add a genuine alternative now, with a named bounded choice put to the
  user before design (e.g. selectable horizontal/vertical tree arrangements).
  Cost: several days to a few weeks across core/adapters/tests for a bounded
  same-policy arrangement; new algorithms/renderers are larger and unestimated.
  Consequence: new behavior/settings and unresolved rearrangement semantics.
  Orientation variants count as layouts elsewhere (Mirror Tall), but a parent
  toggle alone does not provide R-LAY-04's workspace selector.
- Recommendation: A. Grounding: the 6/8 count is availability/scope across
  different models (desktop/parent/workspace/group/tag), not agreement to
  pick one L2, and COSMIC - the default - offers no contrary layout to
  adopt; no generic multi-layout framework should be built speculatively;
  eventual options need functional setting names with WM names in tooltips.
  This follows [simplicity](../principles.md#simplicity) and the
  [reference-default rule](../spec/functional-spec.md) (`:19-26`). Any future
  implementation must preserve fullscreen/game exclusions and avoid unwanted
  reflow/focus interference ([gaming](../principles.md#gaming-compatibility)).
  REQ-LAY-04 remains NORMATIVE and pending; parking/dropping/narrowing it
  awaits the user's decision.

## Interaction with profiles and tabbed stacks

- `docs/backlog.md:2334-2336` at `59572c7` (P3 post-MVP tiling profiles) plus
  `docs/changes/shortcuts.md:15-17`: "After MVP, adding a tiling type
  requires a selectable profile/type for both its tiling behavior/algorithm
  and matching shortcuts." That is a bundled profile/type future
  requirement (behavior + shortcuts together), distinct from a
  workspace-local layout selector. The eventual algorithm sets overlap,
  but workspace-local selection does not imply switching the global shortcut
  catalog. Their eventual coupling remains unselected.
- `docs/backlog.md:2337-2345` at `59572c7` schedules tabbed stacks first after
  0.1. A local
  stack/tab feature is not automatically a whole-workspace second layout;
  whether tabbed stacks can serve as R-LAY-04's L2 is a future product
  decision. Revisit then; do not make an extra layout system a prerequisite
  for the already-scheduled tab feature.

## Matrix edits made / TBDs

- `layout-commands.md` R-LAY-04 COSMIC leg: clarified `WorkspaceLayout` is
  shell navigation and `TileBehavior` is enable-scope.
- `reference-outcomes.md` `S-cos-wslay` legend: added navigation-use
  citations.
- Unresolved: Hyprland order preservation through the algorithm switch
  stays TBD. All other R-LAY-04 cells were already sourced; no new rows
  added, no consensus counts changed.

## User decision 2026-10-09

- PARK option A selected: R-LAY-04 parked until a genuine second layout
  exists; revisit when tabbed stacks are designed after 0.1. Whether tabs
  count as L2 is a future decision. REQ-LAY-04 stays a parked requirement,
  not an implementation. Research completed.
