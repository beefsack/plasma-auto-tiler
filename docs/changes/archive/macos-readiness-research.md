# macOS readiness research

## Goal and scope

- Prepare for macOS work starting soon: development setup, sourced prior-art
  survey and a concise tentative implementation plan informed by Windows.
- Documentation only; no product code, dependency installation, configuration
  files or live desktop tests. Principles and backlog remain owner-maintained.
- Existing approved goals remain binding; recommendations are not new product
  decisions. Sources must be fetched, with implementation observations and
  unknowns distinguished from platform guarantees. ASCII only.

## Acceptance and approach

- Development runbook covers Apple Silicon, proposed OS floor, native build
  tools, stable Rust, signing/notarization, TCC/reset/identity stability,
  unsigned iteration, optional install routes including mise and hosted CI.
- Prior art covers the requested managers and libraries: APIs, workspaces,
  SIP/TCC, keyboard capture, displays, jank, license and maintenance evidence.
- Plan retains Engine/adapter boundaries and Windows recovery lessons;
  includes native-tiling conflicts, gaming, presets, phases and open decisions.
- Sequential units: survey; development runbook; plan integration.
  Review source claims and diffs, reconcile cross-document intent,
  verify documentation hygiene, archive outcome and check CI.

## Evidence and decisions

- Baseline: main at 57c7950, clean; root guidance, principles, backlog,
  Windows/Cross-Platform decisions and both existing port plans read.
- Windows archive titles reviewed: retained Engine tiling, managed workspaces,
  shortcut slice, minimum sizes, active border, underlay, maximise, fullscreen,
  float/sticky float, latency and send-axis fixes are the parity context.
- No new approved macOS product decisions; open choices will carry explicit
  recommendations in the plan.

## Outcome (2026-10-03)

- Added the native macOS setup runbook and prior-art survey; replaced the
  oversized offline plan with a tentative Windows-informed phased plan.
- Survey source gaps were repaired with raw license and hotkey/API source
  inspection plus dated commit feeds. Hammerspoon's private
  AX-to-window bridge location corrected, TCC resets scoped to the dev bundle, and
  unsupported OS/adoption claims removed. Unknown closed/internal mechanisms
  remain explicit, with no platform guarantees inferred from upstream code.
- Independent read-only review passed with one low-severity Glide commit-feed
  drift finding, corrected. Stock-SIP private APIs, reduced-SIP Dock injection
  and public AX are distinct routes; no advanced mode or new modifier defaults
  selected. No new durable product decisions to promote to decisions.md.
- Native locked build/test/strict all-target clippy and fmt passed for the
  four Windows-built packages; diff whitespace and ASCII checks passed.
  Hosted CI is checked after the docs-only publication and reported;
  no macOS/runtime acceptance is claimed.
- No live desktop testing, dependency installs, product/config changes,
  principles or backlog edits. All sequential units completed.
- Next implementation input: user confirms Mac/floor/architecture, stable
  development identity, modifier mapping and native-conflict intent; Phase 0
  then establishes the host and permission/recovery probes under new scoped
  live-testing authority. Backlog replacement text is in the handover only.
