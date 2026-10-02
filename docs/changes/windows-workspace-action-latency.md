# Windows workspace action latency

## Goal and scope

- Select/send/follow must apply eligible source and destination geometry in the
  action path, without depending on a later periodic reconcile. Preserve native
  identity, lifetime, ownership, scope, observation and fullscreen safety gates.
- Add bounded correlated action, transition and geometry timing, distinguishing
  verified geometry, native refusal and uncertainty.
- Exclude Paint minimum-size replanning, product/KDE policy changes, settings,
  registry/policy writes and unrelated refactors. Do not change principles.

## Acceptance and approach

- Portable regression evidence for both-domain send geometry and guarded
  transition ordering; existing safety/recovery tests remain green.
- Locked native four-package build/test, strict all-target clippy, fmt,
  affected PowerShell parse/mock and Just dry-runs, whitespace checks.
- No live tests authorized yet. After offline gates, return the exact scoped
  desktop plan to the user and await authorization. Later scope: owned helpers
  and Notepad/Calculator/Paint only, never unfiltered normal-mode tile.
- Later evidence must show action-correlated geometry before the action returns,
  source reflow and destination convergence, plus graceful recovery. End with
  no project actor/ledger/hidden window, arranging raw 1 and pen raw 35.

## Bounded units

1. Offline log/code diagnosis (accepted).
2. Smallest safe synchronous-path fix, timing and portable regressions.
3. Fresh independent mutation/safety review and offline verification.
4. Records and scoped desktop plan; live execution awaits user clearance.

## Accepted diagnosis, 2026-10-02

- Baseline HEAD e3e0c32, clean tree. Trace:
  `C:\Users\beefs\AppData\Local\plasma-auto-tiler\session-1\run-01dd520d16c9a125.log`.
- Lines 113-123: send action tick 21 attempts target geometry at tick 23,
  writes zero with fullscreen-foreground veto, then writes at tick 24.
  Lines 196-208: source return/select tick 46 attempts three writes at tick
  47, all vetoed, then converges at tick 48. Directional writes occur within
  the action tick (e.g. lines 92-100).
- Selection currently reconciles geometry before focusing the revealed target;
  send does not apply its Engine source geometry before hiding that domain.
  The precise transient foreground identity is not captured in the old trace.
- No observation-completeness deferrals or domain rejection in this trace.
  Workspace intents wake the 100 ms pump directly; the 2 s fallback does not
  schedule workspace dispatch. Later-tick recovery can still incur fallback
  delay if no wake arrives. Old logs have no clock, so exact latency attribution
  and sequential hide/reveal cost remain unmeasured.
- Prefer correcting effect ordering and consuming the existing source plan over
  arbitrary sleeps/retry budgets or relaxing the fullscreen veto. Keep hidden
  geometry ineligible; source native reflow must occur while safely visible.

## Implemented and offline-verified, 2026-10-02

- Send consumes its existing Engine source plan before hiding the survivors;
  the mover and hidden/retained members remain outside that writable domain.
  Selection establishes verified eligible target focus before geometry. Follow
  reuses that observation/focus instead of enumerating and focusing twice.
- Foreground classification now distinguishes exact public Windows desktop
  handles and valid nonvisible windows from covering apps. Visible fullscreen,
  invalid and unreadable foregrounds still veto. Style-read errors and handle
  invalidation fail closed; focus rechecks fullscreen/elevation before its setter.
  The old trace does not identify its transient foreground, so attribution to
  these corrected cases remains unproven until fresh evidence.
- One correlated workspace-action summary records queue/terminal/transition
  offsets, hide/reveal/observation/focus durations, separate source/target
  planning/geometry durations, opaque domain tokens and native readback/veto
  verdicts. A phase that did not run is null; successful dispatch is not a
  claim of applied geometry. Real vetoes and incomplete observation still defer.
- Native-used portable extraction and eligibility seams cover both-domain send
  plans, hidden/stale exclusion, no-plan replies and desktop/nonvisible versus
  fullscreen/unreadable/invalid classification. Existing recovery suites pass.
- Independent reviews rejected the initial focus guard as insufficient and
  unused test seams, then required style-error/invalidation and no-plan reporting
  repairs. Corrections reviewed and accepted by the fresh verification Worker.
- Scoped scripts now require same-action correlated pass/write evidence before
  the terminal action summary. Helper success requires verified focus, no veto,
  zero mismatch and positive source/target writes on the first changed send;
  source return requires zero additional writes. Ordinary-app success rejects
  vetoes but records Paint clamp mismatches without treating them as this fix.
  The initial readback-only oracle was tightened because vetoed writes can still
  produce a successful observation. Offline synthetic cases prove rejection.
- Current native gates pass: locked stable four-package build/test, strict
  all-target clippy, fmt-all and whitespace. Both changed PowerShell scripts
  parse and Mock passes; functional oracle suite passes 16 cases. Recipe dry-runs
  pass. No live executable, hook, hide, movement or setting mutation was run.

## Desktop plan awaiting authorization

- User clears fullscreen apps before resuming. Read the live testing guide again
  and bind revision/diff, payload SHA-256, exact actor identity, medium integrity,
  display/work areas, approved target preimages and clean recovery baseline.
- Run sequentially:
  `just --justfile windows.justfile workspace-proof -Live`, then
  `just --justfile windows.justfile workspace-normal -Live`.
  Default owner lifetime is 240 seconds per cycle. Helpers use exact frozen
  allowlists; ordinary scope is Notepad, Paint and Calculator's matched host.
  The normal script always supplies explicit executable/host-child filters.
- Helper journey exercises select/send/follow/trailing/source return and
  independent layouts, with action-correlated native geometry and timings.
  Ordinary-app CLI select/hide/reveal checks the same ordering and recovery.
  Existing graceful and exact-owner forced-loss cycles verify watcher restore.
  Hooks and session-only arranging/pen effects are bounded by these owners;
  no registry/policy writes, foreign app actions or unfiltered tile launches.
- Preserve runDirs and reports. Cleanup uses exact runDir stop recipes and
  verified restoration; end with no actors/ledger/hidden window and readbacks
  arranging raw 1, pen raw 35. Stop/report ownership or restoration ambiguity.

## Status and residuals

- Ready for desktop test; live authorization and physical latency evidence
  pending. Leave this note active until accepted desktop outcome.
- Old one-second duration split cannot be reconstructed. Fresh summaries must
  establish whether hide/reveal, observation or focus settling remains costly.
  Portable gates do not prove native DWM/foreground timing or visual latency.
- Paint minimum-size overlap, multi-monitor/mixed-DPI and fullscreen-app live
  acceptance remain separate. Hosted CI remains pending publication.
- No commits or pushes. Proposed message:
  `Fix Windows workspace action retiling latency`.
