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

- Exactly one subagent may be active across the hierarchy. Approximately 20
  Orchestrator dispatches is a terminal succession boundary.
- Do not push or amend commits. Stage explicit paths only.
- `test-output` is user-provided untracked evidence. Leave it untouched and
  uncommitted.
- `Project Technical Report and Implementation Plan.md` is protected untracked
  user content. Leave it untouched and uncommitted.
- `docs/principles.md` and `docs/decisions.md` are absent by design. Do not
  create governance artifacts.
- No live KWin/Plasma mutation occurred in this package. Before any future live
  work, read `docs/live-kwin-testing.md`; it does not grant mutation authority.

## Current Repository Evidence

- Baseline before this handover commit: `eb3adb5af5bb669eb66ee46846e15d87fc0a56ed`
  (`Add guarded Custom Tile reset foundation`).
- Static verification at that baseline passed: `npm run typecheck`, `npm run
  build`, and `npm run test` from `kwin/`.
- The full test command reported 393 passing tests in 47 suites and 202 passing
  lifecycle checks, with zero failures.
- Ignored generated `kwin/contents/code/main.js` SHA-256 after that build:
  `7855a7f8c415b6b6ee578b5c783c32784fce42e4b7a44fd6938447e1e389057f`.
  Never edit generated JavaScript manually.
- Authored production code is strict TypeScript; the generated ES2017 IIFE is
  the KWin payload. Toolchain dependencies remain managed by `devenv.nix` and
  `kwin/package.json`; do not install dependencies ad hoc.

## Accepted Product Direction and Capabilities

- The user explicitly approved automatic product ownership of managed
  workspace/output topology and chose ratio-free `dwindle` as the default.
  For scopes managed by this enabled plugin, this supersedes the old parked
  question of whether authored layouts may be replaced. Do not list that
  product choice as pending.
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
  scope fill, and `dwindle`. None establishes live structural or callback
  behavior.

## Reset Boundary

- `eb3adb5` is source-safe only; it does not wire automatic lifecycle ownership.
- Pinned KWin `CustomTile.remove()` is void, can mutate promotion and occupancy,
  and uses `deleteLater`. The reset code guards unmanagement before removal,
  preserves the original root identity, and requires a fresh decoded smaller
  root after each remove.
- Live QJSEngine invocation, removal/promotion behavior, root identity, and
  fresh-root decoding remain unaccepted. Do not infer them from static tests.
- A 2026-08-12 direct contract-probe preflight created one nonce-owned desktop
  but stopped before switching it, loading a script, launching a test window,
  or calling `split()`/`remove()`: its strict desktop parser expected an extra
  JSON array level and rejected the actual valid `a(uss)` envelope. Reconciliation
  also established that `createDesktop` immediately materializes that desktop's
  default `tiles` and `padding` values. The exact desktop was removed and only
  its two exact keys were deleted; the original four-desktop current selection
  and `kwinrc` SHA-256 `cc624ba8763531610c42fe3b62b54c3192ee796314da9997dde2c6056f7141ab`
  were restored. This is restoration evidence, not any `remove()` contract
  evidence.
- A later `unit-19` reconciliation corrected the desktop enumeration decoder
  and proved the current-desktop scalar envelope is `{"type":"s","data":"..."}`.
  Three separate nonce-owned create/read/remove preflights then stopped before
  switch, script load, client launch, split, or remove: none had a new
  `[Tiling]` group on disk one second after `createDesktop`, despite the earlier
  materialization observation. Each cleanup restored the four-desktop/14-group
  baseline and `kwinrc` SHA-256
  `cc624ba8763531610c42fe3b62b54c3192ee796314da9997dde2c6056f7141ab`. This
  contradiction is a scope-integrity blocker, not `remove()` evidence.

## Remove-Contract Probe Crash and Directional Swap

- A live remove-contract probe on the current persistent scope crashed KWin
  with the exact stack `QTimer::timeout -> JS callback -> KWin::CustomTile::split
  -> KWin::TileModel::beginInsertTile -> QAbstractItemModel::beginInsertRows`.
  Mechanism: `split()` on a tile tree already changed by a prior `remove()`; the
  earlier remove recursively promoted a single-child layout and
  `deleteLater()`ed the detached tiles (`customtile.cpp:273-343`), so the later
  split ran against model rows that no longer matched the live tree
  (`customtile.cpp:40-50` -> `scripting/tilemodel.cpp:123-138`). The fixed 3000
  ms timer was incorrectly treated as a `deleteLater` settle barrier; a timer
  cannot observe deferred deletion. The probe artifacts were deleted:
  `scripts/run-current-remove-contract-probe.sh`,
  `scripts/run-remove-contract-probe.sh`, `kwin/src/remove-contract-probe.ts`,
  and the generated `kwin/contents/code/remove-contract-probe.js` and
  `remove-contract-current-scope-probe.js`.
- Durable prohibitions from the crash: never `remove()` then `split()` in one
  run; never use a fixed-timer `deleteLater` barrier; always re-resolve every
  tile handle including root after removal; one structural call per dispatch
  then stop; never run a structural probe in a persistent user scope. A
  scripted collapse (repeated `remove()`) can also crash the compositor and may
  expose an upstream KWin defect; it is crash-class, never cleanup-class.
- Whether `createDesktop` immediately materializes `[Tiling]` groups remains an
  unresolved contradiction (one preflight observed default `tiles`/`padding`;
  three later scopes found no persisted group one second after `createDesktop`).
  Treat neither observation as settled; do not perform another structural
  mutation until it is resolved.
- Pinned KWin 6.7.3 source evidence for the guarded directional swap: writing
  `window.tile = X` dispatches to `Window::setTileCompatibility`
  (`src/window.cpp:3803-3814`), which calls `X->manage(this)` then
  `previousTile->unmanage(this)`. `Tile::manage` (`src/tiles/tile.cpp:377-425`)
  first evacuates the window from its previous tile (removing it from every
  descendant of the desktop root/quick root across all outputs), then `add`s it
  to the target tile, so a single write never leaves the window doubly listed.
  Across the two swap writes the first-moved window's destination leaf
  transiently holds both windows (the pinned double-occupancy window), lasting
  only between the two synchronous writes with no event-loop yield. The
  untiled-stranding interval is zero for in-scope windows on the current
  desktop because both leaves are `isActive()` (tile.cpp:74-77), so `requestTile`
  always targets a real tile; the ordering that moves the active source first
  was chosen because a failed second write then leaves the source in the
  intended directional leaf and a single best-effort restoration returns both
  windows to their original leaves. A swap is at most two guarded `window.tile`
  writes, one more for best-effort restoration after a second-write failure;
  the selected-overlay record stores only ordinal leaf tiles and stays valid
  because a swap never changes the tile tree.


## Accepted Live Boundary

- Accepted live evidence is limited to registration/readiness and matching
  shortcut records. The plugin is unloaded after that evidence.
- Focus edge-touch behavior, direct-arrow callback delivery, reset,
  automatic ownership, structural presets, and attach/detach runtime behavior
  remain unaccepted.
- Do not revive the prior large supervisor harness. Do not treat persisted
  records, historical diagnostics, or static results as callback evidence.

## Exact Next Package

1. Reconcile why this KWin session has no persisted scratch `[Tiling]` group
   after `createDesktop`, contrary to the prior observation, without treating a
   switch-created group as an immediate-create result. Preserve the exact
   create/read/remove cleanup boundary and do not retry structural mutation
   until that scope-integrity contradiction is resolved.
2. Only then, on one owned scope, prove `CustomTile.remove()` synchrony,
   promotion, root identity, complete collapse, occupant handling, stale
   references, and immediate versus deferred removal sequencing using
   count-only diagnostics.
3. Only if that contract is accepted, wire session-local startup/add/remove
   managed-scope `dwindle` ownership, intentional detach exclusions, and valid
   selected-overlay precedence. Keep the work bounded and do not revive the old
   large supervisor harness.

## Parked Items

- Live reset validation is parked pending an explicitly owned/isolateable scope
  and its specific mutation authorization; it is not authorized on a persistent
  user scope by the product decision alone.
- Manual drag split and Esc-cancellation journeys remain untested pending a
  future interactive session.
- Dynamic-workspace lifecycle outside the accepted managed-scope direction,
  multi-output hotplug identity, persistence, ratios, broader layout modes,
  effects, packaging, and performance claims remain outside the current slice.

## Current Findings: kwinrc Tiling Config Realization (2026-08-12)

Read-only investigation, no live mutation, pinned KWin v6.7.3 commit
`45ec9a6d0ed312a803ff5658a2a3e61f221566c6`. Verdict: viable only as
cold-start persistence, not automatic runtime realization.

- `[Tiling]` groups are `[Tiling][<desktop UUID>][<output uuid>]` with `tiles`
  JSON + `padding`; no activity dimension. Read once per output's `TileManager`
  construction and per `desktopAdded` (`src/tiles/tilemanager.cpp:57-96,288-340`),
  created at outputAdd (`src/workspace.cpp:1428-1433`). No reload exists:
  `Workspace::reconfigure()` (`src/workspace.cpp:998-1037`) and the D-Bus
  `reconfigure`/`reloadConfig` paths (`src/org.kde.KWin.xml:5-7`,
  `src/dbusinterface.cpp:48-49,64-66`) never re-read tiling; no KConfigWatcher
  in `src/tiles/`. No KDE D-Bus API sets layouts.
- JSON has no version field; leaves use `width`/`height`/`x,y,width,height` by
  parent direction. createDesktop materialization contradiction resolved: the
  default-setup `layoutModified` emissions start the 2000ms save timer, so KWin
  persists the default `[Tiling]` group ~2s after desktop creation
  (`tilemanager.cpp:61-76,300-321,390-405`); the "one second" reads were too
  early.
- Script IPC is `Script.callDBus(...)` (async session bus, 9 args, trailing
  callback; `src/scripting/scripting.h:115-125`, `scripting.cpp:301-374`).
  Config access is read-only `readConfig` over `[Script-<pluginName>]` only
  (`scripting.cpp:296-299,119-123`); no `writeConfig` on `Script`.
- Proposal if cold-start-only support remains useful: unit-21 - dev-only,
  schema-pinned dwindle `[Tiling]` generator/validator + exact non-clobber
  group-selection tests. It cannot provide automatic adaptation: no supported
  reload exists and KWin can overwrite a live external edit on its 2s save.
  User must choose helper runtime/packaging and whether a separately-authorized
  live package may test the restart path. Stale groups remain untouchable.
- Full evidence: `docs/changes/custom-tile-vertical-slice/state.md` (Tiling
  Config Realization Evidence entry) and `plan.md`. Verification 2026-08-12:
  typecheck/build pass, 407 tests / 48 suites, 248 lifecycle checks pass. No
  commit, no stage, no live mutation.
