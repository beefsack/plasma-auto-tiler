# Evaluation Rubric: Integrated Tiling and Workspace Value Audit

- Unit: `unit-01/attempt-02` (reopened 2026-08-10 per plan Amendment Status;
  adds the approved structural-authoring/direct-placement workflow and the
  bounded bspwm reference to the accepted unit-01 rubric).
- Role: source/design research only. No live-session interaction, no
  installation, no configuration change, no `sustained-workload-validation`
  contact.
- Evidence date: original comparator pins retrieved or verified 2026-08-09;
  bspwm structural-reference pins retrieved or verified 2026-08-10. Each source
  URL below carries its own retrieval date.
- Scope: architecture-neutral workflow rubric, comparator version pinning, a
  pinned and bounded bspwm structural reference, baseline assumptions, gap
  classification, scoring procedure, and evidence template for units 02-04.
- Boundary: this is NOT a comparator capability assessment. No comparator
  success or failure is claimed. bspwm is a bounded interaction-model reference
  for structural authoring and direct placement only (spec "Scope and
  Non-Goals"; plan units 01 and 03); it is never a full desktop comparator, and
  no desktop-wide bspwm behavior is claimed. Evaluation dimensions are
  expressed as observable end-to-end workflow semantics, not feature
  checklists.

## 1. Purpose and Thesis

Purpose: give units 02-04 one consistent, versioned, workflow-based instrument.
Define what evidence counts, what an explicit unknown is, and how cell-level
observations map deterministically to the three approved Decision Rule outcomes.

Thesis preserved (spec `## Intent and Desired Outcome`): the audit tests whether
ONE installable and enableable Plasma product can provide a coherent
dynamic-tiling and workspace experience even if multiple KDE components are
packaged internally. This rubric selects no architecture and no implementation;
it only sets the ground rules for observing end-to-end workflows.

This revision (unit-01/attempt-02) makes the approved structural-authoring and
direct-placement workflow first-class rubric content: distinct observable
criteria (D9.1-D9.6), journeys (J9-J10), multi-output structural-state criteria
(D4.8-D4.11), operational definitions of the structural semantics in play
(section 5, "Operational semantics: structural-placement terms"), a pinned
bspwm reference (section 2.3), and target-segment frequency handling in the
Decision Rule (section 9.1). Prior rubric content is retained.

Non-goals, unchanged from spec and plan:
- No capability ranking, feature-count contest, visual comparison, or
  performance benchmark.
- No live-session configuration changes, package installation, or destructive
  hands-on testing (unit-04 sits behind its plan safety gate).
- No assumption that any comparator lacks a workflow until current evidence
  establishes it.
- No desktop-wide inference from the bspwm reference (spec "Evidence
  Standards"): structural-reference evidence never yields multi-output,
  installation, or other full-comparator results for bspwm or the Plasma
  product.
- No edits to `spec.md`, `plan.md`, `state.md`, or `log.md`.
- No resumption, replacement, or reinterpretation of sustained-workload
  validation.

## 2. Evidence Date and Comparator Version Pinning

All versions pinned from current upstream source on the evidence date. Where a
version cannot be pinned, the gap is recorded as an explicit unknown. Units
02-03 must cite the same pins or record a superseding reason. Sections 2.1-2.2
pin the full comparators; section 2.3 separately pins the bounded bspwm
structural reference.

| Comparator | Baseline identity | Pinned version / dated snapshot | Canonical upstream source | Retrieval date | Version evidence status | Explicit unknowns |
|---|---|---|---|---|---|---|
| Stock Plasma | Plasma 6 desktop (KWin compositor + shell) | 6.7.4, released 2026-08-04; 6.7 series released 2026-06-16 | https://kde.org/announcements/plasma/6/6.7.4/ ; https://kde.org/announcements/plasma/6/6.7.0/ ; https://download.kde.org/stable/plasma/ | 2026-08-09 | Confirmed (KDE announcement, download index) | Session baseline (Wayland primary; X11 out of scope for per-output semantics, section 11 U7); depth and stability of the new per-screen virtual desktops (U3) |
| Krohnkite | KWin tiling script, Plasma 6 fork line | anametologin fork 0.9.9.2, released 2025-07-25; canonical esjeon repo latest tag v0.8.1 (2022-02-14) is not Plasma 6 compatible | https://github.com/anametologin/krohnkite/releases/tag/0.9.9.2 ; https://codeberg.org/anametologin/Krohnkite ; https://github.com/esjeon/krohnkite/releases ; https://github.com/esjeon/krohnkite/issues/218 | 2026-08-09 | Confirmed for fork (GitHub tag); esjeon v0.8.1 incompatibility with Plasma 6 confirmed by issue report and the fork's existence | Install/enable path cleanliness on Plasma 6.7 (U1); exact codeberg master snapshot commit for the baseline (U2); companion set membership (U9) |
| COSMIC | COSMIC desktop (cosmic-comp compositor + COSMIC shell) | Epoch 1.5.0, released 2026-07-29/30 | https://github.com/pop-os/cosmic-epoch/releases/tag/epoch-1.5.0 ; https://archlinux.org/packages/extra/x86_64/cosmic-comp/ ; https://www.phoronix.com/news/COSMIC-Epoch-1.5-Released | 2026-08-09 | Confirmed (GitHub tag, Arch package cosmic-comp 1:1.5.0-1) | Pop!_OS 24.04 rolling packaging vs Epoch tags; workspace/desktop semantics (U5) |
| Hyprland | Hyprland dynamic-tiling Wayland compositor | v0.56.2, released 2026-08-05 | https://github.com/hyprwm/Hyprland/releases/tag/v0.56.2 | 2026-08-09 | Confirmed (GitHub release) | Baseline config definition (U6); per-output workspace semantics (assessed in unit-03) |

### 2.1 Krohnkite identity note

The canonical project is `esjeon/krohnkite`; its latest tagged release v0.8.1
(2022-02-14) predates Plasma 6 and is reported non-functional on Plasma 6
(issue #218). The actively maintained Plasma 6 line is the anametologin fork,
latest tagged release 0.9.9.2 (2025-07-25), now hosted at
`codeberg.org/anametologin/Krohnkite` (the GitHub fork is archived); the AUR
package `kwin-scripts-krohnkite-git` points at that fork as upstream. The
Krohnkite baseline therefore uses the Plasma 6 compatible fork line pinned at
0.9.9.2, with the esjeon repo retained as the project's canonical origin. This
is a version-compatibility pinning decision required for a Plasma 6 baseline;
it is not a product-architecture selection.

### 2.2 Plasma 6.7 per-screen virtual desktops

Plasma 6.7 (released 2026-06-16) ships per-screen virtual desktops
(KDE wishlist bug 107302; KWin merge request !8602; kde.org 6.7.0 announcement;
Phoronix and OMG!Ubuntu release coverage). Reported semantics from the cited
sources: each screen can switch virtual desktops independently; switching
affects the currently active screen; each virtual desktop can be shown on any
number of screens; each window belongs to one screen and any number of virtual
desktops; the historical global-switch behavior remains available; the feature
is Wayland only. This is baseline pinning fact, part of the stock Plasma 6.7.4
baseline for the audit. Depth of semantics, defaults, and interaction with
tiling scripts are verified in unit-02 from source, not assumed beyond the
cited descriptions (U3).

### 2.3 bspwm structural-reference pinning

bspwm is NOT a full desktop comparator. It is pinned as a versioned
structural-authoring/direct-placement interaction reference only (spec "Scope
and Non-Goals"; plan units 01 and 03). Its official source and man pages may
inform what a structural workflow can look like and what semantics are
observable, but they must never be used to infer desktop-wide behavior,
multi-output behavior, installation coherence, or any other full-comparator
result for bspwm or for the Plasma-product question.

| Reference | Pinned version / snapshot | Tag date | Canonical upstream source (official) | Retrieval date | Version evidence status | Scope boundary |
|---|---|---|---|---|---|---|
| bspwm (structural reference) | 0.9.12 | 2025-10-08 | Repository https://github.com/baskerville/bspwm ; tag https://github.com/baskerville/bspwm/releases/tag/0.9.12 ; bspwm(1) man page source https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspwm.1.asciidoc ; bspc(1) man page source https://github.com/baskerville/bspwm/blob/0.9.12/doc/bspc.1 (rendered man page at tag 0.9.12; the bspc command documentation is also in the Domains section of bspwm.1.asciidoc) | 2026-08-10 | Confirmed (upstream tag 0.9.12 and man page source at that tag) | Structural authoring and direct placement only: split type/ratio, preselect/manual insertion, automatic schemes, receptacles, state dump/load. No desktop-wide, multi-output, installation, or companion claims |

The structural-semantic reference terms below (section 5, "Operational
semantics: structural-placement terms") are defined so that unit-03 can test
the same versioned bspwm man-page and source documents for each of D9.1-D9.6
without extending the reference into a desktop-wide comparison (U11).

## 3. Baseline Configuration Assumptions

Principle: a baseline is the minimal reasonably configured setup a typical
target user can reach through the standard documented path, with every
deviation documented. A baseline is never underconfigured to the point of
non-function, and never cherry-picked into an elaborate rig.

### 3.1 Stock Plasma baseline (unit-02)

- Plasma 6.7.4, Wayland session (the Plasma 6 default; per-screen virtual
  desktops are Wayland only per section 2.2). The X11 session is out of primary
  scope for multi-output semantics and is recorded as an explicit unknown
  (U7) rather than a negative finding.
- Default install, default global shortcuts, default virtual desktop
  configuration as shipped. "Reasonably configured" means shortcuts used by the
  journeys are assigned as documented and the shipped default navigation and
  indication affordances are present. The exact shipped default desktop count
  and default affordances are recorded in unit-02 from source (U4).
- The baseline includes Plasma's native per-screen virtual desktop capability
  as shipped in 6.7 (section 2.2). Any additional per-output behavior beyond
  the shipped default is a candidate companion subject to section 4.

### 3.2 Krohnkite + companions baseline (unit-02)

- Plasma 6.7.4 Wayland + Krohnkite fork 0.9.9.2 (or the dated codeberg master
  snapshot pinned in unit-02, U2) installed and enabled through its documented
  path.
- Keyboard shortcuts required by the journeys are assigned through Krohnkite's
  documented configuration surface (its config dialog under System Settings >
  KWin Scripts and its documented config file). This is Krohnkite's own
  documented configuration, not a companion component.
- Additional components qualify as "commonly required companions" only when
  they pass the standard in section 4. No companion counts toward the baseline
  until its install, enable, configure, and interaction are evidenced
  end-to-end (spec Evidence Standards).
- The cap and justification rules in section 4 bound the set, avoiding both an
  underconfigured baseline and an elaborate cherry-picked setup.

### 3.3 COSMIC baseline (unit-03)

- COSMIC Epoch 1.5.0 (or the dated Pop!_OS 24.04 rolling packaging of it),
  default configuration, with its built-in tiling enabled as shipped.
  Workspace and tiling semantics are assessed by unit-03 against the same
  criteria in section 5; no capability is assumed by this rubric.

### 3.4 Hyprland baseline (unit-03)

- Hyprland v0.56.2 (2026-08-05) on a Wayland session. Hyprland generates a
  default config on first run; the baseline config is the minimal documented
  configuration that supports the rubric journeys without hacks. Its exact
  content is decided in unit-03 under the same bounded standard as section 4
  (U6), so Hyprland is neither underconfigured nor an elaborate rig.

### 3.5 bspwm structural reference is not a baseline

bspwm is pinned and cited in section 2.3 purely as a versioned
structural-authoring/direct-placement interaction reference (spec "Scope and
Non-Goals"; plan units 01 and 03). It has no baseline configuration, no
companion standard, and no journey cells in this rubric. Unit-03 records its
bounded reference evidence in `research/bspwm-structural-reference.md` using
the section 10 template with a distinct evidence prefix (e.g., B-01). The
structural journeys J9-J10 below run against the full-comparator baselines
(sections 3.1-3.4), never against bspwm.

## 4. Commonly Required Companion Standard (Krohnkite)

Purpose: a bounded, evidenceable test for what counts as part of the fair
Krohnkite baseline. A component qualifies as a commonly required companion
iff ALL of the following hold:

- (a) Necessity: at least one journey in section 6 cannot complete its defined
  end-to-end workflow with stock Plasma + Krohnkite alone (using only
  Krohnkite's documented configuration), and the component is required to close
  that semantic gap - not to add a preference or style.
- (b) Common-recommendation evidence: the component is referenced as a normal
  part of a Krohnkite setup by a canonical source - the Krohnkite README, wiki,
  or FAQ, the KDE Store listing, or a maintained distribution packaging of
  Krohnkite that pulls it in (e.g., the AUR package). A single community
  dotfiles post is not sufficient.
- (c) Coherent enablement: the component's install + enable + configure +
  interaction is a documented, repeatable sequence with no undocumented hacks
  and no manual file patching.
- (d) Bounded set: the companion set is capped (default cap: 3 components),
  each individually justified, each carrying its own evidence record; anything
  beyond the cap requires explicit Lead approval during unit-02. Components
  already inside stock Plasma (System Settings, KWin Global Shortcuts, shipped
  default widgets) are baseline Plasma, not companions, and need no cap entry.

Candidate companion hypotheses (listed only so unit-02 has a target set; they
are unassessed here and must pass (a)-(d) or be recorded as non-qualifying):

- A workspace/Pager indication widget beyond Plasma's shipped default
  affordances, if any journey requires per-output indication the defaults do
  not provide.
- Window rule / exception management beyond Krohnkite's documented ignore and
  float rules, if any journey requires it.
- Any helper required to make a documented shortcut or lifecycle action
  reachable in a way Krohnkite does not itself document.

Unit-02 applies the standard and records the outcome per component in the
evidence template (section 10). A companion that fails any test is not part of
the baseline; the corresponding journey gap, if real, is assessed against the
raw baseline and recorded, never silently absorbed by an unbounded companion
set.

## 5. Evaluation Dimensions with Observable Workflow Criteria

Each dimension is a set of observable end-to-end workflow criteria. A criterion
is satisfied when a user completes the described observable sequence using only
the baseline's documented affordances. Criteria are neutral: they describe
behavior to observe, not what any comparator does.

### D1. Dynamic workspace lifecycle

- D1.1 Creation: the user creates a new workspace from a documented affordance;
  windows opened afterward land on the intended workspace; focus behavior is
  as documented.
- D1.2 Retention: closing all windows on a workspace leaves the workspace
  existing or auto-removes it exactly as documented; the policy is predictable
  and repeatable.
- D1.3 Removal: the user removes a workspace; its windows migrate to a
  documented target; no window is lost or orphaned; remaining workspace order
  is as documented.
- D1.4 Ordering/reordering: the user reorders workspaces; shortcuts, indicators,
  and window assignments stay consistent with the new order.
- D1.5 Migration: the user moves a window to another workspace; it retains its
  tiled/floating state predictably; focus and layout respond as documented.
- D1.6 Recovery: after a session or compositor restart, workspaces and windows
  are restored to the pre-restart arrangement or the documented default, with
  no silent loss.

### D2. Tiling behavior

- D2.1 Initial placement: opening an app places its window in a layout position
  predictably, without overlap or loss.
- D2.2 Layout changes: switching the tiling layout reflows existing windows
  predictably; no window is hidden or geometry-corrupted.
- D2.3 Insertion: opening additional windows inserts them in a predictable
  position and order; closing windows causes a predictable refill.
- D2.4 Stack/tab behavior: where the baseline exposes stacking or tabbed
  behavior, opening a window over another produces the documented result;
  otherwise this criterion is out of scope for that baseline (recorded, not
  scored as absent).
- D2.5 Mixed tiling/floating: dialog, utility, and intentionally floated
  windows behave predictably among tiled windows; floating state survives focus
  changes and layout switches as documented.

### D3. Keyboard focus and window movement

- D3.1 Directional focus: a directional focus action moves focus to the window
  in that direction among tiled and floating windows; focus lands on a visible
  window.
- D3.2 Moving/swapping windows: a documented action moves or swaps the focused
  window to an adjacent layout position, another workspace, or another output;
  the target accepts it and the layout reflows.
- D3.3 Cross-workspace behavior: focus movement respects workspace boundaries
  as documented; moving to another workspace activates it and places focus
  deterministically.
- D3.4 Focus/click consistency: keyboard and pointer focus are consistent;
  focusing a window reveals its layout position.

### D4. Multi-output (first-class hypothesis)

- D4.1 Workspace model (global vs output-local): the user can determine, with
  the default affordances, whether workspaces are global (switching affects all
  outputs) or output-local (each output shows its own workspace); the model is
  explicit and predictable.
- D4.2 Directional focus and movement across outputs: directional focus and
  window-move actions can cross an output boundary; a window moved to another
  output lands on that output's active workspace predictably; focus follows
  deterministically.
- D4.3 Lifecycle across outputs: creating, removing, and retaining workspaces
  has a defined effect on every output; windows on other outputs are not
  silently moved or dropped.
- D4.4 Connect/disconnect/hotplug recovery: connecting, disconnecting, and
  reconnecting an output preserves windows and their workspace/layout
  assignments; reconnection returns the previous arrangement or a documented
  default; no window is lost.
- D4.5 Per-output indication: the user can tell at a glance which workspace each
  output is showing and where windows live; the indication updates when outputs
  change.
- D4.6 Window/layout preservation: moving a window across outputs or across
  workspace switches preserves its tiled state, geometry, and fullscreen or
  floating status as documented.
- D4.7 No hidden per-output setup: the documented default behaves sensibly on a
  second output without undisclosed per-output configuration; any required
  per-output setup is discoverable and documented, not hidden.

Structural state is a first-class part of the multi-output dimension. The
criteria below keep multi-output connected to authored structure (section 5
D9) without assuming any implementation: a baseline with no authored-structure
support records these as out of scope for that baseline rather than scoring
them absent.

- D4.8 Structural scope per output: where the baseline supports authored
  structure, the user can determine, with default affordances, whether each
  output carries its own authored structure/workspace set or shares a global
  one; the model is explicit and consistent with D4.1.
- D4.9 Structural cross-output moves: moving a window across outputs preserves
  its authored position or re-inserts predictably into the target output's
  active structure; focus and indication update deterministically.
- D4.10 Structural persistence/recovery: authored structure and its window
  assignments survive hotplug and session recovery (as in D4.4 and D1.6) as
  documented; no silent loss.
- D4.11 Structural indication: default affordances reveal which authored
  structure each output is showing and where windows sit within it; the
  indication updates on structural change.

### D5. Workspace indication and navigation

- D5.1 The user can name and see workspaces and know the current one per output.
- D5.2 Navigation (keyboard and visual) reaches any workspace without losing
  state.

### D6. Configuration and installation coherence

- D6.1 The baseline's components install, enable, and configure through
  documented, coherent paths with no undocumented file edits.
- D6.2 Configuration changes apply without a session restart where documented;
  the configuration surface for a given behavior is discoverable.

### D7. Workflow smoothness

- D7.1 No journey requires a manual rescue step (script reload, session restart,
  reset) in normal use.
- D7.2 Repeated high-frequency actions complete without observable degradation.

### D8. Escape hatches

- D8.1 Floating: the user floats an individual window via a documented action.
- D8.2 Fullscreen: the user makes a window fullscreen; it is not forced back
  into a tile while fullscreen; returning restores the prior tiled state.
- D8.3 Manual override: the user manually sizes or places a window without the
  layout immediately fighting the override.
- D8.4 Exceptions: the user excludes a class of windows (by app, title, or role)
  from tiling via a documented mechanism.
- D8.5 Temporary disablement: the user temporarily disables tiling (per-window
  or global pause) and re-enables without losing layout state.

### D9. Structural authoring and direct placement

Approved workflow (spec "Scope and Non-Goals"; plan "Technical Approach").
D9.1-D9.6 are distinct observable sequences. They are never collapsed into a
single "dynamic splitting" label: each cell is scored separately, and a
comparator that can only reflow windows automatically evidences nothing about
D9.1-D9.6 until each criterion is tested on its own.

- D9.1 Arbitrary-leaf split (both axes): the user splits any leaf region
  horizontally or vertically at any depth of the current layout through a
  documented affordance; the split produces two regions and the surrounding
  structure is preserved or predictably re-derived.
- D9.2 Keyboard-directed insertion: the user directs where the next window
  opens by selecting a target leaf and an insertion side through a documented
  keyboard or scripted action before the window opens; the window lands in the
  target region and the structure updates predictably.
- D9.3 Pointer-directed drag-to-split placement: the user places a window by
  dragging it onto another window's region (or region boundary) so the target
  splits to make room; the drop result is predictable and reversible as
  documented.
- D9.4 Structure independent of window ordering: the authored region structure
  persists as windows open and close in any order; opening or closing a window
  does not silently re-author the layout into a different arrangement; windows
  occupy authored regions rather than the structure being derived from window
  order.
- D9.5 Automatic placement preserving authored structure: windows added without
  explicit direction are placed into authored regions (or a documented default
  region) without moving or restructuring authored branches; no window is
  dropped or overlapped.
- D9.6 Empty-branch semantics: when the last window of an authored branch
  closes, the branch collapses (regions merge) or is retained (an empty region
  persists) exactly as documented; the behavior is predictable and does not
  silently shift other windows.

### Operational semantics: structural-placement terms

The rubric and units 02-03 must not conflate distinct structural mechanisms.
These operational definitions bound what each evidence cell may claim.

- Persistent saved topology: an explicitly serialized or stored description of
  a layout that exists independently of any open window and survives sessions
  (e.g., a saved layout file, a stored tile definition, or bspwm `wm
  --dump-state`/`--load-state`). Observable marker: the arrangement can be
  restored with no windows open, and closing all windows does not erase it.
- Live-window binary tree: a runtime tree whose leaves are the currently open
  windows; the tree is maintained as windows map and unmap, so leaf count
  tracks the window set (e.g., bspwm's in-memory tree, COSMIC's split tree,
  Hyprland dwindle, Krohnkite's per-layout arrangement). Observable marker:
  closing a window removes a leaf and rebalances unless an empty-leaf retention
  mechanism (D9.6) is documented.
- bspwm receptacles and preselection: empty leaves ("receptacles") that occupy
  tiling space while holding no window, plus preselection (`bspc node -p`,
  `-o`), which marks a leaf as a manual insertion point for the next window.
  Together they are the reference mechanism for authoring a tree of regions
  before windows arrive and for directing insertion (D9.2, D9.6). Reference-only:
  scoped by section 2.3.
- Generated balanced geometry: geometry computed by an automatic scheme
  (bspwm `longest_side`/`alternate`/`spiral`, Hyprland dwindle, Krohnkite
  layout engines) that keeps regions balanced without user authorship; the user
  cannot reliably author a specific region layout through the scheme.
- Manually predefined Plasma custom tiles: KWin's Custom Tiling editor
  (Meta+T) predefined arrangements - a flat set of regions a user defines once
  and applies; not a binary tree, and applied as a fixed grid rather than
  maintained as a persistent per-window structure across window lifecycle.
  Whether any of these semantics exist and how they map to D9.1-D9.6 per
  baseline is an evidence question for unit-02/unit-03, never assumed here.

## 6. Target User Journeys

Frequency labels: H = high (daily, several times), M = medium (daily once or
weekly), L = low (weekly or setup-time). J9-J10 add the modifier TS
(target-segment core): within the bounded target segment that depends on
persistent authored layouts, the journeys are high-frequency (daily). The
explicit product requirement (spec "Scope and Non-Goals") establishes this
importance for that bounded target segment; the rubric does not assert
market-majority prevalence or universal high frequency. Step 3 of the Decision
Rule treats a TS journey as high-frequency only when the evidence is scoped to
the target segment's documented normal workflow (section 9.1). Each journey
lists the criteria it exercises; the matrix in section 7 is the working table
for units 02-04.

- J1. Onboard and enable (L/H: once): from a fresh baseline install, install,
  enable, and configure tiling and the workspace model through the documented
  path; assign the shortcuts the user needs; confirm a first app tiles on
  launch. Exercises: D6, D2.1, D8.5.
- J2. Daily launch and placement (H): boot into a session, launch the usual
  apps, have them placed predictably, and move between them with keyboard
  focus. Exercises: D2.1, D2.3, D3.1, D1.6, D1.2.
- J3. Focus and relocate during a task (H): switch focus directionally,
  move or swap a window to a new layout position, and move a window to another
  workspace mid-task without a reset. Exercises: D3, D1.5, D2.2.
- J4. Multi-window session with mixed types (H): work with tiled editors and
  terminals plus floating dialogs and overlays; insert and close windows; the
  layout stays predictable; go fullscreen for a focused block and return.
  Exercises: D2.4, D2.5, D8.1, D8.2, D8.3, D8.5.
- J5. Multi-output working session (H for multi-monitor users, M otherwise):
  work across two outputs with per-output workspace control, directional focus
  and movement across outputs, and per-output indication; windows keep their
  arrangement. Exercises: D4.1, D4.2, D4.3, D4.5, D4.6, D5.
- J6. Dock, undock, and hotplug (M): connect an external output, work,
  disconnect, reconnect; windows and workspace assignments survive predictably.
  Exercises: D4.4, D4.6, D1.6.
- J7. Workspace lifecycle management (M): create, reorder, and remove
  workspaces; move windows among them; confirm the workspace model on
  multi-output setups. Exercises: D1.1-D1.5, D4.3.
- J8. Configure and tune (M): change layouts, gaps, exceptions, and shortcuts;
  changes apply coherently and are discoverable; no hidden per-output setup
  surprises when a second output is added later. Exercises: D6, D8.4, D4.7.
- J9. Author a persistent structure (TS): from a running session, author a
  layout by splitting leaves arbitrarily in both axes, direct where windows
  open with a documented keyboard or scripted action, and confirm the authored
  structure persists as windows open and close in any order. Exercises: D9.1,
  D9.2, D9.4, D9.5, D9.6.
- J10. Direct placement and empty-branch handling in a live task (TS): during
  a working session, place a window by dragging it onto another window's region
  so the target splits, rely on automatic placement into authored regions, and
  observe the documented empty-branch collapse or retention behavior when the
  last window of a branch closes. Exercises: D9.3, D9.5, D9.6.

## 7. Journey-Rubric Matrix (units 02-04)

Rows are journeys; columns are the dimensions actually exercised; cells list
the exact criteria each comparator must evidence and classify. Every cell is
recorded per comparator in the evidence template (section 10).

| Journey | D1 workspace lifecycle | D2 tiling | D3 focus/move | D4 multi-output | D5 indication | D6 install/config | D7 smoothness | D8 escape hatches | D9 structural |
|---|---|---|---|---|---|---|---|---|---|
| J1 Onboard/enable | - | D2.1 | - | - | - | D6.1, D6.2 | D7.1 | D8.5 | - |
| J2 Daily launch | D1.2, D1.6 | D2.1, D2.3 | D3.1 | - | - | - | D7.2 | - | - |
| J3 Focus/relocate | D1.5 | D2.2 | D3.1-D3.4 | - | - | - | D7.1 | - | - |
| J4 Mixed session | - | D2.4, D2.5 | - | - | - | - | D7.1 | D8.1-D8.3, D8.5 | - |
| J5 Multi-output | - | - | D3.2 (cross-output) | D4.1, D4.2, D4.3, D4.5, D4.6, D4.8, D4.9, D4.11 | D5.1, D5.2 | - | D7.2 | - | - |
| J6 Dock/undock | D1.6 | - | - | D4.4, D4.6, D4.10 | - | - | D7.1 | - | - |
| J7 Workspace mgmt | D1.1-D1.5 | - | - | D4.3, D4.8 | - | - | - | - | - |
| J8 Configure/tune | - | - | - | D4.7 | - | D6.1, D6.2 | - | D8.4 | - |
| J9 Author structure (TS) | - | - | - | - | - | - | - | - | D9.1, D9.2, D9.4, D9.5, D9.6 |
| J10 Direct placement (TS) | - | - | - | - | - | - | - | - | D9.3, D9.5, D9.6 |

Multi-output coverage required by the plan unit-01 verification clause is
complete in this matrix: workspace scope (D4.1), cross-output focus/movement
(D4.2), lifecycle effects (D4.3), hotplug recovery (D4.4), per-output
indication (D4.5), window/layout preservation (D4.6), and no hidden per-output
setup (D4.7), plus structural-state coverage: per-output structural scope
(D4.8), structural cross-output moves (D4.9), structural persistence/recovery
(D4.10), and structural indication (D4.11).

Structural-authoring cells (D9.1-D9.6) are never collapsed into a single
"dynamic splitting" label; each is scored as its own evidence cell. The bspwm
structural reference is NOT a row of this comparator matrix; unit-03 records
its bounded reference evidence in `research/bspwm-structural-reference.md`
under the section 2.3 scope boundary.

## 8. Critical-Gap Classification

Applied per evidence cell (section 10). A cell has exactly one classification.

- Critical blocker (CB): with the baseline configured as in section 3, the
  journey cannot complete its defined end-to-end workflow through documented
  affordances, the failure is repeatable, and any workaround is an undocumented
  hack or a step outside normal workflow. Evidence-backed only.
- Material friction (MF): the workflow completes, but through extra documented
  steps, hidden configuration, or observable degradation that interrupts flow
  on a repeatable basis.
- Preference difference (PD): the workflow completes equivalently; the
  difference is stylistic or personal preference with no workflow cost.
- Feature trivia (FT): the difference does not affect any journey's completion;
  isolated presence or absence without workflow consequence.
- Unknown (UK): no current source, documentation, or observation evidence; the
  cell cannot be classified. UK never substitutes for a failure claim.

Rules: CB and MF claims must cite a current evidence record (section 10). PD
and FT claims must also cite the cell that shows equivalence. UK is the default
when evidence is absent. Comparator failure is never assumed; a missing journey
outcome on a comparator is UK until evidenced (spec Evidence Standards).

## 9. Scoring and Classification Procedure

Deterministic mapping from cell classifications to the three Decision Rule
outcomes.

Step 1 - Collect evidence (units 02-03): for each comparator and each matrix
cell, record evidence with the template (section 10) and assign exactly one of
CB/MF/PD/FT/UK.

Step 2 - Journey status per comparator: the most severe evidenced classification
among the journey's cells (CB > MF > PD > FT). If every cell is UK, the journey
is UK for that comparator.

Step 3 - Baseline coverage (stock Plasma + Krohnkite/companion rows):
coverage is "coherent" iff no high-frequency journey is CB and material
frictions are limited to medium/low-frequency journeys. Coverage is "broken"
iff at least one high-frequency journey is CB. "High-frequency" includes
universal H journeys (J2-J5) and, per section 9.1, target-segment TS journeys
(J9-J10) only when the evidence is scoped to the target segment's documented
normal workflow.

Step 4 - Product-plausibility check (unit-05, kept separate per plan residual
risk): for each gap, record whether one coherent install, enable, and
configuration experience of an integrated Plasma product could plausibly close
it without replacing normal Plasma behavior. This is assessed from the gap's
semantics and the thesis that multiple KDE components may be packaged
internally; it does not select an architecture.

Step 5 - Decision mapping:

- Strong justification: Step 3 is "broken" on the baseline (>=1 high-frequency
  CB, evidence-backed; target-segment TS journeys count per section 9.1), AND
  Step 4 finds the gap plausibly closable by an integrated product.
- Narrow differentiated product: Step 3 is "coherent" but at least one
  high-value gap remains (material friction, or CB confined to medium/low
  frequency journeys), AND Step 4 finds a bounded integrated product thesis
  that plausibly closes it.
- Insufficient value: Step 3 is "coherent" and remaining differences are
  preference differences or feature trivia; OR Step 4 concludes the only way to
  close a real gap is replacing Plasma.

Step 6 - Unknowns handling: UK cells never count toward CB/MF. If the gap that
would drive a decision is UK for the baseline, the audit must either acquire
evidence through a safe unit-04 check or report the decision as not fully
evidenced. A decision is never built on assumed failure.

### 9.1 Target-segment frequency and the Decision Rule

J9-J10 (TS) are core workflows for a bounded target segment: users whose daily
work depends on persistent authored layouts, a named product requirement in
spec "Scope and Non-Goals". The rubric derives their importance from that
explicit product requirement, not from a claimed market-majority frequency.

- Universal high-frequency blocker: a CB on an H journey (J2-J5) affects the
  general baseline population; per Step 3 it makes baseline coverage "broken".
- Target-segment blocker: a CB on a TS journey (J9/J10) makes baseline coverage
  "broken" for the bounded product thesis only when the evidence shows the
  failure occurs in the target segment's documented normal (daily, not
  setup-time-only) workflow and is not rescued by an undocumented step. A TS
  journey CB that is setup-time-only, preference-level, or rescued by a
  documented configuration step maps to "narrow differentiated product", never
  to "strong justification".
- Non-blocking TS findings: a TS journey MF or PD supports the bounded product
  thesis (narrow differentiated product) without making coverage "broken".

Elevating the revised opportunity from narrow to strong requires ALL of:
(1) an evidence-backed, repeatable CB (never UK; section 8) on a high-frequency
journey - universal (J2-J5) or target-segment (J9/J10) under the scoping above;
(2) the failure occurs through the baseline's documented affordances with no
undocumented rescue in normal use (D7.1); and (3) Step 4 finds that one
coherent install-enable-configure experience of an integrated Plasma product
plausibly closes it without replacing normal Plasma behavior. Concrete
candidates unit-02/unit-03 would need to evidence to reach strong: stock Plasma
+ Krohnkite cannot preserve an authored structure across window open/close
(D9.4/D9.5 CB), cannot direct insertion to an authored leaf (D9.2 CB), or
cannot retain or cleanly collapse empty branches (D9.6 CB) in the target
segment's daily workflow, with a plausible integrated-Plasma closure. These are
hypotheses for units 02-03 to evidence; they are not claims here. Without such
evidence the prior narrow-differentiated-product expectation stands (plan
"Historical Accepted Outcomes").

COSMIC and Hyprland rows are assessed on the same matrix and version pins; they
serve as comparative reference and prevent assuming any comparator's failure.
The Decision Rules are applied to the Plasma-product question; comparator
evidence feeds plausibility and guards against unsupported claims.

## 10. Evidence-Record Template

Units 02-04 create one record per matrix cell per comparator.

- Evidence ID (unique, e.g., PK-01, CH-01, HYP-01)
- Comparator
- Journey and criteria (e.g., J5 / D4.2)
- Claim statement (the observable behavior)
- Evidence type: source-doc / source-code / official-doc / hands-on / unknown
- Canonical source URL(s)
- Version pinned at evidence time
- Retrieval/evidence date
- Result (what the source says or what was observed)
- Classification (CB / MF / PD / FT / UK)
- Unknown reason (if UK): exactly what evidence is missing
- Cross-reference (matrix row; unit-04 validation ID if any)

Rules: every completed cell has one record. UK cells have a record stating why.
Hands-on records additionally carry environment, actions, reversal, and the
plan safety-gate authorization, per plan `## Safety Gates`.

J9-J10, D9.1-D9.6, and D4.8-D4.11 cells use this same template and the section
8 classifications; units 02-03 record them per full comparator with the
established comparator prefixes. bspwm structural-reference evidence is
recorded separately in `research/bspwm-structural-reference.md` with a distinct
prefix (e.g., B-01) using this template, scoped by section 2.3.

## 11. Explicit Unknowns Registry

| ID | Unknown | Resolution |
|---|---|---|
| U1 | Krohnkite fork 0.9.9.2 install/enable path cleanliness on Plasma 6.7 (AUR reports TypeScript 6 build workarounds) | unit-02 from packaging source; a fragile documented build path is recorded as baseline configuration friction with a source citation, not assumed |
| U2 | Exact codeberg master snapshot commit for the Krohnkite baseline | pinned by unit-02; 0.9.9.2 is the tagged baseline until superseded |
| U3 | Plasma 6.7 per-screen virtual desktops: full semantics, defaults, and interaction with tiling scripts (Wayland only) | unit-02 from KWin MR !8602 and source |
| U4 | Plasma shipped default virtual-desktop count and default indication/navigation affordances | unit-02 from Plasma default configuration |
| U5 | COSMIC workspace/desktop semantics, including any per-output behavior | unit-03 from COSMIC source |
| U6 | Hyprland baseline config definition | unit-03 under section 4's bounded standard |
| U7 | X11 session multi-output semantics for Plasma (per-output desktops are Wayland only) | recorded as out of primary scope; unknown unless acquired |
| U8 | Whether a safe hands-on environment exists for unit-04 | Lead decision per plan safety gate |
| U9 | Krohnkite companion set membership (which candidate hypotheses in section 4 qualify) | unit-02 applying section 4; hypotheses are unassessed here |
| U10 | Structural-authoring capability of the stock Plasma + Krohnkite baseline: whether any documented affordance satisfies D9.1-D9.6, and whether Plasma Custom Tiling is a persistent authored structure or a manually predefined flat arrangement (section 5 operational semantics) | unit-02 from Plasma/KWin and Krohnkite source |
| U11 | End-to-end semantics of bspwm pointer-directed drag-to-split placement: bspwm itself handles no pointer input (README: a third party such as sxhkd translates events to bspc); whether the default sxhkd binding set exposes pointer preselect/split is a unit-03 reference question, scoped by section 2.3 | unit-03 from bspwm/sxhkd source within the reference boundary |
| U12 | COSMIC and Hyprland structural persistence and empty-branch collapse/retention semantics against D9.4-D9.6 | unit-03 from COSMIC/Hyprland source |

## 12. Verification Against the unit-01 Clause in plan.md

The plan.md unit-01 verification clause (the reopened unit-01 row) is: "Every
required structural workflow element has observable criteria; full-comparator
and bspwm-reference boundaries are explicit; all multi-output criteria remain
complete." The table below verifies that clause and retains the pre-amendment
multi-output clause elements (workspace scope, cross-output focus/movement,
lifecycle effects, hotplug recovery, indication, layout preservation, hidden
setup) that the accepted unit-01 rubric already mapped.

| Clause element | Reference in this document |
|---|---|
| Every required evaluation dimension has observable workflow criteria | section 5, D1-D8 (D1 lifecycle, D2 tiling, D3 focus/move, D4 multi-output, D5 indication/navigation, D6 install/config, D7 smoothness, D8 escape hatches); each criterion is an observable end-to-end sequence (e.g., D1.3, D4.4, D8.2) |
| Multi-output: workspace scope | section 5 D4.1; matrix J5 row |
| Multi-output: cross-output focus/movement | section 5 D4.2; matrix J5 row (D3.2 cross-output) |
| Multi-output: lifecycle effects | section 5 D4.3; matrix J5, J7 rows |
| Multi-output: hotplug recovery | section 5 D4.4; matrix J6 row |
| Multi-output: indication | section 5 D4.5 and D5.1; matrix J5 row |
| Multi-output: layout preservation | section 5 D4.6; matrix J5, J6 rows |
| Multi-output: hidden setup | section 5 D4.7; matrix J8 row |
| Structural workflow: every required element has observable criteria | section 5 D9.1-D9.6; section 6 J9-J10; matrix J9/J10 rows |
| Full-comparator and bspwm-reference boundaries explicit | section 1 boundary; section 2.3 pin and scope boundary; section 3.5 |
| Multi-output: structural-state coverage complete | section 5 D4.8-D4.11; matrix J5 (D4.8, D4.9, D4.11), J6 (D4.10), J7 (D4.8) rows |

### 12.1 Structural-authoring clause mapping (spec Acceptance Criteria)

Spec acceptance criterion: "The structural-authoring/direct-placement workflow
has evidence or an explicit unknown for arbitrary-leaf horizontal/vertical
splitting, keyboard-directed insertion, pointer-directed drag-to-split
placement, structure independent of window ordering, automatic preservation of
authored structure, and empty-branch collapse/retention semantics."

| Spec structural element | Observable criteria | Journey | Evidence and Decision-Rule path |
|---|---|---|---|
| Arbitrary-leaf horizontal/vertical splitting | D9.1 | J9 | Per-comparator cell in the section 10 template, classified CB/MF/PD/FT/UK per section 8; bspwm reference cell in `bspwm-structural-reference.md` (section 2.3) |
| Keyboard-directed insertion | D9.2 | J9 | same |
| Pointer-directed drag-to-split placement | D9.3 | J10 | same |
| Persistent structure independent of window ordering | D9.4 | J9 | same |
| Automatic placement preserving authored structure | D9.5 | J9, J10 | same |
| Empty-branch collapse or retention semantics | D9.6 | J9, J10 | same |
| Multi-output structural state (per-output trees/workspaces, cross-output moves, persistence/recovery, indication) | D4.8-D4.11 | J5, J6, J7 | same |

Each row must end in evidence or an explicit UK; a UK is never converted into a
failure claim. Decision-Rule consequences flow through section 9, including the
section 9.1 target-segment scoping.

Additional plan constraints honored: no comparator capability assessment
(section 1); thesis that one Plasma product may package multiple KDE components
internally preserved and architecture-neutral (sections 1, 9 Step 4); bounded,
evidenceable companion standard (section 4); comparator version pins with
canonical URLs and evidence date (section 2); pinned and scoped bspwm
structural reference (sections 2.3, 3.5); structural-authoring criteria and
multi-output structural-state criteria (sections 5 D9, D4.8-D4.11); explicit
unknowns (sections 2, 11); journey/rubric matrix (section 7); target-segment
frequency handling and the three Decision Rule outcomes (sections 6, 9, 9.1);
evidence template (section 10). No comparator success or failure is claimed.
