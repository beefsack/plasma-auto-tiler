# Windows managed workspaces

## Goal and acceptance

- Dogfood-grade project-managed per-output-local workspaces, matching the KDE
  default and catalog: Win+1..9 selects existing ordinals; Win+Shift+1..9 sends
  only the focused tiled window and follows after verified membership transfer;
  0 reuses or creates the trailing empty target. Standard US shifted symbols
  arrive at the Windows LL hook as Shift plus the same digit virtual key.
- Independent Engine domains preserve each workspace layout and last focus.
  Keep one trailing empty and at least two workspaces; prune empty invisible
  non-final workspaces without discarding occupied or displaced domains.
- Identity-safe write-before-hide, verified reveal on graceful stop, automatic
  recovery after owner crash, and independent restore after exact-owner emergency
  stop. Preserve helper-only proof gates, medium-integrity and session fences.
- Bounded structured observability, portable KDE-reference policy fixtures,
  single-monitor owned-helper and approved ordinary-app automated evidence,
  independent mutation/recovery review, standard gates and hosted CI.
- Multi-monitor behavior is implemented conservatively but physical acceptance
  belongs to the other Windows test system. Indicator/tray, visuals, proper settings UI,
  Win+L, games and secure desktop remain outside this change.

## Approach and bounded units

1. Survey: accepted. Existing Engine already owns independent (output,workspace)
   sessions. KDE numbered catalog is workspaceShortcutCatalog in
   kwin/src/workspace-native.ts, beside planShortcutCatalog for directions.
2. Public hiding and recovery: choose SW_HIDE with nonactivating reveal. Extend
   ordinary-window lifetime identity without relaxing helper gates; commit before
   effects. Add owner-death recovery so a crash cannot strand hidden windows.
3. Narrow portable select/trailing/cleanup policy with KDE-reference fixtures,
   then product owner domain/membership, select/send/follow and hook dispatch.
   Do not migrate KDE's synchronous TS authority or invent a platform trait.
4. Fresh independent native-mutation/recovery review, then live verification with
   helpers followed by authorized Notepad/Calculator/Paint. Preserve Terminal
   access and leave all test apps visible, unminimized and unmaximized.
5. Final current-tree gates, durable decisions, outcome/evidence and P0 update;
    archive on completion; hosted integration CI follows publication.

## Material choices and verification

- SW_HIDE is public and already helper-proven; minimize conflates workspace and
  user minimization, parking leaves mapped offscreen shell entries and changes
  geometry, and foreign DWM cloak lacks a supported public authority. Record
  actual shell behavior and external-activation feasibility from live evidence.
- Process creation identity alone cannot distinguish same-process HWND reuse;
  ordinary recovery must additionally bind a window-lifetime property, checked
  before and after every hide/reveal and removed only after verified release.
- Graceful product teardown reveals its hidden claims. Legacy bounded Phase 1
  proof semantics may still leave hides for independent restore. Recovery state
  is deleted only after verified release; no geometry recovery is introduced.
- Native gates: locked stable four-package build/test, strict all-target clippy,
  fmt-all, changed PowerShell parsing/mock checks, Just dry-runs, whitespace.
  Hosted Linux/Windows CI verifies portability. Receipts bind source/artifact,
  exact actors/targets, display baseline, effects and restoration readbacks.
- Automated injected evidence does not establish physical shortcut, Start,
  Task View or Alt+Tab visual acceptance. Final desktop raw arranging must be 1
  and pen visualization 35, with no actors, ledger or hidden windows remaining.

## Accepted recovery milestone, 2026-10-02

- Ledger v3 distinguishes helper claims from ordinary product lifetime nonces;
  v1/v2 helper ledgers remain readable, older readers refuse v3. Product hides
  commit the verified claim before ShowWindowAsync, then pump and check native
  visibility and exact identity. Reveal uses an identity-only recovery path so
  changed application state cannot defeat release.
- Same-executable watcher verifies exact owner/watcher identity before each hide,
  waits for owner death and restores under the same held ledger lease. Product
  graceful teardown reveals first, then stops its watcher. Helper proof gates
  and legacy Phase 1 independent-restore semantics remain intact.
- Independent mutation/recovery review found one uncommitted-nonce cleanup gap;
  fixed with fresh ledger and process/nonce checks before conditional removal.
  Detached setter threads and admission-based recovery exclusions were rejected
  during review before live testing.
- Owned visibility fixture passed
  `target/windows-hide-proof/20261002-051801-26124/hide-report.json`: two helpers,
  graceful automatic reveal, repeat admission, forced exact-owner loss with
  automatic watcher reveal, independent restore idempotence, preserved helper
  process/lifetime identity and geometry, no actors/ledger/stop/watcher markers,
  arranging raw 1 and pen 35. Native package tests/clippy/fmt/parse pass.
- First fixture attempt `20261002-051706-33296` safely recovered. Its log oracle
  incorrectly rejected the opaque allowlist digest as a native identifier;
  one causal key-name oracle repair produced the pass. No semantic live failure.
- Recovery fixture is `just --justfile windows.justfile hide-proof`. Ordinary
  apps and workspace dispatch remain untested at this milestone.

## Accepted portable policy milestone

- Dependency-free tiler-core workspace policy resolves existing ordinals,
  trailing-empty maintenance, protected occupancy/visibility/retention and
  minimum-two floors, plus disconnect-time survivor choice. KDE-reference Rust
  fixtures establish these semantics without changing KDE's TS authority.
- Windows session tables retain hidden membership, workspace last focus,
  active-ID-preserving cleanup and whole-workspace displacement/return. Digit
  decoding and hook bookkeeping remain Windows-local; production hook/Engine
  wiring is the next unit. Portable package tests and strict clippy pass.

## Completed outcome, 2026-10-02

- Managed workspaces pass automated acceptance: per-output-local default,
  Win+1..9 select existing only, Win+Shift+1..9 send focused tiled window and
  follow after verified transfer, `0` reuses or creates trailing empty.
  Covered: helper select/send/`0`/shifted aliases/source return, global empty
  select, min/max retained, hidden-window close, external show rehidden versus
  activation, graceful plus forced-owner-loss watcher recovery, and ordinary
  Notepad/Calculator/Paint scoped-mode same recovery. Final desktop arranging
  raw 1, pen visualization raw 35, with no actors, ledger, or hidden windows
  remaining. Physical shortcut/shell visual acceptance, mixed-DPI/multi-monitor
  and games remain user-owned and unaccepted; integration CI runs after the
   user publishes the integration.
- Evidence (every run passes):
  `target/windows-workspace-proof/20261002-112058-31192`,
  `target/windows-workspace-normal/20261002-110618-11672`,
  `target/windows-shortcuts/20261002-110712-26848` (OwnedFocusMove),
  `target/windows-shortcuts/20261002-110750-32160` (OwnedMove),
  `target/windows-shortcuts/20261002-110830-18644` (SpiGraceful),
  `target/windows-shortcuts/20261002-110951-27476` (SpiCrash),
  `target/windows-shortcuts/20261002-111000-35300` (NormalSmoke default-on/off),
  `target/windows-hide-proof/20261002-111030-28332`.
- The final helper forced-loss cycle captures originally minimized and
  maximized targets before hiding, checks their exact v4 ledger show-state
  preimages, and proves both watcher recovery and idempotent independent
  restore preserve those states. Helpers are normalized and closed afterwards.
- Causal repairs: trace `run-01dd51f997869973` showed a physical send at tick
  116 (ws1 to empty ws2) storing target `outer_gap` 0; follow-up reconciliation
  with fixed gap 8 rejected domain-mismatch at ticks 118/119/120/124/128.
  New targets inherit the carried source gap, existing targets preserve theirs;
  the regression covers fixed-gap-8 both-domain geometry. Old poisoned state is
  session-local; restart clears. A transient fullscreen-foreground write veto
  on the source gap (tick 122 onward, recovered 132) is not a persistent Engine
  rejection and not the direct target-gap fix. No physical retest is claimed
  for this repair beyond the listed automated runs.
- Fixture repairs: `103812-3444` occluded-helper directional run, Terminal
  guard prevented the click; owned non-click activation restored the harness.
  `104403-16344` failed a stale edge-single minimized oracle (retained
  membership was correct); replaced with a geometry-proved 3-member true
  edge no-op, full `105001-5452`, then final `110712` pass. `103854-3132`
  stale v2 preimage oracle repaired to v4, then final default/off and SPI
  passes. One mechanical formatting reflow, then clean. Earlier `051706`
  key-name oracle repair stands as prior history.
- Independent review: HWND-reuse stale membership fixed via same-process
  visible lifetime property `OmniTilerMember` plus token reissue;
  effect tag gates; hidden claims carry a separate nonce; scope send runs
  pre-Engine/fresh host-child effect fences; atomic publish no-overwrite
  reviewed and upheld. Uncertainty claims stay durably recoverable.
  Conservative monitor displacement reviewed, physically untested. Recovery
  ledger v4 stores min/max show-state, no geometry; readers accept v1-v3.
- Final gates (current tree): locked four-package build/test
  (tiler-core/tiler-protocol/tiler-kwin-effect-ffi/tiler-windows), fmt,
  strict all-target clippy `-Dwarnings`, PowerShell parse/mock checks,
  Just recipe dry-runs, `diff --check`. Source HEAD `9dce0a2` plus
  uncommitted work; current-run owner SHA-256
  `B7F16E37FACE11037A1C05EC2C909875E141236D35A0E7C4780906567B958A20`,
  helper
  `23B159992BE4D9D4C882264B09E397D997C292FADF0FF7227874EDE61DD66A39`.

## Dogfood procedure

```powershell
just --justfile windows.justfile tile --user-start --trace
just --justfile windows.justfile tile-stop
```

- Unfiltered user dogfood now includes Terminal. Select shortcuts and return
  to the source immediately to observe reflow. Report log/run timestamp,
  chord, apps, from/to, focus, source/destination, latency and min-size
  constraints; do not include raw content. A fresh user launch starts a clean
  session.
