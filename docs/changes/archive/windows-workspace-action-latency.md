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
- Initial live work was held for fullscreen clearance; the user subsequently
  authorized the scoped plan. Scope: owned helpers and Notepad/Calculator/Paint
  only, never unfiltered normal-mode tile.
- Later evidence must show action-correlated geometry before the action returns,
  source reflow and destination convergence, plus graceful recovery. End with
  no project actor/ledger/hidden window, arranging raw 1 and pen raw 35.

## Bounded units

1. Offline log/code diagnosis (accepted).
2. Smallest safe synchronous-path fix, timing and portable regressions.
3. Fresh independent mutation/safety review and offline verification.
4. Scoped desktop verification and records (accepted): helpers and ordinary-app
   journeys pass; physical latency usability accepted by the user.

## Accepted diagnosis, 2026-10-02

- Baseline HEAD e3e0c32, clean tree. Trace: `run-01dd520d16c9a125.log` (product session log).
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

## Authorized desktop evidence, 2026-10-02

- User closed the fullscreen app and authorized helper then scoped ordinary-app
  journeys, including their existing graceful/exact-owner forced-loss recovery.
  Baseline HEAD 06f9d8d (user committed the latency fix), clean tree.
- Helper first attempt failed:
  `target/windows-workspace-proof/20261002-133800-12496/workspace-report.json`.
  Send act-7 wrote source and destination before its terminal summary in 113 ms,
  with verified focus and no veto. The exact target oracle found requested width
  2544 versus observed 2545; startup half-height helpers also read one pixel tall.
  Legacy helper creation was DPI-unaware, unlike the PMv2 owner and the existing
  physical geometry fixture. No tolerance policy or production fix was added.
- One mechanical fixture correction launches all four helpers through existing
  passive PMv2 creation, then identity-bound nonactivating show and fresh inspect.
  Register ownership before show; record actual DPI. All original identity,
  scope, recovery and exact zero-mismatch geometry gates remain unchanged.
- Helper retry passed:
  `target/windows-workspace-proof/20261002-134957-12760/workspace-report.json`.
  Four helpers report DPI 120. Windows 11 build 26200, one display; owner SHA-256
  `4F28BE3D71952554E479493062F15C0AAD24EBCCFC824F6863D754C2E369FD83`,
  helper `5A60A47003631BC140737C1EF41161C899ECCB354F1BF1F6FABAF093656777FF`.
  Main owner log: `session-1/run-01dd522118e75e58.log` under local app data.
- Queue-inclusive action completion is queue_wait_ms + action_ms, a terminal
  offset after native geometry/readback, not a visual presentation timestamp.
  First send act-9: 118 ms, source/target geometry passes 7/5 ms, hide/reveal
  41/31 ms, focus 20 ms; both sides applied one write, zero mismatch/veto.
  Source return act-13: 103 ms (1 ms queue + 102 ms action), zero new writes,
  target readback matched. Trailing send act-33: 115 ms, source/target passes
  5/6 ms, hide/reveal 32/32 ms. Repeated selects act-36/39/41: 47/51/46 ms.
  Empty trailing select act-19: 47 ms, zero writes, no focus. These are measured
  same-action effects; later periodic reconcile is not credited as success.
- Scoped ordinary-app invocation blocked before owner launch:
  `target/windows-workspace-normal/20261002-135108-20552` contains only payload
  copies, no report/log or live owner. Assert-ApprovedEligible rejected an
  eligible steamwebhelper.exe/SDL_app window. No scope expansion, retry,
  Steam/Terminal/Firefox mutation or ordinary-app latency claim followed.
- Fresh retry gates passed: locked stable four-package build/test, strict
  all-target clippy, fmt-all, both PowerShell parse/Mock checks, affected Just
  dry-runs, existing helper argument tests and diff whitespace.
- Both helper attempts recovered. Successful graceful/forced-loss cycles kept
  original minimized/maximized show state, then normalized/closed owned helpers.
  Final report says actors absent, ledger clean, arranging 1, pen 35. Independent
  final read-only Lead probe also reads zero project actors, arranging raw 1,
  pen raw 35; no ledger/stop/workspace-request remains. The historical zero-byte
  ledger.lock is a lease file, not recovery residue. Approved apps remain visible,
  unminimized and unmaximized; nothing project-owned remains running.
- Preflight command error: the first Worker accidentally invoked windows-dev.ps1
  bare, launching its non-tiling dev owner. Verified stop/restore removed it
  before the helper run. Source confirms that default launches run, not tile;
  subsequent Workers used parse/Mock only. No unfiltered tiling was launched.

## Ordinary-app completion, 2026-10-02

- After the user closed Steam, the first fresh invocation of
  `just --justfile windows.justfile workspace-normal -Live` passed. No harness
  correction or retry was needed. Report:
  `target/windows-workspace-normal/20261002-140357-7364/workspace-normal-report.json`.
- Revision remains 06f9d8d, with the three prior staged fixture/record changes
  preserved. Windows 11 Pro build 26200; owner/helper hashes match the successful
  helper proof above. The normal script supplied its explicit Notepad, Paint and
  Calculator host/child scope, with bounded 240-second owners.
- Owner logs under local app data `plasma-auto-tiler/session-1/`:
  `run-01dd52230cef7a77.log` (graceful) and
  `run-01dd5223150ae362.log` (forced-loss).

| Action | Correlation / log line | Completion ms | Target geometry ms |
| --- | --- | ---: | ---: |
| Select 2 | act-6 / graceful L32 | 103 | 4 |
| Select 1 | act-11 / graceful L49 | 124 | 6 |
| Minimized-app hide | act-24 / graceful L98 | 72 | 4 |
| Minimized-app reveal | act-28 / graceful L111 | 96 | 5 |
| Forced-cycle hide | act-5 / forced L25 | 105 | 4 |

- Five actions complete in 72-124 ms; queue wait is zero throughout. Each has
  same-action target reconcile/readback before its terminal summary, zero veto,
  zero mismatch and zero additional geometry writes. These select checks confirm
  already-converged frames, not fresh send reflow; the helper proof covers writes.
- Graceful stop/independent restore and exact-owner forced-loss/watcher reveal
  both pass. Calculator's minimized state survives hide/reveal; Terminal stays
  visible outside scope. Admission and exact-tag close of the owned helper pass.
- Final report and independent Lead read-only probe agree: zero project actors,
  no ledger/stop/workspace request, arranging raw 1, pen raw 35. All three approved
  HWNDs still match their recorded PIDs and are visible, unminimized and
  unmaximized. No hidden test window remains.

## Physical dogfood evidence, 2026-10-02

- User reports very low latency, successful physical workspace select/send/follow
  and successful click-drag resizing. This is user visual/usability acceptance.
- Read-only source: `run-01dd52224782f10c.log` (product session log).
  Six correlated down-edge action summaries carry successful native focus and
  action-path geometry/readback, with zero queue wait and no source/target veto.

| Action | Correlation / line | Completion ms | Source geometry ms | Target geometry ms |
| --- | --- | ---: | ---: | ---: |
| Send | act-15 / L69 | 236 | 9 | 7 |
| Select | act-19 / L81 | 204 | - | 7 |
| Select | act-34 / L139 | 171 | - | 5 |
| Select | act-36 / L147 | 174 | - | 7 |
| Select | act-56 / L244 | 180 | - | 4 |
| Send | act-59 / L261 | 241 | 4 | 35 |

- Completion is `queue_wait_ms + action_ms`, the owner-side terminal offset after
  native geometry/readback. `action_ms` alone excludes queue wait; the sum equals
  it in these samples. It is not a physical key-to-presentation timestamp.
  Selects span 171-204 ms, sends 236-241 ms; transitions span 155-210 ms.
  Select source passes did not run (null), rather than applying zero geometry.
- Four of six actions report geometry mismatches despite readable readback:
  act-15 source 1, act-19 target 1, act-36 target 1, act-59 target 2. L257 shows
  requested widths 500/915 versus observed 864/1263 for two opaque windows.
  This is consistent with app-size clamping; the trace does not map those tokens
  to executable identities, so app-specific cause is not established.
- There is no separately labelled follow action sample; user follow acceptance
  and the existing helper journey remain the evidence for that behavior.
  Six pointer-resize ticks (99, 103, 110, 117, 121, 159) also record applied
  geometry with 1-3 mismatches. No exact-frame resize acceptance is claimed.

## Outcome and residuals

- Complete: portable/native offline gates and independent fix review accepted;
  same-action helper source/destination write proof, scoped ordinary-app timing
  and both recovery paths pass; user accepts physical latency usability. Archive
  this note and resolve the latency backlog item.
- Paint/app minimum-size overlap, multi-monitor/mixed-DPI, fullscreen-app live
  acceptance and hosted CI publication remain separate. The 35 ms physical
  target pass has no measured causal breakdown. Old one-second duration split
  cannot be reconstructed; present figures do not measure rendered presentation.
- Original fix is user-committed as 06f9d8d. Fixture correction remains preserved
  for staging with these records. No new commits or pushes. Proposed message:
  `Verify Windows workspace latency with DPI-aware helpers and ordinary apps`.
