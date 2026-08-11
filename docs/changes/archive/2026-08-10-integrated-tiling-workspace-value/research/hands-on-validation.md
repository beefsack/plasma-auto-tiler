# Hands-On Validation Report: Disputed Claims Triaged from Pinned Source and Upstream Evidence

- Unit: `unit-04/attempt-01`
- Role: source/issue/integration-test validation only. **No hands-on runtime
  observation occurred** in this attempt, despite the historical filename
  `hands-on-validation.md`: the plan safety gate (plan `## Safety Gates`) is
  closed for this audit and the brief explicitly forbids live Plasma/COSMIC
  interaction, installation, configuration, compositor runs, and any
  `sustained-workload-validation` contact. This file is the durable evidence
  record for the triage; it is not a substitute for a future authorized
  observation.
- Evidence date: 2026-08-09. Evidence type: upstream source, upstream
  integration-test source, official upstream issue-tracker, and read-only local
  introspection of pinned source clones. No install, no live session, no config
  or window/output/desktop/shortcut/script/plugin/process change.
- Scope: only the three disputed, verdict-relevant claims below. No edits to
  `spec.md`, `plan.md`, `state.md`, `log.md`; no commit.

## Evidence base (read-only, pinned)

Local pinned source clones used (all verified at the exact pinned identities):

| Repo | Pin | Local path (read-only) |
|---|---|---|
| Krohnkite (anametologin fork) | tag `0.9.9.2` = `1d7fd742edd58963c94a158217440b27dad963ef` | `/tmp/opencode/krohnkite-0.9.9.2` |
| KWin | tag `v6.7.4` = `8438567a741826da8b7536a8b10eb3af8fc8820d` | `/tmp/opencode/kwin-6.7.4` |
| cosmic-comp | `81cd5fdbaa41c3973369ae85bccf829137836e20` | `/tmp/opencode/cosmic-comp` |

Upstream references fetched 2026-08-09 from
`https://codeberg.org/anametologin/Krohnkite/` (issue tracker and git history).
A personal clone at `/home/beefsack/Development/Krohnkite` (origin = codeberg
fork) was used read-only for `git merge-base`/`git log` ancestry checks.

No relevant upstream Krohnkite test exists (the `0.9.9.2` tree and master
contain no test suite; `bin/testenv-docker.sh` is a stale docker
test environment, not a runnable unit test). KWin ships relevant integration
tests that were read from source at the pinned commit; they are not runnable
without building KWin and launching a compositor (installation + live
interaction, out of scope for this attempt). No test command was executed.

---

## Claim 1 - Krohnkite 0.9.9.2 composition X-03: interaction with Plasma 6.7.4 per-output virtual desktops

### Prior entry (plasma-krohnkite-baseline.md)

- X-03: "Per-output desktops + Krohnkite: surfaces keyed on active output's
  current desktop; interaction unestablished."
- D4.1 (J5 and dedicated matrix): per-output-mode interaction "not established
  (X-03, unit-04)."
- Unit-04 candidate U04-2: does Krohnkite mis-key surfaces / cause re-arrangement
  churn when per-output desktops are enabled?

### Evidence

1. KWin 6.7.4 scripting API semantics (source, v6.7.4):
   - `workspace.currentDesktop` -> `VirtualDesktopManager::currentDesktop()`
     with no output argument, which resolves the **active** output's desktop
     (`kwin/src/virtualdesktops.cpp:558-565`).
   - Per-output accessors `currentDesktopForScreen(output)` /
     `setCurrentDesktopForScreen(desktop, output)` exist in the scripting API
     (`kwin/src/scripting/workspace_wrapper.h:368-375`, `.cpp:88-108`).
   - `currentChanged(previous, current, output)` carries the affected output and
     is forwarded to the scripting signal `currentDesktopChanged` with the
     output argument (`workspace_wrapper.cpp:46`; `virtualdesktops.h:469`).
   - KWin integration tests at the pinned commit
     (`autotests/integration/virtual_desktop_test.cpp`, `testPerOutputDesktopSwitching`
     lines 552-578, `testTogglePerOutputDesktops` lines 580-653, registered in
     that file's header and CMake as `integrationTest(NAME testVirtualDesktop)`)
     confirm: with per-output mode on, `setCurrent(2, inactiveOutput)` changes
     only the inactive output (active stays on desktop 1) and emits exactly one
     `currentChanged` with that output.
2. Krohnkite 0.9.9.2 surface construction (source, tag 0.9.9.2):
   - `KWinDriver.screens` builds **every** output's `KWinSurface` from the
     single global `workspace.currentDesktop` (active output's desktop), and
     `currentSurface` uses the same global desktop
     (`src/driver/kwin/kwindriver.ts:41-48,76-89`).
   - Surface identity = hash(output name [+activity][+desktop id])
     (`src/driver/kwin/kwinsurface.ts:32-41`).
   - `arrange()` iterates `ctx.screens` only, so with per-output mode on and
     differing per-output desktops, the non-active output's actual surface is
     never arranged; `KWinWindow.visible()` requires `window.output ===
     surface.output` AND the surface's desktop in the window's desktops
     (`src/driver/kwin/kwinwindow.ts:223-234`), so windows on the non-active
     output's real desktop match no arranged surface and are not tiled.
3. Upstream issue-tracker (official, not anecdotal):
   - Issue #37 "Support per-screen virtual desktops (KWin 6.7)"
     (https://codeberg.org/anametologin/Krohnkite/issues/37), created
     2026-06-19, merged 2026-06-21 via PR #37 (merge commit
     `512e2dbd7d28ee472330a8e5c02f6f79e068c95d`, fix commit `60c4607`). The
     issue states the root cause: "KWin's `workspace.currentDesktop` only ever
     reflects the **active** output's desktop. The code used it everywhere -
     most importantly in `currentSurfaces`, which built every output's surface
     from that one global desktop, so `arrange()` tiled all non-active outputs
     against the wrong desktop." Documented symptoms with differing per-output
     desktops: focus navigation stole focus to another output instead of
     switching the current output's desktop; moving a window to an output on a
     different desktop left it stranded/invisible; the source output was not
     re-tiled after a window moved away.
   - Ancestry verified read-only: `60c4607` is **not** an ancestor of tag
     `0.9.9.2` (tag `1d7fd742`, 2025-07-25; fix 2026-06-19). The fix is in
     master and tag `0.9.9.3_beta` (`f374250`), not in the pinned baseline.

### Conclusion

The X-03 interaction is **established**, not unknown: with Plasma 6.7.4
per-output virtual desktops enabled (the opt-in `Switch desktops independently
for each screen` mode, P-05/P-06) and differing desktops across outputs,
Krohnkite 0.9.9.2 arranges every output's surface against the active output's
desktop. Non-active outputs' real desktops are never arranged, and the
issue-documented failure modes (focus steal, stranded windows on cross-output
moves, no source-output re-tile) follow. The fix exists upstream but is
post-0.9.9.2. The global-desktop default (per-output mode OFF) is unaffected
and remains PD.

### Classification

- D4.1 per-output-mode interaction: **changed** from "not established (UK)" to
  **MF** (evidenced material friction) for the composed Krohnkite baseline.
- D4.1 global-default mode: **unchanged** (PD).
- X-03 record: **changed** from "interaction unestablished" to "source + issue
  #37 established mis-keying in per-output mode; fixed upstream post-0.9.9.2."
- U04-2: **resolved** (no longer an open observation candidate; statically
  determinable from source + KWin integration-test semantics + issue #37).
- Krohnkite J5 journey status: unchanged (already MF).

---

## Claim 2 - Krohnkite 0.9.9.2 U04-3/D4.4: hotplug/connect/disconnect lifecycle preservation and coherent retiling

### Prior entry (plasma-krohnkite-baseline.md)

- D4.4 Krohnkite: "UK. Driver reacts to `screensChanged` only by re-arranging
  (K-05); no window-migration logic for connect/disconnect exists in Krohnkite,
  so end-to-end behavior (no lost/mis-tiled windows, coherent layout) is not
  established from source."
- Unit-04 candidate U04-3: "On output connect/disconnect/reconnect, are windows
  preserved and correctly re-tiled by Krohnkite with no loss?"

### Evidence

1. Krohnkite 0.9.9.2 hotplug handling (source, tag 0.9.9.2):
   - `screensChanged` -> `onSurfaceUpdate` -> `arrange` only
     (`src/driver/kwin/kwindriver.ts:355-358`); per-window `outputChanged` ->
     `onWindowChanged` -> `arrange` (`kwindriver.ts:555-567`).
   - No output-liveness handling anywhere in the tag. `KWinSurface` stores a raw
     `output: Output` and passes it to `workspace.clientArea(PlacementArea,
     output, desktop)` in `workingArea` (`src/driver/kwin/kwinsurface.ts:47,64-65`);
     `KWinWindow.surface` reads `this.window.output`
     (`src/driver/kwin/kwinwindow.ts:93-98`); `visible()` compares
     `this.window.output === ksrf.output` (`kwinwindow.ts:232`). The type
     declarations know only the pre-6.7 API (`currentDesktopChanged` without an
     output parameter, no `currentDesktopForScreen`;
     `src/extern/workspace.kwin.d.ts:33`).
2. KWin 6.7.4 side (source, v6.7.4) - window preservation on hotplug is KWin's
   job and is unchanged from the prior record (P-12, P-13): output change
   evacuates tile trees, migrates quick-tiled windows, and re-assigns every
   window's output via `setOutput` in `desktopResized` before
   `outputsChanged`/`screensChanged` is emitted
   (`kwin/src/workspace.cpp:1435-1490,2309-2347`; `Window::setOutput` emits
   `outputChanged`, `kwin/src/window.cpp:219-224`); PlacementTracker restores by
   output-layout hash (`workspace.cpp:1487-1488`).
3. Upstream issue-tracker (official, not anecdotal):
   - Issue #43 "FIX: don't touch destroyed Output objects on hotplug/resume"
     (https://codeberg.org/anametologin/Krohnkite/issues/43), created
     2026-07-03, merged 2026-07-04 via PR #43 (merge commit
     `f374250e850b19b4743e163c9dc75d7ebf6a38f3`, fix commit `c0ea26f`). The
     issue states: KWin destroys Output QObjects on unplug, resume from sleep,
     and output reconfiguration; stale references were kept, and "Reading a
     property of such a dangling wrapper returns undefined or throws depending
     on the Qt version, and feeding one back into KWin API calls -
     `workspace.clientArea()` via `KWinSurface.workingArea` in particular - can
     crash KWin itself. This is the crash-on-hotplug / crash-after-resume path,
     and also why tiling misbehaves afterwards: a thrown property read aborts
     the whole `arrange()` (enter() swallows it), and stale output identity
     compares in `KWinWindow.visible()` make windows invisible to the engine."
   - Ancestry verified read-only: `c0ea26f` is **not** an ancestor of tag
     `0.9.9.2`. The fix is in master and tag `0.9.9.3_beta` (`f374250`), not in
     the pinned baseline.

### Conclusion

Window **preservation** on hotplug is established on the KWin side (P-12/P-13;
windows migrate on disconnect and are restored on reconnect; Krohnkite has no
window-destruction path). Coherent **retiling** by Krohnkite 0.9.9.2 is **not
established**: no pinned upstream integration test was run and no authorized
live hotplug observation occurred, so the end-to-end runtime outcome (no
lost/mis-tiled windows, coherent retiling) remains **unavailable**. The source
and issue #43 facts are preserved as **risk evidence only**: 0.9.9.2 keeps raw
Output references with no liveness handling, and the upstream PR description
identifies that code path as a stale-Output crash/mis-tile risk fixed only
after 0.9.9.2; per the audit safety rule, a PR/issue description can identify a
risk but cannot establish a normal runtime failure.

### Classification

- D4.4 Krohnkite: **unchanged** (retained **UK**). The prior UK is preserved;
  the source/issue #43 facts are added as risk evidence only, not as proof of a
  runtime failure.
- D4.6 Krohnkite: unchanged (PD).
- U04-3: **unchanged** (remains an **open** observation candidate; the source/
  issue #43 facts are risk evidence, not a resolution).
- Krohnkite J6 journey status: **unchanged** (`UK (D1.6, D4.4)`).

---

## Claim 3 - COSMIC Epoch 1.5.0 J1/D6.1 scoring correction for source-default `autotile=false`

### Prior entry (cosmic-hyprland-comparison.md)

- J1 D6.1 COSMIC: PD ("Shipped desktop; enable tiling = Super+y (one documented
  toggle, persists, no install).").
- Section 2.1 note, X-05, and section 8 flagged the rubric 3.3 wording ("tiling
  enabled as shipped") vs source default `autotile=false` as an open
  interpretation for unit-05.

### Evidence (source, cosmic-comp `81cd5fd`)

- `CosmicCompConfig` field `autotile: bool` defaults to `false` in
  `Default` (`cosmic-comp-config/src/lib.rs:81,130`; `bool::default()` =
  false). C-03 confirmed at the pinned commit.
- `ToggleTiling` is bound to Super+y in the shipped keybindings
  (`data/keybindings.ron:85`). C-14 confirmed.
- `Action::ToggleTiling` (Global mode) flips `cosmic_conf.autotile`, applies it
  live to every workspace via `update_autotile`/`apply_tile_change`
  (`src/input/actions.rs:971-991`; `src/shell/mod.rs:1462-1493`), and persists
  it via `config.set("autotile", autotile)`. C-29 confirmed.

### Scoring correction applied (per brief)

- The source default `autotile=false` is **one enablement/configuration
  friction**: a fresh baseline install ships with tiling off and requires the
  documented one-step toggle (Super+y) to enable it.
- It is **not** tiling-workflow friction: after the rubric's explicitly
  enabled-tiling baseline (rubric 3.3), J1 D2.1 (first app tiles on launch)
  stays PD and is evaluated against the enabled baseline. Not re-scored.
- The setup cost is scored **only** in J1 coherence (D6.1 install/enable/
  configure coherence), **without double counting** the other J1 cells: D6.2
  (live apply; the toggle itself applies live) stays PD, D7.1 (no rescue step in
  normal use; one-time onboarding enable is not a rescue) stays PD, D8.5
  (temporary disablement; Super+y is the documented pause) stays PD.
- U04-11 (whether Pop!_OS 24.04 packaging ships a first-run config overriding
  the source default) is **unchanged** and remains UK: the packaging artifact is
  not present in the source tree and cannot be inspected here.

### Classification

- J1 D6.1 COSMIC: **changed** from PD to **MF**.
- J1 other cells (D2.1, D6.2, D7.1, D8.5) COSMIC: **unchanged** (PD).
- COSMIC J1 journey status (section 3.1): **changed** from PD to **MF**.
- All other COSMIC/Hyprland cells: unchanged. Hyprland is unaffected by this
  correction (its config-surface enablement was already scored PD under U6/X-06).

---

## Summary of classification changes

| Cell / record | Prior | After | Evidence |
|---|---|---|---|
| Krohnkite X-03 (composition) | interaction unestablished | per-output mis-keying established; fixed post-0.9.9.2 (issue #37) | KWin source, KWin integration test, issue #37, ancestry check |
| Krohnkite D4.1 (per-output mode) | not established (UK) | MF | same as X-03 |
| Krohnkite D4.1 (global default) | PD | PD (unchanged) | - |
| Krohnkite D4.4 hotplug | UK | UK (unchanged; source + issue #43 facts preserved as risk evidence only) | 0.9.9.2 source, KWin hotplug path, issue #43, ancestry check |
| Krohnkite U04-2 | open unit-04 candidate | resolved (statically established + upstream fix K-15) | above |
| Krohnkite U04-3 | open unit-04 candidate | unresolved (UK retained; K-16 risk evidence only) | above |
| Krohnkite J6 status | UK (D1.6, D4.4) | UK (D1.6, D4.4) (unchanged) | - |
| COSMIC J1 D6.1 | PD | MF | C-03, C-14, C-29 |
| COSMIC J1 status | PD | MF | C-03, C-14, C-29 |
| COSMIC J1 D2.1/D6.2/D7.1/D8.5 | PD | PD (unchanged; not double-counted) | - |
| COSMIC U04-11 | UK | UK (unchanged; packaging artifact) | - |

All other cells in `research/plasma-krohnkite-baseline.md` and
`research/cosmic-hyprland-comparison.md` are unchanged by this unit.

## Safety statement

- No live Plasma or COSMIC query, no live session interaction, no install, no
  system/devenv config change, no compositor or session run, no Krohnkite load
  or enable, no setting/window/output/desktop/shortcut/script/plugin/process
  change, no `sustained-workload-validation` contact.
- All work was upstream source, upstream integration-test source, official
  upstream issue-tracker evidence, and read-only `git`/file inspection of pinned
  local clones. No destructive action was taken. No upstream test was executed
  because no relevant Krohnkite test exists and the KWin integration tests are
  not runnable without installation and live-compositor interaction.
- Despite the historical filename, **no hands-on runtime observation occurred**
  in this attempt.

## Correction trail

- Claim 1 corrects the prior "interaction unestablished" X-03 entry in
  `research/plasma-krohnkite-baseline.md` to an established mis-keying using
  source + KWin integration-test semantics + issue #37, with `git merge-base`
  ancestry checks proving the fix post-dates the pinned `0.9.9.2` tag.
- Claim 2 (this correction round): the source + issue #43 facts were preserved
  as risk evidence, but the D4.4 classification was **reverted from MF to UK**
  and U04-3 from resolved to unresolved, because no pinned upstream integration
  test was run and no authorized live hotplug observation occurred; a PR/issue
  description establishes a risk, not a normal runtime failure. All summary,
  matrix, journey-status, citation-register, and risk notes were updated
  consistently to retain the UK and state that coherent end-to-end
  hotplug/retiling behavior remains unavailable.
- Claim 3 resolves the flagged COSMIC rubric-vs-source interpretation in
  `research/cosmic-hyprland-comparison.md` per the brief: the source default is
  one configuration friction scored in J1 coherence only, not tiling-workflow
  friction and not double-counted across J1 cells.
- Remaining runtime-dependent residuals are stated explicitly (Krohnkite D4.4
  hotplug end-to-end outcome; COSMIC packaging-default override U04-11) and are
  not converted into stronger claims.

## Risks for the Lead

- Claim 1's D4.1-per-output MF rests on an upstream issue body that describes
  the pre-fix failure modes and matches the pinned code; the exact observable
  behavior on a real live multi-output session remains runtime-dependent and is
  a candidate for a future authorized observation.
- Claim 2's D4.4 stays UK. The preserved risk evidence (issue #43) means the
  stale-Output crash/mis-tile path is a real hazard to weigh in unit-05, but it
  is not a proven failure of the pinned baseline; an authorized hotplug
  observation (or a runnable pinned integration test) would be required to
  classify it.
- Claim 3's J1 D6.1 MF for COSMIC reflects the brief's scoring instruction; a
  strict rubric-D6.1 reading ("documented, coherent paths") could also support
  PD, but the brief resolves the ambiguity as a friction, and this record
  follows the brief. unit-05 should not re-count the same cost elsewhere.
- If unit-05 reads D4.6 (window/layout preservation across output changes) as
  gated on reliable re-tiling, the preserved hotplug risk evidence (K-16) could
  implicate D4.6; that is a scope decision for the Lead, not an evidence change
  made here.
- No product conclusion is drawn; all changes are evidence-cell and
  classification inputs for unit-05.
