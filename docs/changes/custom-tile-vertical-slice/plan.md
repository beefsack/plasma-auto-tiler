# Plan: Custom Tile Vertical Slice

Ownership and approval:
- Owner: Lead (`lead-openai`)
- Change class: Standard.
- Status: Approved by the user on 2026-08-10.
- Governing scope: [specification](spec.md); current execution status: [state](state.md); checkpoints: [log](log.md).
- Cross-change boundary: the active [integrated-plasma-structural-feasibility change](../integrated-plasma-structural-feasibility/) supplies accepted structural discovery only. Its unsafe live harness and nested-KWin path remain blocked. This change owns any useful runtime discovery through unit-05 only, under separate authorization.

## Technical Approach

Establish a strict development-only TypeScript foundation and defensible KWin
type provenance before writing behavior. Keep topology and hit testing pure and
fully testable, then add the smallest guarded adapter and generated bundle.
Unit-03 may produce conditionally unvalidated production adapter source, but
static evidence cannot establish fail-inert behavior for `CustomTile.split()`:
it mutates before JavaScript can decode its return. All non-split boundaries
must fail inert through strict decoders and guards. Unit-05 is the mandatory
first live structural invocation and acceptance gate for unit-03 behavior; no
delivery, enablement, or runtime capability claim precedes its fresh user
authorization and passing evidence.

Current-workspace/output adapter state uses session-local exact `Output` object
identity plus virtual-desktop ID. It clears pending state on output removal,
replacement, or scope change, and does not survive restart or hotplug. KWin
retains persistent topology; stable multi-output identity remains deferred.

## Work Units

| ID | Status | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|---|
| unit-01 | Accepted 2026-08-10 | Establish the development-only Node/TypeScript build and test foundation. First search high-quality upstream or official KWin/KDE TypeScript types during implementation, record suitability and provenance, and use them if suitable. If no suitable type source exists, record that evidence and define only the narrow source-pinned local subset needed. Enforce strict controls: no `any`, unchecked casts, non-null assertions, or manual generated-JS edits. `devenv.nix` now declares `nodejs_24`; stop before assuming the toolchain is available until the user restarts the session. | none | Toolchain, TypeScript configuration, type provenance, build/test scripts, generated-artifact policy | No | After restart, strict build and test commands must pass; provenance records upstream search or justified local-subset fallback; package metadata must prove tools are development-only; generated bundle must be reproducible. |
| unit-02 | Accepted 2026-08-10 | Implement pure deterministic topology and hit-test logic with executable vectors. Cover keyboard insertion to the right of the focused occupied leaf; four directional regions over a different occupied leaf; central 50% no-op; horizontal diagonal-tie precedence; cancellation origin restoration without target mutation; retained empty origin after successful drag; and ordinary placement into a retained empty leaf without restructuring. | unit-01 | Pure TypeScript topology, hit testing, vectors, and tests | No | Tests run without KWin/Qt and assert each journey plus current-workspace/output-independent invariants. |
| unit-03 | Statically complete 2026-08-10; structurally gated by unit-05 | Add conditionally unvalidated KWin adapter source and generated bundle. Keep authored production code TypeScript-only, guard every KWin/Qt boundary value with strict decoders, fail inert for every non-split boundary, limit behavior to the current workspace/output, and regenerate rather than hand-edit JavaScript. Do not claim fail-inert structural behavior: `CustomTile.split()` mutates before its JavaScript result can be decoded. | unit-01, unit-02 | KWin adapter, bundle entry point, generated JavaScript artifact | No | Strict build regenerates the bundle; static checks demonstrate guarded non-split handling and generated-artifact provenance. Unit-03 structural behavior remains unaccepted until unit-05 passes. |
| unit-04 | Accepted 2026-08-11 | Perform static and unit safety review of the completed slice. Check strict TypeScript controls, runtime guards, type-provenance evidence, generated-artifact policy, package dependency boundaries, scope exclusions, all executable tests, and the minimal production observability required to attribute the separately authorized smoke. | unit-01, unit-02, unit-03 | Static checks, unit tests, build output, review evidence | No | The registration-result observability correction typechecks, builds, passes 83 tests, and satisfies generated-bundle, metadata, privacy, ASCII, and whitespace checks. Fresh `unit-04/attempt-07` independent review found no defect; Lead inspected its cited source, tests, declaration, and generated ES2017 IIFE evidence. |
| unit-05 | Partially live-proven, unaccepted; live validation parked after final `attempt-25` infrastructure stop | Run the mandatory first live structural invocation and acceptance gate for unit-03 only after preflight blockers are resolved. It must establish the guarded Qt sequential-container boundaries, `windowAdded` readiness, Esc finish behavior, and the first `CustomTile.split()` result before any delivery, enablement, or runtime capability claim. It must not install or enable anything beyond the exact authorization, broaden scope, or reuse the feasibility change's blocked harness/nested path. | unit-04, unit-03, separate fresh user authorization | Authorized live KWin smoke only | Yes, separately authorized | `unit-05/attempt-18` live-proved Client A eligibility and automatic placement, then Client B rejected at `keyboard-rejected:target-occupancy-validity`; Client C and manual journeys were not attempted. Final `attempt-25` prevalidated a detached heartbeat, but its newly launched supervisor exited normally before its required ready marker and before any KWin mutation. Live validation is parked; Unit-03 structural behavior remains unaccepted and no runtime capability result is claimed. |
| unit-06 | Accepted 2026-08-11 | Bounded, source-only observability correction: split the single combined `window-added-rejected:eligibility-or-scope` diagnostic in `handleWindowAdded()` (`kwin/src/controller.ts`) into six mutually exclusive, exhaustive sub-codes, mirroring the existing `keyboard-rejected:*` design, with no change to accept/reject behavior for any window and no addition of private payload data. Purpose: let a future live smoke (`unit-05/attempt-16`) pinpoint exactly which condition rejected `unit-05/attempt-15`'s test client. | unit-04, unit-05/attempt-15 evidence | `kwin/src/controller.ts` (`handleWindowAdded`, new private `windowAddedRejection` helper), `kwin/tests/controller.test.ts` | No | Strict typecheck/build/test pass (141/141 tests, 23 suites, up from 140/23); regenerated bundle SHA-256 `d0a3ae1d50863806ee05033802213a7680fa38243696c218605c105a6a140adb` (from baseline `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`); Lead independently re-ran typecheck/build/test and read the changed source before accepting; independent review Worker separately confirmed no behavior change, exhaustiveness/mutual distinguishability, exactly-one-code-per-rejection, payload privacy, and no generated-file hand-editing. |
| unit-07 | Accepted static correction 2026-08-12 | Make the manual launcher fail closed unless same-KWin-PID fixed diagnostics prove all shortcut registrations completed and startup handlers are ready, with no disabled diagnostic. Move only the two focus shortcuts that collide with active keyboard-layout bindings to unused `Meta+Alt+Ctrl` equivalents. This is launcher attribution and shortcut-conflict remediation only, not callback delivery or broader runtime acceptance. | unit-04 | launcher, focus shortcut declarations/vectors, launcher usage | No | Mocked launcher vectors require ordered readiness diagnostics for success and reject a disabled controller without a success line. The all-component collector finds no active/default records for the two replacement sequences; strict typecheck/build/test remain required. |
| unit-08 | Accepted static correction 2026-08-12 | Replace legacy focus defaults with conflict-free `Meta+H/J/K` and move defaults with conflict-free `Meta+Shift+H/J/K/L`. Defer all requested arrow variants because active Krohnkite actions own them, and defer focus-right `Meta+L` because active Session Management owns it; retain the safe existing focus-right fallback. | unit-07 | shortcut registrations, focused catalog/callback/failure tests, handover | No | Read-only all-component KGlobalAccel records establish exact owners. Source-pinned KWin API accepts one sequence string per action, so no multi-sequence action exists. `npm --prefix kwin run typecheck`, `npm --prefix kwin run build`, and `npm --prefix kwin test` pass with 265 tests across 37 suites. |
| unit-09 | Accepted static correction 2026-08-12 | Make the manual `start`/`status`/`stop` lifecycle reliable and truthful. Start uses a bounded 30 x 100 ms same-KWin-PID after-cursor readiness poll and rejects disabled or malformed evidence. Status separately reports loaded state, unproven running/callback state, readiness evidence, and exact project KGlobalAccel records with active/default sequences. Stop uses only exact-plugin unload, verifies absence, and never unregisters actions. | unit-08 | launcher, focused mocked shell tests, live-testing guide | No | Static checks passed with 265 tests across 37 suites and 48 mocked shell checks. One authorized live `start -> status -> stop` validation succeeded: Script0 readiness was reported from one ordered same-PID aggregate registration/readiness pair with no disabled-registration diagnostic; status found 13 exact `kwin` records and stop verified unloaded. Persisted records are explicitly not callback proof. |
| unit-10 | Accepted static correction 2026-08-12 | Add one guarded active-window detach action only after direct pinned-source evidence proves the writable `Window.tile` null contract. Revalidate active identity, eligibility, scope, non-layout Custom Tile association, and topology immediately before exactly one write; report a fixed private postcondition failure without rollback. | unit-09 | controller, boundary/declarations, controller/boundary tests, lifecycle action collector | No | Pinned KWin 6.7.3 `window.h` exposes writable `tile`; `setTileCompatibility(nullptr)` calls the prior tile's `unmanage`, which clears the requested tile and restores geometry. The 13-action aggregate gate, focused controller/boundary tests, typecheck, build, test, and lifecycle mock checks pass. |
| unit-11 | Accepted static correction 2026-08-12 | Make controller-owned deferred placement and armed keyboard insertion inert when KWin reports a source or target window removed. A cancelled 50 ms callback must confirm it still owns its deferred entry before reevaluating; armed insertion retains only source/target wrapper identity until cleared. | unit-10 | controller removal handling and focused controller tests | No | A forced queued-after-cancel callback cannot manage a removed window; source removal clears the arm before the next addition; duplicate removals are inert; disabled registration keeps callbacks and connected workspace signals inert. Typecheck, build, 279 tests across 39 suites, and 49 lifecycle shell checks pass. |
| unit-12 | Accepted static correction 2026-08-12 | Implement minimal explicit ephemeral, self-validating selected-overlay state for a successfully user-applied focused-leaf preset overlay. Recorded only after all structural execution and occupant assignments succeed; per exact current desktop/output scope; replaced only by a later same-scope success. A narrow `readSelectedOverlay` seam verifies scope match, current Custom Tile-root reachability, and intact ordinal leaf realization, discarding structural drift inertly with one fixed diagnostic. Prepares a later bounded assignment-only reflow only; no automatic reflow or persistence. | unit-11 | `kwin/src/controller.ts` (`SelectedOverlay`, per-scope record, `readSelectedOverlay` seam, `decodeTileTree`/`collectPresetLeaves`), `kwin/tests/controller.test.ts` | No | Strict typecheck/build/test pass with 293 tests across 40 suites and 49 lifecycle shell checks; generated bundle SHA-256 `fb956315d95fbe9c409e8381ff8e77ea0cd23aa11eef00347a5643249d5bec9c`. |
| unit-13 | Accepted static correction 2026-08-12 | Consume only currently valid explicitly selected-overlay state for bounded automatic lifecycle reflow after relevant eligible additions, removals, and successful detaches. Build a complete assignment plan from current ordinal leaves and eligible in-scope occupants, compacting without topology mutation; validate state, scope, capacity, occupant eligibility, and source/target assumptions before planning and immediately before each guarded `window.tile` write; stop on first failure without rollback claim. A full overlay must fall through to the existing generic automatic-placement behavior. | unit-12 | controller lifecycle handlers and focused controller tests | No | Focused vectors cover removal and detach compaction, eligible addition/capacity fallback, stale state, no-op and ordering, scoped/external eligibility rejection, multiple scopes including scope-loss inertness, preflight and mid-write failure, and absence of structural calls. `npm --prefix kwin run typecheck`, `npm --prefix kwin run build`, and `npm --prefix kwin test` pass with 314 tests across 42 suites and 49 lifecycle shell checks. |
| unit-14 | Accepted static correction 2026-08-12 | Generalize guarded keyboard insertion to individually conflict-free `Meta+Alt+Left/Right/Up/Down` actions. Re-arming atomically replaces source and direction; the next eligible unassigned in-scope window revalidates source, target, scope, occupancy, and split result before one directional split and source-first child assignments. | unit-13 | controller, pure logic, focused tests, lifecycle action catalog | No | Exact conflict inspection found Left, Up, and Down active-owner-free; all 16 registrations passed their aggregate gate. Typecheck, build, 325 tests across 42 suites, and 137 lifecycle shell checks passed. One registration-only `start -> status -> stop` sequence confirmed 16 exact records without callback or topology mutation. |
| unit-15 | Accepted static correction 2026-08-12 | Add a guarded active-window attach action as the assignment-only inverse of detach. It selects only the first empty authored non-layout Custom Tile leaf in decoded traversal order, then revalidates active/source/target/root immediately before one pinned writable `window.tile` assignment and decodes the association postcondition. It makes no topology or occupant change. `plasma-auto-tiler-attach` registers `Meta+Alt+Shift+Space` only after an exact read-only KGlobalAccel scan found no unrelated active conflict. | unit-14 | controller, boundary/declarations, action catalog, focused controller/boundary/lifecycle tests, docs | No | Typecheck, build, 339 tests across 43 suites, and 192 lifecycle shell checks pass. Read-only reconciliation reports 17 matched actions with zero drift, missing records, ownership errors, and unrelated target conflicts. A fresh callback preflight stopped before start or window launch because no available read-only seam can prove that KWin's active window is the exact owned test window before either mutation. Plugin status is unloaded; no callback or window/topology behavior is claimed. |
| unit-16 | Accepted static focus correction 2026-08-12 | Correct directional neighbor selection so a non-overlapping leaf that touches the focused leaf's facing edge is eligible at distance zero. | unit-15 | Pure directional geometry and focused controller tests | No | The supplied diagnostics prove two delivered focus callbacks rejected only at `focus-rejected:no-neighbor`; adjacent occupied-leaf vectors now select and write the target. Typecheck, build, 389 tests across 46 suites, and 194 lifecycle shell checks pass. |
| unit-17 | Accepted source and registration correction 2026-08-12 | Add separate project-owned focus and move arrow alias actions because KWin registers one source default per action. Keep H/J/K/L actions and all guarded callbacks unchanged; expand the all-or-nothing catalog and lifecycle reconciliation. Clear only exact active Krohnkite desired-arrow sequences after snapshotting and verifying each action, never deleting records or changing nonconflicting sequences. | unit-16 | Controller shortcut catalog, lifecycle reconciler/tests, exact KGlobalAccel records, live guide | Yes, explicitly authorized | The 27-action catalog has eight aliases. Typecheck, build, 389 tests across 46 suites, and 202 lifecycle shell checks pass. One `start -> status -> stop` lifecycle confirmed all 27 records; read-only reconciliation then confirmed 27 matched, zero drift/missing/ownership errors/unrelated conflicts after the exact Krohnkite sequence clears. |
| unit-18 | Static-only source-safe foundation 2026-08-12 | Establish whether exposed scripting writes can reset arbitrary Custom Tile topology without guessing. Model a guarded collapse that preflights every decoded occupant, unmanages before removal, preserves the original root identity, and requires fresh decoded postconditions after every void removal. Do not wire lifecycle ownership or run live structural mutation until the runtime remove/promotion/list contract is proven. | unit-17, pinned KWin source | No | Pinned `customtile.h` exposes `Q_INVOKABLE void remove()`; `customtile.cpp` removes the child, can recursively remove/promote a non-root single-child layout, re-picks residual occupants, and ends in `deleteLater()`. Pure fakes cover three-leaf/nested/singleton trees, root preservation, unmanage rejection, throwing/no-op remove, and mutation-possible reporting. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Generated-Artifact Policy

- TypeScript is the only authored production language for the KWin component.
- KWin executes generated bundled JavaScript only.
- Generated JavaScript is produced by the recorded build and is never manually
  edited.
- Development tools remain build/test dependencies only and are not runtime
  product dependencies.

## Restart Checkpoint

`unit-01/attempt-01` prepared strict TypeScript manifests, placeholders, the
Node built-in test route, output ignore policy, and the `nodejs_24`
`devenv.nix` declaration. Its tentative `kwin-api@6.7.1` selection was rejected
by the independent `unit-01/attempt-02` type-quality gate. The documented
narrow, source-pinned KWin 6.7.3 local subset is required instead.

`unit-01/attempt-04` accepted the narrow local declaration recovery, and
`unit-01/attempt-05` generated the pinned lockfile through the project package
manager. The declared typecheck, build, and test commands passed after one
manifest-only correction to the explicit Node test-runner path. The unit is
accepted; no production behavior was added.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Strict toolchain, type provenance, and generated bundle policy | unit-01 provenance record, strict configuration, package metadata, and reproducible build evidence |
| Deterministic topology and hit testing | unit-02 executable vectors and tests |
| Guarded current-workspace/output adapter | unit-03 adapter and regenerated bundle evidence; unit-05 mandatory structural acceptance gate |
| Static and unit safety controls | unit-04 review record, strict checks, build, tests, and fixed-payload production-observability timing/privacy evidence |
| Launcher shortcut readiness | unit-07 same-PID diagnostic gate and mocked launcher regression vectors; no callback-delivery claim from persisted shortcut records |
| Safe directional vocabulary | unit-08 exact catalog and registered-callback vectors; all-component read-only KGlobalAccel ownership evidence |
| Truthful manual lifecycle | unit-09 strict launcher tests, typecheck/build/test, and read-only plugin/action evidence |
| Guarded active-window detach | unit-10 source-pinned writable-property evidence, exact catalog/collector coverage, and focused static failure/postcondition vectors |
| Removal bookkeeping | unit-11 cancellation-identity and source/target wrapper bookkeeping, with forced queued-callback, armed-source-removal, duplicate-removal, and registration/signal-gating vectors |
| Selected-overlay lifecycle reflow | unit-13 focused controller vectors plus typecheck, build, full suite, and lifecycle shell checks |
| Guarded active-window attach | unit-15 focused controller/boundary/lifecycle vectors plus typecheck, build, full suite, and lifecycle shell checks |
| Adjacent-leaf directional focus | unit-16 exact edge-touch selector and controller focus-write vectors, plus typecheck, build, and full suite |
| Project-owned arrow aliases | unit-17 exact metadata/default/callback and all-or-nothing vectors, lifecycle catalog source-sync checks, exact KGlobalAccel snapshot/clear/postflight evidence |
| Separately authorized runtime behavior only | unit-05 exact authorization and mandatory-gate record; no delivery, enablement, or runtime capability claim beforehand |

## Residual Risks

- Suitable official TypeScript types may not exist or may not cover the narrow
  KWin/Qt boundary, requiring a source-pinned local subset.
- The KWin Custom Tile surface may require runtime discovery that static/unit
  evidence cannot establish. In particular, `CustomTile.split()` mutates before
  JavaScript can decode its result; unit-05 is its mandatory first-live gate and
  requires separate authorization.
- The slice deliberately does not establish multi-output, hotplug, persistence,
  broader layout, performance, or product-packaging behavior.
- No installed same-Qt QJSEngine parser is available for static acceptance. The
  ES2017 generated-syntax regression removes the observed ES2019 optional-catch
  incompatibility but cannot establish full runtime parser or API compatibility.

## Progress

- [x] unit-01 Toolchain/type provenance and strict foundation (static correction, install, and checks)
- [x] unit-02 Pure deterministic logic and executable vectors
- [ ] unit-03 Guarded KWin adapter and generated bundle (statically complete; unit-05 gated)
- [x] unit-04 Static/unit safety review (registration-result observability reaccepted 2026-08-11)
- [ ] unit-05 Separately authorized runtime smoke
- [x] unit-06 Fine-grained `window-added-rejected:*` sub-code observability correction
- [x] unit-09 Manual start/status/stop lifecycle correction
- [x] unit-10 Guarded active-window detach static correction
- [x] unit-11 Removal bookkeeping static correction
- [x] unit-12 Selected-overlay state (accepted 2026-08-12)
- [x] unit-13 Selected-overlay lifecycle assignment-only reflow (static correction, 2026-08-12)
- [x] unit-15 Guarded active-window attach action (static correction, 2026-08-12)
- [x] unit-16 Adjacent-leaf directional focus correction (static correction, 2026-08-12)
- [x] unit-18 Guarded Custom Tile reset foundation (static-only, 2026-08-12)
- `unit-05/attempt-07` aborted before bundle load when the exact-owned supervisor
   did not detach from the command runner; its completed cleanup restored the
   reviewed baseline. No registration/discovery evidence was obtained.
- `unit-05/attempt-08` registered all five actions and reached ordered readiness,
  but its all-component checkpoint parser was invalid; it failed-clean and did
  not establish the required t+0/t+1/t+5 registration evidence.
- `unit-05/attempt-09` validated the corrected collector read-only, then aborted
  before load because its two owned capture processes did not survive the command
  runner. The supervisor cleanup made unconditional targeted unregister calls
  despite no attempt action registering, a scope defect; postflight restored the
  exact absent-action baseline. No runtime acceptance is established.
- `unit-05/attempt-10` failed-clean before load after its detached supervisor
  reached ready/start but the foreground supervisor gate returned unexpectedly.
  It used no journal follower or capture process. Empty ownership manifests
  caused zero unload and unregister calls; postflight restored the exact baseline.
- `unit-05/attempt-11` passed the corrected supervisor gate but failed-clean
  before ScriptN run when its unretained `loadScript` JSON result did not satisfy
  the foreground load-ID parser. Exact loaded-state recovery recorded and
  unloaded only the plugin; no action registered or ran.
- `unit-05/attempt-12` retained and strictly parsed the load response, ran only
  the returned object, then stopped at the empty required journal-diagnostic
  gate. The plugin unloaded, but five project shortcuts persisted without a
  validated action manifest; exact-manifest cleanup forbade unrecorded
  unregister calls. This is an unclean failed attempt, not runtime acceptance.
- `unit-05/attempt-12` recovery reconciliation found, read-only, that a prior
  cancelled dispatch had already removed all five persisted actions/config keys
  and restored the exact pre-attempt-12 `kglobalshortcutsrc` baseline; zero
  further `unregister` calls were needed or issued. This does not change unit-05
  or unit-03 acceptance status.
- `unit-05/attempt-13` (Lead-direct, registration/discovery-only, non-interactive,
  no Worker) proved the corrected `--user`-scope journal-capture path end to end
  with a true-positive `logger` marker before it gated anything, then ran the
  full preflight/load/registration/readiness/cleanup/postflight cycle cleanly.
  Preflight matched the exact recorded baseline (bundle
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`, both
  Pings, PID 2517, Krohnkite/all known scripts unloaded, five actions/keys
  absent, 19/322 collector baseline, desktop/output/former-group/13-group
  tiling/non-project-shortcut fingerprints unchanged). The raw `loadScript(ss)`
  response `{"type":"i","data":[0]}` was atomically retained before a
  fail-closed parse, `/Scripting/Script0` was introspected before any method
  call, and only that object's `run()` was invoked. The after-cursor `--user`
  read (fixed cursor immediately before load, one bounded synchronous read
  after `run()`) captured the required ordered diagnostics
  `boundary-decoded:workspace-window-list` -> `shortcut-registered` ->
  `startup-handlers-ready` with strictly increasing timestamps, no `disabled`
  event, and independently zero `QT_CATEGORY=kwin_scripting` records. Plugin
  ownership was recorded immediately after confirmed load; action ownership was
  recorded immediately once the collector confirmed all five exact records
  under `kwin/default` (t+0 and t+1 snapshots each showed exactly one
  source-consistent record per action, no duplicate/unknown project record).
  No action invocation, client, desktop, or tiling/config edit occurred, per
  this attempt's exact scope. The detached supervisor's own 120-second
  failsafe (not a foreground signal, which was never sent) fired legitimate
  exact-manifest cleanup at real elapsed time before the intended t+5
  readiness snapshot, unloading only the recorded plugin and unregistering
  only the five recorded actions (all results `true`); the t+5 snapshot
  therefore correctly shows post-cleanup absence rather than a third
  live-persistence confirmation. Postflight at t+0/t+1/t+5 confirmed all
  invariants exactly restored (bundle/PID/Pings/Krohnkite/scripts/config-keys/
  `kglobalshortcutsrc`/`kwinrc`/desktop-output/former-group/13-group-tiling
  fingerprints unchanged, owned unit `not-found/inactive/dead` `MainPID=0`, no
  owned process or path residue). This is a successful registration/discovery
  capture-contract validation, not unit-05 structural acceptance: no client,
  keyboard, drag, split, or retained-empty-placement journey was attempted.
  Unit-03 structural behavior and unit-05 remain unaccepted pending a future
  `unit-05/attempt-14` window journey under separate authorization, which
  should also give the foreground process an explicit early-trigger path
  (e.g. a signal/marker file) rather than relying solely on the supervisor's
  120-second failsafe, since real inter-step elapsed time can approach that
  bound.
- `unit-05/attempt-14` crashed before it began any live mutation (session
  crash, not a KWin/host failure). Package-1 read-only reconciliation found
  it had created only its own empty nonce runtime directory, with zero
  journal trace of any `systemd-run` launch; that directory was removed as
  the sole cleanup action. No residue, invariant drift, or open surprise
  remained. Full detail: log.md, 2026-08-11 crash-reconciliation entry.
- `unit-05/attempt-15` (Lead-direct, non-interactive, standing authorization,
  new heartbeat/early-trigger supervisor contract) proved the corrected
  supervisor design end to end, created and switched to a temporary desktop,
  loaded/ran the bundle with ordered startup diagnostics and all five
  actions confirmed, then launched Wayland-native test client A. A's
  `windowAdded` was observed but rejected as `window-added-rejected:
  eligibility-or-scope` instead of `window-added-eligible` - the first live
  observation of this gate ever reached. The attempt stopped fail-fast
  before any keyboard invocation, second/third client, or split, and cleaned
  up exactly and byte-identically to the recorded baseline. Neither journey 1
  (keyboard insertion) nor journey 4 (automatic placement) is proven. Full
  detail and source-grounded diagnosis: log.md, 2026-08-11 attempt-15 entry.
- A dispatch of the `unit-05/attempt-16` package was aborted mid-run by a
  host quota interruption; its detached supervisor kept running unattended
  and its own automatic cleanup correctly removed the plugin/actions/
  client/desktop but left one stale `[Tiling]` group behind (a real
  interrupt-path hazard, now recorded in the live-testing guide). This was
  attributed read-only, treated per Orchestrator ruling as a tenth
  unowned/never-cleaned stale group exactly like the pre-existing nine, and
  the postflight baseline was rebaselined to the observed 14-group/
  `kwinrc` SHA-256 `cc624ba8763531610c42fe3b62b54c3192ee796314da9997dde2c6056f7141ab`
  state. The aborted dispatch's own diagnostic capture (`window-added-
  rejected:desktop-scope-mismatch`) was unreported/host-unknown and not used
  as evidence.
- `unit-05/attempt-16` (fresh dispatch, one Worker plus one same-scope
  correction, Lead independently re-verified every claim) cleanly captured
  and independently confirmed the exact rejection sub-code:
  `window-added-rejected:desktop-scope-mismatch`. Per the accepted `unit-06`
  helper's fixed evaluation order, this rules out `scope-unavailable`/
  `not-normal-window`/`not-managed`/`not-resizeable`/`applet-popup` and
  narrows the cause to the window's decoded `desktops` value not containing
  the live current desktop id. Restoration was byte-identical to the
  rebaselined 14-group state; the attempt's own transient tiling-group entry
  was positively detected and deleted by exact UUID without adding an
  eleventh stale group. Neither journey 1 (keyboard insertion) nor journey 4
  (automatic placement) is proven; this is a diagnostic pinpointing, not an
  eligible journey. Full detail: log.md, 2026-08-11 attempt-16 entry.

## Pending User Decisions

- Resolved by user direction 2026-08-12: automatic session-local ownership is approved when the plugin is enabled, using ratio-free dwindle topology. Implementation remains blocked only on the dedicated runtime proof for `CustomTile.remove()` collapse semantics; no static package may perform a live reset.

- Resolved by `unit-05/attempt-13`: the corrected `--user`-scope capture
  contract (fixed-prefix `plasma-auto-tiler:` success diagnostics plus
  independent same-PID `kwin_scripting` error check) is now proven end to end
  against a true positive and against a live successful load/run.
- Resolved by `unit-05/attempt-15`: the heartbeat-plus-early-trigger
  supervisor contract (120s heartbeat-stale bound, up to 900s terminal bound,
  explicit trigger file) is proven end to end, including exact-manifest
  idempotent cleanup covering plugin, actions, client process group, desktop
  restore/removal, and tiling keys.
- Resolved by `unit-06`: the recommended fine-grained `window-added-rejected:*`
  sub-codes now exist (`scope-unavailable`, `not-normal-window`, `not-managed`,
  `not-resizeable`, `applet-popup`, `desktop-scope-mismatch`), statically and
  unit-reviewed and accepted, with no behavior change.
- Resolved by `unit-05/attempt-16`: the exact sub-code is
  `desktop-scope-mismatch`, cleanly captured and independently verified,
  narrowing the cause to the window's `desktops` value at `windowAdded` time.
- `unit-05/attempt-17` (2026-08-11, one-package implement-build-live-validate
  unit, no new spec/change directory): implemented bounded deferred
  `desktop-scope-mismatch` re-evaluation (one 50ms `QTimer`-backed retry via a
  new `ControllerEnvironment.scheduleOnce`, cancelled on window removal, every
  other rejection sub-code still immediate/terminal); bundle SHA-256
  `b02a53d9eecafd6dbbf14bf4ef04d74f388a0a2e6428af28cf37a5d610f5fde5`, 144/144
  tests/23 suites. Live: client A's `window-added-deferred:decode-failed` ->
  `window-added-reevaluated:decode-failed` -> `window-added-rejected-
  deferred:desktop-scope-mismatch`, bounded/inert/no leak/no crash as
  designed, but disproving the settling-race hypothesis for this window
  (`window.desktops` fails to decode at all, both immediately and at
  +50ms, not merely "decodes but omits the current desktop id"). Journeys
  B/C not attempted (client A never became eligible). Cleanup byte-identical
  to the `cc624ba8...`/14-group baseline, independently re-verified by the
  Lead. Full detail: log.md, 2026-08-11 attempt-17 entry.
- `unit-05/attempt-20` stopped failed-clean before `run()` because its strict
  load-result runner predicate rejected its own valid response. The source
  correction is statically verified but A/B/C remain unattempted. A fresh
  attempt must correct and prevalidate that predicate, retain the exact plugin
  manifest before any parser-failure cleanup path can race, and record the
   temporary desktop's tiling UUID immediately after creation.
- Package 5 parser prevalidation accepted the retained valid `loadScript`
  envelope and rejected eight malformed/false-positive vectors. Three
  pre-mutation harness failures then prevented a product run: the first used a
  `rg` pattern without `--`, the second PID-filtered a non-KWin logger marker,
  and the third failed fresh-desktop ID extraction before writing its cleanup
  manifest. The exact third temporary desktop and tiling key were recovered and
  both config files byte-matched preflight. No A/B/C or fallback result exists.
- `unit-05/attempt-24` stopped before bundle load: an exact fresh desktop was
  recorded and switched, but no owned tiling group existed to manifest. The
  detached supervisor restored the four-desktop, 14-group baseline. Its writer
  had stopped when the timeout-bound launch command ended, so no retry occurred.
- `unit-05/attempt-25` was the final live attempt. Its independent heartbeat
  writer advanced before and during the supervisor launch, but the supervisor
  exited normally without a ready marker. No desktop, plugin, action, client,
  load/run, or journal mutation followed; live validation is parked.
