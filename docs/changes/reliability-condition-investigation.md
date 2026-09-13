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

### Resolution And Scaling Changes - NOT HANDLED

- Each observation obtains current work-area geometry from `clientArea`:
  `kwin/src/plan-adapter-entry.ts:336-388`. A scope refresh compares that geometry
  as part of `sameScope`: `kwin/src/plan-adapter.ts:165-190`.
- Changed bounds make `sameScope` false. The adapter replaces `lastGood` and
  sends no command: `kwin/src/plan-adapter.ts:1048-1062`. It does not project the
  retained tree into the new work area.
- This is not client geometry drift. The reassert-then-park path is reached only
  after same-scope geometry difference: `kwin/src/plan-adapter.ts:1063-1106`.
  A changed work area therefore neither reasserts nor parks.
- A manually requested retained reconcile rejects changed bounds or gaps as
  `domain-mismatch`: `src/planner_protocol.rs:2051-2102`. The next non-reconcile
  command instead discards that domain and reseeds it:
  `src/planner_protocol.rs:1242-1248,1364-1449`.
- Expected failure: after a resolution, scale, or work-area change, the adapter
  issues no immediate geometry write. The user can retain KWin's post-change
  layout rather than a projection of the prior tree until a later tiling command
  rebuilds the domain. The max-three policy does not bound this condition.

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

### Full-Screen And Gaming - NOT HANDLED

- `docs/decisions.md:233-235` says fullscreen is never tiled, resized, or
  reflowed. The production adapter starts unconditionally from
  `kwin/src/entry.ts:51-56`, observes every `normalWindow` with no `fullScreen`
  exclusion at `kwin/src/plan-adapter-entry.ts:397-445`, and sends those windows
  in every `DescribePlan` request: `kwin/src/plan-adapter.ts:1157-1195`.
- The wire DTO has no exception fields, and the Planner constructs each observed
  window with `fullscreen: false`: `src/planner_protocol.rs:170-175,648-661`.
  Normal fullscreen windows can therefore be admitted and included in complete
  geometry writes: `kwin/src/plan-adapter.ts:1401-1507`.
- The production route's fullscreen behavior contradicts the current decision.
  The separate, unwired adapters do exclude fullscreen windows:
  `kwin/src/focus-adapter-entry.ts:131-132`,
  `kwin/src/movement-adapter-entry.ts:252-253`,
  `kwin/src/resize-adapter-entry.ts:192-193`,
  `kwin/src/pointer-resize-adapter-entry.ts:197-198`, and
  `kwin/src/workspace-send-adapter-entry.ts:347`. They are not production
  evidence.
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
- Expected failure: a normal fullscreen application can be included in a later
  Plan request and receive a geometry write, violating fullscreen and gaming
  isolation. The recurring tray D-Bus work continues during fullscreen. Its
  measurable gaming cost, and the actual cadence of `paintScreen`, are not
  established statically.

#### Live Experiment

1. Follow `docs/live-kwin-testing.md` with a disposable normal tiled scope and
   journal capture enabled.
2. Record 60 seconds of compositor frame-time data, project D-Bus traffic, and
   `plasma-auto-tiler:plan` journal lines while idle, then repeat with one member
   fullscreened by its normal fullscreen control. Do not inject project D-Bus
   calls.
3. Trigger one unrelated window activation and one existing tiling shortcut while
   fullscreen remains foregrounded. Record all Plan requests and the fullscreen
   window's frame geometry before and after each action.
4. Exit fullscreen and restore the exact baseline. This settles both whether the
   production route writes fullscreen geometry and the residual fullscreen cost.

### Underlying Configuration Changes - NOT HANDLED

- The active-border effect does handle a KWin reconfigure call: it rereads its
  configuration and updates the outline and border at
  `kwin/native-effect/activewindowborder.cpp:45-50`.
- The KCM writes five script settings to `kwinrc`:
  `kwin/native-effect/activeborderconfig_module.cpp:416-501`. Production reads
  only `shortcutProfile`, once during startup, and registers its shortcuts once:
  `kwin/src/plan-adapter-entry.ts:247-270,757-809`. No production script source
  subscribes to a configuration-change or reconfigure signal.
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
  a KCM shortcut-profile change can leave the already running script using its
  startup profile and existing shortcut registrations. KCM's queued reconfigure
  provides no acknowledged script reload. Border settings are the only confirmed
  reconfigure-aware configuration path.

## Proposed Slices

- P0 | Fullscreen exclusion and residual-cost gate | Boundary: production Plan
  observation, request, and geometry-write paths only. Gate: a fullscreen normal
  application receives no Plan geometry write through fullscreen entry, idle,
  unrelated activation, tiling input, and restore; capture frame-time and
  project traffic against the recorded idle baseline.
- P1 | Output hotplug domain lifecycle | Boundary: retire, retain, or reseed
  `(output, workspace)` state only under an explicit selected policy. Gate:
  unplug and replug a tiled secondary output while another output remains active;
  prove selected tree semantics, no writes to absent outputs, and no unrelated
  domain eviction.
- P1 | Work-area change projection | Boundary: resolution, scale, and work-area
  bounds changes within one existing logical domain. Gate: change resolution and
  scale for a tiled output; prove one bounded projection to the new work area,
  no client-drift retry/park misuse, and restore on return.
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
