# Reliability Condition Investigation

## Scope

- Static diagnosis of the five reliability conditions in `VISION.md:30-48`.
- No live KWin, Plasma, D-Bus, suspend, output, configuration, or lifecycle
  action occurred. The active border and tray retain only their recorded manual
  confirmation; this record makes no further runtime claim.

## Verdicts

### Output Hotplug - NOT HANDLED

- The production adapter observes only the domain of the active normal window:
  `kwin/src/plan-adapter-entry.ts:292-388`. `screensChanged` only schedules its
  debounced refresh: `kwin/src/plan-adapter-entry.ts:694-727`; it does not
  enumerate output removal or addition, retire a domain, or reconcile all
  domains.
- The Rust planner retains `BTreeMap<DomainKey, Session>`:
  `src/planner_protocol.rs:1263-1288`. A missing domain is never removed. It is
  discarded only on a later same-key bounds/gap mismatch, divergence, or owner
  or generation change: `src/planner_protocol.rs:1242-1248,1315-1329,1364-1384`.
- The tree does not retain a native output object. It retains opaque output ID
  and bounds inside the session, so an unplugged domain becomes stale retained
  state rather than a tree reference to a destroyed KWin object.
- Expected failure: an unplugged output leaves an unretired logical domain. An
  output is not initialized or reconciled until it becomes the active observed
  domain. A later same-key observation can reuse stale topology, while a changed
  bounds/gap observation discards it and reseeds from current geometry. Neither
  outcome is an explicit hotplug policy. At the 16-domain cap, first insertion
  of a new key clears every retained domain: `src/session.rs:101` and
  `src/planner_protocol.rs:1377-1384`.

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
   records the Planner verbose request/reply, bounded plan diagnostics, and all
   member frames, then exits fullscreen and restores the exact baseline. The
   per-member `plasma-auto-tiler:plan:write` lines prove the fullscreen member
   carried `disposition=skip-fullscreen` while every sibling carried
   `disposition=written`.
5. Pass only if each bounds change issues one retained projection to the new
   work area with the retained split/share structure and 8px gaps, no second
   `reconcile` plan after settlement, and exact restoration after reversal; while
   fullscreen, that member remains fullscreen through the sibling action and
   retains its position on exit. The no-native-write assertion is proven by the
   fullscreen member's `disposition=skip-fullscreen` write line in the live log.
   Record the exact failing observation otherwise.

### Sleep And Wake - UNKNOWABLE STATICALLY

- No committed KWin, Planner, or transport source subscribes to a sleep, resume,
  or power-state event. The production adapter has only window, geometry, scope,
  and shortcut entry points: `kwin/src/plan-adapter.ts:686-731,759-870` and
  `kwin/src/plan-adapter-entry.ts:694-809`.
- The Planner has only in-memory owner, generation, and domain state:
  `src/planner_protocol.rs:1263-1288`. It exits on serving-connection, monitor,
  or Planner-name loss: `src/planner_service.rs:346-415`. Its D-Bus user unit
  specifies `Restart=no`: `home-manager-module.nix:50-61`.
- If wake drops the Planner name, the current process exits and its retained
  topology is lost. The adapter does not disable itself, but a direct
  `DescribePlan` failure only ends that flight: `kwin/src/plan-adapter.ts:1218-1262`.
  A later scope/window signal or user shortcut is the only source-level route to
  another direct service-name call. Whether that call activates a replacement
  service after wake, and which KWin signals wake emits, is session-bus and KWin
  runtime behavior not established by this repository.

#### Live Experiment

1. Follow `docs/live-kwin-testing.md` and obtain the required user authorization
   for a session boundary.
2. In a disposable three-window normal tiled scope, record the current Planner
   owner, one successful `DescribePlan` result, the three frame geometries, and
   the current `plasma-auto-tiler:plan` journal lines.
3. Suspend and wake the host manually. Make no tiling input for 10 seconds.
   Record Planner owner/name state, frame geometries, and new journal lines.
4. Issue one existing directional tiling shortcut. Record whether the Planner
   starts or reacquires its name, whether the request succeeds, and whether the
   resulting topology is the prior retained tree or a rebuilt tree.
5. Restore the exact scoped baseline. The condition is handled only if name loss
   has an automatic, bounded recovery route and the first post-wake operation
   has selected topology semantics. Otherwise record the exact failing step.

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

### Underlying Configuration Changes - NOT HANDLED

- The active-border effect does handle a KWin reconfigure call: it rereads its
  configuration and updates the outline and border at
  `kwin/native-effect/activewindowborder.cpp:45-50`.
- The KCM writes seven script settings to `kwinrc`, including bounded
  `innerGap` and `outerGap` values. Production reads `shortcutProfile`,
  `workspaceMode`, and the gap pair once during startup; no production script
  source subscribes to a configuration-change or reconfigure signal.
- KCM Apply queues an unacknowledged KWin `reconfigure` call:
  `kwin/native-effect/activeborderconfig_module.cpp:128-136,514-523`.
  This matches `docs/decisions.md:123-128`: a session restart is required before
  relying on an authority change. It does not establish that a running script
  rereads configuration.
- Shortcut Apply and Revert are explicit KCM operations:
  `kwin/native-effect/activeborderconfig_module.cpp:183-252`. The KCM can detect
  recorded-postimage drift when opened: `kwin/native-effect/activeborderconfig_module.cpp:376-414`.
  No running-script watcher reconciles externally changed shortcuts or `kwinrc`.
- Expected failure: hand-edited `kwinrc`, externally changed script settings, or
  a KCM change can leave the already running script using its startup values,
  including its gap pair and existing shortcut registrations. KCM's queued
  reconfigure provides no acknowledged script reload. Border settings are the
  only confirmed reconfigure-aware configuration path.

## Proposed Slices

- P0 | Fullscreen residual-cost live gate | Code isolation is complete in the
  production Plan observation, request, and geometry-write paths. Run the
  user-owned fullscreen gate above to prove no fullscreen write through entry,
  idle, unrelated activation, sibling tiling input, fullscreen-target tiling
  input, and restore; capture frame-time and project traffic against idle.
- P1 | Output hotplug domain lifecycle | Boundary: retire, retain, or reseed
  `(output, workspace)` state only under an explicit selected policy. Gate:
  unplug and replug a tiled secondary output while another output remains active;
  prove selected tree semantics, no writes to absent outputs, and no unrelated
  domain eviction.
- P1 | Work-area change projection live gate | Static implementation now projects
  one retained existing domain through resolution, scaling, and work-area bounds
  changes without client-drift retry/park misuse. Run the exact user-owned gate
  above; output addition, removal, retirement, and all-domain reconciliation
  remain the separate output-hotplug slice.
- P1 | Wake transport recovery | Boundary: Planner name or connection loss and
  subsequent KWin adapter recovery. Gate: the sleep/wake experiment above proves
  the selected automatic recovery semantics, bounded failure behavior, and the
  first post-wake plan result.
- P2 | Runtime configuration coherence | Boundary: script settings, KCM Apply,
  external `kwinrc`, shortcut drift, and effect reconfigure. Gate: change each
  supported setting through KCM and its underlying store; prove the selected
  live/restart behavior, shortcut registration state, and no silent stale state.

## Decision Contradiction

- `docs/decisions.md:233-235` claims fullscreen is never tiled, resized, or
  reflowed. The committed production Plan route contradicts that claim as shown
  above. This record does not alter the decision.
