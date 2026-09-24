# AR11: Workspace-send expectations

## Goal and scope

Adopt the user's 2026-09-23 selection of review 7.8: host observations own existence, domain and flags; the Engine owns layout within observed facts. Prototype on workspace send, replacing send's pending acknowledgement/verification path with a bounded expectation and convergence. Preserve same-UID authorization, owner/generation/correlation, prompt native-proof follow, focus preservation, in-flight workspace retention and correlated lifecycle diagnostics. Keep R4 and ordinary commands on their existing transaction model in this slice.

## Candidate design - implementation not accepted

### Facts, authority and scope

- `Fact::InDomain(DomainKey)` is the only initial send expectation, keyed by stable window ID, owner, generation, correlation, source and target. Store the observed sequence at issue and the existing send deadline (5,000 ms from initial request). `Rect`, flags and focused facts remain observations, not send expectations; native geometry may settle independently. A send does not infer closure from absence in its source/target: the adapter scans the full `workspace.windowList()` once (already used by `kwin/src/workspace-send-adapter-entry.ts`) and supplies a complete world membership index for that bounded native-window-list scope, including eligible and exception windows and windows on other outputs/workspaces. Each stable window appears once, carrying output, the complete native desktop membership list and flags; sticky/multi-desktop windows are present without inventing a single domain. Windows outside the managed domain still count as present. Native reads that cannot enumerate/identify the complete list reject the observation (including overflow), never masquerade as closure. A window observed elsewhere is a move, not a close; an unexpired in-transit mover remains in the modeled target even while its native fact still says source. A different observed destination is held until expiry, without adopting a false target.
- Send requests carry an exact complete source and target domain observation plus the world membership index, the scoped focus and the native observation sequence. Follow-up `send-observed` requests carry the same complete observation shape and the original send correlation; they resolve the expectation on observed target, on whole-world disappearance, or at the deadline. `send-observed` may also be sent after a lost reply and on deadline without replaying the native setter. Scope equality and whole-world uniqueness are checked before reconciling; neither a missing domain nor an empty eligible-window list asserts that a window has closed. Ordinary membership discovery outside the send pair stays on the existing adapter route pending AR4. Native classification of floats/fullscreen/maximized/sticky must be carried in the membership index, including exception windows previously filtered from send eligibility.
- Existing per-domain `Session`s remain canonical. Add a send-specific atomic two-domain transition over clones that preserves each occupied domain's authoritative tree, shares, focus and node identity; no reconstructing an occupied tree from current rectangles and no blind reset. An entirely fresh source/target can be seeded once with existing near-strip fitting, but may not replace a retained authoritative tree. In the transition, remove the mover from source and admit it to target, keeping unrelated domains and their independent revisions/fingerprints unchanged. Retain the two exact pre-transition Session clones for at most the expectation lifetime; the pair is interlocked against other model mutations during transit. If expiry finds the mover still in source and the fresh complete observation matches the applicable pre-transition membership (other members may have geometry drift), restore the **topology** of the cloned trees/focus/shares but advance both accepted revisions monotonically and bind each to its actual fresh per-domain observation fingerprint; never store the old Session clones verbatim. If intervening membership or flags changed, reconcile **all** affected members through a validated post-only membership transition before release, not just the mover; do not blindly restore a now-false membership. If that exact inverse/transition cannot be represented, fail the design review before implementation rather than silently rebuild.

### Observation sequence and protocol

- Introduce a generation-local strictly increasing `observation_seq` on native snapshots. It is not the existing route diagnostic/correlation counter or a Session revision. Increment on relevant native invalidation and each complete fresh snapshot used for planning; reject overflow and rebind to a new generation rather than wrap. The adapter takes a complete fresh snapshot before send, before every follow-up, and immediately before applying a returned plan. A reply echoes the sequence. The adapter applies a plan only when its sequence equals the latest completed snapshot, no relevant native invalidation intervened, owner/generation/correlation still match, and a fresh pre-write snapshot still agrees on required facts and scope. Otherwise drop it and observe/replan, without writing any stale plan. Core rejects a sequence not greater than its accepted high-water mark for that generation, except an explicitly idempotent exact same-correlation lookup if needed for a lost reply; a lost reply is instead recoverable via a newer `send-observed` request. Keep existing revision/fingerprint checking over actual carried data as an additional fence, never substitute the sequence for either.
- `send-to-workspace` request adds `observation_seq` and complete `world_windows` entries with stable ID, real output, native desktop IDs (possibly multiple/none for exception windows) and flags. The existing `revision`, `fingerprint`, `domain`, `target_domain`, `windows`, `target_windows`, `focused_window`, and `command` remain; both domain window lists are complete including exceptions. New `send-observed` uses the same envelope, the exact source/target scope, `observation_seq`, `world_windows`, and `command: {op:"send-observed",deadline_elapsed:boolean}`. Only the original one-shot deadline callback may set `deadline_elapsed:true`; same-UID/owner/generation/correlation are mandatory. No send `-ack/-verify/-status/-cancel` commands remain. Replies for both commands echo `observation_seq`, `correlation_id`, `outcome`, per-domain base revisions and final `desired_geometry`; the original send reply additionally carries a `SetWorkspace` instruction. A later observation reply never emits a second `SetWorkspace`. Reply kinds distinguish `planned`, `converged`, `waiting`, `expired`, `rejected` and `uncertain`; `planned` means model updated / dispatch allowed, **not** verified native completion. Wire validators reject missing/duplicate/foreign world entries, stale sequence, inconsistent source/target lists or owner/generation/correlation, and preserve strict DTO/byte bounds and same-UID authorization before parsing. Fingerprint the actual complete carried data, including the world index (or validate a separate world hash); pin goldens.
- Require a **bidirectional** world/scoped membership match: every single-desktop world member in either declared domain must occur exactly once in its domain observation, and every scoped member must occur exactly once in the world with matching flags. Validate individual per-domain revisions and fingerprints against their real complete observations before mutation; do not reuse the source fingerprint for the target, or attach a fresh fingerprint to a synthetic Session pre-image. A modeled transition based on observation may advance revision directly, but may not fabricate an adapter acknowledgement or native verification. Preserve a monotonic revision through expiry and through either domain's empty/retired slot.
- Keep the existing single-shot 5,000 ms KWin send timer as the deadline authority: arm exactly once at initial request (as the current pre-ack deadline does), never rearm on reply/observation; on firing send a fresh complete `send-observed` with `deadline_elapsed:true`. The core expectation records `issued` observation sequence and `expires_ms: 5000`, and expires only on the deadline callback attestation plus a newer complete observation. This uses existing KWin QTimer and same-UID trust rather than inventing a script-exposed monotonic wall clock (none is declared in `kwin/src/kwin-globals.d.ts`). A reply lost before dispatch still leaves a bounded timer; if activation fails before dispatch, trigger a fresh observation and early failure outcome. On restart, retire generation-bound expectations and reobserve on the new generation. Sequence fences apply to errors and late replies; no reply from an earlier snapshot may actuate.

### Lifecycle and convergence

- After a validated command, atomically update the source/target model and record `InDomain(target)` before replying; the adapter dispatches membership once, writes desired geometries only while current, and logs `dispatch`, `acceptance` (model plan), `completion` (fresh native target proof), or `uncertainty` separately under the same correlation. The original plan is never replayed after lost replies/timeouts. Any geometry drift is handled by bounded existing per-domain reconcile/park, not a loop of asserting the move. The adapter retains both workspaces until an expectation is met, expired, or its generation is retired. A second send can start after a fresh target proof without waiting for unrelated geometry echoes; two competing expectations for the same window or overlapping domains are serialized and the first is resolved before issuing the second. Independent domains, including their sends, are usable throughout.
- Native proof is a fresh stable-ID complete observation: mover absent from pinned source and present on exact target, with unchanged owner/generation/flight/scope. Follow at most once after that proof, promptly switch the target and focus the mover without waiting for geometry, ack or layout settling. Refuse follow on ambiguous, wrong-domain, missing or stale proof or changed active user focus; preserve unrelated active focus and do not steal it. Focus/switch failures are recorded, not retried or fabricated as success. Existing in-flight retention and native follow diagnostic schema remain.
- When the target fact is observed, clear expectation and log completion regardless of geometry mismatch (geometry remains separately reconcilable). If the mover is observed in source at expiry, re-admit to source using the retained topology placement and issue one bounded source/target geometry correction if the current sequence is still valid; log `diag: expectation-expired` and uncertainty, release retention and continue. If observed in another domain at expiry, converge membership to that domain only when its complete scoped observation and existing canonical domain state are available; otherwise keep it outside the send pair and defer normal admission until that domain is observed, without asserting it closed. If absent from the entire complete world at expiry, remove it as closed. A pre-dispatch rejection/failed activation also expires or cancels the unactuated expectation against a fresh complete observation; it never leaves a permanent block. Late target arrival after expiry is a fresh domain change handled by the existing adapter membership route until AR4, not a replay of the original send; no pending status/commit inference, setter replay or repeated reassertion. When a read fails at the deadline, latch expiry, report uncertainty and resolve on the next valid complete observation; no synthetic fact is accepted.
- Scope-specific interlock: an R4 pending transaction affecting source/target blocks new sends; a live send expectation blocks R4 or ordinary commands that would mutate its two modeled domains until native proof or bounded expiry. All unrelated domains continue independently. Retain existing owner/generation and correlation checks through the interlock, including after lost replies; never clear R4 pending on a send binding change. Preserve existing bounded reconcile/park behavior for other commands until AR4/AR11 later slices deliberately replace it.

### Removal and deferred scope

- Drop send `-ack/-verify/-status/-cancel` dispatch, `WorkspacePending` and its two-domain pending Session, send-specific per-window geometry/mover echo fences, send pending branches in `reconcile.rs`, and send terminal Plan blocking. Preserve R4's `DirectionalMovePending`, four phase ops and echo fences; preserve ordinary Session pending, verified commits and current reconcile policy. Remove only send-owned pair staging; introduce a direct topology-preserving send transition rather than changing unrelated pair code. The shared `reconcile.rs` pending state remains wherever ordinary/R4 operations require it.
- AR4 can use post-only complete observation to distinguish removed/changed/in-transit windows under these facts; its existing `Session::propose_remove` pre-image fence still needs a deliberate post-only transition implementation. This slice makes the invariant concrete for send but does not claim AR4 itself shipped.
- The send slice will supersede only the send portions of `docs/decisions.md` entries when shipped: 2026-09-22 pending-transaction status, pre-actuation cancellation, correlated pending observability, the workspace-send native-follow *commit-gated* clauses, and planned-send pre-ack deadline settlement/terminal blocking; preserve native-proof follow and the corresponding R4 decisions. It will also replace the send-specific permanent uncertainty exception to 2026-09-21 recoverability and send pair retention under the AR3 typed-engine decision. The 2026-09-23 user choice is already recorded as an approved direction, explicitly not shipped.

## Concrete transition contract (independently reviewed; not yet shipped)

This contract specifies the *send slice* only. It is a proposed implementation
contract, not a shipped decision. The user selected the authority and
recoverability requirements in `docs/decisions.md` (2026-09-23); the algorithms,
wire shapes and revision rules below are implementation proposals subject to
independent review. Independent feasibility review passed on 2026-09-24 after
fixing legacy-fingerprint migration and empty-domain revision continuity; the
review checked semantic feasibility against the existing Session, Engine,
protocol and adapter, and found no additional product choice. This authorizes
implementation against the contract, not a claim that its APIs already exist.

### Evidence and arithmetic shared by every row

`E(n)` means a newly completed, single-pass native world snapshot at sequence
`n`, with an explicitly declared complete `windowList()` scope and the exact
source and target `OutputDomain` observations. Each world entry contains one
stable ID, actual output, the *complete* native desktop-ID set (possibly empty
or multiple), normal/managed/minimized and floating/fullscreen/maximized/sticky
classification, and readable geometry for any scoped window. Include
ineligible/exception members; do not silently skip an unreadable, unidentified,
duplicate or overflowed window. An unavailable world read is **not** `E(n)`;
there is no inference from a partial read. A domain observation includes every
world window assigned to that exact output and exactly one desktop in its
native set, regardless of tiling eligibility; explicitly marked multi-desktop,
sticky, unassigned or otherwise unrepresentable entries remain in the world
index without a fabricated exclusive domain. The scoped lists may include
such entries only with an explicit nonexclusive marker, never as a tiled member.

Validate the declaration of world completeness and each entry's native reads;
unique stable IDs and unique native desktop IDs; valid bounds, flags and IDs;
and source/target scope equality with the expectation. Construct the expected
scoped member maps *from the world index* and compare in **both** directions:
every world member assigned to either domain occurs exactly once in that
domain list with identical output, full desktop set, flags and geometry; every
scoped entry occurs exactly once in world with the same fields and belongs to
the declared domain (or is explicitly nonexclusive there). No unexplained
foreign/duplicate/missing entry is accepted. A world member on another domain
is present, not closed. Complete-world absence alone proves closure. An
unrepresentable exception never becomes a tiled leaf. Verify owner/generation,
correlation, same-UID authorization, `n >` the generation's accepted sequence,
exact source/target keys and old domain revisions before any mutation. One
request consumes one `n`; failed validation does not consume it. The only
deadline evidence is the original one-shot callback's latched attestation plus
a newer valid `E(n)`; do not trust a timer value as native evidence.

`F(D,E)` is the portable, versioned fingerprint of the **actual observed**
domain bounds/gaps and *all* its scoped entries' stable IDs, real output,
complete desktop sets, real flags and rectangles, in deterministic order.
Nonexclusive entries included in the scoped list are hashed as nonexclusive.
The full world index also has a separately validated deterministic digest;
never put unrelated-domain entries into `F(D,E)`, never hash desired/model
membership as though observed. Pin both hashes in wire goldens. On a valid
snapshot independently verify both carried `F(source,E)` and `F(target,E)`.
On first send touching a legacy Session, the caller supplies both the exact
retained legacy accepted fingerprint and the freshly computed `F(D,E)`; check
the former against the Session's stored token and the latter against the full
fresh real observation. Compare *all* old tiled/exception IDs, domains and
flags against `E` before migration (reject any changed occupied domain rather
than assuming the prior native image), then accept `E` as a new forward
revision with `F(D,E)` on that domain. The legacy token is only a stale-base
fence, not claimed to hash the new observation; there is no historical native
snapshot to validate and no fingerprint stamped on a fabricated image. Both
domains migrate atomically with the send transaction; failed preflight leaves
both unchanged. Later send observations use only the new per-domain hash.
The fingerprint stored on a Session is always `F(D,E)` for the last accepted
real snapshot, including while the mover's model leaf is on target but the
native mover is still on source. A new sequence alone does not advance a
domain revision. A changed tree, observed domain fingerprint, bounds or
exception bookkeeping advances that domain's accepted revision exactly once,
from its current value to `+1` (refuse at maximum); unchanged domains retain
both revision and fingerprint. For send-touched domains, an empty canonical
slot retains its last `(revision, F)` as an owner/generation-bound tombstone; a
subsequent send or ordinary re-admission advances **from that tombstone**,
never starts at zero. A never-observed domain alone begins at zero as in AR4's
unshipped candidate. AR16 retired `MAX_DOMAINS`; the earlier tombstone
capacity clause is superseded. Tombstones are not silently evicted in the
same generation. Binding loss discards old-generation tombstones. Ordinary
operations elsewhere keep
their existing model; ordinary admission into a send-touched empty domain
consumes the retained revision. `Session`
needs a direct validated observation acceptance transition, separate from
ack/verify, that updates reconciler revision/fingerprint and topology
atomically; no synthetic pre-image, fake ack or `verified=true`. The *same*
real observation supplies the newly stored fingerprint and the post-only
membership/flag delta. Stage both domain clones, validate complete topology,
all tiled-leaf projections and revisions, then commit both or neither.

For every `E(n)` while the expectation is live, reconcile **all** source and
target entries, not only the mover: compare the entire observed membership
and flags with each retained canonical domain and staged expectation, remove
departures/now-exception leaves by existing recursive collapse, update
exception records, then admit every newly eligible member in stable native
snapshot order (existing target last-active split, or near-strip fitting only
if the domain has never had an authoritative tree). Retain unchanged tree
subtrees, node IDs, shares, focus stack and last-active; prune invalid focus
references and fall back to valid retained focus rather than stealing the
host's changed active focus. Move a known member between source and target in
one atomic pair transition, preserving its leaf when eligible. For members
observed on other domains, remove their pair record without claiming closure;
ordinary out-of-pair admission waits for that domain's complete observation
(AR4 remains deferred). Exception-to-tiled admission uses the same new-member
placement policy, never synthesizes old native flags. Reject the entire
snapshot without mutation if any membership/flag transition cannot be
represented and validated. During transit only, mask the *mover*'s observed
source presence when computing desired membership, keep its desired target
leaf, and retain actual source presence in `F(source,E)`; no other member is
masked. On expiry or completion the mask ends and *every* member is reconciled
again from the current real observation.

The two-domain lock belongs to one `(owner,generation,correlation,window,
source,target)` expectation; multiple disjoint locks may coexist. R4 pending
and any command mutating a locked domain are rejected for that overlapping
scope only; unrelated R4, sends and ordinary domains continue with their
independent revisions and fingerprints. Before issuing a competing send for
the same mover/domain pair, settle the earlier expectation using a fresh
observation; never stack contradictory masks. A one-shot 5,000 ms timer is
armed at initial issue even if the initial reply is lost, and never rearmed.
Plans/replies carry `n`, correlation, both domain base and accepted revisions,
their real observed fingerprints, exact scope, outcome and complete affected
tiled geometry; only the *initial* `planned` reply has `SetWorkspace`. The
adapter drops any reply whose owner/generation/correlation, latest snapshot
sequence, native invalidation epoch or fresh pre-write scope/facts do not
match; it observes again instead of dispatching or applying stale geometry.
Geometry corrections are one bounded write per valid new plan, never a setter
replay or an indefinite retry. Diagnostics are redacted and correlated, with
distinct `dispatch`, model `acceptance`, native `completion` and `uncertainty`.

### State/transition table

Each row requires the common bidirectional `E(n)` validation above *unless it
explicitly says there is no `E(n)`*. `S/T` denotes the independent source and
target Sessions; `advance` follows the per-domain arithmetic above. `G` is
complete affected-domain tiled geometry, never geometry for unobserved domains.

| From -> to | Additional input evidence and completeness | S/T transition and revision/fingerprint | Scope and plan | Logs and reply |
| --- | --- | --- | --- | --- |
| Idle -> issued | Initial `E(n)` proves mover is an eligible, focused single-domain tile in S, T is exact distinct same-output workspace; both complete scoped observations, independent revisions and fingerprints pass; no overlap with R4/send lock. An already occupied canonical S/T is validated against **all** observed members, not replaced by a fitted rebuild; newly seen changes are reconciled post-only first on clones. | Preserve both authoritative trees; remove mover from S, insert existing leaf into occupied T via remembered leaf/root placement; fresh T may seed its *actual* other eligible members once before inserting mover. Reconcile all other scoped members. Advance changed S and T independently once from their existing revision and store their respective actual `F(D,E)`; keep pre-send topology clones for inverse, not as restorable revision/fingerprint snapshots. | Lock only S/T; arm timer once; complete `G` for S/T and one `SetWorkspace`, fenced to `n`. Other domains/sends usable. | `acceptance: planned` (model only), `dispatch` after actual setter; reply `planned` with `n`, correlation, S/T base/accepted revisions, two fingerprints, `G`, one setter. If preflight fails: `rejected`, no setter, no lock or revision change. |
| issued -> observed-in-transit (or transit -> transit) | New `E(n)` proves mover still in S, or elsewhere but not exactly T, or ambiguous/nonexclusive; `deadline_elapsed=false`. Any other S/T changes are validated bidirectionally. | Keep desired mover in T and S masked **only for model**; reconcile *every other* member/flag/geometry change in both domains; advance each changed domain independently, binding actual `F(D,E)` even when model disagrees about mover. Do not claim other-domain presence is closure. | Preserve S/T lock and timer; emit `G` only for a genuine, safely applicable changed-domain correction, never another setter; no follow on wrong/stale/ambiguous evidence. Independent scopes proceed. | `acceptance: waiting` (or bounded drift diagnostic); reply `waiting`, `n`, correlation, current per-domain revisions/fingerprints and optional `G`; no `SetWorkspace`. |
| issued/transit -> met | New `E(n)` proves mover **only** on exact T, absent S, still eligible, same owner/generation/flight; focus proof also checks pinned active user focus. All S/T members validated. | Reconcile **all** S/T members/flags on real post-observation, including mover, clear mask/expectation; advance only changed domains, each with its own real `F(D,E)`. Geometry mismatch never delays this completion. | Release only this lock/retention and timer token. Emit at most one fresh `G` correction; prompt one-shot native switch/focus after proof if the user has not focused elsewhere; no second setter, no geometry wait. Other locks unaffected. | `completion` under original correlation, focus/switch attempt outcome separately; `converged` reply with `n`, S/T revisions/fingerprints, `G` if needed. A stale or unrelated-focus proof never triggers follow. |
| issued/transit -> expired (observation available) | Sole original deadline callback latched `deadline_elapsed=true`, and a **newer** complete `E(n)` passes all validation. Mover's full world entry resolves uniquely to S, T, another domain, nonexclusive, or is absent everywhere. A fresh pre-dispatch activation failure uses the same complete observation and marks unactuated failure, not success. | If S: rebuild S from retained *topology* placement for mover plus all-member current truth; remove mover from T, reconcile every other member and every changed flag; advance both changed Sessions **forward** (including S re-admission and T removal), bind each to its actual `F(D,E)`. If T: apply `met` instead. If elsewhere: remove from S/T, defer admission outside pair until a complete observation of that other canonical domain; if nonexclusive: represent only as deferred exception, never force a tiled domain. If absent from complete world: remove as closed. Reconcile all remaining S/T members in every case; never assign retained clones' old revision/fingerprint. | Release only this lock and retained pair after successful real-observation transition; one bounded fresh `G` correction in S/T; no setter/follow replay. If topology/post-only reconciliation cannot validate, do not falsely settle: keep deadline latched and uncertain until valid reconciliation, without blocking other scopes. | `diag: expectation-expired` plus `uncertainty` (or `completion` when T proof), including redacted disposition `source/other/nonexclusive/closed`; reply `expired` (`converged` if T) with `n`, per-domain revisions/fingerprints and `G`; distinguish failed native dispatch. |
| issued/transit -> expiry-latched (observation unavailable) -> expired/met | Timer fires once, complete world read fails or lacks a stable ID/flag/geometry/desktop; **no `E(n)` exists**. A later complete fresh `E(n)` with the same latched deadline attestation is required; validate it in both directions before using the preceding expiry/met row. | No Session/revision/fingerprint mutation on failed read; keep mover modeled on T, pin S/T and retain timer-expiry latch. Later valid `E(n)` advances revisions only according to actual changed domains and releases this lock. | No geometry or setter/follow on failed read. Other scopes proceed; the adapter schedules a bounded next fresh observation on relevant native invalidation/explicit request without restarting the 5,000 ms clock. | `uncertainty: observation-unavailable` with correlation; `uncertain` reply if transport is available, else local correlated diagnostic. On next valid read send `expired`/`converged`, never imply closure from a missing scoped list. |
| met/expired -> superseded by later command | Old lock released after full `E(n)` and complete reconciliation, then later request has a **new** complete `E(m)` (`m>n`), new correlation and ordinary focus/eligibility checks. A competitor while the old lock remains receives overlap refusal until old is resolved with fresh evidence. | The later command starts from current canonical S/T (including monotonic revisions and actual accepted fingerprints); advance only its actually changed domains. No revival of old clone, expectation, follow or setter. | New lock only for the later pair; disjoint sends were never blocked. Old late replies fail sequence/flight fences. | Old terminal result stays correlated to old command; new `planned`/`rejected` reply and new `acceptance`/`dispatch` logs under new correlation. |
| issued/transit/expiry-latched -> owner or generation loss | Binding change or lost owner proof; no cross-binding `E(n)` is accepted. Any subsequent new-generation work requires its own complete fresh snapshot and bidirectional validation. | Retire old expectation/clones and per-generation sequence; never transplant old revisions/fingerprints to a different binding. R4's separate pending binding/divergence rules stay intact. Reinitialize new-generation S/T only from new actual observations, with independent revisions/fingerprints. | Invalidate timer/flight/replies and release old send lock; do not emit a plan or follow for old binding. Unrelated new-generation work can start after fresh observation. | Redacted `uncertainty: binding-lost` for old correlation; old reply `rejected`/`uncertain` if deliverable, new commands receive their own correlation and outcome. |

Prior implementation review findings are resolved at: incomplete world-to-domain
validation -> shared `E(n)` bidirectional check and **issued/transit/expired**;
decreasing revisions on failed-send expiry -> shared revision arithmetic and
**expired-source**; fingerprint bound to model-derived data -> `F(D,E)` and
**every** row; incomplete changed-member reconciliation -> shared all-member
delta and **transit/met/expired**; global guard blocking unrelated sends ->
per-expectation interlock and **issued/superseded**; unavailable deadline
observations -> **expiry-latched**. Independent code-based design review passed
before implementation; core implementation still requires its own independent
row-by-row review before protocol/adapter integration.

## Bounded units and verification

1. Independent design review against these invariants and actual code, including clock/sequence, exact inverse and complete native observation. Iterate; stop if an invariant requires a further product choice.
2. Implement core send transition/expectation and scoped interlock with targeted portable regressions; keep R4/ordinary behavior green.
3. Implement thin protocol DTO/fences/replies and byte-exact wire goldens; keep Rust checks green.
4. Replace KWin send actuation/observe/follow route and entry integration, including stale reply drop, bounded timeout and redacted lifecycle logging; run KWin checks.
5. Independent implementation review; full Rust fmt/check/clippy/test, `just check-portable`, KWin typecheck/test/build. Regress rapid sends, expiry re-admission, stale plan drop, transit preservation, prompt proof follow, focus preservation, independent domains. Account for Rust/KWin test count changes and lines removed. Update shipped decisions and backlog; record live user acceptance for rapid sends and failed-send convergence. Archive when accepted.

## Current outcome and blocker (2026-09-23)

The independent design reviewer first rejected an incomplete world-index description, then passed the revised design as **feasible**, not implemented. Its timer correction replaces the unavailable script monotonic clock with the existing one-shot 5,000 ms QTimer and a fresh-sequence deadline attestation. A timer firing while native observation is unavailable must leave `deadline_elapsed` latched until the next valid complete observation. The review found no additional product choice.

Two core implementation approaches were attempted and rejected; neither is retained in the tree. The first used a synthetic accepted acknowledgement/verified post and copied the source fingerprint to the target. A causal repair removed that fake verification and added direct commits/world entries, but independent implementation review rejected it as a production foundation: `validate_send_world` checked scoped-to-world only (a world member could be silently omitted from its domain); expiry restored old clones with decreasing revision/fingerprint; a removal applied a fresh fingerprint to model-derived rather than observed members; drift reconciled only the mover and left other changed members stale; and a global send guard blocked unrelated domains. The core also relied on adapter timeout attestation without an implemented bounded adapter. Passing 361 core tests and `just check-portable` in the second experimental tree did not establish these invariants. All experimental core edits were restored so the repository remains green at the existing baseline. No protocol, TypeScript, wire goldens, shipped decision or live acceptance was produced. Do not integrate either discarded approach.

The exact next slice is to make the above bidirectional membership, real per-domain fingerprint/revision, monotonic expiry transition and all-member post-only reconciliation into an independently reviewed **concrete transition contract** (including fresh occupied domains, exception flags, independent send scopes and unavailable observation at deadline) before another implementation attempt. This is design completion, not authorization to repeat the same semantic approach. AR4 remains deferred behind AR11; its post-only removal is not unblocked in shipped code. Keep this note active until implementation passes all acceptance checks.

Baseline verification after restoring experimental code: `cargo fmt --all -- --check`, `cargo check --workspace`, `cargo clippy --workspace --all-targets` (existing warnings), `cargo test --workspace` (585 passing), `just check-portable`, and in `kwin/`, `npm run typecheck`, `npm test` (715 passing), `npm run build` all passed. Strict `cargo clippy --workspace --all-targets -- -D warnings` fails on existing lint warnings in unmodified core files; it is not claimed green. No wire goldens changed and no implementation lines removed.

## Second implementation stop (2026-09-24)

The concrete transition table above passed independent design feasibility review
after clarifying first-touch legacy fingerprint migration and monotonic
empty-domain tombstones. A new core attempt passed 231 core library tests and
portable checks, but the first independent core review found that the exact
legacy fingerprint token was not checked, exclusive world members could be
mislabelled nonexclusive, and the registry was outside Engine's canonical
ownership. Repairs passed a second independent core review. Protocol and KWin
integration then passed offline unit tests but a full independent review found
four acceptance failures: the native observer looked for focused mover only
in source and therefore could not furnish target proof for the core follow
gate; the foreground adapter's global send guard refused unrelated-domain
commands; expiry misclassified a same-output third workspace as nonexclusive;
and the adapter retained old-generation revision baselines and leaked a
locally proof-mismatched completed flight until timeout. Green unit suites did
not exercise the cross-component native observation path. These are two more
failed implementation reviews (one core, one full integration), so stop under
the assignment's explicit limit. All experimental core, protocol, KWin and
golden edits were restored; the reviewed contract remains here as design
input, not shipped behavior. `docs/decisions.md` must continue to describe
the existing send pending path. AR4's post-only removal remains blocked.

Recommendation: resume only after a small vertical cross-component fixture
using the *same native observer* that drives production has verified issued,
transit, met, same-output third-workspace expiry, unavailable deadline and
unrelated-domain foreground commands through the typed core and wire. Preserve
those checks while replacing the pending path; isolate the adapter's scope
guard and observation seam before another broad implementation. AR5's layout
policy/Session split is orthogonal to these integration failures and is not a
prerequisite on current evidence. No shipped send decisions, live acceptance,
or lines removed resulted from this attempt.

After restoration, `cargo fmt --all -- --check`, `cargo check --workspace`,
`cargo clippy --workspace --all-targets` (existing warnings only),
`cargo test --workspace` (585 passing), `just check-portable`, and in `kwin/`
`npm run typecheck`, `npm test` (715 passing) and `npm run build` all passed.
`git diff --check` passed. Only this active change note and the AR11/AR4
backlog status changed; no code, wire golden or test-count change ships.
