# Hidden-workspace Alt+Tab research

Status: complete, 2026-10-04. Research published as `580c766`; all six hosted
CI jobs passed. This archive is evidence-only.

## Goal and scope

- Investigate official Windows mechanisms for including inactive managed-workspace
  windows in native Alt+Tab, with taskbar, activation, recovery and anti-cheat
  implications. Compare GlazeWM/komorebi and native KDE desktops.
- Research only: no product design selected, product code or host settings changed.
  Backlog and principles are outside this change.

## Acceptance and approach

- Deliver a concise, source-cited Windows-port research note covering SW_HIDE,
  public DWM cloak, public native-desktop APIs, parking and private ApplicationView
  cloak. Separate documented/source evidence from untested shell behavior.
- Bounded research/draft and correction units, one independent source review,
  then native/documentation verification. Lead integrates evidence and records
  uncovered cross-platform scenarios with unsupported outcomes TBD.
- Prefer primary docs and pinned upstream source; live probing only if needed
  to settle a material fact cheaply within authorized disposable-window scope.
- Verify documentation links/claims and whitespace, run required native gates,
  archive this record, commit/push and require hosted CI green.

## Outcome

- Delivered [research](../../research/windows-port/alt-tab-hidden-workspaces.md)
  comparing five options. No public hidden-foreign-window Alt+Tab inclusion
  contract established; recommend current SW_HIDE omission, with parking only
  a future investigation candidate. No mechanism or public behavior selected.
- Glaze discussion #830's final reply reports global Alt+Tab with taskbar
  retention. Both references switch to a selected hidden window's workspace.
  Private ApplicationView cloak cannot be equated with public DWM app-cloak.
- Added `R-WS-07` and `V-WS-SHELL-ACTIVATE` to the reference matrix: KWin native
  filtering plus activation policy (default switch, alternative pull); future
  Windows inclusion/activation outcomes remain TBD.
- Independent source review rejected draft cloak-exclusion claims, a truncated
  upstream report and conflation of native-desktop API intended scope with a
  documented foreign-HWND access restriction. Final text distinguishes those.
- No new durable decisions to promote. Backlog/principles and product code
  unchanged. No live mutations, probes, opened test apps or reference-clone writes.

## Verification

- Lead inspected primary API docs, the full Glaze discussion, pinned reference
  activation paths and KWin's configured switch/pull activation implementation.
- Native locked build/tests for tiler-core, tiler-protocol, tiler-kwin-effect-ffi
  and tiler-windows, all-package rustfmt and strict all-target Clippy passed.
  Existing Rust 1.98.1 MSVC via `cargo +stable`; mise unavailable, no installs.
- ASCII, local-link and whitespace checks passed; final fact reconciliation
  found no serious gaps. Unsupported runtime outcomes remain explicit.
- No project processes or recovery ledger JSON/pending files; only the ordinary
  inactive ledger.lock file remains. Read-only baseline: taskbar present/visible,
  SPI arranging = 1, pen visualization = 35. No experiment-created hidden windows.
  All four sequential Workers completed; no Worker running.
- Hosted [CI run 37192477029](https://github.com/beefsack/plasma-auto-tiler/actions/runs/37192477029)
  passed Rust, KWin, shell, native, Windows and macOS for `580c766`.
- Proposed backlog outcome: research complete; keep the optional feature
  deferred, with no design selected. Reopen only when demand warrants a parking
  probe or a separately approved native-desktop/private-API architecture change.
- Research implementation next action: none. Physical shell/app compatibility
  checks belong to any future selected implementation, not this survey.
