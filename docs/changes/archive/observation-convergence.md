# Complete-observation convergence

## Decision and scope

User decision, 2026-09-25: before an operation, converge retained domain membership and floating state to its complete observation without discarding surviving topology; then run the operation. A missing member is removed, a new member is normally admitted, and a floating transition is adopted. No new observation authority tokens.

Orchestrator decisions, 2026-09-25: portable `floating` and `fit_excluded` are the flag scope; sticky uses KWin's existing floating mapping, and fullscreen/maximized keep tiled allocations as native overlays. One Session primitive applies current-observation changes directly without staged or fabricated lifecycle observations. KWin sends the current post-removal observation, quarantines unreadable foreground frames, and retains its other baseline diffing. Only minimal internal wire changes needed for this behavior are authorized. Send/R4 transactions, baseline-diff migration, live testing, and toolchain changes are outside this change.

## Transient-absence findings

- Minimized and fullscreen/maximized normal windows remain observed; overlays must keep their retained tile. Visibility effects and workspace slides are not observer eligibility filters. No new minimize behavior is selected.
- An unreadable foreground member frame currently skips that member while returning the rest; the hidden observer already omits the entire incomplete domain. Quarantine the foreground domain until a complete observation is available so a temporary frame read cannot trigger remove/re-admit.
- Output/desktop changes alter genuine domain membership; a missing/unreadable output or membership cannot establish a complete per-domain observation. Source inspection cannot establish the duration of host transitions; live acceptance must check the visible result.

## Design and acceptance rows

- Session applies one validated complete observation atomically to retained trees, links, floating exceptions, focus, and accepted revision; preserve survivor group order/shares and normal admission placement. Engine performs it before ordinary operations, and replies describe the final converged plan at the resulting revision. Existing pending send/R4 fences and verification are not weakened. Log bounded correlated removed/admitted/flag-adopted counts and reason without native identifiers.
- Retained tiled member observed floating: remove its leaf, retain a floating exception, and run the requested operation without `partial-observation` or reset.
- Missing tiled member: remove it using the current post-removal observation, keep survivor topology, and choose an observed surviving focus if the former focused member vanished. Unexpected new normal member: admit through normal placement without reseeding survivors.
- Focus/move/resize/drag/reconcile with changed membership must first converge and then follow their ordinary command validation; valid commands proceed. Exact-match behavior and revisions remain unchanged.
- A fullscreen/maximized member keeps its tile and is not actuated while overlaid. A minimized member remains observed. Sticky uses the existing floating mapping. An unreadable member frame quarantines the whole foreground domain; a later complete observation resumes without a transient remove/re-admit.
- The real KWin observer/real Engine fixture must cover floating skew and a current-observation removal as well as quarantine and exact-match paths. Rust Engine/Session tests cover topology, focus, revision, and commands.

## Review, outcome and verification

Independent design/row review flagged lifecycle completeness, revision/ack binding, idempotent admit/remove replies, pair operations, and overlay actuation. The first fixture draft incorrectly expected Session operations to converge implicitly; corrected fixtures call the Engine. Fullscreen/maximized stay tiled and an unreadable frame never reaches the Engine. An independent implementation review found evolving placement axis, stale flag revalidation, and fresh mixed floating/tiled seeding gaps. The former now uses the evolving tree and matches successive normal admissions; reply flags are fenced before writes, and a fresh mixed domain uses the same Session primitive on an empty Session. Paired focus/move invoke that same primitive once on the assembled two-domain Session before planning. No new authority token or send/R4 settlement rule was added.

Offline checks: `cargo test --workspace --offline`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `just check-portable`, and in `kwin/` `npm run typecheck`, `npm test`, `npm run build`. Baselines: 639 Rust; 834 passed, 10 skipped KWin. Live acceptance pending: external floating skew, close/reopen, focus after closure, transient unreadable frame, sticky transition, minimize/fullscreen/maximize restoration, rapid commands and correlated convergence logs.

Status: shipped offline 2026-09-25; live acceptance pending. After the final fixture edits, `cargo test --workspace --offline` passed (12 Engine convergence rows, 217 Session lib rows), as did `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `just check-portable`. `kwin/`: `npm run typecheck`, `npm test` (840 passed, 10 skipped), and `npm run build` passed. The real observer/real Engine fixture covers floating skew, mixed fresh admission, post-removal observation and minimized retention; the production entry fixture covers foreground frame quarantine and flag races. No live KWin testing or session mutation.

## Live finding and follow-up (2026-09-25)

The staged step-1 build was live-tested. In the 1418-line trace copied to `/tmp/opencode/plasma-auto-tiler-dev.kxVjL7.log`, sticky-on sets all-desktops after float (`p16`, lines 686-714); later ordinary float toggles retile without clearing all-desktops (`p31`-`p33`, lines 1196-1262), so observation convergence repeatedly adopts the sticky window as floating (`flags_adopted=1` at lines 1219 and 1247). A subsequent sticky-off triggers a float instead of a tile (`p35`, lines 1315-1345). An all-floating foreground domain seeds duplicate admits (`p17`-`p19`, lines 745-852), and exception-only reconciles reject `malformed-topology` (`p28`, `p30`, `p34`, lines 1088-1128, 1169-1191, 1287-1310). The trace has no keypress timestamps; the attribution to the reported shortcut sequence comes from the routes and native setters.

User decision, option A: Meta+G on a sticky window clears all-desktops using the existing sticky-off path and returns it to tiling regardless of prior float origin. Meta+Shift+G retains its previous-origin behavior. The follow-up changes make that route reject fullscreen/maximized sticky overlays before native writes, suppress an all-floating foreground seed admit, and allow valid exception-only Engine reconcile to project empty geometry. Regression rows cover tiled, prior-float, and adopted sticky origins through a stable next observation, sticky overlay refusal, native sticky-off failure and explicit retry, all-floating foreground, and exception-only reconcile. Independent review found and prompted the sticky overlay guard and no-focus-write-on-failed-sticky-setter fix; exception-only overlay suggestions conflicted with the approved tiled-overlay scope. Follow-up edits remain unstaged on top of the staged step-1 build. Offline verification passed: `cargo test --workspace --offline` (13 Engine convergence rows), `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `just check-portable`, and in `kwin/` `npm run typecheck`, `npm test` (846 passed, 10 skipped), `npm run build`. Live re-test of option A is pending.

## Cross-workspace live failure and correction (2026-09-25)

Commit `43682a1` failed when a Ghostty tiled on workspace 2 was made sticky, the user switched to workspace 3, and pressed Meta+G. Both traces show the sticky-on float and all-desktops write (`/tmp/opencode/plasma-auto-tiler-dev.cj6nqT.log` lines 182-209; `/tmp/opencode/plasma-auto-tiler-dev.5cufKP.log` lines 248-275). Sticky-off re-homed it on the then-current workspace, but the re-invoked `toggle-float` in that workspace was rejected `not-tiled` (first trace lines 226-250; second lines 292-316); the source workspace subsequently removed its missing member (first lines 229-266; second lines 295-332). The second trace's later pointer-resize and reconcile attempts were rejected `partial-observation` and `unknown-domain` (lines 359-396), while subsequent moves only changed its floating frame (lines 401-413). No later Meta+G request appears in either trace, so the trace alone cannot prove whether a later press could recover.

Orchestrator clarification applying user option A: Meta+G tiles on the workspace where it is pressed, where sticky-off leaves the window, regardless of the prior tiled workspace. Plain floating Meta+G must remain able to tile; moving/resizing a float alone does not tile it. The previous option-A rows exercised only one workspace with an existing Engine session. The new cross-workspace rows first reproduced the actual absent-session `not-tiled` refusal with the production observer and real Engine, then covered stable tiling on the new workspace, a plain float/unfloat cycle, an occupied destination with retained tiles, and explicit recovery after a refused first unfloat. The protocol's absent-domain floating probe now permits valid toggle-float requests to reach the Engine; the Engine converges the complete current observation as floating exceptions via the existing primitive before unfloating into the current domain. Invalid-rectangle/malformed-request `not-tiled` precedence remains pinned by a codec row. Independent review prompted stronger terminal-state, occupied-domain, retry, and validation-precedence rows; its source-retention concern is resolved by ordinary source-domain convergence, not a cross-domain topology relocation. Changes are unstaged on the clean committed tree. Offline verification passed: `cargo test --workspace --offline --quiet`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `just check-portable`; in `kwin/`, `npm run typecheck`, `npm test` (850 passed, 10 skipped), `npm run build`. Live re-test pending.

## Step 2 - automatic observation and baseline retirement (2026-09-26)

User decision, 2026-09-25: remove KWin's applied membership baseline and the old public admit/remove paths, with net production deletion. Automatic foreground and hidden tiling now submit complete per-domain `reconcile` observations. Rust preserves fresh horizontal/vertical near-strip fit, deterministic seed/placement, mixed floating exceptions, explicit empty retirement, retained topology and gap reprojection. KWin keeps only applied per-window rectangle/domain/flag evidence for overlays, first-admission maximize, drag fallback, drift and reply-boundary validation; it never derives lifecycle commands from that evidence. Unreadable domains remain quarantined, hidden domains visit once per refresh chain without stealing focus, and a correlated exact gap-mismatch permits one same-domain fresh `update-gaps` retry.

Orchestrator decisions, 2026-09-25/26: strict pending rule B delays any fresh seed while a send/R4 pair is pending; no new automatic command or pending-overlap analysis. A unique same-workspace source relocates only when the target observation shares a retained tiled or floating-exception id; a disjoint unique source seeds fresh, as does an ambiguous source. Exact overlapping relocation keeps its atomic skew/rollback fence. These are Orchestrator rules applying the user's migration decision, not additional user choices. An initial broad codec deletion failed 39 old-wire behavioral tests and was reverted; subsequent migration moved or deleted small test groups before retiring the wire. No send/R4 transaction implementation or toolchain change is included.

Retired public Rust admit/remove codec handlers, typed commands and Engine lifecycle arms, changed-id/idempotent-success paths, and the duplicated post-convergence exact ID-set gates for ordinary reconcile and update-gaps. Session internal admission, fresh reconcile's internal admit-shaped projection, relocated-source exact-set rollback, and the remaining `run_retained` no-reseed guard stay: surviving explicit commands can still see changed bounds/gaps or pending state. Independent review identified that a converged ordinary operation could lose its retained topology on a changed domain; a failing-first row and non-mutating pre-check now preserve the session on the same refusal. Do not delete the remaining guards as if all domain and transaction fences were redundant.

Offline rows cover fresh fit/fallback, out-of-bounds fresh admission vs retained refusal, exception-only and empty domains, changed gaps plus membership, unique overlapping/disjoint and ambiguous relocation, pending-B refusal followed by real Engine commit, hidden once-per-chain/park/no-focus behavior, overlay/maximize/drag evidence, stale/flag fences and redacted convergence summaries. A production-entry KWin send-commit row adds a fresh hidden domain during a held send, then proves the committed callback automatically dispatches and applies its reconcile without a test-triggered resync or new native signal; its send and plan replies are fixture echoes. Rust's real Engine pending-then-commit row independently proves the pending-B refusal and subsequent admission. These two seams do not constitute one real-Engine KWin send integration run. Independent final diff review found no blocking migration defect and flagged that evidence limit and the since-fixed changed-domain topology loss; no live testing was performed.

Final offline checks: `cargo test --workspace --offline`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `just check-portable`, plus `kwin/` `npm run typecheck`, `npm test` (862 passed, 10 skipped), `npm run build`, and `git diff --check`. Measured against `718a58e` (excluding the Orchestrator's `docs/backlog.md` and documentation): production +1277/-1439 = net -162; tests +2798/-1364 = net +1434, down 957 net test lines from the step-2 handover's +2391. Live acceptance remains pending: manually verify startup fit, multi-window open/close on foreground and hidden workspaces, float/sticky/maximize/fullscreen overlays and restore, gap reload, repeated client drift recovery, displaced workspace return, send commit/abandon followed by fresh hidden admission without extra input, and correlated bounded summaries. Step 3 later replaced the send/R4 transaction model below.

## Step 3 - immediate send/R4 commit and observation convergence (2026-09-26)

User decision (2026-09-25): complete per-domain observations govern membership
and portable flags before operations, preserving survivor topology; replace
send and directional cross-output (R4) pending transactions with immediate
planned-topology commit and subsequent observation convergence. Orchestrator
scope: `floating` (including sticky) and `fit_excluded` are the portable flag
fields; fullscreen/maximized remain retained-tile overlays. Offline only; no
live KWin test or session mutation.

The Engine assembles a temporary canonical source/target pair from retained
per-domain sessions, permitting distinct workspaces on one output and an empty
target. It converges BOTH complete observations once, preserving occupied
source/target trees and remembered focus, then synchronously commits the
planned move/R4 topology atomically into canonical per-domain sessions. A fresh
source seeds normally; a rejected proposal keeps only valid observation
convergence. The Planner returns both-domain geometry and a native assignment,
without a wire acknowledgement or claim of native-verified success. The Rust
send/R4 pending slots, conflict guards and ack/verify/status/cancel/abandon
codec and handlers are retired. The retained `adapter-must-verify-postconditions`
precondition is an exact wire binding, not a native-success claim.

KWin fences reply correlation, owner/generation, flight token and dispatch-
frozen source/target snapshot (including gaps, bounds, membership, rects and
flags) before native setters. Both send observers carry flagged survivors from
source AND target. The production observer knows project intentional floats and
sticky exceptions; the standalone dev observer knows sticky exceptions but has
no project floating-ID registry. Both retain fullscreen/maximized overlays;
only `floating`/`fit_excluded` travel on the send wire.
Send writes source/target geometry then mover desktop membership. R4 writes
output then desktop membership then geometry, skipping overconstrained members;
its mid-transfer/follow fences check non-mover flags as well as scope. One fresh
exact target-arrival proof permits one follow, switch before focus, independent
of unrelated geometry settlement. Short flight-local source/target pins protect
even a new trailing target; separate unanswered-request and arrival deadlines
release on every terminal path. Failed writes, wrong/late/refused/stale replies,
closed movers and wrong-domain arrivals do not replay setters. Every terminal
send/R4 flight forces one complete source AND target Plan refresh through the
existing single-flight chain, bypassing equal-applied-evidence silence and
quarantining unreadable domains. No transaction-lifetime Plan block survives.

Regression evidence: the real standalone send observer and real Planner/Engine
fixture reproduced a fullscreen source survivor being omitted, then proved its
portable fit flag and retained Engine tile after the fix. Flag-only send reply
drift is fenced before setters; R4 non-mover flag drift after the first setter
stops remaining setters and follow. The production-wiring send fixture proves
both-domain refresh on arrival, delayed arrival, native failure, stale reply,
and unanswered request with late reply ignored; the R4 fixture covers release
and forced refresh on failure/deadline. The real-Engine floating-survivor row
exercises sticky-as-floating in the standalone observer; production
`floatingIds` flag observation has a production-observer fixture, but not a
real-Engine send row in that standalone fixture. Rapid sends with a complete target
observation commit immediately; a second send against a stale observation can
refuse and transiently remove the mover from Engine state until the next
complete observation re-admits it. The terminal both-domain refresh bounds
this risk; it does not fabricate a retry or native-success result.

An independent full-diff review found no blocking issue, but subsequent
test-first real-Engine rows exposed two missed send actuation gaps: a fullscreen
survivor's retained-tile geometry was written over its native overlay, and a
floating survivor omitted from tiled reply geometry caused a false
`precondition-mismatch` refusal. The send reply now requires exact tiled-member
geometry (never a floating-exception entry); overlay geometry remains covered
but is not written natively. The real-Engine floating correction is exercised
through sticky-as-floating in the standalone dev observer; the production
observer also carries project intentional floats. Flag-only mid-write drift stops remaining setters
without treating legitimately changed rects as stale. The real-Engine overlay
and sticky-floating rows pass; an adapter flag-flip row covers mid-write
refusal. Independent full-diff re-review found only the corrected dev-observer
evidence description above; a fresh review confirmed that correction clean.

Latest offline checks after these fixes: Rust `cargo test --workspace --offline`
(594 passed), `cargo fmt --all -- --check`, `cargo clippy --workspace
--all-targets --offline -- -D warnings`, `just check-portable`; KWin
`npm run typecheck`, `npm test` (733 passed, 0 skipped), `npm run build`, and
`git diff --check` all pass. Against `3e35961`, diff arithmetic including
untracked tests and Rust inline `cfg(test)` regions: Rust production +466/-2872
(net -2406), tests +906/-5330 (net -4424); KWin production +1565/-3986
(net -2421), tests +2187/-8844 (net -6657). Combined production net -4827.
No live acceptance
claimed. Manual live follow-up remains send to occupied/new trailing desktop,
rapid sends, native refusal/close, R4 occupied/empty/wrong-output, exact
follow/focus, both-domain phantom/re-admission and bounded correlated logs.
