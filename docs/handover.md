# Terminal Succession Handover: plasma-auto-tiler

Status: terminal handover for a fresh Orchestrator. All prior Lead and Worker
sessions are terminal; do not resume them. This handover supersedes older
session instructions and historical verification figures.

## Process and Protection

| Role | Configured agent | Context |
|---|---|---:|
| Orchestrator | top-level session | 150000 |
| Lead | `lead-openai` | 150000 |
| Worker | `worker` | 150000 |

- `lead-anthropic` is unavailable because its quota is exhausted.
- Exactly one subagent may be active across the hierarchy. Approximately 20
  Orchestrator dispatches is a terminal succession boundary.
- Commits resumed and are expected after each major piece of work. Do not push
  or amend commits. Stage explicit paths only.
- `test-output` is user-provided untracked evidence. Leave it untouched and
  uncommitted.
- `Project Technical Report and Implementation Plan.md` is protected untracked
  user content. Leave it untouched and uncommitted.
- `docs/principles.md` and `docs/decisions.md` are absent by design. Do not
  create governance artifacts.
- No live KWin/Plasma mutation occurred in this package. Before any future live
  work, read `docs/live-kwin-testing.md`; it does not grant mutation authority.

## Current Repository Evidence

- HEAD: `24e8166` (`Update custom tile change records`).
- Static verification at that baseline: `npm --prefix kwin run typecheck`
  pass, `npm --prefix kwin run build` pass, `npm --prefix kwin test` 429 pass /
  49 suites / 0 fail, and `bash scripts/start-test.test.sh` 248 pass / 0 fail
  (recorded at `unit-23/attempt-02`).
- Last validated bundle SHA-256:
  `01ba4c2e10b88a7818444a8f59aaa416bb9ef0fec8ca169b9a03fa169684ed56`. Never
  edit generated `kwin/contents/code/main.js` manually.
- Authored production code is strict TypeScript; the generated ES2017 IIFE is
  the KWin payload. Toolchain dependencies remain managed by `devenv.nix` and
  `kwin/package.json`; do not install dependencies ad hoc.
- `docs/changes/custom-tile-vertical-slice/log.md` is the append-only change
  log and is gitignored/untracked by design; `state.md` and `plan.md` are the
  tracked durable records.
- Host baseline: KWin PID `460069`, started `Wed Aug 12 09:51:50 2026`; sole
  live output `eDP-1`, UUID `76d3106d-dc9a-4ca1-8d56-ccbe99dd7837`,
  `1536x1024`; `kwinrc` SHA-256
  `b963179f751fba2f8890a41be48ff501f0ee09264b9e774fd8b02f9ee484767c`; and
  `kwinoutputconfig.json` SHA-256
  `14bfd5f455e1678fe0c9504d2c2263f0451afa70d076721bc1e95decb0dbe13e`. There
  are 14 `eDP-1` tiling groups, 10 orphaned. Never touch the orphaned groups.

## Accepted Product Direction and Capabilities

- The user explicitly approved automatic product ownership of managed
  workspace/output topology and chose ratio-free `dwindle` as the default.
  For scopes managed by this enabled plugin, this supersedes the old parked
  question of whether authored layouts may be replaced. Do not list that
  product choice as pending.
- Automatic session-local managed-scope `dwindle` ownership is now
  implemented (units 21/23, commit `736e485`): on controller start and scope
  change the scope is adopted to the ratio-free dwindle blueprint, a valid
  selected overlay takes precedence, an overcrowded scope grows by splits-only
  insertion, and a provably freed leaf collapses via exactly one guarded
  `CustomTile.remove()` plus a fresh whole-root decode. Adds and removes are
  never mixed in one dispatch and no timer is used for any structural
  transition; a structural failure marks only that scope inert for the session.
  This is static/nested-proven, not host-live accepted.
- The current project catalog has 27 atomic actions: insertion, focus, move,
  focused-leaf columns/rows/balanced-grid/dwindle presets, detach, attach, and
  scope fill. It includes direct `Meta+Arrow` focus aliases and
  `Meta+Shift+Arrow` move aliases, as well as the H/J/K/L variants.
- `822db26` (`Fix adjacent tile focus selection`) accepts the source correction
  that touching facing edges are zero-distance directional neighbors; overlap
  and diagonal-only candidates remain rejected. It is not live callback proof.
- `dd3a9e3` (`Add project arrow shortcut aliases`) is accepted. The user
  explicitly authorized clearing only Krohnkite's eight conflicting direct
  Meta-arrow and Meta+Shift-arrow sequences. Those sequences were cleared
  exactly; nonconflicting Krohnkite settings were preserved, and Krohnkite
  remains disabled and unloaded.
- The plugin's guarded shortcut catalog registers all 27 actions atomically.
  Persisted KGlobalAccel records do not prove loaded callbacks.
- Static capabilities include guarded focus/move-to-empty, guarded directional
  occupied-target window swap (the nearest ranked non-layout leaf's occupancy
  decides move-to-empty versus swap), focused-leaf preset application,
  selected-overlay tracking and assignment-only reflow, guarded attach/detach,
  scope fill, and automatic `dwindle`. None establishes host-live structural or
  callback behavior.

## Binding Structural Safety and Hybrid Recovery

- Pinned KWin 6.7.3 source is `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`.
  `workspace.rootTile(output, desktop)` is the root accessor;
  `workspace.tilingForScreen(output)` is not usable as one. `root.remove()` is
  inert. Removing a two-child nested parent leaves a zero-child leaf in its
  region without changing the grandparent child count; sibling wrapper identity
  is unknown. Removing a root leaf preserves direction and outer geometry,
  changes children `3 -> 2`, and redistributes widths `320/160 -> 480/160`.
  Fresh dispatches immediately read the consistent post-removal tree.
- Across an event-loop yield, a stale wrapper remains non-null but
  `layoutDirection`, `absoluteGeometry`, and `tiles` read as `undefined`, while
  `pick(0,0)` throws catchably. All other stale-wrapper methods and structural
  calls are untested and prohibited. `CustomTile::split()` updates child
  geometry inline (`customtile.cpp:193-256`); `remove()` updates model and
  sibling geometry before `deleteLater()` (`:273-342`); TileModel notifications
  are immediate (`scripting/tilemodel.cpp:123-155`).

- A live remove-contract probe on a persistent scope crashed KWin with the
  exact stack `QTimer::timeout -> JS callback -> KWin::CustomTile::split ->
  KWin::TileModel::beginInsertTile -> QAbstractItemModel::beginInsertRows`.
  Mechanism: `split()` on a tile tree already changed by a prior `remove()`;
  the earlier remove recursively promoted a single-child layout and
  `deleteLater()`ed the detached tiles (`customtile.cpp:273-343`), so the later
  split ran against model rows that no longer matched the live tree
  (`customtile.cpp:40-50` -> `scripting/tilemodel.cpp:123-138`). The fixed 3000
  ms timer was not a `deleteLater` settle barrier; a timer cannot observe
  deferred deletion.
- Durable prohibitions (also recorded in `docs/live-kwin-testing.md`): never
  `remove()` then `split()` in one run; never use a fixed-timer `deleteLater`
  barrier; always re-resolve every tile handle including the root after any
  removal; only homogeneous structural batches with fresh root decode after
  every call; never run a structural probe in a persistent user scope. A
  scripted collapse (repeated `remove()`) is crash-class, never cleanup-class.
- Pinned KWin 6.7.3 source evidence for the guarded directional swap: writing
  `window.tile = X` dispatches to `Window::setTileCompatibility`
  (`src/window.cpp:3803-3814`), which calls `X->manage(this)` then
  `previousTile->unmanage(this)`. `Tile::manage` (`src/tiles/tile.cpp:377-425`)
  first evacuates the window from its previous tile across all outputs, then
  `add`s it to the target tile, so a single write never leaves the window
  doubly listed. A swap is at most two guarded `window.tile` writes plus one
  best-effort restoration; the destination leaf transiently holds both windows
  only between the two synchronous writes. Full detail: `plan.md` unit-20 and
  `state.md`.
- Unit-21 nested evidence PROVED the only safe one-shot event-loop-turn yield
  primitives for remove -> yield -> split: a zero-delay `QTimer` one-shot and
  the `callDBus(...ListNames, cb)` async reply seam. Both fired exactly once
  (21/21 chained, 8/8 Design-B cycles); `Qt.callLater` is absent and the
  `desktopsChanged` re-entering signal is ruled out. deleteLater ordering is
  established (timer before DeferredDelete, callDBus after), but the design
  does not depend on it because safety comes from fresh re-resolution.
- Hybrid recovery (`unit-23/attempt-01`): automatic dwindle reconstruction is
  a two-phase non-timer pipeline - synchronous removals-only collapse, then
  synchronous splits-only rebuild - separated by a named one-shot `yieldOnce`
  event-loop yield implemented with the proven `callDBus` primitive. Per-pending
  phase/arm bookkeeping keeps stale and duplicate callbacks inert. Because a
  D-Bus error reply is logged and never invokes the armed callback
  (`scripting.cpp:361-364`), a lost split-phase reply is re-driven by a later
  ordinary lifecycle event; a failed arm marks the scope inert instead of
  stranding. Full detail: `plan.md` units 21/23 and `log.md`.
- `windowRemoved` fires before KWin detaches the window from its leaf. Collapse
  must therefore wait one yield. The product pipeline is
  `startReconstruction() -> yieldOnce() -> removals-only collapse -> yieldOnce()
  -> splits-only rebuild`, bounded at two yields regardless of window count.
  A callback error reply is recoverable: re-arm the current phase on lifecycle
  events at most twice per phase, then make only that scope inert.

## Tiling Persistence Boundary

- Tiling config is `[Tiling][<desktop UUID>][<output UUID>]`, with `tiles` and
  `padding`. Layout JSON is recursive `horizontal`, `vertical`, or `floating`;
  non-floating children use relative `width`/`height`, floating children use
  full `x/y/width/height`, and there is no schema version
  (`tilemanager.cpp:197-275,288-340,342-405`).
- Do not try runtime topology adaptation by writing `kwinrc`: TileManager reads
  only at construction and `desktopAdded`, has no tiling KConfigWatcher,
  `Workspace::reconfigure()` does not reload tiling, no D-Bus method reloads
  layouts, and scripts cannot write arbitrary `kwinrc` (though outbound
  `callDBus` is available). The 2000 ms TileManager timer is persistence-only,
  not layout. External deletion of non-live-output tiling groups remained absent
  after three seconds; config writes can seed cold start only.

## Nested Compositor Isolation

- `dbus-run-session` isolates D-Bus, not files. An early unisolated nested run
  (PID `493164`, `11:34:11`) wrote the host `kwinrc` at `11:34:12.06`, creating
  phantom output `59aab4a5-024a-40d8-8f45-d8b28e4c45fa` (`WL-0`,
  `640x480@60`) and four tiling groups plus a stale
  `kwinoutputconfig.json` entry at `0/data/1`. These were cleaned only under
  authorization.
- `docs/live-kwin-testing.md` (Nested Compositor Config Isolation) is the
  authoritative operational contract, implemented by
  `scripts/nested-kwin-spike.sh`: private fresh XDG homes and runtime dir per
  run (runtime dir owned by the calling user, mode 0700), a private
  `dbus-run-session`, the proven recipe `--socket nested-kwin-spike --width 640
  --height 480 --no-global-shortcuts --no-kactivities --no-lockscreen` (never
  `--windowed`), and the absolute parent display `/run/user/<uid>/wayland-0`
  passed via `--wayland-display` because a private runtime dir breaks relative
  display resolution.
- Empirical acceptance: host `~/.config/kwinrc` SHA-256 and nanosecond mtime
  unchanged after a 3+ second nested run that wrote its own private `kwinrc`.
  Host KWin PID `460069` and its start time were unchanged before and after
  every unit-19/21/23 nested run.
- Nested compositors are headless: client geometry, animation, and jank are not
  observable. `--no-global-shortcuts` prevents physical shortcut testing. Track
  clients by PID, never index. Locate tile windows by nearest center with a
  small tolerance, never exact-pixel equality.

## Trial Failure and Prevalidation

- `unit-23/attempt-02` (nested removal-rebuild validation, 2026-08-12) is the
  current trial and is PARTIAL. It live-proved the `callDBus` deferred-collapse
  correction: 4 -> 3 and 3 -> 2 removals each observed `removed-obs tile=set`
  then `ownership-remove-deferred -> ownership-remove-collapsed ->
  ownership-pending -> ownership-collapsed -> ownership-taken`, with fresh
  trees `H[A,V[C,D]]` and `H[C,D]` and every survivor tiled exactly once. The
  attempt stopped when its rect-based D locator missed the final leaf's center
  x=479 by one pixel (a harness defect, not a product defect), so no
  authoritative N=1/N=0 shape snapshots and no detached-window-close evidence
  exist. Those cases remain unknown.
- Prevalidation status: the strict `loadScript` parser contract was
  prevalidated against retained valid evidence and eight malformed/false-
  positive vectors; the detached-heartbeat supervisor writer was prevalidated
  at `unit-05/attempt-25`; and nested isolation acceptance preceded every
  unit-19/21/23 run. Nothing further is live-authorized.
- Timing baselines from `unit-23/attempt-02` (n=2 full-rebuild samples, not
  frame-time, visual-jank, or client-geometry measurements): 6713 us for 4 -> 3
  (5092 us deferred to collapse) and 5172 us for 3 -> 2; cleanup-phase closes
  2 -> 1 and 1 -> 0 recorded 175 us and 900 us deferred-to-collapse with no
  rebuild. D-Bus `run()` round trips were 4-7 ms and in-JS structural timings
  were 0 ms at `Date.now()` 1 ms resolution (`unit-19/attempt-04`, coarse
   comparison only).
- Baselines are nested/headless journal wall-clock including yields, n=1-2 per
  path, not frame or jank timing: takeover `1583 us + 624 us`; add rebuild
  `492 us`; removal `4 -> 3` `6713 us`; removal `3 -> 2` `5172 us`; three
  synchronous splits/removals `5 ms`/one dispatch versus deferred `13 ms`/three
  dispatches and `12 ms`/three dispatches. Removals cost roughly 10x adds.
- Live nested validation caught three defects that unit tests missed: the
  zero-child-layout-root leaf model, `windowRemoved` before detach, and the
  first-add-after-N=0 inert path. Lifecycle tests must be able to fail when a
  guaranteed dispatch seam is absent. Two Leads self-rejected defective work
  and four packages returned blocked; those were correct outcomes.

## Accepted Live Boundary

- Accepted live evidence is limited to registration/readiness and matching
  shortcut records on the host (plugin unloaded after), plus isolated
  nested-compositor structural evidence (unit-19 `CustomTile.remove()` contract,
  unit-21 yield primitives, unit-23/attempt-02 partial removal rebuild). Host
  KWin PID `460069` unchanged across every nested run.
- Host-persistent-scope structural behavior - focus edge-touch, direct-arrow
  callback delivery, reset, automatic ownership, structural presets, and
  attach/detach runtime behavior - remains unaccepted and parked. Do not
  perform another host structural mutation. Do not treat persisted records,
  historical diagnostics, or static results as callback evidence.
- Do not revive the prior large supervisor harness.

## Product Decisions and Reserved Decisions

- Resolved: automatic session-local ownership is approved when the plugin is
  enabled, using ratio-free dwindle topology. Homogeneous legal batches may
  re-enter synchronously by discarding child handles and re-resolving/decoding
  the root after every call. Never mix removal and split in one run, touch
   stale handles, or use a timer as a deletion barrier. Full detail:
   `plan.md` Pending User Decisions.
- Automatic ownership is session-local only. Persistence format and
  compatibility policy are reserved to the user and remain unimplemented.
- Reserved (user decision needed): helper language/runtime/packaging for the
  cold-start `[Tiling]` writer (default: existing dev-only Node toolchain; any
  other runtime needs a `devenv.nix` update plus session restart); whether a
  separately-authorized future live package may test restart-realization of a
  written group; stale `[Tiling]` groups remain untouchable.
- `[Tiling]` is viable only as cold-start persistence, not automatic runtime
  realization: no runtime reload exists and a running manager overwrites an
  external edit on its 2s save. A dynamic product needs upstream KWin reload
  support or a separately-safe supported structural API. Full evidence:
  `plan.md` and `state.md` (Tiling Config Realization Investigation).
- Reserved to the user: stable multi-output identity policy, persistence
  format/compatibility, preset ratio semantics, rounded-corner and
  active-highlight component architecture, final packaging/distribution, and
  helper component language/runtime. The automatic trial is confined to
  `eDP-1`; no multi-output policy is implied.

## Exact Next Package

1. The user authorized a controlled live trial of automatic dwindle ownership
   confined to `eDP-1` on a scratch virtual desktop. The last attempt failed on
   two harness defects before any topology transition, produced zero
   product-runtime evidence, and fully restored the session.
2. Fix and prevalidate both defects before retrying: the scratch-desktop
   ownership verifier computed after-minus-before as `list - set`, raising
   `TypeError`; and the supervisor manifest was written in the evidence
   directory rather than its runtime directory, preventing automatic removal of
   the owned scratch desktop.
3. Preserve the stated structural safety pipeline and exact ownership/cleanup
   boundary. Do not broaden the trial to another output or persistence work.

## Parked Items

- Live reset and host structural validation is parked pending an explicitly
  owned/isolateable scope and its specific mutation authorization; it is not
  authorized on a persistent user scope by the product decision alone.
- Manual drag split and Esc-cancellation journeys remain untested pending a
  future interactive session.
- Dynamic-workspace lifecycle outside the accepted managed-scope direction,
  multi-output hotplug identity, persistence, ratios, broader layout modes,
  effects, packaging, and performance claims remain outside the current slice.
- Unknowns: client-visible geometry/animation/jank, physical shortcut delivery
  under host KWin, sibling wrapper identity after removal, and runtime
  structural preset application.

## Related Records

- [Active Custom Tile state](changes/custom-tile-vertical-slice/state.md)
- [Active Custom Tile log](changes/custom-tile-vertical-slice/log.md)
- [Active Custom Tile plan](changes/custom-tile-vertical-slice/plan.md)
- [Live KWin/Plasma testing guide](live-kwin-testing.md)
