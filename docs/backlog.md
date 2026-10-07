# Backlog

Only meaningful pending or active work is listed.

Live runs are user-owned; agents do not run live cases
([testing](live-kwin-testing.md)). Architecture review claims must be verified
before acting ([review](research/architecture-review/review.md)); user
decisions of 2026-09-24 are under
[Architecture Direction](decisions.md#architecture-direction).

## Open work

- P0 | Windows port | KDE-first core extraction finished at K1 (user
  2026-09-30; K2/K3 deferred until Windows needs a shared contract, see
  [extraction](research/cross-platform-core/extraction.md),
  [K2 audit](changes/archive/portable-core-k2-settings-actions.md)).
  User decisions (2026-09-30): Windows 11 x64 only; managed per-monitor
  workspaces required for feature-complete; Meta/Win default shortcuts matching
  KDE (2026-10-01), Windows Snap takeover with a visible off setting, and Win+L
  explicit opt-in; custom-drawing
  underlay experiment with outline fallback; most obvious distribution
  (Store plus signed installer plus winget under evaluation); develop
  natively on the user's Windows 11 PC (also the KDE multi-output PC);
  elevated (administrator) windows unmanaged by default, a user-chosen
  run-elevated option possible later; logical workspace model refined in the
  spikes; shared settings/action intent (deferred K2) and difference
  classification (deferred K3) shaped when Windows needs them. Open: final
  package/update channel. Status 2026-10-02: Phase 1 lifecycle/recovery plus
  WH_KEYBOARD_LL input done and accepted on this single-display PC; Phase 2
  automatic Engine-driven tiling-only dogfood preview verified (no shortcuts,
  input hooks or hiding; stop/crash leaves windows in place). Shortcut slice
  completed with retained-Engine focus/move, default-on keyboard takeover and
  session-only mouse prevention plus explicit CLI off switches. Exact native
  foreground and geometry proof passed the full owned-helper journey
  `20261002-040025-21256`; graceful/crash setting restore and ordinary-app
  default-on/both-off smoke passed. Foreground lock is handled by E8 prime plus
  temporary foreground-thread attachment; the synthetic Shift misrouting was
  a proof-arrow extended-key encoding defect, corrected without changing
  product filtering. Native gates and independent mutation review pass.
  Initial SPI target mix-up was recovered; final arranging is 1 and pen is 35.
  Windows settings UI Apply/Revert, physical shortcuts and Snap
  Layouts/bar/Assist/shake coverage remain pending. Managed workspaces now pass
  current-artifact helper and scoped Notepad/Calculator/Paint journeys: existing
  ordinals, send/follow, trailing empty, independent layouts, identity-safe
  hiding and graceful/crash recovery. Terminal is an ordinary managed app by
  default. The physical send trace exposed a new-target outer-gap mismatch;
  fixed with both-domain regression coverage. Fresh independent review and
  native gates pass. Workspace latency fix 06f9d8d passes scoped helper and
  ordinary-app recovery/timing: 72-124 ms ordinary-app selects, 171-241 ms
  physical select/send trace; user accepts select/send/follow and drag-resize
  usability. [Latency evidence](changes/archive/windows-workspace-action-latency.md).
  Minimum-size hints shipped in 49d4191 and were physically accepted, including
  send into a populated workspace (2026-10-02). Late directional dogfood moves
  match KDE/core R2c/R3; minimum-pinned geometry explains zero visible change.
  [Minimum-size evidence](changes/archive/windows-minimum-size-hints.md).
  [Directional diagnosis](changes/archive/windows-directional-dogfood-diagnosis.md).
  Send split-axis defect fixed in `c4a837b` (shared core): stale destination
  focus after send-away/return now falls back to valid destination focus
  history; minimum sizes did not force the axis. One user return split
  stacked as expected, but a later run (2026-10-03) returned Notepad side
  by side at the right edge, then into the middle; see dogfood defects.
  [Evidence](changes/archive/windows-send-split-axis.md).
  Next: Windows feature parity queue below.
  [Managed workspaces](changes/archive/windows-managed-workspaces.md).
  [Shortcut slice and handover](changes/archive/windows-shortcut-slice.md).
  Full owned-helper proof passed `20261001-222611-6068`: 8/8 gaps at 125%,
  minimize/restore, close reflow, graceful/emergency stop preserving frames,
  11 owned writes and zero foreign writes; clean recovery. Normal-mode smoke
  `20261001-223101-30052` passed Notepad/Calculator/Paint/Terminal admission,
  true new-window open/close, Calculator minimize/restore and unchanged stop
  frames. Paint held 617px against a 543px plan, causing 66px overlap; minimum-
  size neighbour replanning was an initial preview limitation, resolved by the
  accepted minimum-size hints. Standard native gates
  passed; multi-monitor/mixed-DPI, gestures and games remain unaccepted.
  See [Phase 2 record](changes/archive/windows-phase2-tiling.md).
  [plan](research/windows-port/plan.md)
  [decision](decisions.md#windows-port)
  Day-one setup and pending governance: [Windows development environment](windows-dev-environment.md).
- P0 | Windows feature parity queue | User order (2026-10-02), each matching
  KDE behavior and bindings: (1) active window border done (`b5374ce`, native
  gates/CI and scoped composed-pixel/live routes pass;
  [evidence](changes/archive/windows-active-border.md); temporary development
  default `#ffff00` with theme off, `3fcc953`); (2) group underlay stages A/B
  done (`cb790d9`; [evidence](changes/archive/windows-group-underlay.md)), C
  (unfocused dragged subject) parked for reassessment with item 7;
  (3) maximise done (`1be97a1`, Win+M; [evidence](changes/archive/windows-maximise.md);
  physical button/input/feel checks remain); (4) fullscreen shipped
  (`e84b1a7`, Win+F11; [evidence](changes/archive/windows-fullscreen.md));
  (5) float shipped (`d8329e3`, Win+G; [evidence](changes/archive/windows-float.md));
  (6) sticky float shipped (`292d8c1`, Win+Shift+G;
  [evidence](changes/archive/windows-sticky-float.md)). Live acceptance of
  4-6 is user-owned: agent runs were disturbed by Xbox mode (cloaked
  `ApplicationFrameWindow` foreground, DWM cloak 0->2;
  [record](changes/archive/windows-foreground-acceptance.md)).
  (7) mouse drag move and (8) drop preview delivered same-output
  (`1b9bf7b` title-bar drag, `7dc6aa3` Win+left drag, `b68d490` preview; CI
  green; [evidence](changes/archive/windows-mouse-drag.md)); provisional:
  title-bar first, Win+drag keeps the source frame and moves only the
  preview, unfocused subject activates on drop; physical feel checks
  user-owned; underlay C stays parked (needs extra machinery).
  (9) multi-output support PARKED: needs the multi-output PC for live work;
  (10) taskbar item showing workspaces PARKED on the user design discussion
  (options in the [comparison](research/windows-port/reference-wm-comparison.md));
  (11) settings core slice delivered (`df4edc5`, `1c97c52`, `999f2f3`,
  `81986ab`; CI green; `just --justfile windows.justfile settings`;
  [evidence](changes/archive/windows-settings.md)): JSON store under
  LocalAppData, plain Win32 Apply/Revert UI, live gaps/visuals/Snap
  takeover, conflict list and presets (compatible disables 35 conflicting
  chords, authentic stays the default), system accent border default with
  KDE `#2a82da` fallback (yellow removed). All provisional. Tray
  (Settings, Stop, shortcut-conflict warning, TaskbarCreated re-add) and
  first-run Authentic/Compatible prompt delivered (`60fd7bb`, `533f3c9`;
  [evidence](changes/archive/windows-tray-first-run.md)); tray workspace
  mode toggle omitted at first, then delivered with per-workspace
  tiling/floating modes and `core.workspace.default_tiled` (`90ee5c2`,
  `0fa3d29`, `ace352c`, `618683b`;
  [record](changes/archive/windows-workspace-tiling.md)); maximized windows
  on floating workspaces now match KDE (R-MAX-03 resolved).
  Remaining: broader rebinding, physical checks incl. real Explorer
  restart.
  Original item 11 scope: settings
  (UI with Apply/Revert parity, including Snap takeover off; decide the final
  accent/configured border default and remove the temporary yellow default;
  per-binding OS-conflict list with compatible/authentic quick-set presets,
  possibly offered on first run; [decision](decisions.md#cross-platform-behavior)).
  Provisional choices 2-6 accepted by the user (2026-10-03).
- P0 | Windows gaming coexistence | User (2026-10-03): (a) authentic mode
  until settings exist: our bindings must not leak to OS shortcuts (Win+G
  opened Xbox Game Bar when the foreground was unmanaged, and Xbox mode was
  entered during agent tests; user dogfood 2026-10-03: Win+F11 entered Xbox
  mode, so Win+F11 collides with the OS full screen experience shortcut);
  (b) detect Xbox mode (full screen
  experience), pause tiling, effects and shortcuts, remember windows and
  workspaces, restore on exit; (c) research alternate Game Bar access and
  anti-cheat false-positive risk (LL keyboard hook, overlays, window
  moves). Status 2026-10-03: (a) authentic containment offline-verified,
  CI green (`962b0f3`, `5746fca`; the Win+F11 leak was our deliberate
  pass-through). Physical test after those commits FAILED: Win+F11 still
  opens the Xbox mode prompt and Win+G still opens Game Bar (traces
  `run-01dd53116aa74f37.log`, `run-01dd5311a7282421.log`). PARKED
  2026-10-03 (`2c9c11c`, `bbe5b0f`, `6c4ffad`): a provably current,
  consumed Win+F11 tap still produced the Xbox prompt, also after
  reinstalling our hook last; no official-API fix found; prior art has
  none. Needs user choice: accept the gap with KDE bindings kept;
  user-applied Windows setting (recommended first: Settings > Gaming >
  Xbox mode off, then recheck); project registry/policy writes or a
  dedicated hook thread need separate authorisation. (b) user chose
  documented-signal-only detection (2026-10-03); blocked until one exists.
  (c) researched; alternate Game Bar access deferred (see Future).
  [record](changes/windows-gaming-coexistence.md)
  [decision](decisions.md#cross-platform-behavior)
- P1 | Windows placement physical acceptance | User dogfood defects
  (2026-10-03) fixed and live-API verified (`174e70b` diagnostics,
  `2c918d3` startup/minimum placement, `4a636ae` maximise/restore,
  `832e171` record; CI green): overlapping cascades and minimum-infeasible
  fits use long-edge sequential seeding (KDE and Windows; a bisection
  chain, not guaranteed 2x2); Windows infeasible tiles move to their origin
  at minimum size instead of staying put; maximise keeps siblings stable and
  restore reconciles promptly. Send return rule verified unchanged; the
  original dogfood anchor is unknown. Provisional choices to review; user
  to dogfood startup (both platforms), Win+M and send returns. Risk:
  minimum-sized windows can overlap or extend past the work area. User
  decision B6 (2026-10-05) makes origin+minimum the policy on both
  platforms (KDE delivered offline `cf6ab31`); sequential seeding stays
  provisional (consensus: follows COSMIC).
  [record](changes/archive/windows-placement-correctness.md)
- P1 | KDE follow-ups from the Windows port | Audit 2026-10-05
  ([note](research/cross-platform-core/post-windows-audit.md)); user order
  B1/B2, B3-B5, B7, B8. B1/B2 stale maximize/sticky attempted-state
  refusals repaired offline (one attempt per activation; 843 KWin tests
  pass); B3-B5 shared-core KDE fixtures added, no defect found
  ([record](changes/archive/kde-post-windows-followups.md)). User laptop
  (2026-10-05): Meta+M, then Meta+Shift+G refused while maximized, then
  Meta+M restored, as decided. DEFECT: Meta+Shift+G on a tiled window
  floats it sticky but focus moves to another window (Meta+G keeps focus);
  contradicted the exact-toggle focus retention decision. Supplied trace plus
  real Engine replay identified the follow-up foreground flag reconcile
  actuating survivor focus (pre-existing source defect, not B2). Repaired
  offline by skipping that activation over a focused float/sticky subject;
  faithful regression red/green, 846 KWin tests and all gates pass. User
  laptop re-check (2026-10-05): normal and sticky float focus correct
  ([evidence](changes/archive/kde-post-windows-followups.md#laptop-re-check-user-owned)).
  Still pending: native-change repeats and held-key autorepeat.
  User decisions 2026-10-05: B6 infeasible minimums use origin+minimum on
  both platforms (Windows already does it); KDE delivered offline
  `cf6ab31` (920 KWin / 1107 Rust tests, CI green; client shortfalls get
  three reassertions then quiet acceptance; live steps in
  [record](changes/archive/kde-minimum-origin-placement.md)). Q3 born-maximized admission follows COSMIC:
  tile with a reserved slot and keep the maximize as an overlay, no launch
  unmaximize (KDE and Windows); KDE delivered offline `9b612be` (901 KWin
  tests, CI green; live steps in
  [record](changes/archive/kde-born-maximized-overlay.md): born-maximized
  launch beside a sibling, native restore into the slot, session-restore
  no loop). User Q3 scope decision 2026-10-07 also covers R-MAX-03:
  KDE floating-to-tiled reserved-slot overlay delivered offline (921 KWin /
  1107 Rust tests); no admission clear, later unmaximize lands in the slot,
  synchronous/repeated maximize signals settle. Native check pending in
  [record](changes/archive/kde-maximized-floating-retile-overlay.md).
  B9 overlaid intentional unfloat:
  provisionally unfloat and stay maximized (KDE dispatches already; settled
  result unverified); Windows changes from refusal after the user's COSMIC
  check of R-FLT-06. Pinned 11-WM source comparison added. B7
  movement-only underlay A/B delivered offline (Meta+Shift chord or focused
  native user move; host-matched native build and all gates pass; paired
  FFI signature change; C parked); user tested A/B on the laptop
  (2026-10-05): all good; PC remap checks later. Next: B8 after user acceptance of the existing KDE
  shortcut controls. Core extraction: no new move until macOS starts.
- P1 | Directional focus/move from floating windows | Partial delivery
  (user decision 2026-10-05, rows R-FLT-07..11): KDE COSMIC float/sticky-only
  top-left-axis focus and explicit four-direction half-snaps delivered offline;
  tile-origin still skips floats. Misses reuse existing horizontal output-edge
  behavior, without COSMIC workspace cycling. 897 KWin / 1107 Rust tests and
  all gates pass. User laptop check passed (2026-10-05): float-to-float
  Meta+arrow focus (ordinary and sticky) and Meta+Shift+arrow half-snaps.
  Windows implementation pending next PC session. Quarter/maximize/repeated-outward transfer snap states
  deferred: require per-window state and transfer integration. Next: PC parity.
  [Delivery and live steps](changes/archive/kde-floating-directional-navigation.md).
- P1 | Windows parity with the 2026-10-05 KDE session | Can run on this PC:
  (a) float-origin directional focus and Meta+Shift+arrow half-snaps
  (R-FLT-07..11; Windows today refuses float subjects); (b) Q3 born-maximized
  reserved slot plus maximize overlay, replacing the one-shot admission
  clear on Windows (and KDE, same decision); user 2026-10-07: Q3 also
  covers the R-MAX-03 floating-to-tiled case (stays maximized over a
  reserved slot). KDE R-MAX-03 and R-MAX-06 delivered offline, native checks
  pending ([scope record](changes/archive/kde-maximized-floating-retile-overlay.md));
  Windows parity (b) remains pending for the Windows agent.
  (c) B9 overlaid unfloat: Windows stops
  refusing once the user's COSMIC R-FLT-06 check settles retain vs
  unmaximize; (d) audit finding: Windows keyboard resize and non-local
  workspace modes are unimplemented despite catalog/settings text
  (`settings.rs:769-777`, `workspace.rs:95-108`).
  [decisions](decisions.md#cross-platform-behavior)
  [audit](research/cross-platform-core/post-windows-audit.md)
- P1 | Adopt reference-consensus additions | User 2026-10-07 accepted the
  Orchestrator recommendations from the consensus Table A; items 1-5 shared
  core/KDE delivered (item 1 single-output user-confirmed, items 2-5 offline),
  each through the shared Engine where possible, KDE and Windows unless
  noted ([consensus](research/reference-wm-consensus.md)):
  R-MOV-08 allow vertical move onto another output once local movement is
  exhausted; R-LAY-01 parent split-axis toggle; R-LAY-04 workspace-local
  layout selection; R-WS-08 previous-workspace toggle; R-WS-11 wrapping
  next/previous workspace switch; R-WS-12 move whole workspace to another
  output; R-WS-14 send window to next/previous workspace; R-OUT-04 send
  window to output; R-MAX-09 carry fullscreen across workspace send on
  Windows (observe KDE first); R-SPC-04 float fixed-size windows on
  admission; R-RST-01 keep intentional floats floating across owner
  restart, including Windows sticky floats staying sticky (R-FLT-05, user
  2026-10-07); R-RSZ-01 Windows keyboard resize (overlaps Windows parity (d));
  R-WS-01 separate send-and-stay command beside the existing follow send
  (user 2026-10-07; COSMIC Send/Move pair; stay unbound by default);
  R-MOV-03 setting: COSMIC wrap default, flat sibling
  swap alternative (user 2026-10-07); R-DRAG-08 Windows Win+drag activates
  the mover at press instead of on drop (user 2026-10-07).
  Detailed selections 2026-10-07 (items 1-5 and D1 in
  [decisions](decisions.md#cross-platform-behavior)); KDE items 1-5 delivered
  offline, remaining implementation pending:
  Q2 R-SPC-04 shared core/Linux planner + KDE delivered offline under
  autonomous PROVISIONAL D1-D8 (2026-10-08), pending user review and native
  checks; [record](changes/archive/fixed-size-admission.md). Windows Q2
  behavior remains unchanged; handoff item 13 supplies its exact wiring.
  KDE-side session owns shared Rust core + KDE adapter; separate Windows
  agent wires later. Correctness over non-breakage: Windows build/behavior
  may break provided the handoff below lists the specific changes needed.
  Implementation order:
  1. R-WS-08 + R-WS-11 (KDE delivered; single-output native journey
     confirmed by user 2026-10-07, multi-output/presets pending;
     [record](changes/archive/kde-workspace-history-ring.md)):
     Meta/Win+Ctrl+Tab previous-view two-state toggle;
     Meta/Win+Ctrl+arrows and +H/J/K/L relative switch (left/up previous,
     right/down next). Local/global-unique per-output history/ring, shared
     one history/ring; every successful observed workspace change records,
     including native/send-follow/hotplug, not same-workspace activation or
     output focus alone. Stable IDs, surviving empties valid; removed,
     unassigned or out-of-recording-output-scope IDs clear; no-op until next
     recorded change, no recreation/ordinal reinterpretation. Disconnected
     output history discarded; reconnect selection never consults/restores
     history (1.5). Ring wraps all existing scoped workspaces, trailing empty
     and ordinals beyond 9 included; selection creates nothing. Authentic
     clears conflicting holders; Compatible disables conflicting arrows,
     letters remain (KDE KWin desktop-switch arrows; Windows native Left/Right
     ownership general knowledge, unverified in repo).
  2. R-WS-01 + R-WS-14 (shared core + KDE delivered offline; native journey
     pending; [record](changes/archive/kde-workspace-send-follow-stay.md)):
     keep numbered follow Meta/Win+Shift+digits; relative
     follow Meta/Win+Ctrl+Shift+arrows and +H/J/K/L. Numbered/relative stay
     bindable, unbound. Relative targets ordinal step in item 1 ring, not
     MRU, resolved once before transfer; fills trailing empty, normal
     lifecycle supplies next spare. Follow/stay both absolute/relative.
     Authentic clears KDE KWin window-desktop arrow holders; Compatible
     disables our arrows, letters remain; Windows ownership unknown.
     Explicit follow/stay now also reaches KDE's membership-only
     floating-boundary path, repairing its existing-default gap: default
     follows; stay preserves the source view/native boundary focus.
  3. R-MOV-03 (shared core + KDE delivered offline; native journey pending;
     [record](changes/archive/same-axis-move-setting.md)):
     global KDE `sameAxisMove` / Windows `core.same_axis_move`,
     `cosmic-wrap` default or `flat-swap`; Windows additive version-1 field,
     missing defaults to wrap. Apply to subsequent moves without tree
     rebuilding; KDE settings UI control. Flat-swap replaces R2c only for
     adjacent direct leaf siblings; shares travel with windows. Leaf/group
     rules unchanged; discriminating TBD rows before broadening.
  4. R-LAY-01 (shared core + KDE delivered offline; native journey pending;
     [record](changes/archive/parent-orientation-toggle.md)):
     Meta+O / Win+O immediate-parent axis toggle including root,
     preserving order/shares/focus; sole root leaf no-op, no saved admission
     hint, long-edge rule unchanged. No KDE stock holder found; Windows
     orientation lock conflict: Authentic takes over, Compatible disables.
     Pending live check for user: Meta+O toggles root and nested immediate
     parent, twice restores order/shares/focus, lone window is a no-op.
  5. R-MOV-08 + R-OUT-04 (shared core/protocol + KDE delivered offline;
     two-output native journey pending;
     [record](changes/archive/four-direction-output-transfer.md)):
     local restructure/swap/escape first, then cross
     all four directions, including sole root leaf (horizontal too).
     Unique reciprocal edge-touch + positive-overlap adjacency on FULL
     output rectangles, horizontal too; no candidate no-op, ambiguous/
     unreadable refuse, no wrap. Explicit output-follow Meta/Win+Ctrl+Alt+
     arrows and +H/J/K/L; stay bindable unbound. KDE arms absent from
     `kglobalshortcutsrc`, Windows ownership unknown; COSMIC's arm collides
     with resize-shrink, niri's with item 2. Target destination current
     workspace with ordinary send admission (remembered leaf, focus history,
     root) and command follow/stay. Initially tiled-subject eligibility,
     sticky excluded; floating boundaries membership-only, tiled sides
     reflow. Ordinary float transfer stays open.
     Full rectangles select adjacency only; work-area placement and R4 edge
     landing nearest the source remain. Explicit send reuses item-2 follow/
     source-MRU stay, with pinned source/target current-view arrival fences.
  Bindings for other accepted additions remain to be chosen.
- P1 | Windows handoff: reference-consensus additions | D1, user 2026-10-07:
  Windows agent wires each adapter piece after its KDE-side delivery.
  ### How to use this handoff

  - Source-checked 2026-10-08 at HEAD
    `9bbc83b6bf37295cb2883d9d31880599e7bdf088` for items 1-5 and shared
    plumbing; re-find the named function after pulling.
  - Current-revision check 2026-10-08 at HEAD
    `db31234f450e11af78406518150438c623ea91e4` for entries 6-12 and the
    matrix/spec corrections below; original revision provenance above is
    preserved. Re-find named symbols after pulling; no pull performed.
  - KDE/shared deliveries: item 1 `7f1a9ee`, item 2 `8d476ee`, item 3
    `0dc7518`, item 4 `fa15add`, item 5 `9bbc83b`. Item 1 has user-confirmed
    SINGLE-output live acceptance (2026-10-07, unspecified edge cases/presets).
    Items 2-5 are offline-delivered; multi-output/hotplug/preset and native
    journeys remain pending. None of this proves Windows native behavior.
  - D1: KDE session owns shared core plus KDE; Windows session owns its adapter.
    Correctness wins over Windows non-breakage, with exact repairs recorded
    here. Decision 2.3 permits behavior-preserving compile-only Windows fixes
    for items 2-5; those fixes are not completed Windows implementations.
  - Git coordination: inspect `git status` and the diff; on a clean Windows
    clone use `git pull --rebase` before starting and before an authorized
    publication. A concurrent KDE agent may advance shared files/docs. On dirty
    state or rebase conflict, report to the Orchestrator; do not stash/reset/
    checkout or overwrite another agent's work. Stage only your files, propose
    one single-line message, and hand the staged change to the Orchestrator to
    commit/push unless separately authorized.
  - Progress: own one `docs/changes/<piece>.md` per implementation piece with
    scope, acceptance, exact pending work and evidence; archive on completion.
    Give the Orchestrator the handoff/backlog status to advance. Update linked
    Ours Windows matrix cells and spec Win cells with dated, revision-bound
    offline evidence; native outcomes stay TBD until user-tested. Preserve
    reference outcomes and product decisions; add decision delivery pointers.

  ### Execution order and shared Windows plumbing

  | Order | Deliverable | Dependency / boundary |
  | --- | --- | --- |
  | 1 | Item 1 local history/ring plus exact Ctrl/Tab input/settings support | Shared input foundation for items 2 and 5. Global-unique/shared runtime and multi-output remain separately pending. |
  | 2 | Item 2 explicit follow/stay, then relative sends | Reuse item 1 ring/action routing, not MRU target selection. |
  | 3 | Item 3 live same-axis setting | Independent; replace compile constant without rebuilding trees. |
  | 4 | Item 4 orientation action | Reuse input/catalog/live settings infrastructure. |
  | 5 | Parked parity-queue multi-output foundation, then handoff item 5 | Per-monitor current-view observation, membership/geometry/visibility/recovery fences first; user live checks need the other Windows PC. Offline topology/Engine tests can precede that. |
  | 6 | Keyboard resize R-RSZ-01 (parity d) | Independent; needs fresh Alt-capable trigger plus dedicated resize intent. No dependency on items 1-5 except shared modifier routing. |
  | 7 | Press-focus R-DRAG-08 | Independent of items 1-5; touches Win-drag arm only. Keep R-DRAG-07 stationary-source/moving-preview split intact. |
  | 8 | Restart R-RST-01/R-FLT-05 sticky/intentional persistence | Independent of items 1-5; durable float intent must remain distinct from recovery authority. Persistence mechanism unselected; REQ-RST-01c stays OPEN. |
  | 9 | Fullscreen send R-MAX-09 (Windows carry; NOT the parked parity-queue multi-output foundation) | Depends on handoff item 2 follow/stay wiring only; same-output workspace carry, no cross-output claim. |
  | 10 | Float/half-snap parity (a) R-FLT-07..11 | Independent of items 1-5; reuses existing focus/move catalog rows, no new chords. |
  | 11 | Born-max/floating-retile overlay parity (b) incl R-MAX-03 | Replaces one-shot admission clear; keep first-fullscreen-exit and B9 refusal intact. Independent of items 1-5. |
  | 12 | Non-local workspace modes parity (d) | Depends on handoff items 1/2 (ring + follow/stay) and the parked parity-queue multi-output foundation; last. |
  | 13 | Q2 fixed-size float admission R-SPC-04 | KDE/shared offline delivery under autonomous PROVISIONAL D1-D8; max-track observation and lifetime/origin wiring before enabling the Engine opt-in. Fixed/maximize intersection coordinates with item 11. |

  Q2 R-SPC-04 occupies handoff item 13 below. Remaining Q2-Q5 reservation:
  R-RST-01 KDE delivery, R-WS-12 and R-LAY-04
  own their KDE pieces; when each lands, its owning session appends a Windows
  handoff entry here in the same numbered format. Do not pre-write their
  adapter wiring.

  - Source notation: `src/...` / `tests/...` below are under
    `crates/tiler-windows/`; `core/...` is `crates/tiler-core/src/`;
    `protocol/...` is `crates/tiler-protocol/src/`. KDE paths start `kwin/`.
    Proposed Windows IDs below are new implementation names mirroring KDE
    suffixes, not existing rows; existing Windows digit IDs are retained.
  - Verified input limits: `src/snapkey.rs:1012` `SnapClassify::push` rejects
    fresh Ctrl/Alt chords at :1101; `push_owned` :1146/:1250 also rejects them.
    Consumed holds retain their paired verdict when modifiers change.
    `ChordRemap` :130 and `ChordDisable` :144 carry only VK+Shift.
    `src/settings.rs:389` `parse_chord` ALREADY parses Ctrl/Alt tokens, but
    `vk_for_key_name` :337 supports letters/digits/F1-F24/arrows, not Tab or
    Escape. Add Tab for item 1; Escape currently only passes through for drag
    cancellation (`src/snapkey.rs:54-56`), not a selected binding addition.
    `validate_bindings` (`src/settings.rs:1317/:1363`) and
    `apply_rebind_text` (`src/settings_ui.rs:403/:425`) reject Ctrl/Alt rebinds.
  - Items 1/2/5 share changes to `BindingFamily` (`src/settings.rs:475`),
    `binding_wants_shift` :1032, `binding_canonical_vk` :1044,
    `effective_bindings` :1071, `build_remap` :1154, `build_disabled` :1206,
    `validate_bindings` :1317. Carry exact Shift/Ctrl/Alt plus explicit ACTION
    through routing, duplicate detection, canonical hold slots and release
    pins. VK alone cannot identify focus/relative select/relative follow/output
    follow; an unbound stay row has no canonical default VK but must rebind.
  - Extend `src/snapkey.rs:427` `WorkspaceOp`, `WorkspaceIntent` :445,
    `Classified` :503, `MaskTrigger` :545, `SnapClassify` :580,
    `push` :1012/`push_owned` :1146, `QueuedWorkspaceIntent` :2055,
    `QueuedSnapEvent` :2116 and `classify_and_queue` :2217. Preserve origin
    binding (`SnapOrigin` :1976, `resolve_origin` :2003), down/repeat/up pairing,
    held Disable/rebind behavior, saturation verdict and E8 mask reservation
    (:2303). Do not just remove Ctrl/Alt guards and reuse Shift-derived actions.
    Authentic owns chords independently of foreground eligibility; native
    actions still require fresh origin, lifetime, suspension and scope guards.
  - Schema stays version 1 (`src/settings.rs:31`): binding overrides remain
    `bindings[id] = {state, chord?}` (:280-299), absent means Keep, missing
    `chord` defaults None. New stay rows have no default chords; Keep means
    unbound, not Disabled/effective interception. Repair `effective_bindings`,
    canonical-target validation and `src/settings_ui.rs:175/:231`
    `row_text`/`refresh_info`; do not parse empty sequence as a key.
  - Dynamic Settings rows use `binding_catalog` (:757), `refresh_list`
    (`src/settings_ui.rs:207`), `stage_state` :459 and `collect_draft` :345.
    Support Keep/Disable/Rebind, full-modifier duplicates and actual rebound
    conflict text. Preserve atomic Apply (`do_apply` :495) and saved-file
    Revert (`do_revert` :580). Live routing adoption uses
    `src/tiling_sys.rs:13432` `apply_live_settings` / :13547 `poll_live_settings`.
    Update hard-coded UI text in `src/settings_ui.rs:1088` preset explanation,
    :1093 "Shortcuts (48 rows)" and :1100 rebind/modifier note as rows land;
    unknown OS ownership must not be labeled conflict-free.
  - Presets use `src/settings.rs:1490` `apply_preset` (reset overrides, no
    replacement chords) and `compatible_disabled_ids` :1528 (currently 35).
    Update fixed counts/assertions as rows land. Compatible treatment is
    specified per item below, not copied from KDE foreign-holder tables.
    Windows uses owned-chord interception, not KGlobalAccel holder clearing.
  - Tray: `src/tray.rs:120` `unresolved_conflicts` warns only known-incomplete
    containment (G/F11, opt-in physical L); unknown containment adds no warning.
    `menu_items` :235 and `settings_for_choice` :345 already expose Settings,
    presets and workspace mode. Propagate catalog/presets/status tests; these
    five pieces do not select additional menu commands.

  ### Common definition of done and live-check protocol

  - [ ] Each item meets its behavior, adapter, settings/input and tests below;
    replace compile placeholders where required. Portable tests use real
    retained Engine replies, exact-lifetime and hidden-row policy, not just
    callback/catalog presence. Pure workspace/owner/tiling/settings/classifier/
    tray tests run on Linux; cfg(windows) owner/hook/UI wiring needs Windows.
  - [ ] Run native offline gates from ordinary PS7 with root mise-selected
    MSVC (`rustc -vV` host must be `x86_64-pc-windows-msvc`), per the
    [Windows runbook](windows-dev-environment.md#5-prove-linker-discovery-and-run-native-offline-development-gates):

    ```powershell
    mise exec -- rustc -vV
    mise exec -- cargo build --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi -p tiler-windows
    mise exec -- cargo test --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi -p tiler-windows
    mise exec -- cargo fmt --all -- --check
    mise exec -- cargo clippy --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi -p tiler-windows --all-targets -- -D warnings
    git diff --check
    ```

  - [ ] CI `.github/workflows/ci.yml`: `windows` :95-128, `rust` :32-47 and
    applicable `kwin` :13-30, `shell` :49-80, `native` :82-93 green after
    Orchestrator-authorized publication; `macos` :130-148 remains green.
    Linux handback: `devenv shell --impure -- cargo test --workspace`,
    `devenv shell --impure -- cargo clippy --workspace --all-targets -- -D warnings`,
    `devenv shell --impure -- cargo fmt --all -- --check`; shared changes also
    need applicable KWin/mock-shell/native checks and `just check-portable`
    through Linux agent/CI. Record unrun gates as pending.
  - [ ] Update the linked Ours Windows matrix cells, spec `REQ-*` Win/status/
    shortcut rows, decision delivery pointers and one archived change record
    per piece. Keep native pending separate from offline completion. Preserve
    existing TBD order/focus/lifecycle outcomes. New ambiguities need shortest
    discriminating matrix rows with unsupported outcomes TBD.
  - Live steps below are a USER queue, not mutation authorization. Read
    [live Windows testing](live-windows-testing.md) before planning them. User
    owns physical input and ordinary-app dogfood; agent native experiments need
    separate classes/resources/chords/duration/end condition and identified
    disposable owned windows. Follow the approved dependency list/mise route;
    installs are user-owned. This docs handoff ran no live tests.
  - EACH live journey: record OS build, revision/diff, artifact path/SHA-256,
    exact owner PID/start/session/integrity, display full/work rectangles/DPI
    and permitted windows; prove independent stop/restore first. User starts
    the authorized owner (`mise exec -- just --justfile windows.justfile dev`),
    applies the specified preset/settings, performs the steps, then runs
    `mise exec -- just --justfile windows.justfile stop`. Verify hook release,
    hidden-window reveal and owned session-setting restoration. Forced loss
    needs separate authority and the exact-owner recovery ladder. Callback/API
    success alone does not prove physical OS suppression.

  ### Item implementation checklists
  - Item 1: KDE adapter delivered offline, no shared Rust core/API changes or
    resulting Windows build repairs. Windows changes still needed:

    #### Item 1 behavior and reference seams

    - Normative: decisions 1.1-1.5; [spec](spec/functional-spec.md#workspaces)
      REQ-WS-08/11; [matrix](spec/reference-outcomes/workspaces.md)
      R-WS-08/11/15/16/17. Two-view toggle, not MRU traversal. Record successful
      observed numbered/relative/toggle/native/foreground/send-follow/hotplug
      view changes; never attempted setters, same-workspace activation or
      output focus alone. Local/global-unique history/rings are per-output;
      shared has one history/ring. Stable previous ID survives emptiness but
      clears on removal/unassignment/leaving recording-output scope. No-op
      until next recorded change; never recreate/reinterpret by ordinal.
    - Ring includes ALL existing scoped order, trailing empty and >9; wrap
      both ends, select creates nothing. Disconnect drops previous AND observed
      baseline. Reconnect selection never consults/restores history; prime a
      fresh baseline and record subsequent observed displacement/return changes.
      Observe before/after hotplug actuation so A->B->D records B, not A.
    - Core currently supplies only existing workspace lifecycle primitives:
      `core/workspace.rs:7` `select_existing`, :16 `resolve_send_target`, :21
      `WorkspaceFacts`, :29 `TrailingPlan`, :35 `plan_trailing`, :88
      `choose_displaced_destination`. Numbered resolvers stop at 9; do NOT
      implement the ring through those resolvers. No history/ring CoreCommand,
      protocol command or reply was added by `7f1a9ee`; this is adapter state.
    - KDE reference: `kwin/src/workspace-native.ts:990` `selectPrevious`,
      :1051 `selectRelative`, :2141 `recordHistoryObservations`, :2185
      `observeSharedHistory`, :2203 `scopedRingIds`, :2224
      `validatePreviousEntries`; `handleTopologySignal` :921 observes hotplug.
      Catalog :152-222; native compiled holder identities at
      `kwin/native-effect/shortcutreconciler.h:55-62`.
      [Offline fixtures](../kwin/tests/workspace-previous-relative.test.ts),
      [delivery/live status](changes/archive/kde-workspace-history-ring.md).

    #### Item 1 catalog, conflicts and acceptance

    | Proposed Windows id | Default chord | Intent | Compatible |
    | --- | --- | --- | --- |
    | `workspace-previous` | Win+Ctrl+Tab | Two-view toggle | Keep |
    | `workspace-prev-h`, `workspace-prev-k` | Win+Ctrl+H, Win+Ctrl+K respectively | Previous ordinal | Keep |
    | `workspace-prev-left-arrow` | Win+Ctrl+Left | Previous ordinal | Disable |
    | `workspace-prev-up-arrow` | Win+Ctrl+Up | Previous ordinal | Keep |
    | `workspace-next-j`, `workspace-next-l` | Win+Ctrl+J, Win+Ctrl+L respectively | Next ordinal | Keep |
    | `workspace-next-down-arrow` | Win+Ctrl+Down | Next ordinal | Keep |
    | `workspace-next-right-arrow` | Win+Ctrl+Right | Next ordinal | Disable |

    - Authentic keeps all nine rows. Win+Ctrl+Left/Right native virtual-desktop
      ownership is UNVERIFIED in repository (decision 1.1), not measured here.
      Extend `src/settings.rs:954` `chord_conflict` past its Ctrl/Alt early
      return: identify those chords with text such as "Windows virtual desktop
      switch (ownership unverified in repository); override needs takeover,
      containment unproven live". Tab/letters/Up/Down get an honest ownership-
      unknown note, not a stock-holder or conflict-free claim. Compatible
      disables these two new rows for that recorded conflict; KDE disables
      all four arrows for different KWin holders. Test presets independently.
    - Exact native integration: `src/tiling_sys.rs:9819` `workspace_do_select`
      activates only after verified hide/reveal (:10061), then obtains fresh
      target focus/geometry. Add observation recording at that completed view
      transition, including when later focus/geometry fails; view evidence,
      not the final action success label, controls history. Dispatch through
      `workspace_tick` :11395 and its selection arm :11530; also cover
      `poll_workspace_cli_request` :11130, `poll_foreground_workspace` :11912
      and `sync_monitor_outputs` :12050. `chord_output` :8508 /
      `src/workspace_owner.rs:25` `output_context` resolve command scope.
    - State/resolvers/invalidation are the `ManagedWorkspaces` changes below;
      input/catalog/UI use the shared plumbing checklist above. No new
      persisted history/settings field or standalone history UI control;
      expose the nine action rows through the existing binding editor.
      Exact state sites: `src/workspace.rs:95` `ManagedWorkspaces`, :244
      `activate`, :255 `select`, :262 `select_trailing`, :297 `resolve_send`,
      :303 `resolve_send_trailing`, :508 `apply_cleanup`, :561
      `displace_output_to`, :603 `reconnect_output`, :673 `workspace_ids`.
      Add pure stable-ID toggle/ring resolvers without activating/appending;
      observe actual completed transitions separately from these setters.
    - [ ] Portable: add observed-change vs failed-attempt tests, repeated
      toggle WS1->WS2->WS3->WS2->WS3, same-view/output-focus isolation,
      surviving empty vs deleted/moved ID, disconnect/reconnect baseline,
      local/global-unique/shared scope fixtures, >9/trailing wrap and unchanged
      inventory. Extend `tests/snapkey.rs` / `tests/settings.rs` for exact
      Ctrl/Tab routing, extra modifiers, held live rebind/disable, queue/mask,
      duplicate modifiers and Compatible vs Authentic rows.
    - [ ] Windows-only: owner selection/foreground/CLI producers, native
      hook release/suppression and settings Keep/Disable/Rebind Apply/Revert.
      Local-only delivery must explicitly keep non-local/multi-output pending.
    - User journey: occupy WS1/2/3; select 1->2->3; Win+Ctrl+Tab twice must
      show 2 then 3. Select first, previous must reach last existing trailing
      empty; next wraps to first without creation. Populate through ordinal
      10 using normal trailing sends, then verify relative selection >9.
      Re-select same view, toggle unchanged; after verified send-follow toggle
      returns to source. Repeat Left/Right with Compatible (project disabled,
      record native desktop effect) and Authentic (project view switch, record
      whether native desktop ALSO switches), plus disable/takeover-off release.
      Multi-output user: R-WS-15 isolation and R-WS-17 disconnect/toggle/reconnect
      sequence; moved previous D clears on L if no intervening change.

    - `workspace.rs` / `ManagedWorkspaces`: stable-ID previous plus observed
      current baseline per output for local/global-unique, one shared scope
      when non-local modes land. Resolve previous and ordinal relative targets
      without activating, appending or invoking trailing creation; use every
      existing scoped ID, trailing empty and >9 positions, wrap both ends.
    - `tiling_sys.rs` / `workspace_do_select`: dispatch toggle/relative targets
      through existing verified hide/reveal/focus selection. Record actual
      successful view changes from numbered/relative/toggle, native/foreground
      activation, verified send-follow and hotplug, not attempted setters,
      same-view activation or output focus. `ManagedWorkspaces::activate`,
      cleanup, displacement and return must converge on that observation rule.
    - Invalidate removed/unassigned/out-of-scope previous IDs (including global
      swap and returning workspace); never reinterpret an ordinal or recreate.
      Discard BOTH previous and observed baseline on disconnected outputs;
      keep displacement associations separate. Prime a reconnect baseline,
      record any subsequently observed return change, never consult history
      for reconnect selection. Observe before/after hotplug actuation so two
      changes in one handler leave the actual immediately preceding view.
    - `settings.rs`, `snapkey.rs` and settings UI: add one Win+Ctrl+Tab toggle
      and eight separate Win+Ctrl+H/K/Left/Up previous, J/L/Down/Right next
      rows. Add Tab VK recognition and exact Ctrl modifier routing without
      conflating focus/move/digit arms; extend intents, queues, hold/repeat,
      suppression, remap and duplicate validation to include Ctrl (current
      rebind/suppression keys carry VK+Shift only; Ctrl arms are rejected).
      Authentic owns the new chords; Compatible disables Left/Right for the
      native-desktop conflict, keeps letters/Tab/Up/Down enabled with no
      invented holder claims. Physical native suppression needs Windows evidence.
    - Port KDE offline acceptance cases (toggle, producer/scope isolation,
      empty survival/removal, relocation/disconnect/reconnect, >9/trailing wrap,
      no creation, exact modifiers and presets); non-local modes/multi-output
      runtime remain the separately parked Windows work.
  - Item 2: shared Rust core + KDE delivered offline. Windows compile-only
    fix applied (decision 2.3), preserving current always-follow behavior;
    exact handoff (all paths below under `crates/tiler-windows/`):

    #### Item 2 behavior and shared contract

    - Normative: decisions 2.1/2.2/2.3 and R-WS-01 follow/stay selection;
      [spec](spec/functional-spec.md#workspaces) REQ-WS-01/01b/06/14;
      [matrix](spec/reference-outcomes/workspaces.md) R-WS-01/14/18/19/20.
      Numbered follow stays default; separate numbered/relative stay unbound.
      Relative target is item 1 scoped ordinal step, never previous-history,
      resolved ONCE before transfer, wrapping through trailing empty and >9.
      Filling trailing empty invokes ordinary lifecycle for the next spare.
    - Tiled follow focuses mover at target after verified transfer. Tiled stay
      retains source selection/visibility and source focused-removal MRU;
      null focus issues no setter, native removal focus stands. Admission,
      source collapse and destination geometry are identical for both intents:
      valid remembered destination leaf, then valid destination focus history,
      then genuine root fallback, long-edge split. Floating boundaries remain
      membership-only, floating frames untouched, tiled sides reflow; stay
      retains existing native boundary focus, no invented float MRU tracking.
      Sticky/intentional-float eligibility remains as shipped.
    - Exact core: `core/boundary.rs:93-100`
      `CoreCommand::SendToWorkspace {window,target_output,target_workspace,follow}`;
      :170-185 `CoreEvent` carries source `domain/domain_key/windows/outer_gap`
      and `target_domain/target_windows`. :328-337 `SendWorkspacePlan` fields
      `base_revision, policy_version, geometry, focus_domain, focus_leaf,
      follow, operation, preconditions`; :666 `CoreReply::SendWorkspace`.
      `core/session.rs:125` `SessionCommand::MoveToWorkspace` and
      `core/contract.rs:394` `LifecycleIntent::MoveToWorkspace` carry explicit
      follow. `core/session/ops/workspace.rs:103` `propose_send_impl` owns
      admission (:198) and source-MRU/null stay (:269).
    - `core/engine.rs:1865` `transfer_request` converges the complete canonical
      pair and immediately commits planned topology (:2140), not native
      success. Windows calls Engine directly; no second Session transaction or
      JSON roundtrip is needed. `protocol/planner_protocol.rs:3740-3750`
      `SyncCommand::SendToWorkspace` wire op `send-to-workspace` defaults
      omitted `follow` to true; native Windows must pass the actual intent.
    - KDE reference: `kwin/src/workspace-native.ts:1162`
      `resolveRelativeMoveTarget`; `kwin/src/plan-adapter-entry.ts:4964`
      `requestWorkspaceMove`, :5104 `requestWorkspaceRelativeMove`, :5156
      `transferResolvedWorkspace` (floating boundary); `kwin/src/workspace-send-adapter.ts:1309`
      `requestSend`, :2635 `followOnce`, :2915 `confirmStayOnce` (fresh arrival,
      pinned source visibility and exact MRU/null focus, no desktop switch).
      [Fixtures](../kwin/tests/workspace-send-follow-stay.test.ts),
      [record](changes/archive/kde-workspace-send-follow-stay.md).

    #### Item 2 binding and acceptance checklist

    | Windows id | Default chord | Intent |
    | --- | --- | --- |
    | Existing `workspace-send-1`..`workspace-send-9`, `workspace-send-0` | Win+Shift+1..9/0 | Numbered follow; 0 reuse/append trailing |
    | Proposed `send-prev-h/k/left-arrow/up-arrow` (four ids) | Win+Ctrl+Shift+H/K/Left/Up respectively | Relative previous follow |
    | Proposed `send-next-j/l/down-arrow/right-arrow` (four ids) | Win+Ctrl+Shift+J/L/Down/Right respectively | Relative next follow |
    | Proposed `stay-workspace-1`..`stay-workspace-9`, `stay-workspace-0` | Unbound (ten rows) | Numbered stay; 0 reuse/append trailing |
    | Proposed `send-stay-prev-h/k/left-arrow/up-arrow`, `send-stay-next-j/l/down-arrow/right-arrow` | Unbound (eight separate rows) | Relative stay |

    - KDE catalog `kwin/src/workspace-native.ts:225-392` includes shifted-symbol
      aliases for numbered stay; Windows digits share the same VK with symbols
      (`src/settings.rs:830-834`), so no duplicate physical symbol rows.
      Use explicit follow/stay ACTION in shared input/remap/queue work, not
      focus inference or Shift alone. Existing CLI send remains follow unless
      its transport is explicitly extended for needed tests.
    - Authentic keeps follow rows and unbound stay. Windows Ctrl+Shift arrow
      ownership is UNKNOWN (2.1); no new Windows Compatible disables are
      selected from KDE's four Window One Desktop holders. Keep new defaults
      pending evidenced conflicts, display "Windows shortcut ownership unknown;
      containment unproven live" by extending `chord_conflict` :954 past its
      Ctrl/Alt early return (:956-957), including effective rebound chords.
      KDE Compatible disables four arrows; do not claim those Windows holders.
    - Replace `follow:true` in builder/test below with real command wiring.
      No new global follow setting/schema field; per-binding action encodes
      intent. Keep schema-v1 missing binding overrides at Keep/unbound as above.
    - [ ] Portable `src/workspace_owner.rs` / `tests/tiling.rs`: explicit true/
      false events, stamped targets preserve intent, actual Engine admission
      byte/topology equality, stay MRU vs null, hidden target no-write, relative
      wrap/trailing/>9/frozen target. Port real core/KDE fixture semantics.
      `tests/snapkey.rs` / `tests/settings.rs`: all bound and unbound actions,
      modifier arms, rebind-away defaults, full-key duplicates, live holds.
    - [ ] Windows-only: Engine/native-boundary tails, source-selected fences
      before writes AND focus, target hidden/reveal policy, recycled lifetime,
      changed view/mode/gaps, partial transfer reconciliation without replay.
      Run common CI/doc gates; item 1 history records follow but not stay.
    - User: WS1 A,B (focus A then B), WS2 C; Win+Shift+2 follows B, source
      collapses to A. Fresh fixture, bind a stay row through Settings to a
      validated unused chord (example Win+Ctrl+Shift+F6, after checking it is
      unused in the effective catalog); send B, WS1 remains shown/focused A,
      WS2 stays hidden. Select WS2 to inspect unchanged admission. Repeat relative next
      from WS10 into trailing E and previous from WS1 to pre-transfer last E;
      E fills and one next spare appears. Sole-B stay keeps source selected,
      no explicit focus setter; record native focus/lifecycle as TBD evidence.
      Tray-toggle WS2 floating, repeat both intents both directions: floating
      frames stable and only tiled sides reflow. Apply/Revert/unbind restores
      defaults; physical Ctrl+Shift arrows must not leak under Authentic.

    - Compile fix applied: `src/workspace_owner.rs:127-132` constructor sets
      `follow: true` at :131; the exhaustive command match in
      `send_event_binds_target_and_focused_mover` at :1286-1290 requires
      `follow: true` at :1290. Both preserve always-follow Windows behavior.
      Real wiring remains: `build_send_event` :70 must accept explicit
      `follow: bool` instead of the constant. `stamp_send_target` :138/:139
      already uses `..`; preserve intent while replacing target IDs.
    - Thread that parameter through every `build_send_event` caller:
      `src/tiling_sys.rs:10848` (`workspace_do_send`) and test calls in
      `src/workspace_owner.rs:1270,1726,1915,2070,2282,2588` and
      `tests/tiling.rs:2217`. Existing follow tests pass true; add false cases.
    - `src/tiling_sys.rs` / `workspace_do_send` :10552, reply match :10876
      and verified transfer/tail :10945 onward: retain the `SendWorkspace`
      payload, branch on `plan.follow`. Follow selects/reveals target and
      focuses mover; stay hides the transferred mover without selecting or
      revealing target, keeps source selected/visible, applies source-bound
      `plan.focus_domain/focus_leaf` through exact-lifetime leaf/window
      resolution (no setter for null), and reflows only writable source rows.
      Destination admission/structural geometry remain identical; target
      writes obey existing hidden-row fences. Do not infer intent from focus.
    - `src/tiling_sys.rs` / `workspace_do_send_native` :10314 and call :10692:
      thread the same explicit intent through floating boundaries. Membership
      transfer remains native-only, tiled sides reconcile, floating frames
      stay untouched; follow uses verified target selection/mover focus;
      stay keeps source view and existing native boundary focus, no target
      selection. Sticky/intentional-float eligibility remains unchanged.
    - Changed core types searched across the entire Windows crate:
      `SessionCommand::MoveToWorkspace` and `LifecycleIntent::MoveToWorkspace`
      have no Windows sites; no direct `SendWorkspacePlan` constructors or
      destructures. Its added `follow` field reaches `CoreReply::SendWorkspace`.
      Besides production :10876 above, existing payload reads in
      `src/workspace_owner.rs:1210,1513,1602,1946,2099,2163,2215,2311,3016,3225`
      only consume geometry/operation and need no shape repair; extend relevant
      send tests to assert intent/focus. Wildcard reply arms
      :1093,1167,1188,2003,2611,2993,3135,3206,3288 likewise need no shape repair.
    - `src/workspace.rs` / `ManagedWorkspaces`: reuse item 1's scoped existing
      ordinal ring for relative targets, resolve once before mutation, wrap
      both ends including trailing empty and >9; ordinary lifecycle supplies
      next spare. Keep source-empty selection distinct from target admission.
    - `src/snapkey.rs` / `WorkspaceOp` :427, classifier/dispatch/queues and
      `src/settings.rs` catalog/rebind/presets: split explicit follow/stay,
      add Ctrl+Shift H/K/Left/Up previous and J/L/Down/Right next follow;
      numbered 1..9/0 and relative stay register unbound. Carry exact modifiers
      through suppression/repeat/remap (item 1 Ctrl work reused). Windows
      arrow ownership is unknown: do not invent a holder claim.
    - Despite cfg(windows) native actuation, portable `workspace_owner.rs`
      participates in Linux workspace builds. The compile-only fix restores
      full-workspace `cargo test`/`clippy` gates; stay/relative adapter wiring
      remains pending. Port follow/stay MRU/null, admission equality, visibility
      fences, relative wrap/spare and floating-boundary regression coverage.
  - Item 3: shared Rust core/protocol + KDE delivered offline. Windows
      compile-only defaults preserve current behavior (decision 2.3); actual
      wiring remains pending. Sites below under `crates/tiler-windows/`:

     #### Item 3 behavior, references and acceptance

     - Normative: decisions 3.1/3.2; [spec](spec/functional-spec.md#move)
       REQ-MOV-03; [matrix](spec/reference-outcomes/move.md) R-MOV-03/09/10.
       Global `core.same_axis_move`, `cosmic-wrap` default, `flat-swap`
       alternative. Only R2c adjacent direct LEAF siblings in the same N-ary
       group change; unequal shares travel with window identities. Binary R2a,
       group-neighbor wraps/insertion, escape and output boundaries keep their
       rules. Default `H[A,B*,C,D]` right -> `H[A,H[B,C],D]`; flat ->
       `H[A,C,B*,D]`. No rebuilding, retroactive flattening or new swap verb.
     - Core: `core/directional.rs:218` `SameAxisMove::{CosmicWrap,FlatSwap}`,
       :229 `as_wire_str`, :239 `parse_wire`; :202 `MoveIntent.same_axis_move`.
       `core/boundary.rs:48-57` `CoreCommand::Move {window,direction,
       cross_output_transfer,same_axis_move}`; :372 `MovePlanReply`, :670
       `CoreReply::MoveDirectional` unchanged. `core/engine.rs:2531`
       `directional_move_request` threads the typed mode. Windows should use
       these semantics, not reimplement swapping in native geometry.
       `protocol/planner_protocol.rs:3686-3697` `SyncCommand::Move` decodes
       `same_axis_move` string (missing wrap), :3800-3812 maps the validated
       token. Unknown/mistyped values refuse; core has no serde dependency.
     - KDE: `kwin/src/same-axis-move.ts:15/:33` normalize/read;
       `kwin/src/plan-adapter-entry.ts:7414-7427` reloads subsequent-move value;
       `kwin/src/plan-adapter.ts:3100` `requestMove` sends explicit flat token
       at :3178 (default omitted). KCM `kwin/native-effect/unifiedsettings_module.cpp:57`
       `readSameAxisMove`, :115-120 combo; Save/reconfigure live pickup detailed
       in [record](changes/archive/same-axis-move-setting.md).
       [KDE fixtures](../kwin/tests/same-axis-move.test.ts) and
       [core fixtures](../crates/tiler-core/tests/session_movement.rs).
     - Windows schema/control: add `CoreSettings.same_axis_move` at
       `src/settings.rs:99` with serde missing-default and Default :124;
       validate exact tokens in `validate_settings` :1268 (map via shared
       `parse_wire`, reject unknown, no silent invalid->default). Keep v=1,
       startup invalid-file and live last-good behavior. UI adds a global
       "Same-axis move" two-choice control in `src/settings_ui.rs:939`
       `cmd_settings` / control
       construction :1054, `refresh_all` :292 and `collect_draft` :345; Apply
       writes tokens and Revert reloads saved selection. Read last-good per
       move in `keyboard_tick` (`src/tiling_sys.rs:5645`, command :6102-6110),
       with wrap fallback for proof owners lacking `settings_live` (:1210).
       Same-axis-only settings adoption must not trigger tree rebuild/resync.
     - Bindings/presets/conflicts/tray: no new action/chord or conflict entry;
       existing Win+Shift+H/J/K/L/arrows use the setting. Authentic/Compatible
       change bindings only (`src/settings.rs:1490` `apply_preset`), not this core setting.
       Existing tray Settings opens its control, no menu addition.
     - [ ] Portable: schema-v1 old file missing field -> wrap; both token
       roundtrips, invalid value/type refused, atomic save and live invalid file
       keeps last-good. Retained Engine tests for right AND left unequal-share
       leaf swaps, wrap default, group neighbor R-MOV-10 unchanged, binary/
       nested-boundary parity, focus retention, mode change no topology mutation
       until next move. Replace test constant only where exercising settings;
       retain explicit default-wrap fixtures as appropriate.
     - [ ] Windows-only: Settings Apply/Revert and startup/proof fallback;
       verify `keyboard_tick` uses adopted setting, not hard-coded mode; common
       gates/docs update only R-MOV-03/09/10, not item-5 rows.
     - User: prepare R-MOV-03 four-leaf row; default right wraps B/C. Fresh
       row, Settings Flat swap + Apply, right yields A,C,B,D focused B. Repeat
       left and unequal widths, verify widths travel. Change setting on an
       existing nested tree: Apply alone changes no layout; next move uses
       new mode. R-MOV-10 group-neighbor result stays wrap, not whole-group
       swap. Stage another choice then Revert, verify saved choice returns.

     - Applied compile fixes: `src/tiling_sys.rs:6102`, `SnapOp::Move` arm
       constructing `CoreCommand::Move`, sets
       `same_axis_move: tiler_core::directional::SameAxisMove::CosmicWrap`;
       `tests/snapkey.rs:915-919`, `engine_focus_moves_through_nested_topology`,
       uses the same constant (production field :6109, test field :919).
       No Windows behavior change.
     - `src/settings.rs:99` / `CoreSettings`, `Default` :124 and
       `validate_settings` :1268: add `core.same_axis_move` within schema
       version 1, serde missing default `cosmic-wrap`, exact values
       `cosmic-wrap`/`flat-swap`; reject unknown values through existing
       invalid-file/last-good behavior, retain atomic saves.
     - `src/settings_ui.rs` / `cmd_settings` :939, controls :1054,
       `refresh_all` :292 and `collect_draft` :345: add the global
       setting control, display/persist the selected token, validate Apply,
       preserve existing Revert behavior.
     - `src/tiling_sys.rs` / `TileLoop.settings_live` :1210,
       `apply_live_settings` :13432, `poll_live_settings` :13547 and
       `src/settings.rs` / `LiveSettings` :1689, `poll_for_change` :1722:
       adopt valid changes for subsequent moves only, without tree rebuild
       or reconciliation. In `SnapOp::Move` :6102 replace the constant with
       the last-good setting mapped to shared `SameAxisMove`. Other
       input/focus/resize/float move paths retain existing rules.
     - Changed shared constructors searched: the above production and test
       `CoreCommand::Move` sites are the only Windows sites; no Windows
       `MoveIntent`/`SyncCommand::Move` constructors or exhaustive move-field
       destructures require repair. The reply shape is unchanged: existing
       `CoreReply::MoveDirectional` branch at `src/tiling_sys.rs:6173` continues
       applying returned geometry for R2c as well as R2a.
     - Extend portable settings decode/default/validation/round-trip and
       live last-good tests; native settings Apply/Revert tests; move tests
       for N-ary flat-swap both directions with traveling unequal shares,
       default wrap, group-neighbor/boundary parity and live changes without
       tree rebuild. Linux workspace tests/clippy compile portable Windows
       modules; native Windows UI/owner checks remain Windows-owned.
  - Item 4: shared Rust core/protocol + KDE delivered offline; zero Windows
      compile fixes required, existing Windows behavior preserved. Exact
      wiring handoff (paths under `crates/tiler-windows/`):

     #### Item 4 behavior, references and acceptance

     - Normative: decisions 4.1/4.2; [spec](spec/functional-spec.md#layout)
       REQ-LAY-01; [matrix](spec/reference-outcomes/layout-commands.md)
       R-LAY-01/05/06. Win+O toggles focused tiled leaf's immediate parent,
       root included, retaining order/shares/focus. Twice returns exact tree.
       Lone root, float/no tiled focus and floating workspace are no-write
       outcomes; focused maximized/fullscreen refuses. Sibling overlays remain
       reserved slots, reproject but skip native geometry/state writes. No
       future-admission orientation hint; long-edge and collapse unchanged.
     - Core: `core/boundary.rs:90-92`
       `CoreCommand::ToggleOrientation {window}`; :200
       `TiledKind::ToggleOrientation`; :250-259 `TiledPlan` carries revision,
       policy version, kind, geometry, focus domain/leaf and optional float
       fields (empty for orientation). :665 `CoreReply::Tiled`.
       `core/session.rs:161` `SessionCommand::ToggleOrientation`,
       `core/contract.rs:418/:460` lifecycle intent/operation;
       `core/session/ops/toggle_orientation.rs:39` `propose_toggle_orientation`
       and :212 `flip_group_axis` preserve direct parent's children/shares;
       :102-121 focused overlay refusal / lone `unchanged`.
       `core/engine.rs:2464` `toggle_orientation_request` ordinary retained
       single-domain handling. `protocol/planner_protocol.rs:3738-3739` wire
       `{"op":"toggle-orientation","window":"<id>"}`, :3857 typed mapping.
     - KDE: `kwin/src/plan-adapter.ts:3269` `requestToggleOrientation` gates
       subject/workspace, :3314 exact command; :1655
       `isToggleOrientationDetail`, :7014 orientation reply validation.
       `kwin/src/plan-adapter-entry.ts:449-456` catalog; native key constant
       `kwin/native-effect/shortcutreconciler.h:126`.
       [Fixtures](../kwin/tests/plan-toggle-orientation.test.ts),
       [record](changes/archive/parent-orientation-toggle.md).
     - Binding id `toggle-orientation`, default Win+O, unshifted. Add
       `ToggleKind::Orientation` at `src/settings.rs:523` with token/Shift
       methods (:530-548), catalog :757 and live effective/remap handling.
       Authentic keeps; Compatible adds this one disabled id (:1528) for
       orientation lock. Existing `chord_conflict` :983 text is
       "orientation lock owns Win+O; override needs takeover". The catalog
       claim is repository-VERIFIED with Microsoft-list attribution (:943-952);
       OS ownership was not independently rechecked by this handoff, and
       physical suppression is UNVERIFIED. No current Windows Win+O action.
     - No persisted core field; schema-v1 absent binding override means Keep.
       Dynamic settings editor exposes Keep/Disable/Rebind; add O (0x4F) to
       classifier inventory, exact Win+O action/queue/mask handling below.
       Default Shift/Ctrl/Alt variants pass through; preserve key pairing and
       existing activation fences. Resolve any unselected autorepeat outcome
       with a discriminating matrix row/TBD, not a new policy in this handoff.
       Dedicated `src/tiling_sys.rs:5645` `keyboard_tick` arm, not a SnapOp movement request;
       assembly uses `src/tiling.rs:1226` `build_reconcile_event_for_floating`,
       replace command, accept only matching Tiled kind, apply geometry with
       fresh fences. Current helpers do not magically dispatch the new action.
     - [ ] Portable Engine/owner: root both axes, nested parent-only, unequal
       shares double roundtrip, focus/minimum allocation, lone no-op then wide
       long-edge admission, float/no-focus/floating-workspace/overlay fixtures;
       focused overlay refusal and sibling write-skip must be distinguished.
       `tests/settings.rs` / `tests/snapkey.rs`: O catalog/preset/conflict,
       rebind/disable, exact modifiers, repeat/release, mask and saturation.
     - [ ] Windows-only owner/input/UI: stale origin/lifetime or suspension
       causes zero writes; real matching Tiled reply actuates without view
       switch, sibling overlays untouched. Common gates/docs: R-LAY-01/05/06.
     - User: ordinary root pair A,B (B focused), Win+O -> V then -> H with
       identities/shares/focus retained. R-LAY-05 nested H[A,V[B*,C]] toggles
       only V. Sole A on wide area: no effect; opening B still uses long edge
       (record native newcomer order/focus, currently TBD). Float/workspace-
       floating/focused overlay: no effect; sibling overlay native state stays.
       Compatible passes Win+O to OS, Authentic toggles only project layout;
       record OS orientation-lock effect/suppression with unchanged displays,
       and test Disable/rebind/Apply/Revert/takeover-off release.

     - `src/settings.rs:523` / `ToggleKind` and token/Shift methods :530-548:
       add orientation; `binding_catalog` :757-827 adds `toggle-orientation`
       default Win+O. Reuse `chord_conflict` :983 orientation-lock text;
       `compatible_disabled_ids` :1528 adds the new id/count, Authentic
       `apply_preset` :1490 keeps it. Dynamic settings UI consumes the catalog;
       test Keep/Disable/rebind and effective conflict text, without claiming
       physical OS suppression before Windows evidence.
     - `src/snapkey.rs:43-58` key inventory: add O (0x4F); `Classified` :503,
       `MaskTrigger` :545, `SnapClassify::push` :1012 / `push_owned` :1146,
       `QueuedSnapEvent` :2116 and `classify_and_queue` :2217: extend the
       toggle family with exact unshifted Win+O, paired downs/repeats/ups,
       origin identity, live suppression/remap, saturation and E8 mask.
       Shift/Ctrl/Alt variants pass through; Compatible disables our binding,
       Authentic takes over the orientation-lock chord. Extend portable
       `tests/snapkey.rs` and `tests/settings.rs` coverage.
     - `src/tiling_sys.rs:6095-6205` directional retained Engine/apply route
       and :6224 toggle queue arm are integration examples, not new SnapOp
       movement semantics: add a dedicated queued orientation arm with fresh
       origin/suspension/lifetime/tiled-workspace/focused-overlay guards.
       Build an ordinary single-domain event with
       `CoreCommand::ToggleOrientation { window }`; accept
       `CoreReply::Tiled` only with `TiledKind::ToggleOrientation`, then use
       `apply_geometry` :4866 with existing writable/hidden/overlay/minimum
       fences and readback. Focus stays on the same window; no view switch.
       `unchanged` / `not-tiled` / no tiled focus are no-write outcomes;
       sibling overlays keep their native state and skip native writes.
     - Port root H/V, nested parent-only, double-toggle unequal-share/order/
       focus, minimum allocation, lone-leaf no-op plus long-edge admission,
       floating-workspace/focus and overlay fixtures. Linux workspace tests
       compile/test portable Windows modules; Windows native
       owner/input/UI and physical Win+O takeover remain Windows-owned.
  - Item 5: shared Rust core/protocol + KDE delivered offline; zero Windows
      compile fixes required, current Windows behavior preserved. Depends on
      parked Windows multi-output work. Exact sites under `crates/tiler-windows/`:

     #### Item 5 behavior and shared contract

     - Normative: decisions 5.1-5.4; [spec](spec/functional-spec.md#move)
       REQ-MOV-08/08b and [output](spec/functional-spec.md#output)
       REQ-OUT-01/04; [move matrix](spec/reference-outcomes/move.md)
       R-MOV-08/11/12/13 and [output matrix](spec/reference-outcomes/multi-output.md)
       R-OUT-01/04/07. Local restructure/swap/escape wins first; exhausted
       movement crosses all four ways, sole root leaf included. Explicit send
       crosses before exhaustion. No wrapping outputs or cycling workspaces.
     - Resolve neighbor on FULL rectangles: exact touching edge and positive
       perpendicular overlap, UNIQUE in forward and reverse direction. Panels
       cannot break adjacency; work areas still govern placement. No candidate
       no-op; ambiguous/unreadable refuses, no arbitrary nearest/focused output.
       Directional R4 landing is target edge nearest source; explicit send uses
       ordinary remembered-leaf/destination-MRU/root long-edge admission into
       destination CURRENT workspace, not R4 edge insertion. Directional focus
       keeps existing horizontal policy; vertical focus is not selected here.
     - Follow/stay as item 2: follow focuses mover on target output (target
       workspace already shown, no needless desktop switch); stay retains
       source current view/MRU or null no-setter focus. Tiled subject initially,
       sticky/intentional floats excluded; floating-workspace boundaries are
       membership-only with only tiled-side reflow. Ordinary float transfer
       remains OPEN, not implicitly implemented by output send.
     - Core types: `core/boundary.rs:48-57` `CoreCommand::Move` capability flag
       and typed same-axis mode; :170-185 `CoreEvent.directional` source-first
       pair plus `directional_target_outer_gap`, both-domain `windows`.
       `core/directional.rs:147-152` `Output.adjacent` accepts Direction four ways;
       :334 `MoveOperation::CrossOutput`. Actual Engine reply is
       `CoreReply::MoveDirectional(MovePlanReply)` (`core/boundary.rs:670`), where
       `MovePlanReply.cross: Option<MoveCrossView>` (:372-400) carries source/
       target output/workspace, mover window/leaf/direction, target occupancy,
       source root-child index and preconditions. Windows handles `plan.cross`,
       not a nonexistent `MoveOperation` field in the reply.
     - Explicit send `core/boundary.rs:105-112`
       `CoreCommand::SendToOutput {window,target_output,target_workspace,follow}`
       uses `target_domain/target_windows`, returns :669
       `CoreReply::SendOutput(SendWorkspacePlan)` with item-2 fields.
       `core/session.rs:140` `SessionCommand::MoveToOutput`,
       `core/contract.rs:411` `LifecycleIntent::MoveToOutput`;
       `core/engine.rs:1865` `transfer_request` canonical ordinary send and
       :2531 `directional_move_request` R4 planned commit. Geometry/native
       arrival remain Windows adapter work. Same workspace ID on different
       outputs is valid; workspace send stays same-output distinct-workspace.
     - Protocol `protocol/planner_protocol.rs:3758-3766` `SyncCommand::SendToOutput`
       wire `send-to-output` (missing follow true), :1948
       `serialize_send_output_reply` emits distinct kind, move-tiled operation
       + follow and desired focus/geometry. Directional adjacency parsing
       :930-1049 and fingerprint :73-166 include up/down; adapter owns geometric
       uniqueness. Windows direct Engine path needs complete validated pair
       construction, not an invocation of private codec types.
     - KDE mirrors: `kwin/src/plan-adapter-entry.ts:562` `readFullOutputRect`,
       :601 `readOutputTopology`, :677 `selectAdjacentOutput`, :2557
       `observeOutputSendTarget`, :5304 `requestOutputSend` (floating boundary),
       :5571 `focusOutputMover`; `kwin/src/workspace-send-adapter.ts:1434`
       `requestSendToOutput`, :2820 `followOutputOnce`, :2915 `confirmStayOnce`.
       Retain frozen source identity when active mover changes outputs; actual
       source visibility is a separate fence. Both views/modes/gaps/window
       sets and exact lifetime must still match before EACH membership,
       geometry and focus write; partial arrival cannot masquerade as success.
       [Engine fixtures](../kwin/tests/output-send-engine-fixture.test.ts),
       [adapter fixtures](../kwin/tests/output-send.test.ts),
       [record](changes/archive/four-direction-output-transfer.md).

     #### Item 5 bindings, exact native additions and acceptance

     | Proposed Windows id | Default chord | Intent / presets |
     | --- | --- | --- |
     | `send-output-left`, `send-output-down`, `send-output-up`, `send-output-right` | Win+Ctrl+Alt+H/J/K/L respectively | Follow, both presets keep |
     | `send-output-left-arrow`, `send-output-down-arrow`, `send-output-up-arrow`, `send-output-right-arrow` | Win+Ctrl+Alt+Left/Down/Up/Right respectively | Follow, both presets keep |
     | `send-output-left-stay`, `send-output-down-stay`, `send-output-up-stay`, `send-output-right-stay` | Unbound (four canonical rows) | Stay, both presets keep unbound |

     - KDE catalog `kwin/src/plan-adapter-entry.ts:169-201` and native constants
       `kwin/native-effect/shortcutreconciler.h:174-181` establish 8 follow + 4
       stay rows. Ownership UNKNOWN on Windows (5.3), use truthful unknown/
       containment-unproven `chord_conflict` text, extending the Ctrl/Alt early
       return in `src/settings.rs:956-957`. No new Compatible disables;
       do not borrow resize-shrink (COSMIC) or item-2 arm (niri).
       No new global field; schema-v1 binding defaults and full Ctrl+Alt action
       rebinding/queue/suppression reuse items 1/2. Native OS suppression pending.
     - Exact additions: topology from `src/tiling_sys.rs:264` `all_monitors`
       / :282 `monitor_fulls` preserving device/full/work association;
       domain bounds through `workspace_domain_for` :8540. `keyboard_tick`
       :5645 constructs directional event at :6082-6110, handle `plan.cross`
       at :6173 before geometry (:4866 `apply_geometry`), verify membership
       and native target-output arrival before one `actuate_focus` (:5402).
       Explicit output builder beside `src/workspace_owner.rs:70`
       `build_send_event` must construct DISTINCT `SendToOutput`, not merely
       retarget workspace send. Extend `planned_writes` :396 / native
       `desired_entries` (`src/tiling_sys.rs:4211`) for `SendOutput`; add output
       reply/actuation route beside `workspace_do_send` (:10552), not its same-output tail.
     - Output target is already visible: stay must not hide the arriving mover
       simply because item-2 workspace stay hides an INACTIVE destination.
       Preserve source visibility, keep target current view, reflow writable
       visible tiled rows on both outputs; only focus distinguishes follow.
       Membership-only floating boundaries use the same distinction. Native
       placement/transfer capability is part of parked item 9; do not enable
       `cross_output_transfer` before it exists. Failure converges both domains
       without setter replay, guessed rollback or success claims.
     - [ ] Portable: full-rect compass tests, no candidate, forward/reverse
       ambiguity, panel gap both axes, local-first under both item-3 modes,
       sole-root empty/occupied targets, directional nearest-source landing
       vs explicit remembered/MRU/root admission, same workspace on different
       outputs, follow/stay/null, floating-boundary only-tiled reflow and
       excluded floats/sticky. Use real Engine reply geometry, `plan.cross`
       and `SendOutput` extraction; catalog/modifier/preset/rebind tests.
     - [ ] Windows-only: physical full/work area + mixed-DPI placement, fresh
       output/current-view/mode/gap/lifetime fences during writes, half-applied
       transfer, delayed arrival, no repeated follow; independent owned-window
       stop/restore across outputs. Common gates/docs R-MOV-08/11..13 and
       R-OUT-01/04/07; item 9 and physical acceptance remain explicit blockers.
     - User on two-output PC: stack outputs, lower V[A*,B], upper X; exhausted
       Win+Shift+Up moves A nearest source below X, source B; fresh sole A also
       crosses. Mirror Left/Right/Down, empty and occupied destinations. With
       local move available it wins; explicit Win+Ctrl+Alt+direction instead
       transfers before exhaustion to CURRENT target workspace. Prepare
       R-OUT-07 remembered Y: admission splits Y long edge; follow focuses A,
       bind `send-output-right-stay` to an unused validated Win+Ctrl+Alt+F6,
       then stay leaves source B focused with target A visible. Panel gap
       R-MOV-13 still crosses, placement respects work area. User-readable
       ambiguous/no-candidate topology must refuse/no-op with no writes.
       Floating-boundary frames stable/tiled-side reflow; source/target drift
       and lifetime failure cases belong in fixtures, not uncontrolled dogfood.

     - `src/tiling_sys.rs:6082-6110` retained directional event construction:
       supply complete source plus adjacent output's current workspace in
       `CoreEvent.directional`, including target outer gap, and opt into
       `cross_output_transfer` only with native transfer/fence support.
       Derive unique reciprocal edge-touch + positive-overlap neighbors in
       all four directions from FULL monitor rectangles, not work areas;
       no candidate no-op, ambiguous/unreadable refuse, no wrap. Keep domain
       bounds as work areas. Local move rules and sole-leaf eligibility are
       now core-owned. Focus remains the existing horizontal policy.
     - `src/tiling_sys.rs:6173-6205` currently applies only geometry for
       `CoreReply::MoveDirectional`: handle `plan.cross` (`MoveCrossView`,
       constructed from `MoveOperation::CrossOutput` by the core) and
       native output/membership transfer before both-domain geometry, with
       exact lifetime, frozen domain/gap/mode/current-view fences, fresh
       arrival and one follow. Preserve nearest-source directional landing;
       failed/partial transfer converges without replay or success claims.
     - `src/workspace_owner.rs:70-147` / `build_send_event`,
       `stamp_send_target`: add a DISTINCT output-send builder producing
       `CoreCommand::SendToOutput { window, target_output, target_workspace,
       follow }`; resolve destination CURRENT workspace once. Workspace-send
       remains same-output. Reuse ordinary admission/canonical pair machinery;
       same desktop ID on different outputs is valid (no last-desktop gate).
     - `src/workspace_owner.rs:396-417` / `planned_writes` currently falls
       through for new `CoreReply::SendOutput`; extract its geometry.
       `src/tiling_sys.rs:10848-10884` send builder/reply dispatch and
       `workspace_do_send` are same-output patterns, not output-send wiring:
       add the new reply route and apply command follow/stay (reuse item 2),
       source MRU/null focus, visibility and live-arrival fences.
     - `src/tiling_sys.rs:10314` / `workspace_do_send_native` and
       `src/workspace_owner.rs:162-171` / `SendRoute`: extend output sends
       through floating-workspace boundaries with membership-only transfer
       and tiled-side reflow; sticky/intentional float movers stay excluded.
       Ordinary float output transfer remains OPEN.
     - `src/snapkey.rs:427` / `WorkspaceOp`, classifier/queues/suppression,
       `src/settings.rs:757-827` / `binding_catalog` and preset/rebind validation:
       distinct output-follow Win+Ctrl+Alt+arrows/HJKL and four unbound
       directional stay rows; exact Ctrl+Alt modifier routing, hold/repeat/
       release and origin lifetime. Reuse item-1/2 modifier work; Windows
       shortcut ownership is unknown, do not invent stock-holder claims.
     - Portable Linux workspace tests/clippy pass with no Windows edits.
       Port core/KDE compass, local-first, sole-leaf, full-rect panel-gap,
       reverse ambiguity, ordinary remembered/MRU/root admission, shared
       desktop, follow/stay, floating-boundary and stale/lifetime fixtures;
       native Windows acceptance remains Windows-owned.

  - Item 6: keyboard resize R-RSZ-01 (parity d). Table A R-RSZ-01 accepted
    2026-10-07 (Windows keyboard trigger via shared Engine pixel path; P1
    adoption entry in this file, [consensus](research/reference-wm-consensus.md);
    KDE match stays B). Catalog text already documents the rows; the trigger
    is the gap.

    #### Item 6 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#resize) REQ-RSZ-01 pixel
      `cosmic_v1` path plus REQ-RSZ-01b Windows trigger; [matrix](spec/reference-outcomes/resize.md)
      R-RSZ-01 (Ours KDE: 12px press 0, then 14/16/18/20 on repeat, adjacent
      shares only, inwards reverses, minima clamp; Ours Windows:
      no-counterpart). Four outward and four inward rows, each with letter
      and arrow defaults (16 physical chords): Win+Alt grows outwards,
      Win+Alt+Shift shrinks inwards.
      Step schedule `(10 + 2 + 2 * press_index).min(20)` (`core/cosmic_v1.rs:228-240`;
      first press 12px). Dedicated resize intent; never `SnapOp::Move`.
    - Core/engine/protocol (verified 2026-10-08 at `db31234`):
      `core/boundary.rs:69-74` `CoreCommand::Resize {window, direction, mode,
      press_index}`; `core/engine.rs:892` dispatch plus :3044-3108
      `resize_request` (retained converge, `ResizeCapabilities
      {keyboard_resize: true, pointer_resize: false}`, `ResizePlanReply::
      from_keyboard`); `core/contract.rs:830-883` capability gates;
      `core/session/ops/resize.rs:49` `propose_resize`, gate :134, keyboard
      derivation :1383-1504; `protocol/planner_protocol.rs:208-211`
      `parse_mode`, :2683 `SyncCommand::Resize` parse, :2734 core mapping,
      :3712-3719 wire shape, :3824-3834 typed mapping, :1797-1858 reply
      serializer, :2112 reply dispatch, :2314 retained eval.
    - KDE reference: `kwin/src/plan-adapter.ts:3197` `requestResize` (fences:
      disabled, invalid direction/mode, busy, observe, activeExcluded,
      workspace-floating, fullscreen, maximized; repeat state
      `repeatFocused/repeatDirection/repeatMode/repeatNext` :2110-2113 and
      :3241-3257; dispatch body `{op: "resize", window, direction, mode,
      press_index}` :3253-3257); `kwin/src/plan-adapter-entry.ts:4102`
      catalog entry, delegates :7536/:7844; `kwin/tests/plan-adapter.test.ts:417`
      resize-param test plus :898 busy-refused.
    - Current Windows gap: `src/settings.rs:693` `RESIZE_ROWS` (8 ids, Alt
      outwards defaults, Alt+Shift inwards defaults), `binding_catalog`
      :769-777 marks them `implemented:false` ("not intercepted on Windows:
      Alt chords pass through untracked"). `src/snapkey.rs:104` `SnapOp`
      has only Focus/Move; `snap_repeat_live` :301 pins Win-only repeats;
      `key_op` maps :870/:1176/:1208/:1254. `src/tiling_sys.rs:5645`
      `keyboard_tick` builds Focus (:6096-6100) and Move (:6102-6110) only.

    #### Item 6 adapter checklist

    - `src/snapkey.rs`: add a Resize op beside `SnapOp` :104 (`as_str`
      :109-114); extend `snap_repeat_live` :301 with an Alt-pinned arm
      (Win+Alt held, Shift selecting inwards vs outwards per
      `binding_wants_shift` `src/settings.rs:1038`); extend `key_op` maps
      :870/:1176/:1208/:1254 and `push` :1012 / `push_owned` :1146
      Ctrl/Alt acceptance scoped to these documented resize chords only;
      carry exact Alt (+Shift) plus ACTION through intents, queues
      (`QueuedSnapEvent` :2116, `classify_and_queue` :2217), hold/repeat/
      release pins and E8 mask (:2303). Unrelated Ctrl/Alt-rebind refusal
      (`validate_bindings` :1317, `apply_rebind_text`
      `src/settings_ui.rs:403/:425`) stays.
    - `src/settings.rs`: flip each `RESIZE_ROWS` row to `implemented:true`
      as it lands; extend `chord_conflict` :954 past the Alt early return
      with truthful ownership text (Windows Alt-chord ownership is
      unrecorded: "ownership unverified in repository; containment unproven
      live", never conflict-free). Presets: `compatible_disabled_ids`
      :1528 lists implemented conflicting rows only; NO Compatible-disable
      or Authentic-takeover is recorded for Alt resize chords, so preset
      treatment is TBD, not a silent keep. KDE clears stock kwin Switch
      Window arrows through KCM Apply/Force/Revert ([shortcuts decision](decisions.md#shortcuts)
      2026-09-28); the Windows analogue is unselected.
    - `src/tiling_sys.rs` `keyboard_tick` :5645: add a dedicated Resize arm
      (not a `SnapOp::Move` request) constructing an ordinary single-domain
      event with `CoreCommand::Resize {window: focused mover, direction,
      mode, press_index}`; `press_index` from per-focus/direction/mode
      repeat tracking mirroring KDE :3241-3257; pre-dispatch fences mirror
      KDE :3197-3239 (suspension/lifetime, floating subject, floating
      workspace, fullscreen/maximized overlay). On `CoreReply::Resize`,
      extract via existing `planned_writes` (`src/workspace_owner.rs:412`)
      and apply through `apply_geometry` :4866 with the Move-arm fences
      (:6172-6205); pointer-resize precedent :13040-13060.
    - [ ] Portable: `tests/snapkey.rs` exact Alt/Shift routing, extra
      modifiers, held live rebind/disable, queue/mask, duplicate modifiers;
      `tests/settings.rs` catalog flags, conflict text, preset TBD behavior;
      `tests/tiling.rs` retained-Engine resize geometry: 12px first press,
      14/16/18/20 repeats, adjacent-shares-only, inward reversal, one-sided
      minima clamp, no Move semantic. Port `crates/tiler-core/tests/session_resize.rs`
      semantics (`horizontal_both_directions` :358, `vertical_both_directions`
      :389, `edge_refusals_are_unchanged` :516, `normalization_and_clamp_to_exhaustion`
      :565, `focus_retained_and_plan_carries_semantics` :648).
    - [ ] Windows-only: owner hook release/suppression plus settings
      Keep/Disable/Rebind Apply/Revert for the 8 rows; native chord
      suppression needs Windows evidence.
    - User journey: use horizontal and vertical tiled pairs, focusing the
      member with a shared boundary in each requested direction. Win+Alt+
      H/L/J/K plus arrows grow outward once each (12px before clamps);
      outer edges without a resize boundary remain no-ops. Win+Alt+Shift variants
      shrink inward (reversal); repeat-hold one direction to the 20px cap;
      drive one pair into its minimum (clamp one-sided, no axis search);
      Apply/Revert plus takeover-off release; unrelated Ctrl/Alt chords
      still pass through.
    - DoD: all 8 rows resize through the shared pixel path with
      press_index steps; no Move semantic; catalog/conflict/preset-tests
      updated with preset TBD recorded; matrix `R-RSZ-01` Ours Windows cell
      updated with dated offline evidence, native pending.

  - Item 7: press-focus R-DRAG-08. User decision 2026-10-07 (R-DRAG-08;
    [decisions](decisions.md#cross-platform-behavior)): a Meta/Win client
    drag focuses the dragged window at press on both platforms. Windows
    changes from activate-on-drop; KDE timing needs a live check ([pending
    live checks](#pending-live-checks)).

    #### Item 7 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#drag) REQ-DRAG-08 plus
      REQ-DRAG-03 producer note; [matrix](spec/reference-outcomes/mouse.md)
      R-DRAG-08 (Ours Windows today: foreground retained during hold, B
      activated on valid drop; Ours KDE: exact focus timing TBD).
      R-DRAG-07 stationary-source/moving-preview split and parked underlay
      C stay unchanged.
    - Current Windows exact (verified 2026-10-08 at `db31234`): Win+Left
      arm `windrag_down` (`src/tiling_sys.rs:12427`) validates tiled-only
      published origins, live identity/tag/token (`no-token`,
      `stale-snapshot`), captures gesture start (`capture_gesture_start`
      :12342), sets `gesture_producer` "windrag", `windrag_start_cursor`,
      `windrag_bound`, `move_kind` Move and `active`. Focus is bound later
      at drop-settle in `gesture_tick` :12900-12935 via `actuate_focus`
      (:5402, E8-prime plus attach plus one setter with exact readback),
      logged `windrag-focus`; failed actuation refuses with snap-back, no
      plan. Model: `src/win_mouse.rs:38` `WinDragSnapshot`, :51
      `WinDragEdge`, :71 `validate_windrag_down`, :90 `WinDragKind`, :104
      `WinDragQueue`, :329 `settle_pointer_journey`. Title-bar drag runs
      the native modal loop (OS focuses at press; no project code); Esc
      cancel is `clear_windrag_gesture` :12531 (no plan, no geometry change).
    - KDE: Ours KDE cell timing is TBD by live check, not by adapter work;
      oracle grab/drag route diagnostics live at
      `kwin/src/plan-adapter-entry.ts:5888-6073` (`grabSource`) and
      :6864-6894. Port evidence: `kwin/tests/drag-press-evidence.test.ts`.
    - Core/drop seam: `core/boundary.rs:113-125` `DragDrop` carries the
      mover and hover prior, not native press-focus authority. Windows
      `src/tiling_sys.rs:13018-13028` constructs that command only at drop;
      :13051-13074 applies the retained reply. Press activation adds no
      Engine mutation or layout write to that unchanged drop contract.

    #### Item 7 adapter checklist

    - `src/tiling_sys.rs`: bind mover focus in `windrag_down` :12427 right
      after the `active` insert (all START fences already passed:
      unmanaged, unknown-subject, busy, identity-changed, stale-snapshot,
      no-token, no-pre), using the same `actuate_focus` :5402 authority as
      the drop path. On press-actuation failure, refuse the arm with
      snap-back and no plan (mirror :12912-12928). At drop-settle
      :12900-12935, avoid redundant activation only after fresh foreground
      readback; preserve settle-time refusal if the required focus cannot
      be verified. Keep every other gate (START identity/lifetime, member match,
      sticky/float refusal, domain routing, same-output fence) and the
      Engine plan path unchanged. `windrag_up` :12508 and
      `clear_windrag_gesture` :12531 unchanged; title-bar path untouched.
      No new chord; no settings/catalog/preset row is touched.
    - [ ] Portable: `src/win_mouse.rs` model tests (`validate_windrag_down`
      edges, queue cap/discipline, `settle_pointer_journey` ordering) plus
      new press-ordering cases: unfocused-B press binds focus before any
      move; no-move press yields focus with zero layout writes; Esc cancel
      keeps focus with zero writes; drop at edge transfers with the mover
      focused; failed press actuation snaps back with no plan. Port
      `kwin/tests/drag-press-evidence.test.ts` ordering assertions.
    - [ ] Windows-only: owner-side arm/drop/cancel with exact foreground
      readback; native foreground evidence on press.
    - User journey: unfocused-B Win+Left press with no move (B focused,
      layout unchanged); Esc cancel (B stays focused, no write); press,
      move, drop at A's edge (transfer, B focused); underlay C remains
      parked.
    - DoD: press-focus on Win client drag with no drop-path regression;
      R-DRAG-07 split preserved; matrix `R-DRAG-08` Ours Windows cell
      updated with dated offline evidence, KDE timing still live-TBD.

  - Item 8: restart R-RST-01 plus R-FLT-05 sticky persistence. User
    decisions 2026-10-07 (R-FLT-05, R-RST-01 float identity;
    [decisions](decisions.md#cross-platform-behavior)): sticky floats stay
    sticky across owner restart including Windows, delivered with the
    R-RST-01 work. KDE delivery rides the Q2-Q5 reservation above.

    #### Item 8 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#startup) REQ-RST-01/01b plus
      REQ-FLT-05; [matrix](spec/reference-outcomes/restart-persistence.md)
      R-RST-01 (Ours KDE: intentional F loses ordinary-float status because
      its id set resets; Ours Windows: runtime store resets while settings
      persist without layout restore) and
      [matrix](spec/reference-outcomes/floating.md) R-FLT-05. Sticky stays
      sticky and intentional floats survive owner restart. REQ-RST-01c
      membership/set/focus remains OPEN; no invented persistence identity
      or storage scheme.
    - Core seams (verified 2026-10-08 at `db31234`): `core/session.rs:546`
      `exceptions` map, `core/session/world.rs:433` `is_exception` (Engine
      float/settle reads at `core/engine.rs:835/:1467`), `core/session.rs:148`
      intentional-float transition. Exceptions ride the session, never the
      settings file.
    - KDE runtime (verified 2026-10-08 at `db31234`): observed
      float/sticky classification `kwin/src/plan-adapter.ts:7043-7051`
      `floatSourceOf` (float-set vs all-desktops), per-observation
      `floatingById` :8229, env `setFloating` :635. The id set resets on
      restart per the matrix cell; re-persisting it is the reserved KDE
      delivery, not this handoff.
    - Windows exact (verified 2026-10-08 at `db31234`): runtime intent
      `state.floated: BTreeSet<WindowKey>` (`src/tiling_sys.rs:1452`,
      init empty :13813); float toggle inserts :7361/:8103, unfloat
      removes :7668, close cleanup :4150; domain-release carry via
      `float_carry_tokens` (`src/workspace_owner.rs:207`, used :4286;
      fixtures :1352 `float_carry_survives_a_fresh_engine_session`);
      Engine read `engine_is_float` :3963. Sticky lane: `state.sticky` map
      plus on-window SetProp markers `src/tiling.rs:450`
      `sticky_marker_value` (1 = pre-sticky tiled, 2 = pre-sticky float)
      and :457 `parse_sticky_marker`; `src/product_hide.rs:487-547`
      read/install/remove; adoption fixtures
      `src/workspace_owner.rs:2894` roundtrip and :3245
      `sticky_adopt_consumes_both_markers_as_normal_float_then_tiles`.
      Runtime maps (`member_tokens`, `hidden_claims`, `member_identity`,
      `member_tags` :1280-1303) never serialize. These existing maps and
      recovery records are not a selected durable float-intent mechanism.

    #### Item 8 adapter checklist

    - `src/tiling_sys.rs` + `src/workspace_owner.rs`: on fresh observation
      after owner restart, restore the accepted intentional-float/sticky
      classification before first tiling. Current marker-adoption fixtures
      consume both origins as ordinary float (:3245); that is the gap,
      not the intended restart outcome. Preserve exact-lifetime admission
      fences (`member_tokens`/`member_identity`/`member_tags`,
      `visible_lifetime_ok`, `reused_hwnd_stale`) and independent recovery.
      Do not authorize writes from a marker or guessed HWND alone.
      Persistence/identity mechanism, journal-versus-separate-store routing
      and schema are not selected here; record the implementation proposal
      before wiring. REQ-RST-01c membership/set/focus remains OPEN. Existing
      live sticky toggles retain the two pre-sticky origins; the exact
      post-restart un-stick result is not selected by R-FLT-05 and stays TBD.
      No new shortcut/catalog row or preset is selected.
    - [ ] Portable: `float_carry_survives_a_fresh_engine_session` :1352,
      marker roundtrip :2894, sticky-adopt :3245, plus new offline-restart
      cases: surviving sticky marker re-adopts as sticky (both origins),
      intentional ordinary float survives, marker mismatch fails closed,
      recycled HWND refuses. Keep same-owner un-stick origin tests; leave
      post-restart un-stick assertions TBD under R-FLT-05/R-RST-01. Core:
      `crates/tiler-core/tests/restart_disjoint_adoption.rs` and
      `crates/tiler-core/tests/session_lifecycle.rs` exception
      fixtures. Windows: `tests/restore.rs` (reveal/skip/missing/ambiguous),
      `tests/storage.rs` roundtrip/refusal, `tests/lifecycle.rs`.
    - [ ] Windows-only: owner restart with live windows across all three
      lanes; ledger/journal crash recovery unchanged.
    - User journey: two sticky floats (one made sticky from tiled, one
      from intentional float), one ordinary intentional float and one tile;
      restart owner; both sticky windows remain sticky and the ordinary
      float remains floating. Observe and record un-stick results for both
      origins without selecting a post-restart outcome; membership/focus
      stays TBD under REQ-RST-01c. No layout-restoration claim.
    - DoD: sticky/intentional floats survive restart without identity
      guessing; undecided post-restart outcomes remain TBD; REQ-RST-01c OPEN;
      matrix `R-RST-01` and `R-FLT-05` Ours Windows cells updated with
      dated offline evidence, native journey TBD.

  - Item 9: fullscreen send R-MAX-09 (Windows carry). Table A R-MAX-09
    accepted 2026-10-07: Windows workspace send carries fullscreen state
    without restoring first (P1 adoption entry in this file). Depends on
    handoff item 2 follow/stay wiring only; same-output workspace carry,
    never the parked parity-queue multi-output foundation.

    #### Item 9 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#maximize) REQ-MAX-09;
      [matrix](spec/reference-outcomes/maximize-fullscreen.md) R-MAX-09
      (Ours Windows today: tiled maximized B sends through the retained
      Engine route with follow, fullscreen B refuses with no writes;
      Ours KDE: same-output desktop-send outcome TBD, R4 cross-output
      Engine path cited). KDE observe-first/maximize leg stays OPEN; only
      workspace carry is selected, never output-fullscreen carry.
    - R-MAX-05 boundary (not a send outcome): the project-toggle refusal on
      app-owned fullscreen without a preimage is a separate invariant
      (user decision 2026-10-07 R-MAX-05; [matrix](spec/reference-outcomes/maximize-fullscreen.md)
      R-MAX-05 Ours Windows; `src/tiling_sys.rs:6808`
      `fullscreen-refused-app-owned`). This item preserves that toggle path
      untouched; it selects fullscreen workspace-send carry only.
    - Current Windows gates (verified 2026-10-08 at `db31234`):
      `workspace_do_send` (`src/tiling_sys.rs:10552`) pre-dispatch overlay
      gate :10713-10737 (retained mover: fullscreen refuses
      `send-refused-fullscreen` :10728-10730, maximized proceeds through
      `send_flags_stable` plus `is_zoomed_now` rechecks); native boundary
      `workspace_do_send_native` :10314 with its own gate :10374; retained
      tail :10900-10945 (same fullscreen/maximized branches, post-tag
      lifetime recheck, `assign`, verified transfer before follow);
      builder/reply :10848-10884. `src/workspace_owner.rs:70`
      `build_send_event`, :138 `stamp_send_target`, :170-180 `SendRoute`,
      :396 `planned_writes`. Core: `core/engine.rs:1858-1865`
      `transfer_request`, `core/boundary.rs:93-112`
      `SendToWorkspace`/`SendToOutput`.
    - KDE seams, not carry acceptance: numbered workspace send enters
      `kwin/src/plan-adapter-entry.ts:4964` `requestWorkspaceMove`; tiled
      routing uses `kwin/src/workspace-send-adapter.ts:1309` `requestSend`
      and :2635 `followOnce`. Its :1363-1365 `non-tiled-focus` gate and
      native send behavior are context for the observe-first KDE R-MAX-09
      row, not authority to select a KDE fullscreen outcome.

    #### Item 9 adapter checklist

    - `src/tiling_sys.rs`: at the :10728-10730 and :10914 fullscreen
      branches, let a project-fullscreened mover proceed exactly like the
      maximized leg beside it: live flag-stability recheck, ordinary
      `transfer_request` admission (remembered leaf, destination focus
      history, root fallback), target allocation kept, overlay geometry
      never written, command follow/stay per handoff item 2 (follow
      selects/reveals target and focuses mover after verified transfer;
      stay hides the mover without selecting target and applies source
      MRU/null focus), verified transfer before follow. Retain every
      exclusion (unmanaged, suspended, identity/lifetime) and setter
      isolation; R-MAX-05 toggle path untouched. Any genuinely unresolved
      mover subcase gets a TBD governing matrix row, never an invented
      refusal.
    - [ ] Portable: `src/workspace_owner.rs` send fixtures
      (`send_event_binds_target_and_focused_mover` :1251,
      `send_plan_scopes_source_reflow_through_writable_subset` :2229) plus
      new fullscreen-carry cases: true-Engine source/target allocation
      equality with the maximized leg, overlay geometry skip (zero native
      writes for the mover), follow vs stay focus/visibility, maximized vs
      fullscreen distinction; `tests/tiling.rs` retained-Engine send
      coverage with lifetime/arrival/recovery.
    - [ ] Windows-only: Engine/native-boundary tails, source-selected
      fences before writes and focus, hidden target reveal policy, recycled
      lifetime, partial-transfer reconciliation without replay.
    - Settings/input/catalog/presets: reuse handoff item 2's follow/stay
      actions and exact-modifier routing. Current numbered send rows are
      `src/settings.rs:823-826` / `workspace_row` :830; this carry change
      selects no additional binding, conflict, preset or UI control.
      `apply_preset` :1490 / `compatible_disabled_ids` :1528 stay under
      item 2's recorded policy, not a new fullscreen-specific policy.
    - User journey: project-fullscreened B on WS1, WS2 occupied; follow
      send (B arrives still fullscreen, source collapses to A, B focused);
      fresh fixture, stay send (WS1 stays shown on A, B fullscreen on
      hidden WS2, select WS2 to verify); maximized leg repeats unchanged;
      native restore/exit of arrived B behaves as before.
    - DoD: workspace fullscreen carry without prior restore; exclusions and
      R-MAX-05 toggle refusal intact; matrix `R-MAX-09` Ours Windows cell
      updated with dated offline evidence, KDE leg still observe-first,
      native TBD.

  - Item 10: float/half-snap parity (a), R-FLT-07..11. User decision
    2026-10-05 float-nav ([decisions](decisions.md#window-and-workspace-behavior));
    KDE delivered offline ([record](changes/archive/kde-floating-directional-navigation.md)).
    Windows parity pending; cross-platform consistency already selected.

    #### Item 10 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#floating) REQ-FLT-07/08/09/
      09b/10/11; [matrix](spec/reference-outcomes/floating.md) R-FLT-07..11.
      Tile-origin focus lands on tiles, floats never targeted; float-origin
      focus selects same-domain floats by top-left axis distance, considering
      sticky entries before ordinary entries in encounter order; nearer
      ordinary entries can win. Up/Left ties keep first, Down/Right last. Miss
      retains focus and reuses the recorded horizontal output-edge behavior
      without COSMIC workspace cycling; float-origin Meta/Win+Shift+arrow
      snaps to the stateless work-area half, stays floating and focused.
      Quarters, maximize and repeated-outward transfer states deferred.
    - KDE exact (verified 2026-10-08 at `db31234`):
      `kwin/src/plan-adapter.ts:944` `floatSubjectEntry` (focused
      same-domain float/sticky gate), :974 `selectFloatFocusTarget`
      (sticky entries first, then ordinary in one axis-distance race;
      Up/Left admit non-positive deltas and keep first tie, Down/Right
      strictly positive and keep last), :1036 `floatHalfSnapRect`
      (inner-gap formula over work-area bounds, trunc halves), :2460
      `requestFloatFocus` via dispatch :2433, :2533 `requestFloatMove` via
      :3129 (exactly one `setGeometry` plus focus retention; no Engine
      admission, no dispatch, no overlay clear, repeats request the same
      half again). Fixtures: `kwin/tests/plan-float-focus.test.ts`,
      `kwin/tests/plan-float-move.test.ts:144-282` (four-direction
      arithmetic, trunc, sticky parity, stateless repeats, stale refusal).
    - Core: `core/boundary.rs:58-67` Focus op (`float_subject` flag),
      `core/engine.rs:2840/:3022` focus proposal,
      `core/session/ops/focus.rs:26` `propose_focus`; cross-output float
      focus leg covered in
      `crates/tiler-core/tests/session_float_focus_cross.rs`.
      Half-snaps are adapter-native geometry (no Engine plan) on KDE;
      Windows must do the same, never an Engine admission.
    - Current Windows exact (verified 2026-10-08 at `db31234`):
      `src/tiling_sys.rs:5911-5935` sticky refusal (`focus-refused-sticky` /
      `move-refused-sticky`) plus float refusal (`focus-refused-floating` /
      `move-refused-floating`); `CoreCommand::Focus` :6096 with
      `float_subject:false` :6100; focus actuation `actuate_focus` :5402;
      float read `engine_is_float` :3963.

    #### Item 10 adapter checklist

    - `src/tiling_sys.rs` `keyboard_tick` :5645: before the Engine
      Focus/Move build, branch on float subject (`engine_is_float` :3963
      or `state.sticky` member, mirroring the :5911-5935 gates): Focus
      runs the ported `selectFloatFocusTarget` over same-domain observed
      floats (one distance race, sticky encounter-order first, same tie rules) via
      `actuate_focus` :5402; miss retains focus and reuses the existing
      horizontal output-edge path, never workspace cycling and never a new
      crossing. Move runs the ported `floatHalfSnapRect` over the work-area
      bounds plus inner gap, performs exactly one geometry write with the
      existing writable/hidden/minimum fences, and retains focus on the
      same subject; no Engine call. Keep the refusal vocabulary for
      ineligible subjects, invalid geometry, stale subjects and the
      deferred quarter/max/outward states.
    - [ ] Portable: `tests/tiling.rs` + `tests/snapkey.rs` (existing
      focus/move rows, no new chords): nearer ordinary vs farther sticky,
      first/last tie selection, miss
      retention, repeated half-snaps stateless with exact allocation,
      tile-origin skip, deferred states still refused. Port
      `kwin/tests/plan-float-focus.test.ts` axis/tie cases and
      `kwin/tests/plan-float-move.test.ts:144-282` arithmetic/repeat/stale cases.
    - Settings/input/catalog/presets: existing `FOCUS_MOVE_ROWS`
      (`src/settings.rs:575`) / `binding_catalog` :757-768 are implemented;
      retain their Keep/Disable/Rebind and `compatible_disabled_ids` :1528
      conflict policy. Half-snaps use current inner-gap settings; no new
      shortcut, preset rule or persistent snap-state setting is selected.
    - [ ] Windows-only: single-write readback, minimum-hint clamp,
      mixed-DPI work-area placement; native suppression evidence.
    - User journey: float-to-float Win+arrows (ordinary pair, then sticky
      pair: verify encounter-order tie rules); Win+Shift+arrows all four halves
      twice (same half again); miss holds focus; tile-origin Win+arrows
      ignore floats.
    - DoD: REQ-FLT-07..11 behave with deferred states still deferred;
      matrix `R-FLT-07..11` Ours Windows cells updated with dated offline
      evidence, native TBD.

  - Item 11: born-max/floating-retile overlay parity (b), Q3 including
    R-MAX-03. User decisions Q3 plus Q3 scope 2026-10-07
    ([decisions](decisions.md#cross-platform-behavior)): born-maximized
    tiles with a reserved slot and keeps maximize as an overlay, no launch
    unmaximize, on KDE and Windows; Q3 also covers R-MAX-03
    floating-to-tiled admission, replacing the one-shot restore on both.
    KDE R-MAX-06 delivered offline, R-MAX-03 delivered offline in
    `29c75fe` ([record](changes/archive/kde-maximized-floating-retile-overlay.md),
    born-max [record](changes/archive/kde-born-maximized-overlay.md)).

    #### Item 11 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#maximize) REQ-MAX-03/03b/06;
      [matrix](spec/reference-outcomes/maximize-fullscreen.md) R-MAX-03
      (Ours KDE: floating skips slot seeding, retile reserves the slot,
      native unmaximize lands in it; Ours Windows: one-shot retile restore
      still in code) and R-MAX-06 (Ours KDE: reserved-slot overlay, no
      launch clear; Ours Windows: one admission-time clear attempt,
      retained slots/fullscreen/floating domains exempt). No launch
      unmaximize, no one-shot retile restore. First fullscreen exit and
      the B9 Windows refusal (until the COSMIC R-FLT-06 check) preserved;
      no R-MAX-08 nav choice.
    - KDE exact (verified 2026-10-08 at `db31234`):
      `kwin/src/plan-adapter.ts:5933` `clearMaximizeAtAdmission` (skips
      fullscreen, skips attempted ids via `maximizeAdmissionAttempts`,
      clears only the exact-ref-held born-fullscreen exit
      `heldInitialFullscreen`, echo arm/clear, observed refetch); call
      sites :5476/:5791; env `clearMaximize` :626; overlay = retained
      tile slot plus `fit_excluded` / `skip-maximized` isolation with
      quiet repeated/synchronous signals (matrix R-MAX-03/06 KDE cells).
      Fixtures: `kwin/tests/plan-adapter.test.ts`.
      Carried projection is `kwin/src/plan-adapter.ts:2721-2740`, payload
      `fit_excluded` :6071 and native `skip-maximized` :8338-8339. Shared
      `core/engine.rs:478-512` converges the carried set; core projection
      `core/boundary.rs:802-807` omits excluded frames from observed-clamp
      assessment while retaining planned geometry. No new Engine behavior
      is selected by this parity piece.
      The implementation-status sentence at `decisions.md:571` still calls
      R-MAX-03 one-shot; `29c75fe` and its archive record supersede that
      KDE delivery status, not the recorded Q3 behavior decision.
    - Windows exact (verified 2026-10-08 at `db31234`):
      `src/tiling.rs:550` `should_clear_maximize_at_admission`,
      :567 `should_admit_slotless_maximized`; callers
      `admission_clear_eligible` (`src/tiling_sys.rs:3785`),
      `clear_maximize_at_admission` :3810 (attempt-key
      mark-before-native-call, `restore_zoom_placement`, assembly
      :3802-3898), `admit_slotless_maximized` :8726 (is_member,
      `member_rects`, holdable-key, lifetime gates),
      `admit_born_fullscreen` :8622. First-exit lane kept:
      `FullscreenMeta` read/write :3400-3496, `enter_fullscreen` :3520,
      `exit_fullscreen_owned` :3574, `track_fullscreen_holds` :3713.
      B9 lane kept: `float_toggle_refusal` (`src/tiling.rs:402`) and
      `sticky_toggle_refusal` (:418). Fixture:
      `floating_retained_max_stays_slotless_then_tiled_seeds_and_plans`
      (`src/tiling_sys.rs:17164`).
      Row assembly is `src/tiling_sys.rs:4243`, retained maxima :4423-4468;
      slot seeding calls `src/tiling.rs:581` `should_seed_member_slot` at
      :4432, with canonical retained rectangles from `src/tiling.rs:480`.

    #### Item 11 adapter checklist

    - `src/tiling.rs` + `src/tiling_sys.rs`: replace the one-shot clear on
      both admission legs (slotless maximize :8726 and tiled clear :3810;
      :8622 is the separate born-fullscreen hold) with the reserved-slot
      overlay: retain membership, seed the slot (`member_rects`), skip native
      clear and geometry writes while overlaid, land native unmaximize in
      the slot, settle repeated maximize/geometry signals quiet with no
      unsolicited toggles or fighting. Retire
      `should_clear_maximize_at_admission` one-shot use; keep the held
      born-fullscreen single exit and the B9 toggle refusals byte-identical
      in behavior. No new chord, no new setting, no R-MAX-08 change.
    - Settings/input/catalog/presets: reuse current native/project maximize
      and workspace tiled/floating controls. Catalog toggles remain in
      `src/settings.rs:799-818`, workspace default :250-263, Settings UI
      `src/settings_ui.rs:314/:394` and tray `src/tray.rs:179-275`; no new catalog row or
      `compatible_disabled_ids` :1528 policy is selected by Q3.
    - [ ] Portable: :17164 plus new cases: born-max beside a sibling
      (sibling keeps its allocated share), hidden-workspace retile,
      floating-toggle retile, native restore to the exact retained slot,
      quiet repeated signals, reused IDs, session-boundary restored max
      with no loop.
    - [ ] Windows-only: native maximize/unmaximize roundtrip into the
      slot; graceful/crash recovery of overlaid members.
    - User journey: born-maximized launch beside a sibling (slot reserved,
      overlay quiet); native unmaximize lands in the slot; repeat
      maximize/unmaximize settles quiet; floating workspace with maximized
      A beside ordinary B, toggle tiled (A stays maximized over its slot,
      B takes its share), native unmaximize lands in the slot; repeat
      with a session-restored maximized A at a user-owned session
      boundary, no loop.
    - DoD: one-shot clear replaced by reserved-slot overlay on both legs;
      first-fullscreen-exit and B9 refusal preserved; matrix `R-MAX-03` /
      `R-MAX-06` Ours Windows cells updated with dated offline evidence,
      native TBD.

  - Item 12: non-local workspace modes parity (d). Decisions 1.2/1.5
    ([decisions](decisions.md#cross-platform-behavior)): local and
    global-unique keep per-output history/rings, shared keeps one
    history/ring. KDE mappings delivered offline; Windows local-only
    today. Depends on handoff items 1/2 (history/ring + follow/stay) and
    the parked parity-queue multi-output foundation; last.

    #### Item 12 behavior and reference seams

    - Normative: [spec](spec/functional-spec.md#workspaces) REQ-WS-08/11
      (Win columns: history/toggle and relative-switch implementation
      pending, non-local modes pending);
      [matrix](spec/reference-outcomes/workspaces.md) R-WS-08/11 plus
      R-WS-15 (per-output isolation vs shared), R-WS-16 (removed-ID
      invalidation), R-WS-17 (hotplug history/scope). KDE mappings are
      selected and the spec carries scoped history/rings; any exact
      Windows outcome not defined is a TBD governing row, never invention.
    - KDE exact (verified 2026-10-08 at `db31234`):
      `kwin/src/workspace-native.ts:990` `selectPrevious` (shared branch
      :995 `selectPreviousShared` :2250; per-output `previousByOutput`,
      `previousInScope`, `swapGlobalIfVisibleElsewhere` for global-unique),
      :1051 `selectRelative` (shared branch :1059 `selectRelativeShared`
      :2281; `rebuildGlobalMapping` vs `rebuildLocalMapping`,
      `scopedRingIds` :2203), :2141 `recordHistoryObservations`, :2185
      `observeSharedHistory`. Fixtures:
      `kwin/tests/workspace-previous-relative.test.ts`.
      Current shared Rust policy `core/workspace.rs:7-17` resolves local
      ordinals, and :35 `plan_trailing` handles local cleanup. It does not
      supply the KDE global/shared mapping machinery; preserve D1 ownership
      if this adapter parity needs a new shared-core contract.
    - Windows exact (verified 2026-10-08 at `db31234`):
      `src/workspace.rs:95-109` `ManagedWorkspaces` fields are
      outputs/displaced/membership/next_ws/next_output/default_tiled/tiled:
      no previous-history or relative-ring resolver, no mode-scope field.
      Workspace order exists; mode provision is
      per-workspace tiled/floating ONLY: `is_tiled` :150, `set_tiled`
      :166, `default_tiled` :133/:139, settings
      `core.workspace.default_tiled` (`src/settings.rs:250-263`), settings
      UI :314/:394, tray per-workspace toggle (`src/tray.rs:179-275`). No
      global/local/shared scope setting exists anywhere in settings, UI
      or tray; the tray workspace-tiling action is a per-workspace
      tiled/floating toggle, never a global mode selector. Routing:
      `src/tiling_sys.rs:9819` `workspace_do_select`, verified
      hide/reveal :10061, `workspace_tick` :11395, selection arm :11530,
      `poll_foreground_workspace` :11912, `sync_monitor_outputs` :12050,
      `chord_output` :8508, `src/workspace_owner.rs:25`
      `output_context`. Cleanup `plan_cleanup`/`apply_cleanup`
      (`src/workspace.rs:453-508`) invoked :9228-9234 and :10074-10080.

    #### Item 12 adapter checklist

    - `src/workspace.rs` `ManagedWorkspaces`: add mode scope
      (local/global-unique/shared) plus per-output previous/observed
      history and scoped ring resolvers from handoff item 1 (pure
      stable-ID resolve, no activation/append/trailing creation);
      global-unique swaps the visible-elsewhere entry instead of
      duplicating selection (KDE `swapGlobalIfVisibleElsewhere` parity),
      shared keeps one history/ring. Record actual completed transitions
      at :10061 (including failed focus/geometry), `workspace_tick`
      :11530, foreground :11912 and monitor sync :12050; invalidate
      removed/unassigned/out-of-scope ids through the existing cleanup;
      discard disconnected-output history, never consult history for
      reconnect selection. Membership/visibility/recovery routing follows
      the transfer. No new shortcut, no new preset, no tray command.
    - [ ] Portable: local vs global-unique vs shared isolation (R-WS-15),
      surviving-empty vs removed/moved id (R-WS-16), disconnect/displacement/
      reconnect/return scope with conditional second toggle (R-WS-17),
      output-focus-alone non-recording, cross-output previous and relative
      selection, >9/trailing wrap per scope. Port
      `kwin/tests/workspace-previous-relative.test.ts` case for case.
    - Settings/input/catalog/presets: existing workspace shortcut rows
      (`src/settings.rs:819-826`) and handoff items 1/2 supply the selected
      chords; `compatible_disabled_ids` :1528 remains their policy. Scope
      configuration exposure/schema and live mode-change transition behavior
      are not selected by the provision at `decisions.md:169`; resolve those
      before adding controls. Existing `WorkspaceSettings` :250-263, UI
      `src/settings_ui.rs:314/:394` and `src/tray.rs:179-275` are
      tiled/floating controls, not scope.
    - [ ] Windows-only: owner selection/foreground/CLI producers, hotplug
      journeys, multi-output native evidence on the second PC.
    - User journey: two-output L/R with WS1/WS2 on L; L WS1->WS2, change
      R, focus L, previous twice (local: WS1 then WS2; R unchanged);
      shared mode WS1->WS2->WS3 then previous twice (WS2 then WS3);
      disconnect/reconnect return-scope sequence per R-WS-17.
    - DoD: non-local modes behave per scoped history/ring with undefined
      outcomes as TBD rows; matrix `R-WS-15..17` Ours Windows cells updated
      with dated offline evidence, native TBD.

  - Item 13: Q2 fixed-size float admission R-SPC-04. User accepted the
    ordinary fixed-size admission addition 2026-10-07; exact D1-D8 edges
    are autonomous PROVISIONAL choices 2026-10-08, not user decisions.
    KDE/shared delivered offline; Windows behavior is frozen in this delivery.
    [Record](changes/archive/fixed-size-admission.md),
    [provisional clauses](decisions.md#cross-platform-behavior),
    [matrix](spec/reference-outcomes/special-windows.md#q2-fixed-size-admission-discriminators-2026-10-08).

    #### Item 13 behavior and reference seams

    - Normative addition: REQ-SPC-04 floats ordinary fixed-size clients.
      PROVISIONAL edges REQ-SPC-04a..h: equal usable whole vectors including
      partial-zero; missing/full-zero/sentinel excluded; admission-only hint
      status; same-live-client user tile overrides; fixed-floating base under
      native maximize; born-fullscreen exit tiled vs prior-float restore;
      workspace enable retiles automatic only; startup/restart recomputes;
      membership-only automatic admission with zero native target writes.
      Either-axis alternative remains reviewable, no setting now. Q3 boundary
      explicitly touched only for fixed-size birth; later fixed/maximized
      retile still uses R-MAX-03's reserved slot. Windows borderless-game
      inference and B9 refusal remain authoritative.
    - References: COSMIC @3d55cba0 `src/shell/layout/mod.rs:46-52`,
      `src/shell/element/surface.rs:565-595`, `src/shell/mod.rs:2957-3022`,
      `src/shell/workspace.rs:1440-1454,1491-1519`. Fullscreen birth/restore
      are distinct (`src/shell/mod.rs:2754-2807,2960-2968`). COSMIC admission
      placement/focus is not permission to touch games; our D8 is no-touch.
    - Shared exact sites in this staged Q2 delivery: `core/size_hints.rs`
      `is_fixed_size` / `fixed_size_reason`; `core/session/world.rs`
      `converge_observation`, automatic/override sets; transactional
      `PendingDesired` in `core/session.rs` and `ops/lifecycle.rs` /
      `ops/float.rs`; `core/engine.rs` `set_fixed_size_admission` default OFF;
      `core/seed.rs` `EngineWindow` origin/overlay fields. Existing Linux
      Planner in `protocol/planner_protocol.rs` `Planner::new` enables it;
      Windows uses `Engine::new` directly and stays OFF. This is no new
      adapter-logic extraction. Fixtures: `crates/tiler-core/tests/fixed_size_admission.rs`,
      `crates/tiler-protocol/tests/planner_fixed_size.rs`.
    - KDE exact sites: `kwin/src/plan-adapter.ts` `withFixedSizeFloats`,
      `fixedClients` exact-reference records, `commitFixedStage` after applied
      command success, `retileAutomaticFixed`; optional `fixed_auto` and
      `fixed_suppress` wire assertions carry origin/override through domain
      release/adoption. `kwin/src/plan-adapter-entry.ts` `markTiledAndResync`
      retiles automatic records only after confirmed release; native removal
      evicts identity, scoped/minimized absence does not. Real Planner and
      production-entry fixtures: `kwin/tests/fixed-size-admission.test.ts`,
      `kwin/tests/fixed-size-workspace-entry.test.ts`.

    #### Item 13 Windows adapter checklist

    - Max-side data is missing today: `src/tiling_sys.rs:733-817`
      `seed_minmaxinfo`, `query_outer_min_track`, `min_hint_for` extract only
      minimum track; maximum track is seeded at :743-747 but never extracted.
      Extend the same one bounded WM_GETMINMAXINFO query, preserving timeout,
      aggregate budget and failure-as-unknown rules. Normalize both sides
      with the same fresh DPI/frame-inset conversion at
      `src/tiling.rs:99-154` `normalize_min_track` / `min_hints_from_outer`;
      no geometry/style/resizeable inference of fixedness.
    - Wire visible/verified-hidden/retained rows through
      `src/tiling_sys.rs:804` `min_hint_for`, :827 `hidden_hint_for`, :4243
      `assemble_domain_rows`; unknown max hints never classify. Keep overlay
      hint retention lifetime-bound; do not reuse an automatic float's stale
      minimum as evidence for fresh fixed-size admission.
    - Select classification before native slot/restore/write side effects:
      `src/tiling_sys.rs:3656-3668` eligibility, :3785
      `admission_clear_eligible`, :3810 `clear_maximize_at_admission`, :8726
      `admit_slotless_maximized`, :8622 `admit_born_fullscreen`, and
      `src/product_hide.rs:825` `admit_managed_claim`. Fixed/maximized birth
      floats without clear/slot; later workspace retile uses item 11's
      reserved-overlay route. Never change the captionless full-monitor
      inference or app-owned fullscreen/preimage rules as part of Q2.
    - Carry live lifetime-bound origin and override through
      `src/tiling.rs:1226` `build_reconcile_event_for_floating`, :1281
      `build_reconcile_event`, `src/workspace_owner.rs:70` `build_send_event`
      and domain row assembly. This delivery's only Windows edits initialize
      `fullscreen`, `sticky`, `fixed_auto`, `fixed_suppress` to false in
      those constructors and two native preview-test literals. Enable
      `Engine::set_fixed_size_admission(true)` only after complete observation,
      origin and no-touch wiring; never infer automatic origin from an
      intentional floating flag or fixed hints alone.
    - Same live client keeps explicit tile/sticky intent through hide/show,
      scope changes and domain release; native lifetime replacement clears
      it. Workspace enable retiles automatic only, intentional/sticky stay.
      Restart recomputes absent authoritative identity; do not add tile
      override persistence or fold R-RST-01 into this piece.
    - No new shortcut, setting, preset or hook. Automatic membership must
      emit bounded correlated decision evidence and cause no game geometry,
      focus, stacking/keep-above or effects/input interference. Do not call
      the explicit-float placement/focus path for automatic admission.
    - [ ] Portable: full hint table, opt-out unchanged behavior, fresh
      foreground/hidden startup, both hint transitions, explicit unfloat /
      sticky overrides through hide/domain adoption, ID reuse, fixed/max
      birth and retile/native restore, born/prior-float fullscreen, automatic
      vs intentional workspace enable, failure paths and no-write accounting.
    - [ ] Windows-only: fresh max-track/DPI/inset observations, timeout/hung
      clients, native overlay/restore and fixed borderless/exclusive games;
      user owns live checks on the Windows PC. Linux tests prove none of these.
    - DoD: selected provisional clauses implemented with current Windows
      rules preserved; dated Ours Windows matrix/spec evidence, no native
      claim without user testing; user review of D1-D8 remains tracked.

  ### Source discrepancies to preserve and report

  | Existing assertion | Current source / implementation gap | Handoff treatment |
  | --- | --- | --- |
  | [R-OUT-01](spec/reference-outcomes/multi-output.md#r-out-01-scrolling-assessment-move-left-onto-an-occupied-output) Ours Windows claimed exhausted-horizontal R4; [R-MOV-05](spec/reference-outcomes/move.md#r-mov-05-backfill-edge-move-with-no-left-neighbor-scrolling) claimed horizontal crossing with Up/Down excluded. | `src/tiling_sys.rs:6099/6105` sets `cross_output_transfer:false` in a single-domain event; no Windows cross actuation. Shared core supports four-direction R4. | Corrected both cells 2026-10-08 at `db31234` to local-only current-code facts. Handoff item 5 remains blocked on the parked parity-queue multi-output foundation; no native acceptance claimed. |
  | [R-WS-10](spec/reference-outcomes/workspaces.md#r-ws-10-send-b-away-empty-middle-retained-vs-removed) and [R-WS-16](spec/reference-outcomes/workspaces.md#r-ws-16-previous-after-the-visited-empty-workspace-is-removed) Ours Windows said no removal path; spec REQ-WS-10 repeated it. | `src/workspace.rs:508` removes stable IDs; `src/tiling_sys.rs:9228-9234` retirement cleanup and :10074-10080 selection invoke it. `core/workspace.rs:35` plans eligible invisible-empty removal, protecting the trailing spare and minimum count. | Corrected both cells and REQ-WS-10 2026-10-08 at `db31234`. Exact native scenarios remain TBD; handoff item 1 invalidates actually removed IDs and tests surviving empties separately. |
  | Existing higher-level item-2 summary says Compatible disables arrows, while decision 2.1 identifies stock holders only on KDE and says Windows ownership unknown. | `src/settings.rs:954-957` currently returns None for all Ctrl/Alt chords; no Windows holder evidence for new send/output arms. Verified 2026-10-08 at `db31234`; status outstanding, no new policy selected. | KDE arrows are disabled by KDE Compatible. Windows unknown new arms keep defaults with unknown-ownership text until evidenced policy is recorded; do not manufacture Windows holder claims. |
  | Current settings/rebind helpers assume every implemented action has a canonical default chord. | `src/settings.rs:1044` canonical helper returns None for empty defaults; `build_remap` :1182 skips that action; `validate_bindings` :1405 rejects it. Keep-empty is currently active/effective (:1082); UI `refresh_info` (`src/settings_ui.rs:248`) labels it disabled. Verified 2026-10-08 at `db31234`; status outstanding, plus `settings_ui.rs:286` resize note. | Items 2/5 must wire unbound ACTION targets explicitly, make Keep-empty non-intercepting and display unbound distinctly from Disabled. These are adapter limitations, not a decision reversal. |

- P1 | Shortcut conflict model on KDE and macOS | Per-binding conflict list
  plus compatible/authentic presets (user 2026-10-03); KDE builds on its
  existing shortcut override Apply/Force/Revert; macOS when it starts.
  KDE Keep/Disable list (now 124 bindings after item 5, including 32 unbound
  stay rows) and presets delivered
  offline
  (`e1bb52a`, `cdd4ef4`, `96d04ab`; CI green); provisional choices in
  decisions; integrated rebind and KDE first-run prompt deferred. KDE live
  acceptance pending: [checks](live-shortcut-override-verification.md),
  [record](changes/kde-shortcut-conflicts.md).
- P3 | Hidden-workspace Alt+Tab option | Research complete (`580c766`,
  `8129b37`; [note](research/windows-port/alt-tab-hidden-workspaces.md)):
  keep SW_HIDE (no supported reinsertion); public off-screen parking is the
  only official candidate, with visibility/recovery costs; native desktops
  and private cloaking need separate API decisions. Activation behaviour
  is matrix row R-WS-07. Implementation deferred; no design selected.
- P1 | Cross-platform functional specification | After the Windows tiling
  dogfood slice, define window/workspace behavior and keyboard shortcuts as
  the single source of truth for Linux, Windows and macOS. KDE is the current
  behavioral reference; macOS modifier mapping is decided when macOS starts.
  cosmic-comp (user favourite: n-ary splits, join/leave UX) is a key input.
  User proposal (2026-10-03): a reference-WM outcome matrix (action
  scenarios x input WMs such as COSMIC, Hyprland, bspwm, i3, xmonad) as the
  source of truth feeding the spec and its supported variants (for example
  n-ary vs binary splits); retrofill COSMIC outcomes from tests already
  done; every behaviour ambiguity adds a row the user can fill later when
  source code cannot answer it. Initial matrix delivered (`076aba1`,
  [reference outcomes](spec/reference-outcomes.md), 27 scenarios, format
  provisional); AGENTS.md now requires a row per ambiguity. All eight
  reference columns source-filled under pinned profiles: COSMIC (`bdb205f`),
  Hyprland (`4f82534`), bspwm (`e6b71cc`), i3 (`4128bdf`), xmonad (`548146d`),
  sway (`332afdc`), qtile (`c32eb48`) and awesome (`046a1e8`). Matrix now has
  58 scenarios. End-to-end expansion completed 2026-10-07 (`9241c94`..
  `9168508`, [record](changes/archive/reference-matrix-expansion.md)):
  matrix split into per-area files, GWT format confirmed (decisions.md),
  scrolling profiles niri/PaperWM/karousel/paneru added, 125 scenarios
  (67 new incl. 10 column mechanics), all 14 profiles per new scenario;
  1198 assessed cells: 372 evidenced, 237 partial, 224 TBD, 328 qualified,
  37 mixed. All 58 historical rows migrated to GWT with separate Ours
  KDE/Windows outcomes (`c365fca`..`21f025d`; combined Ours text kept
  under both for R-MAX-01, R-CTL-02/05/06/07). Source filling makes no
  product decision. Provisional first spec draft `ac75b00`
  ([functional spec](spec/functional-spec.md), single file, format
  provisional): 49 normative (cited decisions only), 84 OPEN, 11
  PROVISIONAL, 12 KDE/Windows gaps; covers all 125 scenarios; ends with a
  grouped open-decisions index for one-sitting review. Flagged
  contradictions: Q3 vs R-MAX-06 label and both adapters' admission
  clear; B6 vs KDE skip-writes; float-origin nav vs Windows refusal; KDE
  no-size-inference vs Windows containment fullscreen; B9 vs COSMIC
  source; Q3/R-MAX-03 overlap.
  [Cross-WM consensus analysis](research/reference-wm-consensus.md) Table A
  now lists 24 Ours-vs-strong-consensus differences with recommendations
  (see Open user decisions), plus strong-consensus predicates where Ours is
  TBD pending native observation. Splits decided 2026-10-07:
  R-DRAG-07 host-native presentation (KDE frame follows pointer, Windows
  Win-drag stationary preview) and R-DRAG-08 focus at press on both
  platforms (Windows implementation pending, KDE timing needs a live check).
  Live-test queue: 508 cells grouped by environment (per reference WM, Ours KDE 39,
  Ours Windows 37, macOS/paneru 82) in the archived record; candidate for
  per-WM environments proposed in the
  [live-test environment proposal](research/live-test-vms/proposal.md).
  Table A decisions are recorded under "Open user decisions" below;
  priority native TBD rows R-WS-02, R-WS-04, R-WS-05, R-START-03, R-MAX-01 remain.
- P2 | Prior-art catalogue upkeep | Completed 2026-10-03 (`e4c1d92`):
  [maintained index](research/prior-art.md), grouped by desktop and type
  (compositor-native vs host-integrated) with algorithm families,
  mechanisms, workspaces, licences and clone inventory. Deferred to a
  Linux/macOS session: FancyWM core submodules, niri/sway/river/awesome/dwm
  source analysis (web-only now). Keep it updated as projects are studied.
  [Evidence](changes/archive/prior-art-catalogue.md).
- P1 | Cross-platform dev environment (mise) | Delivered 2026-10-03
  (`4e95150`, `fda206b`, CI green incl. hosted Windows/macOS install
  checks): root `mise.toml` (Rust stable, just, jq, gh, ripgrep; yq on
  Windows), AGENTS.md and runbooks updated. Provisional: rolling `latest`/
  `stable` without `mise.lock`; hosted install checks instead of exact
  mise/Nix pin equality. User: `winget install --exact --id jdx.mise
  --source winget`, then `mise trust`, `mise install`,
  `mise exec -- rustc -vV` from the repo root.
  [record](changes/archive/cross-platform-mise.md)
- P2 | Windows reference-WM comparison | Completed 2026-10-03 (`2b0540c`,
  `d1b22dd`): [comparison](research/windows-port/reference-wm-comparison.md)
  keeps our public `SW_HIDE` hiding and minimum hints; Whim's projected
  drag preview informs parity 8; komorebi-bar/Zebar/Seelen inform parity 10.
  No official Win+G/Win+F11 suppression found. Follow-up: Steam/Firefox/UWP
  admission observations (small).
- P1 | macOS port | Work expected soon (user 2026-10-03). Readiness research
  done (`f095042`): setup/TCC/signing runbook, sourced prior-art survey and
  tentative plan, which recommended public AX/AppKit. User direction
  (2026-10-03) supersedes that default: lower-level, lower-jank yabai-style
  route first, optional higher-level AeroSpace-style alternative later;
  default tier 2 (public plus private APIs, SIP enabled, no Dock injection).
  Plan revised to tier 2 from nine pinned local sources (`df018fb`,
  `05d1d1f`; [record](changes/archive/macos-tier2-plan.md)). PARKED on
  Phase 0 user inputs (recommendations in the plan): host model/macOS
  floor (Apple Silicon, provisional 15+), Intel (arm64 first), stable
  signer (Developer ID if available), Meta mapping (Cmd). Then Phase 1
  lifecycle/recovery and hotkey probes on a Mac.
  [setup](macos-dev-environment.md)
  [survey](research/macos-port/prior-art.md)
  [plan](research/macos-port/plan.md)
- P1 | Rust toolchain tracking (recurring) | User (2026-09-30): track latest
  stable Rust pre-1.0 and fix breakage. Windows uses rustup `stable`; Linux
  and CI get Rust from the nixpkgs pin in `devenv.yaml`, which must be bumped
  regularly to stay close to stable. Revisit the upgrade process at 1.0.
  Checked 2026-10-04 (`4212456`, `929adf5`, `c486c59`; CI green): hosted
  Windows/macOS CI now refreshes stable (1.99.0); Linux devenv stays at
  1.98.1 and native CI flake at 1.97.1 until 1.99.0 reaches nixos-unstable
  (now only on staging; rechecked 2026-10-07 `0e2a323`: unstable
  `151fa4e8` still 1.98.1, 1.99.0 still latest stable). Next: recheck, then bump devenv and native flake
  pins; user re-enters devenv after the bump.
  [record](changes/archive/rust-toolchain-tracking-2026-10.md)
- P1 | Tray tiling/floating workspace toggle | Shipped `e407531`; user
  confirmed live (2026-09-29) that toggling a workspace floating and back to
  tiled behaves as expected. Remaining live: default change, cross-boundary
  send (see Pending live checks). Tray invokes a keyless KWin script shortcut
  action over KGlobalAccel; the default is
  `kwinrc [Script-plasma-auto-tiler-kwin] defaultTiled`. Simplicity review
  done offline (2026-09-29): duplicated cache recovery consolidated, the
  rest kept as earning its place.
  [change](changes/archive/tray-workspace-toggle.md)
  [review](changes/archive/tray-toggle-simplicity.md)
- P1 | Group underlay on window movement only | User (2026-09-30): show the
  underlay only while moving windows, replacing Meta-held. Staged: A
  Meta+Shift hold; B focused-window interactive move (Meta+drag, title-bar
  drag); C unfocused dragged-window support. Move-only, hard-coded. Stop and
  report if any stage (especially C) grows complex. A/B delivered
  2026-10-05, user laptop check good (see KDE follow-ups above); C parked.
  [change](changes/group-underlay-move-trigger.md)
- P1 | Ghostty/local native alignment | The ~56 px shortfall is unexplained
  (source-only baseline fix is in; needs a fresh `just dev trace` local-move
  plus follow-on command trace), and one requested `2032x1092` became
  `1920x1036` while another primary Ghostty accepted full size (per-window
  native cap or stale output-derived cap unproven). Hypothesis
  (Orchestrator, 2026-09-28): 1920x1036 equals HDMI-A-2's work area, so the
  window may be constrained to the other output. Next: PC `just dev trace`
  with one tall tiled window on DP-6; check output, bounds and constraints.
  Gates reconciliation phase 2.
  [bounds fix](changes/archive/multi-output-domain-bounds.md)
  [phase 2 parked](changes/learned-size-limits.md)
  [drag investigation](changes/window-alignment-drag-investigation.md)
- P1 | Navigation/movement while maximised | No suppression policy selected;
  semantics await the user's COSMIC comparison.
  [behavior](decisions.md#window-and-workspace-behavior)
- P1 | External NixOS/Home Manager delivery validation | Clean external
  install, update, rollback, and host-matching KWin ABI still unproven
  off the dev machine.
  [change](changes/archive/nix-current-host-delivery.md)
- P2 | Simplify drag preview + cross-output drop code | Post-live cleanup only:
  cut advisory `hover_prior` validation, lag-only fences, verbose comments;
  net deletion, no behavior change.
  [change](changes/archive/cross-output-drag-preview.md)
- P2 | Live sibling reflow while dragging | Deferred, not light (est. several
  hundred to ~1,000 lines, write-fighting risk); research done.
  [research](research/drag-and-drop-reorganisation.md)
- P2 | Robust difference reconciliation | Scope decided (user, 2026-09-28):
  (1) event/next-command detection only, no polling (revisit after testing);
  (2) learn size limits only from settled repeatable evidence; (3) replan
  neighbours around learned limits only, native maximum behavior unchanged;
  (4) KWin script and Rust tiling only, native effect unchanged. Added
  complexity must deliver more value than it costs. Phase 1 (shared
  foreground/hidden classifier, refresh classification logs) passed the
  user's laptop live test at `062d707` (2026-09-28, "felt good and minimally
  janky"; trace `~/Downloads/plasma-auto-tiler-dev.uE1S5n.log`). Quiet
  refresh outcomes were ~60% of refresh log lines. Phase 2 (learned limits)
  parked by the user (2026-09-28) after a candidate exceeded the complexity
  rule; preserved on branch `wip/learned-size-limits`; resumes only if the
  P1 Ghostty/output check leaves a genuine client-held limit.
  [record](changes/archive/robust-difference-reconciliation.md)
  [parked](changes/learned-size-limits.md)
- P2 | PID 3568836 SIGABRT (`QKeySequence` D-Bus abort) | Formally open;
  needs sender, method, and fault-stack evidence before attributing it to
  the effect or script.
  [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- P2 | Integrated Plasma feasibility verdict | Establish a safe structural
  verdict; the unsafe nested path stays stopped.
  [change](changes/integrated-plasma-structural-feasibility.md)
- P2 | JavaScript workload evidence | Sustained-workload evidence before any
  native replacement for discrete window management.
  [change](changes/js-workload.md)
- P2 | Grouped-window stability proof | Multi-window Custom Tile stability
  before selecting grouped or tabbed behavior.
  [change](changes/grouped-windows.md)
- P2 | Keyboard-layout support | After initial release; US keyboards only
  for MVP.
  [change](changes/shortcuts.md)
- P2 | Mainstream install path | Target: single mainstream KDE install
  (distro packages built alongside KWin). OBS is a partial fit with a
  proposed Tumbleweed-then-Fedora POC. Needs the user: OBS account/project,
  Fedora release, neon/Kubuntu pursuit, absent-during-upgrade policy, pacman
  repo vs AUR.
  [research](research/distribution-package-feasibility/feasibility.md)
  [OBS](research/distribution-package-feasibility/obs.md)
- P3 | AR6/AR7 workspace model + portable policy in core | Deferred until a
  non-KWin host needs it; current KWin is the "native workspaces" mode.
  Windows and macOS both need project-managed workspaces, so the trigger
  arrives with either port; extraction order and gates are in the
  cross-platform audit.
  [design](changes/architecture-review-ar6-workspaces.md)
  [audit](research/cross-platform-core/extraction.md)
- P3 | Gap-drag anchor | Deferred experimentation incl. gap-0; research complete
  (layer-shell gap surfaces first, KWin input filter fallback; needs a Rust
  split-boundary request).
  [native boundary](decisions.md#native-integration-boundary)
- P3 | Stale branches | Twelve stale branches need explicit user
  authorization before deletion.
  [branches](https://github.com/beefsack/plasma-auto-tiler/branches)
- P3 | Other compositor validation | bspwm, Hyprland, COSMIC runtime
  validation only; pinned-semantics research is not a substitute.
  [comparison](reference-wm-comparison.md)
  [profile research](research/reference-wm-profile-support.md)
- P3 | Artifact publication | KDE Store plus GitHub Release after MVP
  delivery dependencies complete.
  [foundations](changes/archive/delivered-foundations.md)
- P3 | Live workspace-mode switch (post-MVP) | Quiesce, rebuild mapping,
  fresh-adopt without native moves; needs a safe Planner generation
  transition.
  [research](research/live-settings-after-ar15.md)
- P3 | Post-MVP tiling profiles | Re-expose `shortcutProfile` with distinct
  catalogs and live switching when adding new tiling types.
  [change](changes/shortcuts.md)
- P3 | Tabbed stacks (next after the 0.1 release) | User 2026-10-07: tabs are
  a feature of the most important reference tilers (COSMIC, Hyprland, i3,
  sway), so V-GROUP-STACK leaves deferral and is scheduled as the first
  item after 0.1. User sketch: size stacked windows slightly shorter and
  draw the tab strip with machinery like the group underlay. Matrix
  inputs: R-INS-02, R-GRP-01..03 (closing the active tab keeps the group
  and activates the next tab, 4/4 references), R-DRAG-01, R-COL-06. Risk:
  mouse interaction with tabs across Linux, Windows and macOS may be
  complex; scope keyboard-first if so.

## Future

Unprioritised ideas; not scheduled.

- Windows app-owned fullscreen UX spike: options for exiting/toggling
  fullscreen an application entered itself (user 2026-10-03, later).
  User 2026-10-07 (R-MAX-05, references 8/8 exit without refusal): keep
  the refusal until the spike; explore capturing/retaining window style
  and frame state early (at admission or before fullscreen) so an exit
  can restore without guessing at fullscreen time.
- Windows alternate Game Bar shortcut experiment: keyboard and mouse players
  need a shortcut that opens Game Bar over a fullscreen game (for example
  Xbox voice chat); Start menu and controller access are not enough (user
  2026-10-03, after parity and correctness work).

- Uninstall revert of host settings: reset our overridden KDE settings to
  defaults on uninstall. Parked by the user (2026-09-29) pending research,
  possibly via package manager hooks; no verified per-user hook exists for
  Nix/Home Manager, KDE Store or distro packages. Users can use the
  settings-page Revert buttons meanwhile.
  [research](changes/archive/host-settings-conflicts.md)

## Pending live checks

Items below retain their stated pending scope; dated user confirmations are
recorded separately from unexercised legs. Reference-WM checks test other compositors.

### Reference WMs (user)

- B9 / R-FLT-06 on COSMIC: tiled workspace, intentionally float B, natively
  maximize it, then toggle float off once. Record whether B stays
  maximized over its new tile or is unmaximized then tiled. Decides B9
  before Windows drops its refusal.
  [row](spec/reference-outcomes/floating.md)

### Single-output laptop

- KDE Q2 R-SPC-04/06..13 (offline delivered, D1-D8 PROVISIONAL): open a
  fixed-size ordinary client beside a tile; record unchanged incoming frame,
  focus and stacking, including a fixed borderless game. Check single-axis
  clients tile, equal partial-zero clients float, unset/full-zero/sentinel
  hints do not auto-float. Gain/lose fixed hints after admission without
  changing float identity. Meta+G tiles an automatic float and stays tiled
  through minimize/restore, workspace/output observation and domain re-adoption;
  new client/ref and owner restart recompute. Sticky origin commands retain
  their prior semantics. Fixed born-maximized stays floating beneath native
  maximize; float workspace -> tiled while still maximized reserves a Q3
  slot, native unmaximize lands there. Born-fullscreen exits tiled, prior
  fixed-floating fullscreen restores floating; no writes while fullscreen.
  Workspace enable retiles automatic only; intentional/sticky controls stay.
  Foreground/hidden startup and correlated classification/admission/terminal
  logs need native verification. [Record](changes/archive/fixed-size-admission.md),
  [live guide](live-kwin-testing.md). No Q2 live result claimed.
- KDE R-WS-08/11 item 1: user reported "worked perfectly" on a SINGLE output
  (2026-10-07); single-output native journey confirmed. The report did not
  specify individual edge/>9 cases or which presets were exercised.
  Remaining: multi-output per-output/shared scope, hotplug/return (R-WS-15..17),
  and preset-specific checks. Verify Authentic's confirmed Apply/Force clears stock KWin "Switch One
  Desktop to the Left", "Switch One Desktop to the Right", "Switch One
  Desktop Up", and "Switch One Desktop Down" holders; Compatible disables our
  four arrows while letters/Tab work, stock holders remain unchanged on a
  fresh baseline, and Revert restores defaults after earlier clearing.
  [Offline record](changes/archive/kde-workspace-history-ring.md),
  [live guide](live-kwin-testing.md).
- KDE R-WS-01/14 item 2 (offline delivered): physical relative send-follow
  Meta+Ctrl+Shift+H/K/Left/Up previous and J/L/Down/Right next. Check both-end
  wrap, >9 and trailing-empty fill/new spare, including a sole mover emptying
  the source. Rebind numbered/append and relative send-and-stay from their
  empty defaults: source remains selected, source tiled MRU gets focus,
  destination not selected; check empty-source native focus separately.
  Floating-boundary default send now follows; explicit stay keeps source,
  floating frames unchanged and only tiled sides reflow. Verify Authentic
  Apply/Force clears stock "Window One Desktop to the Left/to the Right/Up/Down"
  holders; Compatible disables our four arrows, keeps letters/stay rebindings;
  Revert restores cleared defaults. Multi-output relative-ring scope remains
  user-owned. [Record](changes/archive/kde-workspace-send-follow-stay.md),
  [live guide](live-kwin-testing.md). No item-2 live result claimed.
- KDE R-MOV-03 item 3 (offline delivered): toggle Same-axis move in KCM
  between Cosmic wrap and Flat swap. In an N-ary group, move an interior
  leaf toward a direct leaf sibling: wrap creates the nested pair, flat-swap
  exchanges windows with unequal shares traveling and focus on the mover.
  Verify Save live reread without controller/session restart, including
  switching back on an existing tree; no tree rebuild on setting change.
  Check a group neighbor and group-end move retain existing rules.
  [Record](changes/archive/same-axis-move-setting.md),
  [live guide](live-kwin-testing.md). User-owned; no item-3 live result claimed.
- R-DRAG-08 on KDE: with A focused, Meta+left press on unfocused tiled B,
  move, release at A's edge; record whether B is focused at press, during
  the hold, or only after drop (decision: focus at press).
- KDE Q3 born-maximized overlay (`9b612be`) and B6 origin+minimum
  (`cf6ab31`): steps in
  [Q3 record](changes/archive/kde-born-maximized-overlay.md) and
  [B6 record](changes/archive/kde-minimum-origin-placement.md).
- KDE R-MAX-03 Q3 scope: on a floating workspace, first observe maximized A
  without a tile slot beside ordinary B. Toggle the workspace tiled: A stays
  maximized over a reserved slot, B takes its allocated share. Natively
  unmaximize A: it lands in that slot; repeat maximize/unmaximize and confirm
  quiet settlement with no unsolicited toggles or geometry fighting. Repeat
  with a session-restored maximized A at a user-owned session boundary; no loop.
  [Scope record](changes/archive/kde-maximized-floating-retile-overlay.md),
  [live guide](live-kwin-testing.md).

- Tray workspace toggle: floating/tiled toggling confirmed live by the user
  (2026-09-29). Remaining: default change logs `stage=persist
  ... outcome=written`, `plan:config-reloaded stage=default-tiled`, applies
  to new workspaces and to all workspaces after a session restart;
  cross-boundary send is a native move with tiled-side reflow. Red flags:
  geometry changes while floating, menu check disagreeing with KWin, re-tile
  without confirmed release, `native-failed` sends, a physical key bound to
  the keyless action.
  [change](changes/archive/tray-workspace-toggle.md)
- Active border skips Plasma applet popups (user option A, 2026-09-29;
  KRunner out of scope for now): with an ordinary bordered window active,
  opening the Application Launcher or a tray popup hides the border and logs
  `active-border:visible vis=0 reason=applet-popup appletPopup=1`; closing
  it and refocusing restores `vis=1 reason=eligible appletPopup=0`; ordinary
  dialogs and tool windows keep the border. Red flags: border on the
  launcher, `appletPopup=0` while the launcher is active. If more shell
  surfaces still get the border, tighten further.
  [decision](decisions.md#native-active-border)
- Host settings Revert and tray conflict indicator: Fix confirmed live by the
  user (2026-09-29). Remaining: Revert removes the local key and native edge
  previews return (one `op=revert setting=<key> outcome=ok reason=ok` line
  per click). Tray (fresh session): with a conflict, a `dialog-warning`
  overlay on the icon and a top "Conflicting KDE settings..." menu row that
  opens Settings; Fix clears both without a tray restart and logs one
  `outcome=conflict-updated conflict=false`; Revert brings them back with one
  `conflict=true`. Red flags: stale overlay/row, repeated conflict lines on
  heartbeats, left-click no longer opening the menu, snapshot-loss
  `NeedsAttention` changed.
  [change](changes/archive/host-settings-conflicts.md)

- Confirmed live by the user (2026-09-29): tiling gap Save re-spaces tiles
  without restart and the unified settings page shows everything (closes the
  P0 settings live-application launch blocker); group underlay survives
  workspace switches and `just dev` restarts, its settings apply live and it
  slides with workspace transitions; a plain drag released off-screen
  retiles correctly with no `snapshot-invalid` (trace `H28tD1`); mid-drag
  workspace send now tiles the mover on its destination (after `8be1a32`).
  Maximise and fullscreen hide the underlay; tray Settings and Desktop
  Effects Configure open the unified page. KWin Scripts Configure is not
  listed under `just dev` (script loaded from the worktree, not installed);
  verify with an installed package when available.
  [settings](changes/archive/unified-settings-page.md)
  [underlay](changes/archive/group-underlay-and-preview-colors.md)
  [mid-drag](changes/archive/mid-drag-destination-recovery.md)

- Quiet refresh logs: compare `stage=refresh terminal=quiet` under normal
  and trace logging; non-quiet terminals stay visible in both. (Unfloat
  placement and the duplicate-implementation unification were confirmed live
  by the user on 2026-09-28.)
  [change](changes/archive/unfloat-admission-axis.md)
- Same-output drag drops + preview overlay: user confirmed live at
  `826b233` (2026-09-28) that a paused drag stays under the pointer, the
  preview renders well and drops place correctly. Remaining: overlay
  independent of the Meta outline, Esc/cancel/no-Finished clearing.
  [change](changes/archive/cross-output-drag-preview.md)
  [policy](changes/archive/drag-drop-reorganisation.md)
- Drop-intent edge drag leftovers: tiled Meta+left snap-back, Esc/zero-move,
  size-increment client, and the `p13` 36 px bottom-edge shortfall.
  [follow-up](changes/archive/passive-press-move-snapback.md)
- Convergence step-1 leftovers: close/reopen focus, transient unreadable
  frames, minimize/fullscreen/maximize restoration, rapid commands (sticky /
  Meta+G cross-workspace already confirmed live).
  [change](changes/archive/observation-convergence.md)
- Resilience batches: empty-login open, resize completion, Meta+M; group
  bridge demarshalling, modifier/render delivery and performance, including
  outline after config change and close/reopen; endpoint
  `stage=failed`/`available=1` transitions; tray status current.
  [change 3](changes/archive/resilience-change-3.md)
  [change 4](changes/archive/resilience-change-4.md)
  [audit](changes/archive/resilience-audit.md)
  [sweep](changes/archive/fail-closed-sweep.md)
  [bridge](changes/archive/active-group-highlight-design.md)
- Tray icon and login/autostart: confirm panel presence and the worktree tray
  lifecycle under `just dev`; no tray launcher existed in the earlier report.
  [audit](changes/archive/resilience-audit.md)
- Tray Active status under `just dev` (worktree tray): healthy shows Active,
  snapshot loss shows NeedsAttention. Systemd unit checks need a packaged
  Home Manager install: login starts one tray; killing it restarts it; a
  second invocation exits cleanly; logout stops it without a loop; `just dev`
  preserves the packaged owner; tray diagnostics appear once each in
  `journalctl --user` (native journald submission removed).
  [change](changes/archive/tray-and-restart-followups.md)
- Process-loss and sleep recovery cases on the laptop.
  [live plan](changes/archive/recovery-process-sleep-audit.md#live-test-plan)
- Native border delivery and suppression: fresh-session plugin discovery,
  border rendering, and oracle endpoint; fullscreen/any-maximise suppresses
  both outlines; active-border disappearance gets a fresh combined trace if
  it recurs.
  [diagnostics](changes/archive/active-border-visibility-diagnostics.md)
  [decision](decisions.md#native-active-border)
- Sticky adoption restart/re-enable: already-sticky window becomes a normal
  float on the current workspace, then tiles on the next toggle.
  [decision](decisions.md#window-and-workspace-behavior)
- Non-visible workspace tiling: hidden startup/open/move with unchanged
  native focus/desktop and no rendered-state claim.
  [record](changes/background-tiling.md)
- Reliability gates: fullscreen residual-cost gate plus gaming cost baseline,
  maximize-admission clear gate (session-restored maximized app restores,
  tiles, no re-maximize loop), work-area projection gate (resolution/scaling/
  work-area change incl. fullscreen isolation and restoration).
  [investigation](changes/reliability-condition-investigation.md)
- Custom Tile manual runtime check: separately authorized run with exact
  restoration.
  [change](changes/custom-tile-runtime.md)
- Nested placement visual smoke: occupied-leaf whole-rectangle preview and
  nested split placement.
  [change](changes/archive/nested-placement-affordance.md)
- Tray live/release acceptance: KWin-owner snapshots, watcher ordering,
  login/autostart, update/rollback.
  [change](changes/archive/architecture-review-ar13-tray.md)
  [carrier](changes/archive/tray-carrier.md)
- Drag-oracle post-fix proof: rebuild/new session with committed resizes,
  8 px gaps, one planned-applied result, no immediate reconcile.
  [decision](decisions.md#production-interactive-edge-drag)
- Startup adoption recursive-cut fit (user decision 2026-09-29, replaces the
  near-strip fit): user confirmed live (2026-09-29) it works really well
  restarting over a previously tiled workspace. Remaining: confirmed
  Planner-loss fresh session. The centre-split fallback for overlapping
  windows was superseded by `2c918d3` (2026-10-03): such fits now decline
  to sequential long-edge seeding; check that overlapping windows seed a
  long-edge chain and clean tiles keep their fit (KDE fixtures added in B5).
  [record](changes/placement-aware-startup-adoption.md)
- KWin controller silent unload (diagnostic only): attribute only with
  before/after `isScriptLoaded`, exact `Script<ID>`, and KWin PID/start
  evidence if it recurs.
  [protocol](live-kwin-testing.md)
- Correlated observability live capture: whole-system lifecycle coverage
  and live capture unproven; per-route offline diagnostics shipped.
  [coverage](changes/archive/observability-coverage-assessment.md)

### Multi-output PC

- KDE item 5 R-MOV-08/R-OUT-04 (offline delivered, needs two outputs): stack
  outputs vertically; Meta+Shift+Up/Down crosses after local swap/restructure/
  escape is exhausted, including a sole window. Add a panel work-area gap:
  full rectangles still select the neighbor, tiles stay inside work areas.
  Horizontal Meta+Shift+Left/Right still works, including sole windows;
  no candidate stays put, ambiguous topology refuses. Meta+Ctrl+Alt+arrows/
  HJKL sends before local exhaustion to the target's CURRENT workspace and
  follows the mover; rebind directional output-stay from empty defaults and
  verify source selection/MRU focus and ordinary remembered-leaf admission.
  Check membership-only floating boundaries with only tiled-side reflow.
  [Record](changes/archive/four-direction-output-transfer.md),
  [live guide](live-kwin-testing.md). User-owned; no item-5 live result claimed.
- Core extraction K1 visual policy: laptop confirmed by the user
  (2026-09-30: active border, fullscreen/maximise suppression, group
  underlay, drag preview). Remaining: border, underlay and preview remap
  correctly across outputs with differing scales/origins.
  [change](changes/archive/portable-core-k1-visual-policy.md)
- Born-fullscreen dogfood: game fullscreen beside tiles (no gap,
  `initial-fullscreen-held`), exit (fresh tile, `initial-fullscreen-released`),
  re-enter/exit (slot retained); optionally close before first exit.
  [change](changes/archive/born-fullscreen-admission.md)
- Directional + shortcut + convergence re-test: shortcut Apply/Force/Revert per
  [shortcut plan](live-shortcut-override-verification.md) (Lock Session
  relocation, Revert, Phase-2 resize chords insofar as not covered there),
  then the observation-convergence steps 2-3 list (startup fit; open/close
  foreground and hidden; float/sticky/maximize/fullscreen restore; gap
  reload; displaced return; hidden admission; sends incl. rapid;
  refusal/close; R4 occupied/empty/failed; follow-once; phantom revisit;
  correlated logs).
  [contract](changes/shortcut-override.md)
  [failures](changes/archive/multi-output-failures.md)
  [snapshot](changes/archive/multi-output-directional-snapshot.md)
  [convergence](changes/archive/observation-convergence.md)
- Cross-output drops at the pointer: occupied and empty destinations (incl.
  native-output lag), source membership removal, preview/drop agreement at
  group edges, center snap-back with hidden preview, wrong-output and refusal
  recovery.
  [change](changes/archive/cross-output-drag-preview.md)
- KWin restart with surviving Planner: all-new window IDs fresh-adopt
  spatially per output (no ID-order rebuild), tray status recovers; script
  reload with shared IDs keeps groups/splits.
  [change](changes/archive/tray-and-restart-followups.md)
- Reconciliation phase 1 (PC): hidden and sticky domains stay quiet without
  ping-pong, unreadable outputs imply no departure, stale replies ignored,
  immediate/delayed send/R4 follow and forced refresh.
  [record](changes/archive/robust-difference-reconciliation.md)
- Process-loss and sleep recovery cases on the PC.
  [live plan](changes/archive/recovery-process-sleep-audit.md#live-test-plan)
- Output hotplug displacement/return: disconnect preserves layouts per
  surviving monitor; reconnect returns workspaces with current contents;
  explicit moves stay at their destination.
  [investigation](changes/reliability-condition-investigation.md)
- Multi-output workspace anti-oscillation: trailing-empty behavior on the
  multi-output machine.
  [runbook](live-oscillation-verification.md)
- Native dev lifecycle removal/dogfood coexistence: removal and
  dogfood-coexistence refusal unverified (startup/discovery already
  accepted).
  [record](changes/archive/native-dev-setup-lifecycle.md)
  [host builder](changes/archive/host-matched-native-development-builds.md)

## Open user decisions

- OBS POC inputs: OBS account/project, GitHub PAT/webhook wiring, Fedora
  release, neon/Kubuntu pursuit, absent-during-upgrade policy, pacman repo
  vs AUR.
  [OBS](research/distribution-package-feasibility/obs.md)
  [research](research/distribution-package-feasibility/feasibility.md)
- Gap-drag gap-0 behavior: deferred experimentation; choose whether a zero-gap
  layout exposes a drag anchor before prototyping.
  [native boundary](decisions.md#native-integration-boundary)
- Borderless-windowed fullscreen heuristic (born-fullscreen option 3): only
  if dogfooding shows games arriving non-fullscreen.
  [change](changes/archive/born-fullscreen-admission.md)
- Navigation/movement while maximised: no suppression policy selected;
  semantics await the user's COSMIC comparison.
  [decision](decisions.md#cosmic-movement-and-groups)
- Windows Win+F11/Win+G containment (parked): accept the gap, user turns
  off Xbox mode in Windows Settings (recommended first), or authorise
  registry/policy writes or a dedicated hook thread.
  [record](changes/windows-gaming-coexistence.md)
- Windows taskbar workspace indicator (parity 10): presentation design.
- macOS Phase 0: host model and macOS floor, Intel support, stable signer,
  Meta mapping. [plan](research/macos-port/plan.md)
- Reference consensus differences (functional specification line above):
  the 12 new 2026-10-07 recommendations were accepted (see "Adopt
  reference-consensus additions"); R-WS-01 decided 2026-10-07 (keep
  follow default, add send-and-stay) and R-MOV-03 (COSMIC wrap default,
  configurable); rule: COSMIC stays default unless references agree
  extremely strongly against it, with the alternative configurable unless
  only one outlier or only scrolling WMs differ; R-FLT-05 folded into
  R-RST-01; R-MAX-05 kept for a Future spike; R-MAX-07 Windows inference
  kept (gaming); R-MIN-01..03 B6 kept (overlap is a last resort); the
  R-DRAG-04 Esc cancel kept (setting maybe later); R-GRP-03 tabs scheduled
  after 0.1; R-DRAG-07 host-native drag presentation (Windows Win+drag
  stays stationary); R-DRAG-08 focus at press. Table A rows decided
  except R-FLT-06, which waits on the user's COSMIC B9 check;
  R-FLT-09 is already planned Windows parity.
- Live-test environments for the 508-cell matrix queue
  ([proposal](research/live-test-vms/proposal.md), revised 2026-10-07 at
  the user's request): one shared per-WM definition (packages with
  optional pinned-source override, profile config, fixture clients,
  observation helper) feeding two run modes: A nested on the host Plasma
  session (Wayland WMs as a nested window, X11 WMs in Xephyr; KWin
  "Ignore global shortcuts" rule for Super) and B lean `build-vm` VM
  sharing the host store (multi-output, hotplug, real sessions). User
  prefers A, switching to B when needed. Reasoned estimates, unmeasured:
  A first slice 1.5-3 GiB store growth (all WMs ~6-15 GiB); B adds ~1-3
  GiB plus sparse 4-8 GiB disks. Nested launches unverified at runtime.
  First slice (user 2026-10-07): i3, sway, bspwm plus COSMIC and Hyprland
  (very important to the project), nested mode A first, VM mode B for
  multi-output/hotplug rows. Queue: i3 13, sway 18, bspwm 19, COSMIC 29,
  Hyprland 37 cells. COSMIC/Hyprland nested runs are GPU-heavier and their
  nested multi-output is unestablished. Not started (document only);
  implementation needs a go-ahead.
- Review of 2026-10-03/04 autonomous provisional choices (all marked
  "Provisional, to discuss" in [decisions](decisions.md)): mise rolling
  versions, Windows settings/tray/presets, drag producers,
  sequential startup seeding, KDE conflict controls.
- Review of 2026-10-08 autonomous provisional choices (all marked
  "Provisional, to discuss" in [decisions](decisions.md), not user decisions):
  Q2 D1 whole-vector equality incl. partial-zero and sentinel exclusions,
  no resizeable inference; either-axis Hyprland-Wayland/sway alternative
  reviewable, setting deferred. D2 admission-only hints; D3 same-live-client
  tile/sticky overrides; D4 fixed-floating base under maximize explicitly
  touches the Q3 boundary, non-fixed Q3 and R-MAX-03 retile unchanged;
  D5 born-fullscreen tiled exit vs prior-float restore; D6 workspace enable
  retiles automatic only; D7 startup/restart recompute without tile-override
  persistence; D8 membership-only no geometry/focus/stacking/keep-above writes.
  Shared/KDE delivered offline, native checks/Windows item 13 pending;
  [record](changes/archive/fixed-size-admission.md).

## Known issues and risks

- PID 3568836 SIGABRT (`QKeySequence` D-Bus abort) unattributed; needs
  sender, method, and fault-stack evidence.
  [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- Whole-snapshot `window-out-of-bounds` rejection removed offline
  (2026-09-29); observed out-of-work-area frames are now tolerated drift.
  Watch for any regression where a genuinely foreign window is tiled.
  [change](changes/archive/mid-drag-workspace-recovery.md)
- Ghostty-class shortfalls (~56 px) have no proven native cause; interim
  acceptance can leave a visible gap or reassert the accepted rect when a
  neighbour drifts.
  [bounds fix](changes/archive/multi-output-domain-bounds.md)
  [drag investigation](changes/window-alignment-drag-investigation.md)
  [record](changes/archive/robust-difference-reconciliation.md)
- Sticky pager appearance and Ghostty fullscreen-to-maximise on workspace
  return remain unconfirmed; no native cause or workaround established.
  [behavior](decisions.md#window-and-workspace-behavior)
