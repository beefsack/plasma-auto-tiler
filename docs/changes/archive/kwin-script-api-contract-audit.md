# KWin Script API Contract Audit

## Scope And Evidence

- Documentation review followed by authorized production corrections and offline verification. No live KWin, D-Bus, window, focus, workspace, session, or client-protocol action occurred. The later authorized native-move follow correction supersedes this audit snapshot's commit-before-follow protocol.
- Finding consequences and the contract matrix describe the pre-correction audit snapshot; each finding's status and the implementation objectives below record completion.
- Reviewed active production wiring only: `kwin/src/entry.ts:1-56`, `plan-adapter-entry.ts:1165-2014`, `plan-adapter.ts:2000-2384`, `workspace-send-adapter.ts:1288-2390`, and `workspace-native.ts:1540-1607`. The separately exportable `workspace-send-adapter-entry.ts` is test/isolated wiring, not the production entry.
- Primary public API reference: [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/). It identifies itself as generated "as of KWin 6.0" and supplies no 6.7.4 provenance or completion/error contract for the audited setters, signals, `callDBus`, or `QTimer`.
- Source observations are not public guarantees. They are from upstream [KWin v6.7.4](https://invent.kde.org/plasma/kwin/-/tree/v6.7.4), tag `8438567`, where cited. The local `/tmp/opencode/kwin` is 6.7.3 with an unverified revision and was used only to compare source content. The installed host revision remains unverified.

## Priority Findings

### P0 - Production Setter Results Are Discarded

- **Status:** implemented and statically verified. Production `startPlanAdapterEntry` now returns the `Reflect.set(...)` boolean for normal Plan geometry, send geometry, and send desktop-membership writes; the sticky property seam also treats `false` as a failed native-state write.
- **Prior path:** production `startPlanAdapterEntry` wired both normal Plan and Rust workspace-send writes. Its `setGeometry` and send `setGeometry`/`setDesktops` called `Reflect.set(...)` but always returned `true` if it did not throw. `PlanAdapter.writeGeometries` and `WorkspaceSendAdapter.writeGeometries`/`writeMoverDesktops` treat that boolean as the JavaScript property-write result.
- **Contract:** ECMAScript `Reflect.set` returns a boolean for property-put acceptance. KWin declares `Window.frameGeometry` as `WRITE moveResize`, whose C++ setter is `void`, so a `true` JavaScript result still does not report native resize acceptance. [KWin `window.h:479`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/window.h#L479), [KWin `window.cpp:3412-3420`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/window.cpp#L3412-3420).
- **Consequence:** a JavaScript-level rejected geometry or desktop assignment is reported as submitted and can advance to the existing signal/readback fence instead of failing immediately. This contradicts the existing timeout record's stated Reflect result correction; that correction is present in the isolated entry's geometry seam (`workspace-send-adapter-entry.ts:585-596`) but not in active production wiring.
- **Smallest objective:** return `Reflect.set` directly from all three active production seams. Preserve the existing exact post-observation gate. This only restores JavaScript property-put checking; it must not be presented as native setter acceptance or as a repair for ARTNue.

### P0 - Planner Activation Cannot Reach The Selected Absent-Owner Route

- **Status:** implemented and statically verified. Production uses `NameHasOwner`'s strict boolean reply, then resolves and pins a unique owner when present or activates only after `false`, with `StartServiceByName(name, 0)` followed by one fresh owner resolution.
- **Prior path:** a workspace send first called D-Bus `GetNameOwner` and invoked `StartServiceByName` only from a non-unique owner callback. The production `callDbus` bridge forwarded all calls unchanged, although this D-Bus method requires `(name, flags)`.
- **Contract:** public KWin docs promise only that `callDBus` is asynchronous and reply values reach its callback. Source implementation observation: an error reply is logged and does not invoke the JavaScript callback, so the normal D-Bus `NameHasNoOwner` result cannot execute `onOwnerInitial`. [KWin `Script::callDBus`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/scripting/scripting.cpp#L301-374). The D-Bus contract defines `GetNameOwner`'s `NameHasNoOwner` error and `StartServiceByName(name, flags)`, with `1`/`2` result values: [D-Bus specification](https://dbus.freedesktop.org/doc/dbus-specification.html), [bus API](https://dbus.freedesktop.org/doc/api/html/group__DBusBus.html).
- **Consequence:** an absent Planner stalls until the local request deadline; it neither proves that no service work happened nor starts activation. If a non-unique callback did reach the branch, the production bridge would also omit the required flags argument. The isolated entry correctly supplies `0` at `workspace-send-adapter-entry.ts:533-542`, proving the active bridge mismatch.
- **Smallest objective:** replace the selected lookup-first absent-owner sequence with one that can be expressed through KWin's callback-only API, passes flags `0`, and then pins a fresh unique owner before `DescribePlan`. Keep the existing one-flight deadline and no-rebind rule.
- **Resolved without a policy change:** `NameHasOwner` provides a successful boolean reply for presence or absence. It preserves absence-only activation followed by fresh unique-owner pinning. The audit's initial suggestion that unconditional activation was necessary is superseded; no activation-order decision remains.

### P1 - Shared Plan Reflow Observes The Wrong Geometry Signal

- **Status:** implemented and statically verified. The shared Plan geometry subscription now attaches documented `frameGeometryChanged`; send's dedicated fence remains unchanged. This does not explain the already captured workspace-send timeout.
- **Prior path:** the shared Plan adapter's `geometry` subscription attached `moveResizedChanged` to current windows; that signal drives the debounced re-observation/reconcile path. Direct Plan writes are asynchronous `frameGeometry` assignments and are accepted as applied after synchronous reply-boundary work.
- **Contract:** `frameGeometry` has `frameGeometryChanged` as its notify signal; public docs explicitly qualify its resize emission timing. Upstream implements programmatic writes through `moveResize`, while `moveResizedChanged` is tied to interactive move/resize lifecycle. [KWin `window.h:479-491`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/window.h#L479-491), [KWin `window.cpp:3412-3420`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/window.cpp#L3412-3420).
- **Consequence:** later client configure/commit geometry changes, including divergence from a Plan write, need not schedule the shared reflow. The send-specific fence remains correctly subscribed before writes at `workspace-send-adapter.ts:1651-1728` and uses `frameGeometryChanged` at `plan-adapter-entry.ts:1899-1905`.
- **Smallest objective:** subscribe the shared Plan geometry path to `frameGeometryChanged`, retaining its existing debounce, epoch fence, and changed-only writes. Do not create a signal-per-write completion rule.

### P1 - Follow Treats A Focus Request As Focus Acceptance

- **Status:** implemented and statically verified. Post-commit `focusWindow` now assigns then re-reads `workspace.activeWindow` and compares normalized native ids, so distinct script wrappers for the same Window confirm while a refused or unreadable result leaves follow unconfirmed. This is not a rendered-visibility guarantee.
- **Prior path:** post-commit follow confirmed the current desktop map by stable id, then `focusWindow` assigned `workspace.activeWindow` and returned `true` unless it threw. `followAfterCommit` consequently emitted `state-confirmed` without comparing the resulting active window.
- **Contract:** `activeWindow` is writable and notifies `windowActivated`, but public docs provide no acceptance return. Source observation is that its setter calls activation, which can reject a hidden, deleted, non-input, modal, or otherwise ineligible target without a setter result. [KWin `workspace_wrapper.cpp` `setActiveWindow`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/scripting/workspace_wrapper.cpp), [KWin `activation.cpp` `activateWindow`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/activation.cpp).
- **Consequence:** `state-confirmed` currently proves the desktop-map readback and a focus request, not mover focus. It still cannot prove scene or physical visibility.
- **Smallest objective:** after the existing focus assignment, re-read `workspace.activeWindow` and require the target before emitting `state-confirmed`; otherwise retain committed state and skip follow success. This is a truthful diagnostic/acceptance correction, not a retry, focus guarantee, or recovery policy.

## Pre-Correction Contract Matrix

| Surface | Public/documented contract | Current handling | Audit verdict |
| --- | --- | --- | --- |
| `frameGeometry` | Writable `QRectF`; `frameGeometryChanged` notifies actual changes, with resize timing qualified by mode. No result or await contract. | Snapshots round `QRectF` to integer wire rectangles at `plan-adapter-entry.ts:177-224`; send binds `frameGeometryChanged` before changed writes and verifies exact quantized post-state. | Send fence is aligned. `Reflect.set` result loss is P0. Rounding is a documented-project conversion, not a KWin guarantee. |
| Wayland resize | Source-only: xdg size changes can await configure acknowledgement and buffer commit; constraints/rules may alter requests. | No immediate readback is an acceptance gate; the existing send fence and fresh verification gate commit. | Aligned. `Reflect.set === true`, a signal, a readback, commit, and rendering are distinct facts. |
| `desktops` / `desktopsChanged` / `onAllDesktops` | Writable desktop list; docs say sticky windows have an empty list. No documented object-wrapper identity or signal-per-write guarantee. | Sends only mover membership, subscribes before write, and verifies source/target membership. | Result loss is P0. No-op writes may emit nothing. A strict desktop-object reference gate is a fail-closed availability risk, not demonstrated corruption. |
| Current desktop per output | `setCurrentDesktopForScreen` is void; `currentDesktopChanged(previous,current,output)` is the notification. | Follow chooses active-window output, then `activeScreen`, then first screen; it confirms immediate current map by desktop id and switches before focus. | Aligned with normal public route. The readback establishes map state only, not rendered visibility or an atomic multi-output transaction. |
| Focus / output | `activeWindow` is writable; `activeScreen` and `Window.output` are read-only. `Window.output` is center-based and source signal carries old output. | Re-reads active output for follow and uses stable window ids across DBus. | Focus acceptance is P1. No public transaction atomically combines membership, geometry, switch, and focus. |
| Signals and lifecycle | Docs list signals, but do not promise synchronous delivery, one echo per write, intermediate events, coalescing behavior, or callback disconnect/lifetime guarantees. | Send subscribes before writes, detaches one-shot handlers before progression, ignores no-op geometry, and uses a single exact timeout settlement. Plan uses epoch/in-flight/debounce guards. | Aligned as project fences, not documented KWin completion fences. Do not add one-signal-per-write assumptions. |
| `callDBus` / timers | `callDBus` is asynchronous and passes reply values; public docs specify no error callback, timeout, cancellation, callback-lifetime, or typed-demarshalling contract. | Token/correlation/epoch guards reject late replies; local `QTimer` deadlines define project policy. | P0 activation defects. Existing late-reply guards are necessary; stopping a timer does not cancel D-Bus work. |
| Active-group effect bridge | The effect call has no reply contract. | `setter-submitted` explicitly means submission only at `active-group-highlight.ts:793-805`; failures clear fail-closed. | Aligned. It has no role in hidden active-window or workspace-send completion. |

## Boundaries And Non-Fixes

- KWin source says `frameGeometry` routes through `moveResize`, and xdg configure/ack/buffer commit can defer a size change: [KWin `xdgshellwindow.cpp`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/xdgshellwindow.cpp#L107-289), [KWin `waylandwindow.cpp`](https://invent.kde.org/plasma/kwin/-/blob/v6.7.4/src/waylandwindow.cpp#L212-254). This is compatible with a mismatch or absent echo, but does not attribute ARTNue to a KWin refusal, hidden desktop, rounding, decoration, or client fault.
- The public scripting API does not document decoration conversion, screen-coordinate origin, fractional rounding, min/max values, resizability, or a geometry acceptance result. The adapter writes and reads the same `frameGeometry` surface, but its `Math.round` conversion is project policy. Relaxing exact integer equality or adding a rounding tolerance is a material protocol change, not a documented KWin fix.
- Window rules, minimum/maximum size, resizability, fullscreen, maximize, and client configure negotiation can constrain native results. The production adapter observes fullscreen/maximize and skips their geometry writes, but no public Script API exposes a complete capability predicate or min/max values. Do not claim all targets are resizable because assignment did not throw.
- A no-op geometry, desktop, desktop-switch, maximize, or focus request may emit no signal. Signals can be deferred, intermediate, or coalesced; neither setter return, signal, immediate readback, Planner commit, nor `state-confirmed` proves rendered state.
- `callDBus` returns no cancellable handle. A missing callback or logged exception does not prove the request was unprocessed, especially after native writes or Planner state mutation. Local timer deadlines, stale-reply drops, and loss settlement are project policy, not KWin request guarantees. Do not add `await` to setters, timer retry, reply-loss success inference, or a fabricated cancellation API.
- `VirtualDesktop` and `Window` QObject reference stability is not documented across independent reads, deletion, output changes, or session lifetime. Current stale-object handling re-observes before writes and disconnects tracked handlers, which is correct. Reference-equality gates at `plan-adapter-entry.ts:1009-1018` and `workspace-send-adapter.ts:2021,2306` may falsely fail closed if wrappers are fresh; use stable desktop id only after an explicit availability-versus-strictness decision.
- No public Script API exposes an atomic transaction across frame geometry, desktop membership, current desktop per output, and focus. The selected product protocol writes geometry and mover membership, then after the setter stack returns may use one fresh stable-id mover-membership proof for target switch/focus. Exact full post-observation still gates Planner ack/verify/commit. Both native map/focus confirmation and commit remain distinct from rendered completion.

## Ordered Implementation Objectives

1. Implemented: `Reflect.set` boolean propagation in active production geometry and desktop seams, preserving native verification as the only acceptance gate.
2. Implemented: shared Plan geometry observation uses `frameGeometryChanged`; send's existing one-shot fence is unchanged.
3. Implemented: follow success requires an active-window native-id readback and continues to report state confirmation only, never rendered visibility.
4. Implemented without an activation-order policy change: public D-Bus `NameHasOwner` supplies the explicit absence check unavailable through `GetNameOwner` error callbacks. The route remains presence check, absence-only activation with flags `0`, fresh unique-owner pinning, and existing no-rebind/deadline rules.

## Check

- Follow diagnostics now use a correlation-qualified, per-flight `diag_seq` to
  order adapter events with the active production entry's synchronous native
  call/readback records. `-1` marks an entry refusal before a flight exists.
  `native-switch-*` records API availability, selected-output source, declared
  `void` setter boundary, call ordinal, and immediate current-map equality;
  `native-focus-*` records direct-assignment submission and active-window
  native-id equality. `native-move-confirmed` marks the separate native
  transfer proof; `state-confirmed` remains immediate map-plus-focus state,
  never rendered completion. Terminal records carry either
  `follow=not-reached gate=pre-commit ...` or the actual one-shot native follow
  result with `gate=native-move`, so a later layout timeout cannot misreport an
  already-followed mover as not reached. An uncertain post-plan terminal state
  blocks Plan admission instead of adopting the visible uncommitted target;
  only commit performs the normal resync.
  Timeout and disable verifier short-circuits carry `verify_gates=incomplete`:
  an earlier scope or geometry gate may have run, but the full verifier did not
  complete and later membership checks are not implied.
- All values remain redacted session-local ordinals, counts, equality flags, and
  fixed tokens. Missing/unreadable reads are `-1` or `unreadable`; caught native
  exceptions use the fixed `caught` label. Diagnostic failures are ignored and
  do not alter the existing write, fence, commit, resync, or callback order.
- Offline checks cover `npm run typecheck`, the focused 105-test adapter/production-entry subset, the full 692-test offline suite, explicit IIFE bundle build, and staged/unstaged whitespace checks. No live KWin, D-Bus, or rendered-state claim was made.
- Offline implementation coverage includes production `startPlanAdapterEntry` tests for JavaScript property rejection, frame-geometry subscription, fresh focus wrappers, `NameHasOwner` absence activation with flags `0`, unique-owner pinning, stale reply rejection, and no accepted acknowledgement after a rejected membership write. Adapter tests cover the activation and existing signal-fence reentrant/no-op paths.
- The production-wiring corrections above are not inferred from the separately
  exportable isolated entry. The subsequent user acceptance is recorded in
  `docs/decisions.md`; `/run/user/1000/plasma-auto-tiler-dev.E2E0QJ.log` is NOT
  ANALYZED and supplies no API-contract or native-cause evidence.
