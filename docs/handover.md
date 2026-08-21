# Terminal Succession Handover: plasma-auto-tiler

Status: terminal handover for a fresh Orchestrator. All prior Lead and Worker
sessions are terminal; do not resume them. This handover supersedes every older
session instruction and all historical "next package" statements.

Written at HEAD `0341bb3`. The immediately preceding handover (commit
`d61136d`) is fully superseded; its "Exact Next Package" section named an
abandoned live-trial package and must be ignored.

## 1. Process and Role Configuration

| Role | Configured agent | Context |
|---|---|---:|
| Orchestrator | top-level session | 150000 |
| Lead | `lead-openai` | 150000 |
| Worker | `worker` | 150000 |

- `lead-anthropic` is unavailable; its quota is exhausted.
- Exactly one subagent may be active across the whole hierarchy. Never
  parallelize.
- Approximately 20 Orchestrator dispatches is a terminal succession boundary.
  The session that wrote this handover used roughly 16.
- Commits are expected after each major piece of work. Do not push. Do not
  amend. Stage explicit paths only.
- `docs/principles.md` and `docs/decisions.md` are absent by design. Do not
  create governance artifacts.

### Standing user directives

- **Be pragmatic and keep building momentum toward something usable.** Do not
  get stuck in testing and verification loops that do not realise value.
- Never make assumptions or decisions on the user's behalf. On a roadblock,
  ambiguity, or surprise, stop and report; ask before pivoting.
- The user runs all live install/enable/disable commands personally. Agents
  must never mutate the live host session.

### Protected untracked paths

Leave untouched and uncommitted, always:

- `test-output` - user-provided evidence.
- `Project Technical Report and Implementation Plan.md` - protected user
  content.

## 2. Repository State

HEAD `0341bb3`. Working tree clean apart from the two protected untracked paths
above.

Commits produced by the session that wrote this handover, oldest first:

| Commit | Summary |
|---|---|
| `96e8b20` | Add dogfood package manager |
| `d6915ad` | Test dogfood package manager |
| `7fe8262` | Document dogfood installation |
| `be2c0c2` | Archive dogfood packaging change |
| `cec1282` | docs: record dogfooding backlog |
| `02efdae` | docs: add tiling recovery change |
| `f9f5ace` | docs: record nested reproduction result |
| `aa8cc13` | fix: recover from dwindle geometry limit |
| `84e4c07` | docs: record tiling recovery verification |
| `972ae32` | docs: record drag-drop research |
| `5406d83` | docs: specify post-drop reflow |
| `6b940ca` | feat: reflow native tile drops |
| `9aee46b` | fix: preserve bundle module initialization order |
| `d81bc3b` | test: smoke execute shipped KWin bundle |
| `0341bb3` | fix: reflow plain drags from final geometry |

### Verification baseline at HEAD

Run from the repository root unless noted:

- `npm --prefix kwin run typecheck` - pass
- `npm --prefix kwin run build` - pass
- `npm --prefix kwin test` - 453 pass, 51 suites, 0 fail
- `bash scripts/start-test.test.sh` - 248 pass, 0 fail
- `bash scripts/dogfood-install.test.sh` - 108 pass, 0 fail

Never hand-edit generated `kwin/contents/code/main.js`. It is built from
`kwin/src` and the rebuilt artifact is committed.

## 3. The Plugin Is Now Installed And Dogfooded

This is the single biggest change in project posture. The plugin is installed
and running on the user's real Plasma session and is being used daily.

`scripts/dogfood-install.sh` provides `install`, `uninstall`, `enable`,
`disable`, `reload`, and `status`. Change archived at
`docs/changes/archive/2026-08-12-dogfood-install-packaging/`. `README.md` at the
repo root documents prerequisites, the full 27-shortcut catalog, and an honest
statement of what enabling does to the session.

- Install destination: `$XDG_DATA_HOME/kwin/scripts/plasma-auto-tiler-kwin/`,
  falling back to `$HOME/.local/share/...`.
- Enable/disable write `[Plugins] plasma-auto-tiler-kwinEnabled` via
  `kwriteconfig6`, then `qdbus org.kde.KWin /KWin reconfigure`.
- `kwriteconfig6`, `kreadconfig6`, and `qdbus` are **host Plasma runtime
  prerequisites, deliberately NOT `devenv.nix` dependencies**. The user ruled
  this explicitly: these commands run against the live session and must use that
  session's own Plasma tooling, and pinning them would risk version skew and
  force a session restart. The script detects each tool at runtime with `*_BIN`
  overrides and fails with a clear error. **Do not add them to `devenv.nix`.**

### User's live-use verdict

Positive, verbatim in substance: it feels **super snappy**; window move and
navigation feel **great**; split resizing feels **great** and was better than
expected. Do not regress these.

## 4. BINDING METHODOLOGY RULING (user-directed, highest importance)

The user identified that this project has been inferring the JavaScript API
surface by reading KWin C++ headers, and correctly called that unsound and
dangerous. Undocumented internals can change without notice, and this practice
is the likely cause of the outstanding drag bug.

**Evidence hierarchy, mandatory from now on:**

1. **Official KDE/KWin scripting documentation is the primary source of truth**
   for what API exists and what may be depended upon. Start at
   `https://develop.kde.org/docs/plasma/kwin/` and the KWin scripting API
   reference.
2. **The scripting binding layer** in pinned KWin 6.7.3 (`src/scripting/`, and
   whatever registers `Workspace` and `Window` to QJSEngine) decides what is
   technically reachable when documentation is silent.
3. **KWin C++ internals may only EXPLAIN behaviour already established as
   exposed.** They may never be the basis for an API claim.

Honest caveat: KWin's scripting documentation is materially incomplete, so a
documentation-only answer may be unattainable. Where undocumented but registered
API must be used, say so explicitly and record it as an upgrade risk. Never
silently treat internals as API.

**Consequence not yet acted on:** a large share of this project's accumulated
knowledge, including the structural safety rules in section 8, was derived from
pinned C++ source. That knowledge remains valuable for understanding *why*
things crash, but the project's upgrade exposure is higher than the record
implies. Capturing this as a durable decision is a user-owned call and has not
been made.

## 5. THE OUTSTANding BUG: drag events never reach the script

This is the top priority and the work in flight when the session ended.

### Symptom, confirmed live

The user dragged windows repeatedly, both plain and with Shift. The journal
contains **ZERO `plasma-auto-tiler:drag-*` lines of any kind** - not
`drag-origin-captured`, not `drag-finished`, not even `drag-bail:<reason>`.

A log line was deliberately placed at drag-hook entry, before any other logic,
precisely to disambiguate. Its total absence proves the hook never executes.
This is **not** "fires but bails". KWin delivers no interactive move-resize
event to our script.

### What was already ruled out

- **Not a stale bundle.** The TDZ warnings are gone from the live log,
  confirming the current build is installed.
- **Not the plugin failing to load.** The same log shows
  `startup-handlers-ready`, `ownership-taken`, `window-added-observed`,
  `window-added-eligible`, `automatic-placement-managed`,
  `boundary-decoded:split-result`, `ownership-add-split`, and
  `ownership-remove-deferred`. Tiling is healthy.
- **Not "fires but bails"**, per the missing entry log line.

### A prior Lead's claim that was WRONG

A Lead reported the connection verified and ruled out a wiring fault. It had
only verified that `.connect()` was called against our own test stub. That
proves nothing about KWin delivering a signal. **Do not repeat this error.**

### Unverified hypothesis, must be checked not assumed

We connected to the per-window C++ signal `interactiveMoveResizeFinished`, found
in `src/window.h`. It may not be reachable from scripting. KWin's scripting API
may instead expose drag lifecycle at the **workspace** level, under names such
as `windowStartUserMovedResized` / `windowFinishUserMovedResized`.

This is a hypothesis only. Qt's meta-object system often makes signals reachable
automatically once an object is exposed, so it may be wrong. Settle it against
documentation first, per section 4.

### Required approach for the next attempt

1. Determine from **documented API first** which drag / interactive move-resize
   signals a KWin script can actually receive, and whether they are
   workspace-level or per-window. Label each signal `documented`,
   `undocumented-but-registered`, or `unavailable`, with URLs and citations.
2. Rewire onto whatever is genuinely available, preferring documented and
   workspace-level options.
3. **Log at connection time, not only at event time**: emit
   `plasma-auto-tiler:drag-attach-ok:<signal-name>` per successful connect and
   `plasma-auto-tiler:drag-attach-failed:<signal-name>:<detail>` on failure or
   absence. Without this, "never attached" and "attached but never fires" are
   indistinguishable, and two live round trips were already lost to exactly that
   ambiguity.
4. **Connect defensively to every plausible candidate signal at once**, each
   with a distinct log line, so a single live test decisively identifies which
   signal KWin delivers. This is explicitly encouraged; one decisive round trip
   beats another guess.

## 6. Approved Drag-and-Drop Product Behaviour

All of the following are user-approved and must not be re-litigated.

- **Requiring Shift is REJECTED.** A plain drag must retile. Cosmic and
  Hyprland need no modifier and the user does not want the concept introduced.
- At drag finish, compute the drop target **ourselves from the window's final
  geometry against our own decoded tile tree**, then reflow. Plain drag (KWin
  floats the window) and Shift drag (KWin tiles it) must converge on the same
  result. Do not attempt to veto or suppress KWin's native Shift behaviour;
  scripts provably cannot, and it is harmless once we reflow at drop time.
- **Reflow semantics, not swap semantics**, chosen by the user over the simpler
  swap option.
- **Acceptance example, stated by the user**: given Left=term1,
  Right=[Top=term2, Bottom=term3], dragging term2 to the bottom-left yields
  Left=[Top=term1, Bottom=term2], Right=term3.
- Placement within the target tile is decided by where inside it the drop
  landed. The current ambiguous-central-drop default is a vertical split with
  the existing occupant above and the dragged window below. That default is a
  judgement call and the user may change it.

### Deferred: live reflow as preview (user's own idea, endorsed)

The user proposed reflowing the real tiles during the drag so the windows
themselves are the preview, instead of drawing an overlay box, reverting if the
drag is cancelled. This dissolves the overlay/architecture problem entirely and
is a good direction. It is **deliberately deferred** behind three concerns:

1. Reflow must be debounced on **drop-target change**, never per motion event.
   A reflow is roughly 5-13 ms of tree surgery; motion events fire far too
   often.
2. **Cancel detection is unverified.** Whether a script can distinguish an
   Esc-cancelled drag from a committed drop is unknown, and Esc-cancellation has
   never been tested on this project. The revert plan depends entirely on it.
3. **The dangerous one:** it requires structural tree surgery while KWin holds
   an active interactive grab. This project has already crashed KWin once with a
   `CustomTile::split` -> `TileModel::beginInsertTile` stack from operating on a
   shifted tile tree. Mid-grab mutation is a strictly more hostile version of
   that and nothing in the pinned source has been checked for it.

Staging plan agreed with the user: Stage 1 is drop-time reflow only, sharing the
same reflow engine; Stage 2 turns on live reflow once cancel detection and
mid-grab safety are both proven. Nothing is wasted.

**Until then: NO mid-drag tile mutation. Do not reflow on a stepped/motion
signal.**

## 7. What KWin Natively Does On Drag (established, and confirmed live)

Derived from pinned C++ source and **confirmed by the user's own observation**,
so the behavioural conclusions are trustworthy even though the API-surface
inferences are not (see section 4).

- Holding **Shift** during a drag makes KWin draw a candidate-tile outline and,
  on release, manage the window into the picked custom tile. Source:
  `src/window.cpp:1240-1249, 2566-2575, 1069-1111, 3677-3703`;
  `src/tiles/customtile.cpp:460-483`. It previews the candidate tile only, never
  a reflowed result.
- Dragging **without** Shift applies no custom tile and leaves the window
  floating, via `Tile::unmanage()` and `Window::requestTile(nullptr)`. Source:
  `src/tiles/tile.cpp:427-464`; `src/window.cpp:3750-3790`.
- Dropping onto an **occupied** tile does not swap or reflow. `Tile` holds
  `QList<Window *> m_windows` and `add()` appends, so the target tile ends up
  holding **both windows overlapping at identical geometry**. The user observed
  exactly this: the dragged window lands on top of the existing one at the same
  size.
- Scripts **cannot** veto, cancel, or redirect a drop. They may only act after
  it. Claimed source: `src/window.h:1483-1514`; `src/window.cpp:1205, 1236`;
  `src/tiles/tile.h:127-128`. **Treat the signal-availability part of this as
  unverified** - it is the very inference under suspicion.
- Scripts cannot use KWin's native outline API; `workspace().outline()` is
  C++-internal. QML is reachable only via a scene-replacing
  `ScriptedQuickSceneEffect`. Source: `src/scripting/scripting.cpp:687-720`;
  `examples/quick-effect/package/contents/ui/main.qml`.
- Consequence: reflow-on-drop with a native-fidelity preview would need compiled
  C++, or the deferred live-reflow approach in section 6.

Research recorded at `docs/changes/drag-and-drop-reorganisation/` (commit
`972ae32`).

## 8. Binding Structural Safety Rules (unchanged, still in force)

Pinned KWin 6.7.3 source is `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`.

- `workspace.rootTile(output, desktop)` is the root accessor;
  `workspace.tilingForScreen(output)` is not usable as one. `root.remove()` is
  inert.
- Removing a two-child nested parent leaves a zero-child leaf in its region
  without changing the grandparent child count; sibling wrapper identity is
  unknown. Removing a root leaf preserves direction and outer geometry, changes
  children `3 -> 2`, and redistributes widths `320/160 -> 480/160`. Fresh
  dispatches immediately read the consistent post-removal tree.
- Across an event-loop yield a stale wrapper remains non-null but
  `layoutDirection`, `absoluteGeometry`, and `tiles` read as `undefined`, while
  `pick(0,0)` throws catchably. All other stale-wrapper methods and structural
  calls are untested and prohibited.
- `CustomTile::split()` updates child geometry inline
  (`customtile.cpp:193-256`); `remove()` updates model and sibling geometry
  before `deleteLater()` (`:273-342`); TileModel notifications are immediate
  (`scripting/tilemodel.cpp:123-155`).

**Durable prohibitions** (also recorded in `docs/live-kwin-testing.md`):

- Never `remove()` then `split()` in one run.
- Never use a fixed-timer `deleteLater` barrier; a timer cannot observe deferred
  deletion.
- Always re-resolve every tile handle including the root after any removal, with
  a fresh whole-root decode.
- Only homogeneous structural batches, with a fresh root decode after every
  call.
- Never run a structural probe in a persistent user scope.
- A scripted collapse (repeated `remove()`) is crash-class, never
  cleanup-class.

Origin of these rules: a live remove-contract probe crashed KWin with the exact
stack `QTimer::timeout -> JS callback -> KWin::CustomTile::split ->
KWin::TileModel::beginInsertTile -> QAbstractItemModel::beginInsertRows`,
because `split()` ran on a tree already changed by a prior `remove()` whose
`deleteLater()`ed tiles no longer matched the model rows.

### Proven yield primitives and the reconstruction pipeline

- The only safe one-shot event-loop-turn yield primitives for
  remove -> yield -> split are a zero-delay `QTimer` one-shot and the
  `callDBus(...ListNames, cb)` async reply seam. Both fired exactly once (21/21
  chained, 8/8 Design-B cycles). `Qt.callLater` is absent; the
  `desktopsChanged` re-entering signal is ruled out.
- Automatic dwindle reconstruction is a two-phase non-timer pipeline:
  synchronous removals-only collapse, then synchronous splits-only rebuild,
  separated by a named one-shot `yieldOnce` implemented with the `callDBus`
  primitive. Per-pending phase/arm bookkeeping keeps stale and duplicate
  callbacks inert.
- A D-Bus error reply is logged and never invokes the armed callback
  (`scripting.cpp:361-364`), so a lost split-phase reply is re-driven by a later
  ordinary lifecycle event; a failed arm marks the scope inert rather than
  stranding.
- `windowRemoved` fires **before** KWin detaches the window from its leaf, so
  collapse must wait one yield. Full pipeline:
  `startReconstruction() -> yieldOnce() -> removals-only collapse -> yieldOnce()
  -> splits-only rebuild`, bounded at two yields regardless of window count.
  Re-arm the current phase on lifecycle events at most twice per phase, then
  make only that scope inert.

### Guarded directional swap

Writing `window.tile = X` dispatches to `Window::setTileCompatibility`
(`src/window.cpp:3803-3814`), which calls `X->manage(this)` then
`previousTile->unmanage(this)`. `Tile::manage` (`src/tiles/tile.cpp:377-425`)
first evacuates the window from its previous tile across all outputs, then
`add`s it to the target, so a single write never leaves a window doubly listed.
A swap is at most two guarded `window.tile` writes plus one best-effort
restoration.

Note: the live log shows KWin emitting `Writing to the property window.tile is
deprecated: use tile.manage() instead`. Migrating to `tile.manage()` is an
unaddressed cleanup item.

## 9. Tiling Persistence Boundary (unchanged)

- Tiling config is `[Tiling][<desktop UUID>][<output UUID>]` with `tiles` and
  `padding`. Layout JSON is recursive `horizontal`, `vertical`, or `floating`;
  non-floating children use relative `width`/`height`, floating children use
  full `x/y/width/height`; there is no schema version
  (`tilemanager.cpp:197-275,288-340,342-405`).
- **Do not attempt runtime topology adaptation by writing `kwinrc`.**
  TileManager reads only at construction and `desktopAdded`, has no tiling
  KConfigWatcher, `Workspace::reconfigure()` does not reload tiling, no D-Bus
  method reloads layouts, and scripts cannot write arbitrary `kwinrc` (outbound
  `callDBus` is available). The 2000 ms TileManager timer is persistence-only.
- `[Tiling]` is viable only as cold-start persistence, never automatic runtime
  realization. A running manager overwrites an external edit on its 2 s save. A
  dynamic product would need upstream KWin reload support or a separately-safe
  supported structural API.

## 10. Nested Compositor Isolation (unchanged, and a warning)

- `dbus-run-session` isolates D-Bus, not files. An early unisolated nested run
  wrote the host `kwinrc`, creating a phantom output and four tiling groups.
- `docs/live-kwin-testing.md` (Nested Compositor Config Isolation) is the
  authoritative operational contract, implemented by
  `scripts/nested-kwin-spike.sh`: private fresh XDG homes and runtime dir per
  run (runtime dir owned by the calling user, mode 0700), a private
  `dbus-run-session`, the recipe `--socket nested-kwin-spike --width 640
  --height 480 --no-global-shortcuts --no-kactivities --no-lockscreen` (never
  `--windowed`), and the absolute parent display `/run/user/<uid>/wayland-0`
  passed via `--wayland-display`.
- Nested compositors are **headless**: client geometry, animation, and jank are
  not observable, and `--no-global-shortcuts` prevents shortcut testing. Track
  clients by PID, never index. Locate tile windows by nearest center with
  tolerance, never exact-pixel equality.
- **Practical warning:** nested runs have repeatedly failed on this project and
  have consumed large amounts of effort for little return. Recent Worker
  attempts returned no report at all. Cap any nested work at **two attempts**,
  then proceed on other evidence and say so. Never iterate on harness defects.

## 11. Fixed This Session

### Permanent tiling death after ~10 windows (`aa8cc13`)

Root cause: KWin has a minimum tile geometry floor. Past roughly 10 windows on
the user's 1536x1024 display, a dwindle split produced an empty child.
`dwindleInsert()` treated `orderedChildren(...) === null` as corruption and
called `markInert()` at `kwin/src/controller.ts:3278-3285`; `isInert()` then
suppressed all further management at `kwin/src/controller.ts:2700-2736`. One hit
of the geometry floor killed tiling for the entire session.

Fix: that path now logs `ownership-add-failed:no-child-geometry` and leaves the
scope retryable, so deferred reconstruction recovers it on a later lifecycle
event. Other structural failures retain existing inert handling. Proven by a
regression test that fails with `ownership-inert` pre-fix.

**The underlying capacity limit remains.** Overflow windows past the floor
simply stay untiled. The user approved investigating stacked/tabbed tiles as the
long-term remedy (see section 12).

### Bundle temporal-dead-zone defect (`9aee46b`)

Root cause: `kwin/package.json` declared `"type": "commonjs"`, causing esbuild to
emit deferred `__esm`/`__commonJS` initializers. Module constants were assigned
from trailing initializers that ran **after** their consumers, so any code path
reaching one threw `ReferenceError` at runtime. The live log showed `MAX_TILES`,
`MAX_SEQUENTIAL_LENGTH`, `PRESET_KINDS`, `HORIZONTAL_LAYOUT_DIRECTION`,
`VERTICAL_LAYOUT_DIRECTION` and bundler-renamed `...2` duplicates all used
before declaration.

Fix: removed the package type so esbuild emits ordered IIFE initialization.
Verified by `rg '__esm|__commonJS'` returning nothing against the rebuilt bundle,
and **confirmed live** - the warnings are gone from the user's journal.

### Bundle is now actually tested (`d81bc3b`)

**The systemic failure this exposed:** the 439 tests exercised TypeScript source
modules, while the artifact shipped to KWin is a bundle no test ever executed.
Bundle-level defects were structurally invisible.

`kwin/tests/artifact-smoke.test.ts` now VM-executes the built
`kwin/contents/code/main.js` against a KWin stub and asserts 27 shortcut
registrations, 4 workspace subscriptions, and startup diagnostics, and rejects
deferred CommonJS wrapper markers. Proven effective: substituting the pre-fix
bundle makes the suite fail.

Caveat: this proves **Node** can execute the artifact. It does not prove
**QJSEngine** can. They are different engines.

## 12. Backlog

`docs/backlog.md` holds the tracked list. Newer entries deliberately link to
change directories that do not exist yet; the Orchestrator ruled that
**backlog entries may omit or carry a dead link until their change directory
exists**, because creating placeholder directories to satisfy a link convention
would be worse. Resolve each link when the work is created or discarded.

Pre-existing entries (unchanged): `js-baseline-measurement` (P1, active),
`integrated-plasma-structural-feasibility` (P1, active),
`custom-tile-vertical-slice` (P1, active), `sustained-workload-validation`
(P1, paused).

Added this session, in the user's approved priority order:

1. **P1** - Tiled-window drag-and-drop reorganisation with reflow-on-drop.
   **This is the active work; see section 5.**
2. **P2** - Move-to-workspace `Meta+Shift+1..9`, `Meta+Shift+0` to move to a
   newly appended workspace, `Meta+0` to navigate to a newly appended workspace.
   Depends on dynamic workspaces.
3. **P2** - Dynamic workspaces: create on demand; clean up workspaces that are
   empty and neither active nor visible. Previously parked as out of slice; the
   user has now requested it.
4. **P3** - Single float/tile toggle for the focused window. `detach`
   (`Meta+Shift+Space`) and `attach` (`Meta+Alt+Shift+Space`) exist as separate
   actions; the user wants one toggle.
5. **P3** - Sticky floating windows persisting across workspaces.
6. **P3** - `plasma-auto-tiler-focus-right` is bound to `Meta+Alt+Ctrl+L`,
   breaking the H/J/K/L pattern of `Meta+H`/`Meta+J`/`Meta+K`. **No source
   rationale exists** for the odd binding; a lock-screen-conflict explanation was
   guessed and is unsupported. Pick a sane sequence.

Also outstanding, not yet formal entries:

- **Stacked/tabbed tiles for overflow** past KWin's geometry floor. The user
  chose this as the remedy. Established: `Tile` holds `QList<Window *>
  m_windows`, `add()` appends, and scripts can call `manage()`/`unmanage()` and
  read the `windows` property, so multi-window-per-tile is reachable. But KWin
  provides **no tab or stack UI** - windows simply overlap at identical
  geometry. Stability as a foundation is `unknown`; the source carries an
  evacuation-design TODO.
- **Migrate `window.tile =` writes to `tile.manage()`**, which KWin now
  deprecation-warns about in the live log.
- **Record the undocumented-internals upgrade risk** as a durable decision
  (user-owned, see section 4).

## 13. Live Evidence Status

Accepted live evidence:

- Plugin loads, registers 27 shortcuts, adopts the scope at start, tiles
  windows, splits, and collapses on close. **Start-time adoption WORKS** -
  `startup-handlers-ready` and `ownership-taken` both appear at load. An earlier
  claim in this session that start adoption was broken was wrong and is
  retracted.
- Keyboard move, navigation, and split resizing work well and feel snappy.
- The TDZ fix is confirmed live.
- Native Shift-drag shows an outline and drops the window overlaying the
  existing one at the same size.

Not established live:

- **Any drag handling by our script.** See section 5.
- Physical shortcut delivery has never been isolated as proof; persisted
  KGlobalAccel records are not callback evidence.
- Client-visible geometry, animation, and jank. Nested compositors provably
  cannot observe these; only the user can.
- Sibling wrapper identity after removal; runtime structural preset application;
  Esc-cancellation and manual drag-split journeys.

Do not perform host structural mutation. Do not revive the prior large
supervisor harness.

## 14. Process Lessons This Session (read these)

1. **Three consecutive rounds shipped changes that passed full static suites and
   did nothing live.** Static green is not evidence of live behaviour. State
   explicitly, for every claim, whether it is documented, source-derived,
   statically proven, or unproven until the user tests.
2. **A unit test asserting `.connect()` was called on our own stub is not
   evidence KWin delivers a signal.** A Lead made this error and it cost two
   live round trips.
3. **Log at connection time, not only at event time.** Absence of an event log
   is ambiguous unless a connection log exists.
4. **Connect defensively to multiple candidate signals with distinct log
   lines.** One decisive live round trip beats a sequence of single guesses.
5. **The user's hands are the most valuable instrument this project has.** They
   found the drag defect, the 10-window death, and the methodology flaw. Nested
   harness work found none of these and repeatedly failed. Prefer shipping
   something the user can test over building more harness.
6. **A session crash already cost work once.** Commit early, commit often, and
   persist research findings before moving on - one Lead produced valuable
   findings and committed nothing.
7. Watch for unrelated noise in journals. A `starship` coredump in the user's
   log was their shell prompt, not KWin.

## 15. Exact Next Package

1. Fix the drag-signal delivery bug per section 5, using the mandatory
   methodology in section 4. Documentation first, binding layer second, C++
   internals never as an API claim.
2. Ship it with connection-time logging and defensive multi-signal connection so
   the user's next test is decisive.
3. Have the user install, enable, and drag while capturing
   `journalctl --user -f`, then report which `drag-attach-*` and `drag-*` lines
   appear.
4. Only then proceed to the approved reflow behaviour in section 6, and only
   then to the workspace features in section 12.

Do not start C++/Rust work, QML overlays, mid-drag mutation, persistence, or
multi-output policy without a fresh explicit user decision.

## 16. Related Records

- [Backlog](backlog.md)
- [Drag and drop reorganisation](changes/drag-and-drop-reorganisation/)
- [Tiling recovery robustness](changes/tiling-recovery-robustness/)
- [Dogfood install packaging (archived)](changes/archive/2026-08-12-dogfood-install-packaging/)
- [Active Custom Tile state](changes/custom-tile-vertical-slice/state.md)
- [Active Custom Tile plan](changes/custom-tile-vertical-slice/plan.md)
- [Live KWin/Plasma testing guide](live-kwin-testing.md)
- [README quickstart](../README.md)
