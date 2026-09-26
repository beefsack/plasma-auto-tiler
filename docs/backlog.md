# Backlog

Only meaningful pending or active work is listed.

Architecture review program: immediate next priority, in listed order. Section
references are to [the review](research/architecture-review/review.md). Verify
each review claim before acting; it was a static sampling review. User
decisions of 2026-09-24 are recorded under
[Architecture Direction](decisions.md#architecture-direction).

- P1 | Multi-output PC remaining re-test | Directional focus/move and
  cross-output focus/move accepted live by the user (2026-09-26, trace
  `~/Downloads/plasma-auto-tiler-dev.rRHFMS.log`) after carrying each
  window against its own output bounds; the earlier `window-out-of-bounds`
  offender was never identified, so an ID-redacted rejection diagnostic
  remains ([record](changes/archive/multi-output-directional-snapshot.md)).
  The accepted trace has one focus timeout and one move stale-scope terminal
  with later commands usable. Still to re-test there: shortcut
  Apply/Force/Revert per docs/live-shortcut-override-verification.md
  (`e69739f`), then the step 2-3 list below.
  [record](changes/archive/multi-output-failures.md)
- P2 | Drop-intent edge drag live cases | Shipped with passive native press
  capture and interim move-drop snap-back
  ([follow-up](changes/archive/passive-press-move-snapback.md)). User manually
  reports (2026-09-24) Meta+right drags, edge and corner drags, and floating
  Meta move/resize "working really well". Not individually confirmed: tiled
  Meta+left move snap-back, Esc/zero-move, size-increment client, and the
  unexplained `p13` 36 px bottom-edge shortfall in
  `/run/user/1000/plasma-auto-tiler-dev.LVkQv5.log`. AR8 remains separate.
- P2 | Drag-and-drop reorganisation | User-approved as a later item
  (2026-09-24). Wire move drops to the existing core placement policy
  (`crates/tiler-core/src/session/ops/drag.rs`: split edges, group interiors,
  snap-back) instead of the interim snap-back. Needs product decisions on drop
  targets and preview before implementation.
- P2 | Hintless drag preview | AR12's preview has no observation and therefore
  projects without size hints; a hinted drop can land at a different rectangle.
  Align preview with drop evidence when drag-preview work is taken up.
- P2 | Live sibling reflow while dragging | User request, not high priority.
  Research: no project per-step sibling writer found in history; the
  remembered behavior is likely KWin Custom Tile native reflow (hypothesis).
  Sound route: throttled read-only Rust projection for preview writes plus the
  existing single finish commit, est. several hundred to ~1,000 lines with
  write-fighting and echo-ordering risk. Deferred as not light.
- P3 | In-drag opposite-edge flicker | User observation, not critical: Firefox's
  right edge briefly follows a left-edge drag then snaps back; Kate icons
  flicker ~1 px. Static check: the project makes no per-step geometry write or
  reconcile during interactive resize; treated as native/client behavior.
- P3 | Gap-drag anchor | Deferred by user (2026-09-24) for later
  experimentation, including the gap-0 behavior decision. Research complete
  (read-only). User confirms Ghostty uses `window-decoration = false`
  deliberately, which removes edge grabs; KWin's default Meta+right-drag
  resize works and reaches the drop-intent path. Gap-drag routes: script cannot;
  effect mouse interception blocks all clicks; plausible first prototype is
  project-owned layer-shell surfaces confined to positive-width gaps, with a
  native KWin input filter as fallback. Needs a Rust split-boundary request.
- P1 | Observed-membership convergence (step 1) | User decision (2026-09-25)
  from the Simplicity review: a complete per-domain observation is
  authoritative for membership and flags; the Engine converges retained state
  to it (remove missing, admit new at normal placement, adopt flag changes)
  while keeping topology, instead of refusing (`partial-observation`) or
  reseeding. First check which KWin states make a window transiently absent
  from the observation. Replaces the exact-match refusal class, including
  the floating-membership skew. Shipped 2026-09-25, additive (about 1,500
  production lines incl. sticky/float fixes). User live-tested generally
  working, sticky/Meta+G cross-workspace fixed and confirmed live. Not
  individually confirmed: close/reopen focus, transient unreadable frames,
  minimize/fullscreen/maximize restoration, rapid commands.
  [change](changes/archive/observation-convergence.md)
- P1 | Observed-membership convergence (steps 2-3) live re-test | User
  go-ahead (2026-09-25) to remove the old paths. Both shipped offline. Step 2:
  automatic foreground and hidden tiling send complete observations via
  `reconcile`; applied baselines and public admit/remove removed. Step 3
  (2026-09-26): send and R4 commit topology immediately and converge on
  observation; send/R4 pending transactions, ack/verify/status/cancel/abandon
  and pending rule B removed; abandon-send recovery and pre-actuation
  cancellation are superseded. Combined step-3 production net about -4,800
  lines vs `3e35961`. Batched simultaneous admissions fall out of
  complete-observation reconcile. User live re-test, steps 2 and 3 together:
  startup fit; multi-window open/close (foreground and hidden);
  float/sticky/maximize/fullscreen restore; gap reload; displaced workspace
  return; hidden admission after a send; send to occupied and new trailing
  workspaces; rapid sends across several workspaces (known transient: a
  stale second send refuses and drops the mover until the forced source and
  target refresh re-admits it - confirm no command is lost indefinitely;
  graceful, responsive spam-sending was user-accepted before step 3 and must
  not regress);
  native refusal and mid-send close; R4 to occupied and empty outputs and a
  failed/wrong-output transfer; follow exactly once only on arrival; revisit
  both domains for phantoms; inspect correlated dispatch/arrival/follow/
  refusal/release logs. Watch for recurrence of the floating-membership skew
  (`EIV6Rm.log` drag-4), whose refusal class steps 1-3 removed.
  [change](changes/archive/observation-convergence.md)
- P1 | Resilience fixes | Principle (user, 2026-09-25): no permanent give-up
  short of hard failure. Read-only audit complete (2026-09-26) at `9549721`:
  21 findings, ranked. Ordinary fixes proceed in bounded changes: (1) KWin
  script H, J, B, C, E, U - shipped offline `a55ae9d`; live check: empty
  login then open a window, resize completion, Meta+M; (2) Rust
  tray/Planner O, N, P, Q; (3) low severity T, D, F, K, L, plus a move
  Started without Finished still holding automatic reconcile (found in
  batch 1). User decisions: I - option 2 (user, 2026-09-26): tile a window
  lacking `maximizedChanged`, log once, rely on fresh `maximizeMode` reads.
  G - option 3 (user, 2026-09-26): on a stale pre-write snapshot, replan the
  same command once against a fresh complete observation; never replay after
  any setter; if the replan is also stale, log and drop and let observation
  converge. A - option 3 (user, 2026-09-26; accepted as an interim, not
  great UX): replace the domain-wide park with per-window acceptance of the
  exact client-held rectangle after the existing bounded reassertions; any
  other drift, or that window changing size, reconciles normally; explicit
  commands never blocked. Learned limits (option 4) are deferred to Robust
  difference reconciliation. M - option 2 (user, 2026-09-26): the tray
  stays alive when no watcher exists or the watcher is lost, and registers
  whenever a watcher owner appears; it still exits on loss of its own name or
  connection. R/S - option 2 (user, 2026-09-26): while the group or drag
  oracle endpoint is unregistered, retry registration on events the effect
  already receives (window activation, reconfigure); no timer; log the
  transition once. The press spy installs late on the same events when input
  redirection was unavailable at construction (ordinary).
- P1 | Tray icon not appearing | User report (2026-09-26): the tray icon has
  not been seen for some time, across many rebuilds and restarts. Cause
  (read-only investigation): nothing starts the tray - `just dev` and dogfood
  launch it only on demand since `1535a07`, and no Home Manager autostart
  entry exists on this host; no crash evidence. User decision (2026-09-26):
  `just dev` starts, owns (logs into the trace) and stops a worktree tray.
  Implement with M, N, O, P, Q.
  [audit](changes/resilience-audit.md)
- P1 | Fail-closed sweep | New Resilience rule (user, 2026-09-26): fail
  closed only when recovery is impossible or continuing would cause harm such
  as system instability. Review `docs/decisions.md` (9 fail-closed mentions)
  and production fail-closed paths (about 175 mentions) against it; adjust
  decisions that conflict, and list behavior changes that need a user
  decision. Unsafe-write fences that refuse one operation and let the next
  observation converge are consistent with the rule.
  [principles](principles.md#resilience)
- P2 | Process-loss and sleep recovery testing | User request (2026-09-26),
  not urgent: test how the system recovers when components are killed or
  stopped (Planner, tray, KWin script reload, native effect reload, KWin
  restart) and around sleep/resume, and make recovery graceful for the user.
  Overlaps the Wake transport recovery live acceptance below. Follow
  docs/live-kwin-testing.md; any live mutation needs explicit authorization.
- P2 | Robust difference reconciliation | User direction (2026-09-26, with
  decision I): find a way to make the implementation more robust and able to
  reconcile differences between expected and observed state where they
  occur, rather than depending on individual native signals. Includes
  learned size limits (decision A option 4, user-approved direction): treat a
  client-held size unexplained by hints as a learned min/max/step for that
  window and replan neighbours around it, expiring when the client changes.
  Design work; scope with the user before implementation.
- P3 | AR6 Logical workspace model in core | 7.10. Deferred 2026-09-24 until a
  non-KWin host needs it. The current KWin implementation is the "native
  workspaces" mode of a future native/custom choice.
  [design](changes/architecture-review-ar6-workspaces.md)
- P3 | AR7 Remaining portable policy to core | 4.2, rec 4: shortcut catalog/
  profiles, eligibility and window rules, settings schema, fingerprint and
  wire-schema source. Deferred with AR6.

Existing work:

- P1 | Intermittent active-border disappearance | User reports active border
  stopped midway through a session. Exact trace
  `/run/user/1000/plasma-auto-tiler-dev.Xm6rPM.log` continues script state
  submissions but lacks native endpoint/gate/visibility records; group/oracle
  activity does not prove active-border rendering. No historical cause is proven.
  Added bounded default-info `plasma-auto-tiler:active-border:` endpoint,
  initial-gate result, and changed-visibility reasons. Existing `just dev trace`
  captures them automatically. They report eligibility, not rendered pixels.
  Typecheck, 883 KWin tests, host-native build, and 27 native tests pass. Next:
  user starts a fresh Plasma session with rebuilt native effect and supplies the
  exact combined trace if it recurs.
  [diagnostics](changes/archive/active-border-visibility-diagnostics.md)
- P1 | Initial border state confirmation live gate | The effect seeds committed
  native `maximizeMode()` for each window at load/addition; later native
  transitions update it. Fullscreen/any maximise suppress both outlines. User
  fresh-session visual acceptance after native delivery remains.
- P0 | Immediate single-output focus: fullscreen, maximise, float, sticky float |
  User-selected next scope on the laptop. Verify shortcut delivery, entry/exit,
  retained tiling restoration for fullscreen/maximise, floating placement and
  fresh admission on unfloat, and sticky visibility across workspaces with
  correct sticky-off behavior. Include fullscreen residual cost and maximise
  admission checks tracked below. Diagnose and fix concrete defects within the
  approved behavior; physical checks remain user-owned. User manually confirms
  maximise and normal active-border suppression work; Firefox's native F11
  fullscreen also hides the border. Added the missing project `Meta+F11` toggle,
  reversible KCM clears for Grid View `Meta+G` and Krohnkite Monocle `Meta+M`,
  and maximise suppression for the Meta-held group outline. Existing three-row
  shortcut journals remain recoverable. Typecheck, 815 KWin tests, script/native
  builds, and 26 native CTest cases pass. The other agent's changes were docs
  only and were reviewed. Native public maximize signals track all windows,
  and the effect seeds each observed window from committed native
  `maximizeMode()` on load/addition with native transitions authoritative;
  the script-confirmation gate and its epoch handoff are retired.
  Sticky float uses native all-desktops semantics (empty native desktop list);
  sticky-off selects the current desktop. Static review and regression establish
  no explicit workspace switch on sticky-on, but the user's workspace 1 to 4
  jump remains unexplained and needs an exact attempt trace. Fullscreen cost
  and session-restored maximise admission require separate evidence.
  User manually accepts `Meta+F11` and `Meta+M`. Earlier active shortcut records
  assigned `Meta+G` to both Grid View and project float; the user saw the overview.
  `Meta+Shift+G` had only the project sticky action. After logout/
  login the user saw the updated dialog mentioning `Meta+G` and applied it, but
  overview still wins. Another newly opened window neither tiled nor moved to
  another workspace. `/run/user/1000/plasma-auto-tiler-dev.l1R1hl.log` shows
  source-workspace removal during a confirmed native send/follow, followed by
  stale-revision and blocked admission. Source/target cleanup now retains planned
  in-flight workspaces through acknowledgement/verification; regression reproduces
  the old failure and verifies release after settlement. A separate hermetic
  regression confirms completed v2 shortcut journals incorrectly demanded new
  v3-row postimages before applying them; migration now resumes from verified
  existing state and preserves Revert. Exact host journal remains unverified.
  Checks pass: 825 KWin tests, typecheck/build, 4 workspace-send Rust tests, and
  27 native tests. Next: deploy the native KCM fix in a fresh session, use
  `Active Window Border` -> `Apply Shortcuts`, start fresh `just dev trace`, and
  retest float plus workspace send/new-window admission. This prevents the traced
  pruning failure; it does not recover an already uncertain live transaction.
  Normal/sticky floating now sets native keepAbove, verifies the exclusive
  above/below pair, and restores prior stacking on unfloat or owned cleanup.
  Typecheck, 116 focused adapter tests, and script build pass; live acceptance
  remains pending. The keepAbove change alone needs no native session boundary;
  the later shortcut journal correction does.
  Sticky pager appearance needs user confirmation; no duplicate shortcut or
  sticky occupancy in trailing-empty handling was found. Ghostty fullscreen
  becomes maximised after workspace return; narrow source review found no cause,
  and no native-fighting workaround was added.
  Initial-border-state implementation is tracked above.
  Krohnkite is absent from
  dotfiles declarations and user KPackages and disabled in `kwinrc`; its shortcut
  record remains, while system-package/runtime presence is not established.
  User approved explicit Apply/Revert clearing of Grid View's `Meta+G` and
  Krohnkite Monocle's `Meta+M`, plus standing authorisation to clear other
  project-required shortcut conflicts through that reversible mechanism.
  Navigation and
  movement while maximised await the user's COSMIC comparison; no suppression
  policy is selected. User manually accepts sticky float. Both float toggles now
  retain native focus on the exact toggled window and skip tiled-survivor focus;
  831 KWin tests and typecheck pass, with physical acceptance pending.
  The earlier `Meta+G` overview investigation found an active Grid View conflict,
  and exact `~/.config/kcmshell6/shortcut-override-journalrc` was completed v2
  with only three rows. User supplied the blocking error: `Shortcuts differ from
  allowed image` and `Refusing to apply: KDE Layout Keyboard Switcher/Switch to
  next keyboard layout preimage is not exactly Meta+Alt+K`. User requests
  inspectable failure logs and an explicit Force Apply confirmation instead of
  flat rejection. Both are implemented: clear-row Force previews/revalidates the
  exact live image and retains reversible preimages; default-visible structured
  logs use `plasmaautotiler.shortcut op=`. Journal discovery is now independent
  of the KCM host at `~/.config/plasma-auto-tiler/shortcut-override-journalrc`,
  with bounded migration from the exact legacy kcmshell6 path. The old
  host-dependent path explains a possible fresh-preimage refusal, but the prior
  process's actual lookup is not proven. Host-native 31-test suite, stale Force
  terminal-log regression, and native build pass. Next: user fresh-session KCM
  Apply/Force/Revert acceptance; diagnostics are available through the user journal.
  Screenshot `~/Pictures/Screenshots/Screenshot_20260921_205252.png` shows outline
  overlap. The active border now parents to the target WindowItem at negative z
  through public KWin APIs, preserving outside-frame outline while higher windows
  occlude it. Group outline remains a scene overlay; the screenshot alone does
  not distinguish the two. Host native build, 26 native tests, and 7 renderer
  static checks pass. User fresh-session visual occlusion test remains pending.
  R4 replies now use phase-specific one-shot guards: duplicate planned replies
  cannot restart native transfer, and duplicate acknowledgements/verifications
  cannot repeat settlement. Regressions cover original deadline preservation,
  stale/new-flight isolation, and one deferred admission after settlement.
  Directional tests (32), full KWin tests (836), typecheck, and build pass.
  Background admission and same-output callback reviews found no concrete defect.
  Float geometry-write exceptions now restore prior stacking and release the
  failed flight instead of escaping and leaving it blocked until timeout;
  regressions cover stale callbacks and a later usable command. Typecheck and
  838 KWin tests/build pass. No uncertain-transaction recovery or replay is
  selected. Workspace sends now receive validated gap reloads; each in-flight
  request/ack/verify retains its original pair while subsequent sends use the
  latest values for both domains. Entry and transaction regressions pass with
  typecheck and 845 KWin tests/build. No loss was found in Plan gap queueing or
  native KCM reload-result handling. The three ineffective algorithm, automatic
  split-target, and drop-preview controls have now been removed from both settings
  UIs, schema, and KCM persistence as approved. Existing legacy values are left
  untouched; supported settings remain. Mapping and shortcut lifecycle choices
  remain separate.
  Latest user report accepts floating usability, with navigation policy awaiting
  COSMIC comparison, but float/unfloat appeared to stop tiling. Exact trace
  `/run/user/1000/plasma-auto-tiler-dev.SiVOOr.log` shows successful float p5 and
  later admissions before reconcile p9 rejects three tiled plus one floating
  member as malformed-topology. Retained reconcile/gap-update validation now
  compares projected geometry with tiled leaves rather than all known exceptions.
  Regression covers float, later admissions, moved-float reconciliation, fresh
  unfloat admission, removal, and later convergence. All Rust tests and cargo
  check pass; the later p12 stale/remove-side mismatch remains fail-closed.
  User retested and confirms the float/unfloat tiling stall is fixed. Normal
  float, sticky float, fullscreen, and maximise now have reported manual
  usability acceptance. Navigation semantics await the user's COSMIC comparison;
  remaining startup, recovery, settings, and rendering decisions are tracked
  separately below and above.
  Other backlog work follows this focused scope.
- P1 | Sticky adoption live gate | Already-sticky eligible normal windows with
  proven all-desktops membership now unstick as normal floats on the current
  workspace, retaining placement/focus/above; a subsequent float toggle tiles
  them. Known tiled origins retain fresh-admission behavior. Offline tests pass;
  user restart/re-enable acceptance remains pending. No old origin is inferred.
- P1 | Unified Plasma Auto Tiler native delivery live gate | One surviving
  `plasma-auto-tiler-active-border` plugin/KCM is branded `Plasma Auto Tiler` and
  hosts both borders and the drag oracle with existing public endpoints. The
  standalone oracle artifact is retired; dev/dogfood/packaging use one plugin.
  Dogfood preserves its existing survivor-enable behavior and clears only exact
  legacy oracle-enabled true; oracle-only packaged users require project
  activation before the next session. Dev remains transient, without kwinrc
  writes. Supported configuration survives. TypeScript (878), native (28), host
  native build, and four hermetic shell suites pass. Fresh-session discovery and
  rendering/oracle acceptance remain user-owned; the script entry stays separate.
- P1 | Local movement height mismatch and stalled commands | User reproduced
  the stall without crossing outputs: O1 `H[W1 V[W2 W3]]`, O2 `W4`, with
  W1/W3 Ghostty, W2 Kate, W4 Firefox. Moving W3 right produced local
  `H[W1 H[W2 W3]]`, left W3 roughly 5% short vertically, and blocked later
  local/output moves. `/run/user/1000/plasma-auto-tiler-dev.nEimw8.log` reveals
  a two-domain local reply polluted the source membership baseline with the
  target window, producing a false removal. The source-only baseline correction
  is statically verified with 811 KWin tests, typecheck, and build. W3 requested
  `502x1092` but observed `502x1036`; the native cause remains unknown. Bounded
  trace-only size hints (`resizeable`, `minSize`, `maxSize`), workarea/output,
  and requested/observed frames now cover pre-plan, plan, write, and post-signal.
  AR12 now accepts only hint-explained clamps; the observed 56px shortfall is
  not explained by the recorded min/unbounded max. Next: user restarts
  `just dev trace`, repeats the local move and a subsequent command, and
  provides the exact trace. No native lifecycle or geometry mutation ran in verification.
- P1 | Consistent correlated observability | User requires consistent lifecycle,
  decision, and failure logging throughout the solution, with trace IDs linking
  requests across services; encoded in `docs/principles.md`. Delivered normal
  correlated workspace-send/R4 cancellation lifecycle and Planner summaries:
  eligibility, attempt, failure/refusal/timeout, acceptance, local release with
  original cause, and later command dispatch. Fixed uncorrelated summaries cover
  Planner early exits without parsing rejected input. Offline Rust/KWin tests,
  typecheck/build, and independent review pass. Wider source assessment is
  complete. Delivered normal correlated Plan activation/owner-pinning/send
  records, including bounded failure and timeout phases, without transport
  behavior changes. Typecheck, production build, all 919 KWin tests, and
  independent review pass; corrected two pre-existing stale logging assertions.
  Delivered ordinary Plan reply/validation/observation/application/terminal
  diagnostics with aggregate setter outcomes. Ordinary routes have no ack/verify
  protocol; application logs do not prove remote commit or rendered state.
  Typecheck, production build, all 929 KWin tests, and independent review pass.
  Delivered tray owner/publication/refusal/failure/recovery diagnostics with
  repeated-heartbeat noise suppressed. Validated generation/revision/enabled
  joins snapshot identity across KWin/Rust, not individual heartbeat causality.
  Typecheck, 937 KWin tests, full Rust tests, and independent review pass.
  Delivered native best-effort journald submission for autostarted Rust tray
  diagnostics alongside retained stderr, queryable with
  `journalctl --user -g "plasma-auto-tiler:route-diag component=tray-endpoint"`;
  `just dev` captures KWin and Planner, not tray stderr. Ambient topology and
  native signals must not inherit
  unrelated request IDs. Whole-system coverage and live capture remain unproven.
  [cancellation observability](changes/archive/correlated-pending-observability.md)
  [activation observability](changes/archive/plan-transport-activation-observability.md)
  [application observability](changes/archive/plan-apply-verify-observability.md)
  [tray observability](changes/archive/tray-publication-observability.md)
  [coverage assessment](changes/observability-coverage-assessment.md)
- P1 | Cross-output directional focus and movement live gate | Implemented
  Meta+Left/Right focus and Meta+Shift+Left/Right movement across horizontally
  adjacent outputs after local operations are exhausted. Targets use the other
  output's current workspace and remembered focus; movement uses focused-leaf
  or root insertion, preserving the user-tested COSMIC S20-S23 precedence.
  Canonical per-domain state is retained without spatial reseeding. Native
  transfer uses public `workspace.sendClientToScreen`; confirmed target output
  and desktop membership permits one prompt follow, while complete geometry
  and ack/verify gate commit. Rust tests, 808 KWin tests, typecheck, and build
  pass. User manually observed one successful rightward transfer:
  left `H[W1 W2]`, right `W3` became left `W1`, right `H[W2 W3]`.
  Immediate leftward return of W2 then failed. Exact supplied log
  `/run/user/1000/plasma-auto-tiler-dev.qQMfPr.log` shows unchanged desktop
  membership produced no echo, so the outbound transfer timed out and diverged.
  Static correction accepts fresh exact membership readback when the mover
  already had the target desktop; changed membership still requires its echo.
  New test: right `H[W2 W3]` to left `W1` produced left `H[W1 W2]`, right
  `W3`, but W2's bottom edge remained roughly 5% short. Both return-right and
  local-left swap then failed. `/run/user/1000/plasma-auto-tiler-dev.kjFKIE.log`
  proves an intermediate output-transfer geometry signal was counted before
  planned writes, causing premature post-observation mismatch and divergence.
  Static correction consumes each geometry fence only at the exact planned
  rectangle and otherwise waits within the existing deadline. AR12's flagged
  overconstrained members use client-held geometry for R4 proof; Ghostty's final
  `1012x1036` versus requested `1012x1092` remains unexplained without matching
  size-hint evidence. Next: fresh trace repeats right-to-left and records final
  exact geometry/commit or timeout before testing subsequent local/return moves.
  Up/Down local behavior and directional workspace cycling are unchanged.
  Convergence step 3 (2026-09-26) replaced the R4 ack/verify, echo and
  deadline machinery described above with immediate commit plus observation
  convergence; R4 live re-test is tracked under convergence steps 2-3.
  [record](changes/cross-output-directional-focus-movement.md)
- P1 | Native dev setup and lifecycle live gate | Explicit `just dev-native-setup`
  and `just dev-native-remove` now manage only the exact checkout-owned Plasma
  environment script. `just dev` preflights native discovery before startup,
  transiently loads project effects, and unloads only invocation-owned loads;
  preloaded effects and persistent enabled settings are preserved. Isolated
  setup, collision, lifecycle, interrupt, and new-inode staging checks pass.
  User setup and session restart proved discovery; the subsequent 6.7.4/6.7.5
  ABI mismatch is now addressed by the host-derived native builder. Direct
  staging and dogfood compilation share the exact current-system KWin
  derivation/dev environment, independent of the portable devenv pin. Actual
  native build/staging against host KWin 6.7.5 and 27 native CTest cases pass;
  shared lockfiles are unchanged. User now reports "It's working perfectly now
  and the active border is back too." This manually accepts the reported native
  development startup result and visible active border; it does not establish
  exact oracle protocol, cleanup, removal, or cross-host upgrade behavior.
  Laptop follow-up: after the exact host `dev` output realization fix, the user
  completed setup, build, logout/login, and reports it is working on a single
  output. This manually accepts startup on that laptop; oracle protocol,
  cleanup, removal, and cross-host upgrade checks remain pending. Native rebuild
  activation requires a fresh session; unload is not proof of library release.
  No agent host mutation occurred. Removal and dogfood coexistence refusal
  remain live-unverified.
  [record](changes/archive/native-dev-setup-lifecycle.md)
  [host builder](changes/archive/host-matched-native-development-builds.md)
- P1 | Remaining native window alignment | Ghostty's
  persistent short frame remains unresolved: a requested `2032x1092` became
  `1920x1036`, matching secondary usable size, while another primary Ghostty
  accepted the full size. Native per-window constraint or stale output-derived
  cap remains a hypothesis; AR12 cannot explain this from the recorded hints.
  Primary 125%/secondary 100% scaling causality is
  unproven. Oracle delivery is tracked by the native dev lifecycle live gate.
  The interactive-resize fighting/drop correction is now manually accepted;
  prior output-jumping and startup-loop fixes remain manually accepted.
  [bounds fix](changes/multi-output-domain-bounds.md)
  [drag investigation](changes/window-alignment-drag-investigation.md)
- P1 | Non-visible workspace tiling live gate | Background tiling is statically
  implemented and verified: startup and window open/move adopt or reconcile
  non-foreground domains without switching desktop visibility or stealing native
  focus. User-owned live acceptance must cover hidden startup/open/move,
  multi-output domains, unchanged native focus/desktop, and the absence of any
  rendered-state claim. Graceful move-follow has separate user manual
  acceptance. [record](changes/background-tiling.md)
- P2 | Active-group highlight redesign | User observation (2026-09-24): the
  group border now renders, but statically during KDE's workspace slide
  transition, while the active border now slides with its window (previously
  it jumped to the new window and rendered statically; likely fixed by
  parenting the active border to the target WindowItem at negative z, while
  the group outline remains a scene overlay - not proven). User does not want
  heavy investment in the current group outline. User's current thinking, not
  a decision: render the group as a semi-transparent grey rectangle beneath
  the windows and beneath the active border, extending beyond the active
  border by about one more border width. Earlier: retained-focus and
  completed-geometry defects corrected; native status diagnostic available.
  [record](changes/archive/active-group-highlight-design.md)
- P1 | Preserved host residue | Do not search for, enumerate, inspect,
  heuristically identify, modify, or clean unidentified advisory, shadow, or
  nested-test residue. Any recovery needs explicit user authorization and exact
  identity or hash verification. No stale POC2/POC3 harness or checkpoint retry
  is authorized.
- P0 | Fullscreen residual-cost live gate | Production Plan fullscreen isolation
  is static-complete. User must run the exact fullscreen gate and establish the
  gaming cost baseline. [investigation](changes/reliability-condition-investigation.md)
- P0 | Maximize-admission clear live gate | Static coverage proves the one-shot
  `Window.setMaximize(false, false)` route, its synchronous echo fence, and
  post-admission isolation. A real KWin 6.7.4 session must establish that a
  session-restored maximized application restores, tiles, and cannot form an
  application re-maximize loop. No live result is claimed.
- P1 | Output hotplug domain lifecycle | Preserve displaced layouts as separate
  workspaces on a remaining monitor; alternative handling may be configurable
  later. Visibility follows the active window's location at disconnect; with no
  active window, preserve the surviving view. Displaced workspaces return on
  reconnect with current contents/layout; explicitly moved-out windows stay out.
  Choose nearest only when the native handling source exposes removed-output
  geometry, otherwise use the surviving primary (then deterministic ordering).
  The current adapter does not retain removed geometry so it falls back to
  primary/ordering and never uses post-disconnect window geometry as a proxy. Reconnection keeps the active window
  visible/focused without restoring view history. Offline coverage exists for
  the stated displacement/return, atomicity, and preservation pieces; live
  acceptance remains pending and no live result is claimed.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Work-area change projection live gate | Static code projects one retained
  existing domain through resolution, scaling, and work-area changes without the
  client-drift park policy. User must run the exact gate, including fullscreen
  isolation and restoration. [investigation](changes/reliability-condition-investigation.md)
- P1 | Wake transport recovery implementation | Retain layouts if the Planner
  survives sleep. After confirmed Planner loss, automatically establish a fresh
  in-memory session from current windows using near-layout fitting with normal
  tiling fallback. Never replay interrupted commands or accept stale replies.
  Static implementation is complete with offline TypeScript and Rust coverage;
  live acceptance remains pending and no live result is claimed;
  uncertain-send recovery remains a separate, unselected protocol change.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | All settings live application (launch blocker) | Before launch, every
  user-facing setting must apply live, including tiling, workspace, shortcut,
  and effect settings. Overall liveness is PARTIAL: saving gaps from the script
  Configure page now automatically requests the validated retained gap resync,
  pending live acceptance; borders remain live. `workspaceMode` still requires
  a session restart as a user-approved exception (below). The three
  ineffective controls have been removed; legacy values
  are left untouched. Verify running behavior reflects saved settings without
  requiring a tiler reload. Research (2026-09-25): the three shortcut profiles
  currently produce the same catalog; KWin 6.7.5 scripting cannot unregister
  or rebind shortcuts; live `workspaceMode` needs product semantics for
  layouts, numbering, view and focus; generic post-Save script reload is not
  recommended. User decision (2026-09-25): hide `shortcutProfile` from the
  Configure page until real profiles exist, keep the single COSMIC-style
  catalog, leave any saved value untouched in `kwinrc`, and fold profiles into
  "Post-MVP tiling profiles"; this removes it from the launch blocker.
  Implemented offline (2026-09-25). User decision (2026-09-25): `workspaceMode`
  stays startup-only for MVP as an explicit launch-blocker exception; the
  Configure page now labels it as requiring a session restart. User live-checked
  the Configure page contents (profile hidden, restart wording) on 2026-09-25.
  Remaining blocker: live-accept gap and border application.
  [hide profile](changes/archive/hide-shortcut-profile.md)
  [investigation](changes/reliability-condition-investigation.md)
  [live settings research](research/live-settings-after-ar15.md)
- P2 | Interim runtime configuration reload | PARTIAL: the gap-only portion is
  static-complete with retained offline proof and a pending live gate; broader
  startup-only settings remain unfinished. AR15 moves gaps and startup settings
  to the script Configure page. Saving changed gaps sends a KWin reconfigure
  request automatically after persistence, without the effect KCM's former
  Reload Tiler button. The send is reported as sent-but-unconfirmed or failed,
  never as applied; the controller re-reads validated gaps on
  `Options.configChanged` and requests debounced retained `update-gaps`.
  Unchanged signals resync nothing; startup-read `shortcutProfile` and
  `workspaceMode` remain restart-required and shortcuts are not re-registered.
  Session restart remains the fallback guarantee for gap pickup if the retained
  route cannot converge. Dialog-scoped status resets on reopening. No live
  application result is claimed and the all-settings launch blocker remains.
  [investigation](changes/reliability-condition-investigation.md)
- P1 | Rust-engine/direct-geometry migration live gate | Rust-mode exact-three
  focus, movement, keyboard resize, and pointer resize are static-complete behind
  disabled-by-default exclusive authority. Await a user rebuild/new session and
  one visual-jank smoke. The first host round trip, stale/service-loss refusal,
  after-snapshot equality, restoration, hostile same-UID service proof,
  atomicity, stock-KWin parity, and latency remain unproven. The halted advisory
  transport route needs a user-provided exact receipt/lifecycle record before any
  recovery.
- P1 | Custom Tile acceptance | Perform the separately authorized manual runtime
  check with exact restoration. Drag/reflow and host acceptance remain unproven;
  do not recover stale harnesses. [change](changes/custom-tile-runtime.md)
- P1 | Nested placement visual smoke | Verify occupied-leaf whole-rectangle
  preview and nested split placement. [change](changes/archive/nested-placement-affordance.md)
- P1 | Native active-border runtime delivery | Nix host-KWin ABI/session
  discovery and runtime/config/reload/restoration acceptance remain unproven.
  Existing border/KCM observations are manual evidence only.
  [decision](decisions.md#native-active-border)
- P1 | Tray live and release acceptance | AR13 same-UID-trusted name ownership,
  current-KWin-owner snapshots, and Home Manager XDG autostart are offline-
  verified only. KWin-origin SNI authority, watcher ordering, native ABI load,
  login/autostart, and update/rollback remain live-unproven.
  [change](changes/archive/architecture-review-ar13-tray.md)
  [carrier](changes/archive/tray-carrier.md)
- P1 | External NixOS/Home Manager delivery | Validate clean external install,
  update, generation rollback, and host-matching KWin ABI. [change](changes/archive/nix-current-host-delivery.md)
- P1 | Shortcut physical and recovery checks | Verify Lock Session, Revert,
  Phase 2 resize chords, and Restore. Do not induce another interruption or add
  fault injection. [change](changes/shortcut-override.md)
- P1 | Drag-oracle post-fix proof | The later echo-fence and dragged-source
  reassertion fixes are static-only. Rebuild/new-session test committed
  left/right/up/down resizes, exact 8px gaps, one planned-applied result, and no
  immediate reconcile. Multi-output, more-than-three-window, non-horizontal,
  boundary, atomicity, and parity claims remain unproven.
  [decision](decisions.md#production-interactive-edge-drag)
- P2 | Placement-aware startup adoption live gate | Initial fresh adoption now
  statically fits a best-effort near strip: unambiguous sequential primary
  intervals in `(x, y, w, h)` / `(y, x, h, w)` order, regardless of edge
  offsets, cross-axis drift, or observed gaps, projected with the configured
  gaps as the canonical result; grids, nested, T arrangements, and exceptions
  use normal deterministic seed/reflow fallback. The Rust fit is
  transaction-bound and applies independently to foreground and background
  domains; static unit coverage only, no live claim is made. User-owned live
  acceptance remains pending.
  [record](changes/placement-aware-startup-adoption.md)
- P2 | KWin controller silent unload | Attribute a manual controller unload only
  with before/after `isScriptLoaded`, exact `Script<ID>` introspection, and KWin
  PID/start evidence.
- P2 | PID 3568836 SIGABRT incident | The malformed inbound `QKeySequence`
  D-Bus abort is formally open: its unrelated triage has twice been falsified.
  Do not attribute it to the native effect or script without sender, method, and
  fault-stack evidence. [record](changes/archive/kwin-qkeysequence-dbus-abort.md)
- P2 | Nested disposable actuation limits | The nested POC3 route is
  offline-proven/live-unproven: client lifetime, exact-three KWin scope, and
  same-unit containment are unproven. Do not add a project-owned client or
  dependency, retry, or cleanup without fresh explicit authorization.
- P2 | Configurable gaps live acceptance | Native KCM inner/outer gaps and
  validated startup binding are implemented (defaults 8, bounds 0..64). AR15
  moves gap controls to the script Configure page via a host-built native script
  KCM; its Save requests running gap resync without a separate user step. The
  native companion must be installed for the page, but the effect need not be
  enabled. User-owned acceptance remains for saved settings and visible gaps
  after Save, including session restart where needed for native delivery.
  [record](changes/archive/window-gap-configurability.md)
- P2 | Floor-ratio fallback | Retain it unless qualifying isolated nested proof
  establishes a safe improvement. [change](changes/floor-ratio-feasibility.md)
- P2 | Integrated Plasma feasibility | Establish a safe structural verdict; the
  unsafe nested path remains stopped. [change](changes/integrated-plasma-structural-feasibility.md)
- P2 | JavaScript workload evidence | Complete sustained-workload evidence before
  choosing a native replacement for discrete window management.
  [change](changes/js-workload.md)
- P2 | Grouped-window stability | Prove multi-window Custom Tile stability before
  selecting grouped or tabbed behavior. [change](changes/grouped-windows.md)
- P2 | Keyboard-layout support | Resolve complete keyboard-layout support after
  initial release. [change](changes/shortcuts.md)
- P2 | Multi-output workspace anti-oscillation | Verify trailing-empty behavior
  on a multi-output machine. [runbook](live-oscillation-verification.md)
- P3 | Stale branches | Twelve stale branches, most at least 140 commits behind
  `main`, require explicit user authorization before deletion.
- P3 | Other compositor validation | Validate bspwm, Hyprland, and COSMIC at
  their actual runtimes. The release-pinned semantics and support-path research
  does not substitute for runtime validation.
  [comparison](reference-wm-comparison.md)
  [profile research](research/reference-wm-profile-support.md)
- P3 | Cross-platform adapter feasibility | Research establishes a public,
  normal-window subset for Windows, macOS, and GNOME but rejects literal
  cross-platform workspace/shortcut/focus parity. No port, workspace model,
  panel, settings toolkit, or package format is approved. Any future work must
  select a host/version and pass its bounded capability prototype first.
  [research](research/cross-platform-support/feasibility.md)
- P3 | Panel and workspace-overview helper | Research recommends a narrow,
  additive Plasma native-desktop Pager setup helper as the smallest useful
  interpretation, while documenting that it cannot represent the project's
  per-output logical mappings. No workspace authority, panel command route,
  custom plasmoid, overview replacement, settings owner, package, or
  implementation is approved. Tray live/release acceptance remains separate.
  [research](research/panel-workspace-overview-helper.md)
- P3 | Artifact publication | Publish reproducible KPackage artifacts to KDE
  Store and GitHub Release after MVP delivery dependencies complete.
  [foundations](changes/archive/delivered-foundations.md)
- P2 | Mainstream install path | User direction (2026-09-26): the long-term
  target is the simplest install for a mainstream KDE user (e.g. Kubuntu): a
  single install, probably through the distro package manager given multiple
  parts (script, native effect tied to the host KWin ABI, Planner, tray);
  ideal UX is installing one KDE plugin, weighed realistically. Delivery and
  lifecycle choices (e.g. tray autostart) should serve this target; `just
  dev` is only for development iteration. Only the native effect is bound to
  the host KWin ABI (the script is JS; Planner and tray use D-Bus only; the
  native KCM's KWin linkage is unverified), so the target is packages built
  alongside KWin: official distro packages ideally, starting with our own
  (PPA, COPR, AUR, nixpkgs/flake). Tentative plan (user, 2026-09-26): the
  openSUSE Build Service (OBS) as the one service building for several
  distros, pending research confirming fit or a POC, ideally integrating
  cleanly with GitHub Actions. Aim to cover 80-90% of Linux KDE users: Arch family,
  Ubuntu/Kubuntu/neon/Debian, Fedora, openSUSE, NixOS. Flatpak/Snap cannot
  carry KWin plugins. An effect that fails to load after a KWin update must
  leave tiling working. A reduced no-native tier (script, Planner, tray;
  no borders or drag oracle) is possible but unverified.
  [research](research/distribution-package-feasibility/feasibility.md)
- P3 | Dev build alongside a stable install | User direction (2026-09-26),
  no solution needed yet: find the cleanest, most effective way to run a dev
  build on a machine that also has the stable version installed (D-Bus names,
  plugin/script IDs, config, tray and Planner ownership). Keep it in mind in
  delivery and dev-loop changes; today a dev tray exits if an installed tray
  owns the name.
- P3 | Live workspace-mode switch | Post-MVP (user, 2026-09-25). On save,
  quiesce, rebuild the backing-desktop mapping and fresh-adopt current windows
  without native moves, keeping focus and visible desktops; layouts may be lost
  (near-strip fitting recovers simple strips). Needs a safe Planner generation
  transition. [research](research/live-settings-after-ar15.md)
- P3 | Post-MVP tiling profiles | Required when adding other tiling types such
  as Hyprland: selectable profiles must cover both the tiling behavior/algorithm
  and matching shortcuts. Includes re-exposing `shortcutProfile` (hidden
  2026-09-25) with distinct catalogs and live switching. Deferred beyond MVP, not an optional shortcut-only
  preset feature. [change](changes/shortcuts.md)
