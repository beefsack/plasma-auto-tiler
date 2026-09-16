# Reliability Condition Investigation

## Scope

- Static diagnosis of the five reliability conditions in `VISION.md:30-48`.
- No live KWin, Plasma, D-Bus, suspend, output, configuration, or lifecycle
  action occurred. The active border and tray retain only their recorded manual
  confirmation; this record makes no further runtime claim.

## Verdicts

### Output Hotplug - OFFLINE PIECES COVERED, LIVE GATE PENDING

- The Rust planner retains `BTreeMap<DomainKey, Session>` and relocates a
  retained domain by workspace id when the same workspace is observed on a
  different output: `src/session.rs:relocate_domain` is atomic on any
  validation failure and preserves exception classes, gap, revision,
  tree/shares, and focus while updating domain bounds/gap plus window and
  exception homing; `src/planner_protocol.rs:try_relocate_for_target`
  validates workspace-send pending state, request outer gap, target collision,
  and source uniqueness/usability before any source mutation, honors normal
  retained capacity constraints without all-domain clearing, and restores the
  source on any rejected follow-up in the retained and reconcile paths, so
  displaced layouts converge through the normal admit/remove/reconcile flow
  with CURRENT contents. Offline tests cover same-workspace survivor reuse,
  current-contents edits, no-merge into the survivor tree, target
  collision/outer-gap/ambiguous-source/pending refusal atomicity, and
  revision/gap/tree/focus plus float exception class preservation. The
  standalone workspace-send cross-output refusal is unchanged.
- The TypeScript native layer owns session-local displacement identity and
  actuation: `kwin/src/workspace-native.ts:chooseDisplacedDestination` picks
  the nearest survivor only when the native handling source exposes
  removed-output geometry, else the live primary, else existing output
  ordering, with no historical geometry tracking; the current adapter does
  not retain removed geometry so it falls back to primary/ordering and never
  uses post-disconnect window frame geometry as a proxy;
  `reconcileOutputDisplacement` captures a handling-time topology snapshot
  (previous mapping plus last-known window-output membership plus
  last-visible, keyed by stable output) before destructive cleanup, primes
  visible/membership tracking at enable, moves every associated workspace of a
  removed output as a unit (including background occupied workspaces, never
  bulk-assigned to the primary), defers safely with no orphan/rehome/merge
  when no survivor exists, keeps workspace ids unique across logical lists,
  returns by exact stable-key reappearance only (tuple replacements never
  falsely return; unreturnable associations expire with a bounded log and no
  invented return), and returns each workspace by id with current contents on
  reconnect. Visibility follows the active window; otherwise the surviving
  view/focus is preserved. Offline tests cover multiple occupied workspaces on
  one removed output, global-unique and shared behavior, no-duplicate and
  current-membership convergence, and tuple-replacement safety. Hermetic Rust
  and KWin coverage only; no live KWin, Plasma, or D-Bus action occurred.
- The tree retains opaque output IDs only, never native output objects.

#### User-Owned Live Gate - Not Run

1. The user follows `docs/live-kwin-testing.md`, obtains the required session
   authorization, and records a restorable baseline for a tiled scope on two
   outputs, including per-output current desktops, frame geometries, active
   output/workspace, and `plasma-auto-tiler:plan` plus
   `plasma-auto-tiler:workspace` journal lines.
2. The user unplugs (or disables) the secondary output, waits for the
   debounced refresh, and records all Plan requests, frame geometries, current
   desktops, active window, and journal lines. The user replugs the output and
   records the same evidence. No project D-Bus method is injected.
3. Pass only if unplug keeps the displaced layout as separate workspace(s) on
   a survivor with no merge into the visible tree, visibility/focus follows
   the active window's location (survivor view preserved otherwise), replug
   returns each displaced workspace with its then-current contents/layout by
   workspace unit, no writes target absent outputs, and no unrelated domain is
   evicted. Record the exact failing observation otherwise.

### Resolution And Scaling Changes - CODE ADDRESSED, LIVE GATE PENDING

- Each observation still obtains current work-area geometry from `clientArea`:
  `kwin/src/plan-adapter-entry.ts:336-388`. When the logical domain, selected
  `(DOMAIN_GAP, OUTER_DOMAIN_GAP) = (8, 8)`, and complete window set match but
  bounds differ, the adapter now sends a retained `reconcile` projection rather
  than replacing `lastGood`: `kwin/src/plan-adapter.ts:216-237,1149-1173`.
- The Rust Planner projects the retained tree into the new bounds, then records
  those bounds without replacing topology, shares, membership, focus, or
  revision: `src/planner_protocol.rs:2060-2256` and
  `src/session.rs:755-785`. Observed client rectangles do not supply shares.
  Changed membership continues through admission/removal before this branch;
  changed domain keys remain outside it.
- A work-area projection is explicitly separate from client geometry drift.
  Its terminal outcomes neither consume the max-three reassert budget nor park
  the scope: `kwin/src/plan-adapter.ts:1276-1283,1685-1697`.
- Fullscreen members stay in the retained tree and reply actuation still skips
  their geometry writes: `kwin/src/plan-adapter.ts:1593-1636`. No generic
  reprojection refusal was added. Existing validation refuses each invalid
  condition before projection with its established exact cause; retained inner
  and outer gap changes refuse as `domain-mismatch` with distinct messages:
  `src/planner_protocol.rs:2085-2129`.
- Hermetic Rust and KWin coverage proves grow, shrink, scale-style bounds,
  selected gaps, reply actuation, fullscreen isolation, combined bounds and
  membership change, and non-consumption of drift retries. Static checks only;
  no live KWin, Plasma, or D-Bus action occurred.

#### User-Owned Live Gate - Not Run

1. The user follows `docs/live-kwin-testing.md`, obtains the required session
   authorization, and records a restorable baseline for a disposable two-window
   normal tiled scope on one existing output, including frame geometries,
   active output/workspace, and `plasma-auto-tiler:plan` journal lines.
2. The user changes only that output's resolution, waits for the debounced
   refresh, and records all Plan requests, frame geometries, and journal lines.
   The user restores the original resolution and records the same evidence.
3. The user changes only that output's scaling, waits for the refresh, and
   records the same evidence. The user restores the exact baseline. No project
   D-Bus method is injected in either journey.
4. The user repeats one resolution or scaling change with one member fullscreen,
   records the Planner trace request/reply, bounded plan diagnostics, and all
   member frames, then exits fullscreen and restores the exact baseline. The
    trace per-member `plasma-auto-tiler:plan:write` lines prove the fullscreen member
   carried `disposition=skip-fullscreen` while every sibling carried
   `disposition=written`.
5. Pass only if each bounds change issues one retained projection to the new
   work area with the retained split/share structure and 8px gaps, no second
   `reconcile` plan after settlement, and exact restoration after reversal; while
   fullscreen, that member remains fullscreen through the sibling action and
   retains its position on exit. The no-native-write assertion is proven by the
   fullscreen member's `disposition=skip-fullscreen` write line in the live log.
   Record the exact failing observation otherwise.

### Sleep And Wake - SELECTED RECOVERY, STATIC-COMPLETE, LIVE GATE PENDING

- No committed KWin, Planner, or transport source subscribes to a sleep, resume,
  or power-state event. The production adapter has only window, geometry, scope,
  and shortcut entry points: `kwin/src/plan-adapter.ts:686-731,759-870` and
  `kwin/src/plan-adapter-entry.ts:694-809`.
- The Planner has only in-memory owner, generation, and domain state:
  `src/planner_protocol.rs:1263-1288`. It exits on serving-connection, monitor,
  or Planner-name loss: `src/planner_service.rs:346-415`. Its D-Bus user unit
  specifies `Restart=no`: `home-manager-module.nix:50-61`.
- In current source, if wake drops the Planner name, the process exits and its
  retained topology is lost. The adapter keeps the old flight terminal and
  never replays it; normal Plan transport pins a unique owner via strict
  `NameHasOwner` plus one bounded `StartServiceByName(..., 0)` accepting only
  `PrimaryOwner`/`AlreadyOwner` then `GetNameOwner`, with no Legacy path.
  Ambiguous timeout, malformed, service-fault, missing-callback, and
  correlation-mismatch terminals alone never recover but may run one bounded
  identity probe; only absence or a changed unique owner triggers recovery.
  A later scope/window signal or user shortcut is the remaining route to
  another owner-pinned call. Which KWin signals wake emits remains session
  runtime behavior not established by this repository.
- Selected, static-complete, live gate pending: after CONFIRMED Planner loss,
  one bounded on-demand fresh-session activation fits CURRENT eligible windows
  with the approved simple near-layout heuristic, using normal tiling when it
  cannot produce a supported layout. This is in-memory only: it retains no
  durable layout snapshot or journal, does not infer prior internal history,
  and may change grouping. If the Planner survives sleep, every baseline is
  retained with no rebuild. This adds no polling, retry, or systemd restart
  loop, keeps every old in-flight transaction terminal with old-generation
  replies rejected, replays no commands, recovers no uncertain native
  mutation, applies no stale replies across sessions, settles no parked
  workspace-send partial recovery, and stays unavailable while a workspace
  send blocks Plan. Offline TypeScript and Rust coverage only; no live KWin,
  Plasma, D-Bus, or suspend action occurred.

#### Live Experiment

1. Follow `docs/live-kwin-testing.md` and obtain the required user authorization
   for a session boundary.
2. In a disposable three-window normal tiled scope, record the current Planner
   owner, one successful `DescribePlan` result, the three frame geometries, and
   the current `plasma-auto-tiler:plan` journal lines.
3. Suspend and wake the host manually. Make no tiling input for 10 seconds.
   Record Planner owner/name state, frame geometries, and new journal lines. If
   loss was confirmed, record whether the selected automatic bounded fresh
   activation occurred; if the Planner survived, record that its layout was
   retained.
4. Issue one existing directional tiling shortcut. If loss was confirmed, record
   whether the request succeeds and whether the resulting layout is a fresh fit
   from CURRENT windows or the normal-tiling fallback; it need not retain the
   prior grouping.
5. Restore the exact scoped baseline. The condition is handled only if confirmed
   loss has the selected automatic bounded fresh-session route, the first
   post-wake operation has the selected fresh-layout semantics, and old-flight
   terminal behavior is preserved. Otherwise record the exact failing step.

### Full-Screen And Gaming - CODE ADDRESSED, LIVE GATE PENDING

- `kwin/src/plan-adapter-entry.ts` now observes the exact fail-closed
  `readProp(ref, "fullScreen") !== false` state and subscribes to each window's
  `fullScreenChanged`, including later additions. A fullscreen window remains in
  the observation set and Planner tree; it is not deferred or removed.
- `kwin/src/plan-adapter.ts` carries the last retained in-bounds planned rect for
  fullscreen members instead of their compositor-owned fullscreen frame. This
  keeps every Planner request valid when the fullscreen frame extends beyond the
  work area, retains the member's tree position and share, and permits sibling
  reflows.
- Reply-time re-observation skips every fullscreen geometry target. Fullscreen
  frame drift is excluded from the reassert-then-park policy, while fullscreen
  exit compares the restored frame against the retained projection and reconciles
  only if restoration is imperfect. Direct move, keyboard resize, and pointer
  resize of a fullscreen target refuse fail-closed; the pointer route's
  adapter records the exact `plasma-auto-tiler:plan:pointer-refused-fullscreen`
  token rather than a shared derivation failure.
- Hermetic KWin coverage proves admission with a fullscreen member, enter and
  exit restoration, sibling reflow, reconciliation isolation, out-of-bounds
  fullscreen frame containment, and later-window signal attachment. `npm test
  --prefix kwin` passes 476 tests; no live KWin, Plasma, or D-Bus action was run.
- The active-border effect hides its item for fullscreen:
  `kwin/native-effect/activeborderlogic.h:31-37` and
  `kwin/native-effect/activewindowborder.cpp:91-101`.
- Ongoing work while a fullscreen window is foregrounded:
  `kwin/native-effect/activewindowborder.cpp:104-107` has a `paintScreen`
  override that delegates to KWin. Static source cannot establish its frame
  invocation cadence beyond the loaded-effect framework cost.
  `kwin/src/entry.ts:13-49` and `kwin/src/tray-publisher.ts:1-50,90-112` issue a
  `PublishSnapshot` D-Bus call every second. `src/tray_endpoint.rs:556-568` emits
  a tray change signal every second. The plan adapter has event subscriptions
  (`kwin/src/plan-adapter-entry.ts:694-739`), a 120 ms one-shot debounce
  (`kwin/src/plan-adapter.ts:904-920`), and a 2 s one-shot in-flight timeout
  (`kwin/src/plan-adapter.ts:1218-1227`), but no polling loop. Drag-oracle
  handlers are interaction signals only:
  `kwin/src/plan-adapter-entry.ts:975-1027`.
- The reply can include a fullscreen member's retained geometry, but reply
  actuation skips its native geometry write. The per-member
  `plasma-auto-tiler:plan:write window=<id> disposition=skip-fullscreen
  rect=<...>` line proves that skip in a live log for the fullscreen member,
  while every applied sibling logs `disposition=written`. The recurring tray
  D-Bus work continues during fullscreen. Its measurable gaming cost, and the
  actual cadence of `paintScreen`, are not established statically.

#### User-Owned Live Gate - Not Run

1. The user follows `docs/live-kwin-testing.md` and creates a disposable
   three-window normal tiled scope with bounded journal capture enabled.
2. The user records the member frames, then fullscreens one member using its
   normal fullscreen control. No project D-Bus call is injected.
3. While fullscreen remains active, the user triggers one existing tiling
   shortcut on a non-fullscreen sibling and records the resulting bounded plan
   diagnostic plus all three frames.
4. The user exits fullscreen and restores the exact baseline. Pass only if the
   fullscreen member stays fullscreen during the sibling command, the sibling
   command is applied, and it returns to its retained tree position on exit.
   The fullscreen member's `disposition=skip-fullscreen` write line proves no
   native write reached it, while the sibling's `disposition=written` line
   proves the sibling write. Record the exact failing observation otherwise.

### Underlying Configuration Changes - INTERIM STATIC-COMPLETE, LIVE GATE PENDING

- Approved interim, statically implemented, live verification pending: after
  save, the KCM marks a reload as required and offers a deliberate tiler
  reload with clear reload-required UI. Existing live border updates remain
  live. This is an interim target only: before launch, every user-facing
  setting must apply live, which is a mandatory launch blocker.
- The active-border effect does handle a KWin reconfigure call: it rereads its
  configuration and updates the outline and border at
  `kwin/native-effect/activewindowborder.cpp:45-50`.
- The KCM writes seven script settings to `kwinrc`, including bounded
  `innerGap` and `outerGap` values. Production reads `shortcutProfile`,
  `workspaceMode`, and the gap pair once during startup; no production script
  source subscribes to a configuration-change or reconfigure signal.
- KCM Apply no longer auto-queues a script reconfigure on save. Saving tiling
  settings sets reload-required with the exact status `Tiling settings saved.
  Reload required: the running tiler still uses startup values.` An unchanged
  save sends nothing and leaves the flag untouched. The deliberate Reload
  Tiler button sends exactly one typed `org.kde.KWin /KWin org.kde.KWin
  reconfigure` request: success reports `Reload request sent. Application
  unconfirmed; restart the session to guarantee pickup.` and keeps
  reload-required; failure reports `Reload request failed. Running tiler still
  uses startup values; retry or restart the session.` and keeps
  reload-required. No status claims applied. Running confirmation is not
  provable in current source: the controller has no config-change
  subscription and KWin's reconfigure is Q_NOREPLY, so a queued send alone is
  reported as unconfirmed and session restart remains the guarantee. The
  button never touches shortcuts and never unloads scripts or plugins.
- Shortcut Apply and Revert are explicit KCM operations:
  `kwin/native-effect/activeborderconfig_module.cpp:183-252`. The KCM can detect
  recorded-postimage drift when opened: `kwin/native-effect/activeborderconfig_module.cpp:376-414`.
  No running-script watcher reconciles externally changed shortcuts or `kwinrc`.
- Expected residual: hand-edited `kwinrc`, externally changed script settings, or
  a KCM change can leave the already running script using its startup values,
  including its gap pair and existing shortcut registrations. The deliberate
  reload request is unacknowledged, so only a session restart guarantees
  pickup. Border settings are the only confirmed live configuration path. The
  all-settings live-application launch blocker is unchanged.
- Offline verification (2026-09-16, no live KWin, Plasma, D-Bus, or session
  action): `npm run typecheck --prefix kwin` passes; `npm test --prefix kwin`
  passes 760 tests across 106 suites with 0 failures (including 7 new
  `tiler-reload-interim` static contract tests); `npm run build --prefix kwin`
  emits the `contents/code/main.js` bundle; native `ctest` passes 22 of 22
  including the new `native-effect-kcm-tiler-reload` scenario (KCM
  persistence, live border vs reload-required, deliberate reload
  success/failure, typed DBus contract, no reload on unchanged save, no
  shortcut mutation, no applied claim, poisoned-bus failure); `cargo test`
  passes 523 tests with 0 failures and `cargo build` succeeds. No runtime
  claim is made.

## Proposed Slices

- P0 | Fullscreen residual-cost live gate | Code isolation is complete in the
  production Plan observation, request, and geometry-write paths. Run the
  user-owned fullscreen gate above to prove no fullscreen write through entry,
  idle, unrelated activation, sibling tiling input, fullscreen-target tiling
  input, and restore; capture frame-time and project traffic against idle.
- P1 | Output hotplug domain lifecycle | Boundary: implement the selected
  separate-workspace preservation for a disconnected output's displaced layout.
  If the active window was on the disconnected monitor, show its relocated
  workspace and retain focus on that window. If the active window was on a
  surviving monitor, preserve its current visible workspace and focus; displaced
  workspaces remain accessible through normal workspace switching. If there is
  no active window, preserve the surviving monitor view. On reconnection,
  displaced workspaces automatically return to their original monitor with
  their then-current contents and layout, not a saved snapshot: split edits,
  closed and new windows remain reflected. Workspace relocation is the unit: a
  window explicitly moved out stays at its destination and is never individually
  pulled back, while a window moved into a displaced workspace returns with it.
  Destination among multiple surviving outputs uses the nearest surviving
  monitor from geometry already available while handling disconnect, with no
  added historical state. If that would require old output geometry/history or
  an extra tracking mechanism, use the current primary surviving monitor; if
  that is not identifiable, use existing available output ordering as the
  deterministic fallback. Availability and lifetime of removed-output geometry
  are implementation source-check details, not a claim that nearest is always
  feasible. This destination choice is distinct from the selected displacement
  association required for automatic workspace return. On original-output
  reconnect, if the active window is in a returning workspace, show that
  workspace on the reconnected monitor and retain focus on that window. If the
  active window remains on a surviving output, preserve its view and focus with
  no focus stealing. Other workspace selection follows ordinary behavior, with
  no prior-view tracking or new state/history. The initial scope is
  session-local with no restart-persistent mapping or return guarantee. All
  initial hotplug product choices are resolved; implementation and live
  verification remain pending. Gate:
  unplug and replug a tiled secondary output while another output remains
  active; prove selected tree semantics, no writes to absent outputs, and no
  unrelated domain eviction.
- P1 | Work-area change projection live gate | Static implementation now projects
  one retained existing domain through resolution, scaling, and work-area bounds
  changes without client-drift retry/park misuse. Run the exact user-owned gate
  above; output addition, removal, retirement, and all-domain reconciliation
  remain the separate output-hotplug slice.
- P1 | Wake transport recovery | Selected, static-complete, live gate pending:
  after CONFIRMED Planner name or connection loss, one bounded on-demand fresh
  session fits CURRENT eligible windows with simple near-layout fitting or normal
  tiling when no fit applies; surviving Planners retain their layouts with no
  rebuild. Boundary: in-memory fresh recovery only, not durable
  snapshots/journals, old-flight reset or replay, stale cross-session replies,
  uncertain native mutation, or parked workspace-send partial recovery. Gate:
  the sleep/wake experiment above proves the selected automatic recovery
  semantics, bounded failure behavior, and the first post-wake plan result. No
  live result is claimed.
- P1 | All user-facing settings live application (launch blocker) | Boundary:
  script settings, KCM Apply, external `kwinrc`, shortcut drift, and effect
  reconfigure. The approved interim is statically implemented (deliberate
  tiler reload after save, clear reload-required UI, retained live border
  updates, sent-but-unconfirmed reporting, no silent stale state); its live
  verification remains pending. Before launch, change each
  user-facing setting through KCM and its underlying store and prove live
  application, including shortcut registration state.

## Decision Contradiction

- `docs/decisions.md:233-235` claims fullscreen is never tiled, resized, or
  reflowed. The committed production Plan route contradicts that claim as shown
  above. This record does not alter the decision.
