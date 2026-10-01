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
  belongs to the other Windows PC. Indicator/tray, visuals, proper settings UI,
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
   archive on completion, explicit-path commits/pushes and green hosted CI.

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
  during Lead review before live testing.
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
