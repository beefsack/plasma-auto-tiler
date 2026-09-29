# Cross-platform core extraction

Status: source audit and migration proposal, 2026-09-29. Most layout,
initial-fit, drag and membership policy already lives in Rust. Extract a few
remaining pure decisions from KWin as a Windows adapter needs them; macOS can
then extend the same types without inheriting Windows-specific behavior.

`O` marks observed repository code at the cited `file:line`; `I` marks a
proposed API or migration risk. Source locations were checked 2026-09-29.
`docs/decisions.md:50-58,149-153,201-224` sets the Rust/native boundary
and defers workspace extraction until a second host needs it. Its
`:689-727,749-836` governs workspace and shortcut behavior. No live tests
accompany this audit.

## Existing portable contract to reuse

Keep the Engine's existing typed domain and layout authority. Windows and
macOS supply observations and apply plans; neither needs KWin's D-Bus route.

| Item | Current implementation (O) | Host-neutral API shape / work (I) | KWin risk and order (I) |
| --- | --- | --- | --- |
| Engine/domain identity | `crates/tiler-core/src/engine.rs:52-85` owns per-domain Sessions; `crates/tiler-core/src/session/world.rs:31-75` defines `(OutputId,WorkspaceId)` domain, bounds, gap, adjacency. `crates/tiler-protocol/src/planner_protocol.rs:789-909` decodes directional domain and calls `inset_bounds`. | `Engine::handle(Observation, Command)->Plan/Refusal`; opaque IDs normalized by adapter, one complete domain at a time; preserve generation/revision/correlation fences. Protocol becomes optional at an external IPC boundary, not mandatory inside a Windows process. | Low for Windows adapter; **do not** merge per-domain revisions or reuse KWin D-Bus request object wholesale. First, preserve existing typed Engine. |
| Gap/projection math | `crates/tiler-core/src/geometry.rs:108-165,190-276` already owns outer inset, ordered N-ary pixel allocation and gaps; `crates/tiler-core/src/size_hints.rs:377` begins hint-aware projection; `crates/tiler-protocol/src/planner_protocol.rs:823-889` bounds and normalizes wire gaps; `kwin/src/domain-gap.ts:10-43,56-109` supplies setting defaults and startup/config-read validation. | `ProjectionInput{work_area_physical,outer_gap,inner_gap,hints}` -> `ProjectedLeaves/Refusal`; keep geometry independent of client physical/DPI conversion. Share validated settings *semantics*, not TS `readConfig`. | Low. Existing Rust math first; then align validator defaults/ranges with KWin fixtures. Never treat DWM visible bounds as a portable tree bound. |
| Initial adoption fit | `crates/tiler-core/src/seed.rs:31-73,77-106,142-179,240-332` does recursive cuts, max(gap,3%) crossing and overlapping-window centre split; `crates/tiler-core/src/engine.rs:73-79,833-930` tracks/uses fresh-fit; `crates/tiler-protocol/src/planner_protocol.rs:578-642` logs fit. | `AdoptFit::attempt(Domain, NormalizedWindowRect[])->Fit{tree,links,centre_splits}/Decline`; fresh complete observation only, normal seed fallback. | Low: reuse as-is; native window eligibility/geometry quality determine outcome, not a new fit algorithm. |
| Core convergence and drop policy | `crates/tiler-core/src/session/world.rs:671-865` converges complete membership/float changes; `crates/tiler-core/src/session/ops/drag.rs:66-181,216-312,341-532,638-846` retains drag capture/preview/drop placement. | `Converge(CompleteDomainObservation)->Counts/Plan`; `Drag::begin/preview/drop(Capture, Pointer, ObservedState)->Preview/Plan/Refusal`. Adapter supplies normalized pointer/geometry and observed finish, no native hook calls in core. | Low to medium: this is portable today; add cross-host contract fixtures rather than copying KWin drag oracle. Preserve no-setter-replay and stale-scope gates. |

## Remaining portable pieces at a KWin boundary

The border, underlay and shortcut tables contain small pure decisions worth
sharing. Rendering, native input and process-lifecycle timing stay with each
host adapter.

| Item | Current location and host-only boundary (O) | Proposed core shape and responsibilities (I) | KWin path risk; suggested order (I) |
| --- | --- | --- | --- |
| Active border geometry/visibility | Pure C++ `kwin/native-effect/activeborderlogic.h:11-53` chooses color/inner rect and excludes missing/deleted/minimized/fullscreen/maximized/applet popups. `kwin/native-effect/activewindowborder.cpp:984-1015` reads KWin focus/window state and maps through `windowItem()->mapFromScene`, paints `OutlinedBorderItem`. | `BorderStyle{color,width,radius,gap}` and `BorderTarget{present,visible,fullscreen,maximized,excluded,frame}` -> `VisibleBorder{outer_rect,style}?`. Adapter translates KWin applet popup / Windows eligibility into `excluded`, obtains theme and renders. Do not assume Windows native border supports arbitrary width/gap/radius. | Low for pure predicate/rect migration; medium for strict equivalence with C++ frame/effect rendering. Move policy after initial Windows adapter geometry proof; keep native signal timing/scene placement in effect. |
| Active group + filled underlay | `crates/tiler-core/src/active_group.rs:45-58,71-98,109-164` derives immediate-parent members and union of *projected* rectangles; `crates/tiler-core/src/boundary.rs:824-901` exposes query. `crates/tiler-kwin-effect-ffi/src/group_highlight.rs:492-518` checks focus and Meta-held eligibility; `kwin/native-effect/activeborderlogic.h:69-84` computes underlay extension/outer rect; `kwin/native-effect/activewindowborder.cpp:1018-1079` parses and anchors scene item; `kwin/src/active-group-highlight.ts:567-629` bridges KWin event stream. | `GroupVisual::resolve(ActiveGroup, FocusEvidence, ModifierHeld, Style)->Optional<GroupVisualIntent{members,union,expanded_rect,fill}>`; core provides membership/rect/visibility predicates, adapter handles stacking anchors, effect availability, theme and paint. Keep existing Rust group-resolution source of truth. | Low-medium: move only C++ extension arithmetic and eligibility predicate with integer/float edge fixtures. KWin scene parenting stays native; Windows tests a non-topmost underlay directly beneath the lowest member, with Z-order rechecks. After active border. |
| Drop overlay / final drag verdict | `crates/tiler-core/src/session/ops/drag.rs:216-312,341-532` owns preview and commit policy. `crates/tiler-kwin-effect-ffi/src/drag_oracle.rs:86-152` validates optional press and compares start/end, builds correlated cancelled/moved verdict; `kwin/src/drag-oracle-pull.ts:46-119,124-226` validates response, applies KWin-specific thirds/resize route; `kwin/native-effect/activeborderlogic.h:55-67` validates preview rect and `kwin/native-effect/activewindowborder.cpp:1096-1143` paints screen-space fill. | `DragEvidence{window,start,end,press?,grab_kind?,correlation}` -> `DragVerdict{moved,cancelled,reason}`; `PreviewIntent{target_rect,visual_style,visible}` from core. Adapter owns pointer hooks, KWin D-Bus pull or Windows WinEvent final rect, hit testing, coalescing, paint. KWin grabbed-edge/thirds classifier stays host until second host establishes shared semantics. | Medium: port pure verdict/preview bounds after working Windows drag lifecycle. Moving synchronous effect callbacks or timing may introduce lag/stale preview; require KWin fixtures and native effect acceptance separately. |
| Observation/difference classification | `kwin/src/plan-adapter.ts:2321-2450` applied-scope cache and `classifyCompleteObservation` compare identities/flags/rects/gaps, raw out-of-bounds; `crates/tiler-core/src/session/world.rs:671-865` owns membership changes; `crates/tiler-core/src/reconcile.rs:236-246,379-477` owns propose/ack/verify. | `Classify(CompleteObservation, AppliedEvidence, DomainScope, HostExceptionFlags)->{membership_or_flags_change,pure_drift,scope_change,equal,uncertain}` as pure policy only. Adapter owns collecting complete frames, sticky multi-home normalization, single-flight, retries, quarantine, write echo and client-specific clamp handling. | Medium-high: direct TS extraction could change hidden-domain/readability behavior. Run offline classifier fixtures on KWin before moving; wait until normal Windows observe/actuate spike shows which predicate is genuinely shared. Preserve KWin three-strike acceptance as current host policy (`docs/decisions.md:36-49,617-641`). |
| Workspace lifecycle and per-output mapping | `kwin/src/workspace-native.ts:19-37,94-149,347-400,409-556,1260-1394` owns native backing desktop catalog, logical selection/numbered shortcuts, trailing empty, output displacement/reconnect. `crates/tiler-core/src/session/world.rs:31-75` and `crates/tiler-core/src/session/ops/workspace.rs:36-80` already plan domain keys and same-output send. | **Triggered now by Windows requirement:** design `LogicalWorkspaceState{mode,outputs,active_by_output,ordered_workspaces,membership,displaced}` and commands `select/send/ensure_trailing_empty/disconnect/reconnect`; host `WorkspaceBacking` supplies `observe/select/reveal/hide/move` capabilities and native identity. Pure logical operations can move; backing KWin desktop-pool creation/deletion and Windows hide/restore stay adapters. Model `global-unique`, `shared`, `per-output-local` only where host evidence supports them. | **Highest**: `docs/decisions.md:55-58` intentionally deferred moving workspace model until non-KWin host needs it. Windows **is the trigger to design/prototype extraction**, not an authorization to bulk move KWin TS now. Start as a Windows-owned experimental logical model with matching cross-host fixtures, extract shared semantics only after hiding/recovery and KWin behavior tests. Last extraction. |
| Shortcut command catalog | `kwin/src/plan-adapter-entry.ts:281-398` builds COSMIC HJKL + arrow focus/move/resize, float/maximize/fullscreen, while `kwin/src/workspace-native.ts:68-149` builds numbered select/send and shifted US symbol aliases. `kwin/native-effect/shortcutreconciler.h:22-60` maps exact KDE override rows. | `ActionId` + `CommandKind{focus,move,resize,float,sticky,maximize,fullscreen,select_workspace,send_workspace}` + `ProfileCatalog::actions(profile)`; host `ShortcutBinding{physical_or_logical_key,modifiers,availability,conflict}` maps intent to chords. Do not put literal `Meta+L` or KDE foreign-holder IDs into portable policy. | Low-medium: extract action identities/catalog after Windows chord spike; preserve KDE catalog text, exact alias/Force/Revert behavior via fixtures. The KWin profile setting currently yields one shared catalog, not real three-mode behavior (`kwin/src/plan-adapter-entry.ts:288-290`). |
| Settings schema and live apply | `kwin/contents/config/main.xml:8-41` stores mode/defaultTiled/profile/gaps with defaults/ranges; `kwin/native-effect/activeborderconfig.kcfg:7-39` stores border/drag/underlay; `kwin/src/domain-gap.ts:10-43,56-109` normalizes gaps; `kwin/native-effect/unifiedsettings_module.cpp:27-80` builds KCM; live caveats in `docs/decisions.md:85-95,228-252`. | `SettingDescriptor{key,type,default,validation,capability,apply_mode,conflict_state}` and `ValidatedSettings` used by all adapters; `apply(changes)->Applied/Deferred/Rejected` must have observed confirmation. Portable defaults/semantic validation can move, but Windows-native color/accessibility and keyboard formatting stay adapter-specific. | Medium: do not rewrite `kwinrc` groups or assert all KWin settings already apply live. First align gap semantics; then catalog; then border/workspace settings after Windows capability results. KCM factories and host-setting Fix/Revert stay KWin. |

## Host-specific boundaries that stay put

Native observation, input, rendering and transport must stay in their host
adapters. A shared type must describe an intention, not impersonate KWin's
backing desktop, Windows' HWND or macOS' accessibility window.

- [O] `kwin/src/workspace-native.ts:1-15` manages KWin desktops;
  `kwin/src/plan-adapter.ts:2321-2450` retains native applied evidence and
  schedules event responses.
- [O] `crates/plasma-auto-tiler/src/planner_service.rs:1-46` owns Linux
  D-Bus name, endpoint and caller checks. The plain-old-data (POD) C ABI and
  panic containment in `crates/tiler-kwin-effect-ffi/src/drag_oracle.rs:176-262`
  and `crates/tiler-kwin-effect-ffi/src/group_highlight.rs:520-548` serve the
  C++ effect in `kwin/native-effect/activewindowborder.cpp:984-1143`.
- [O] `kwin/native-effect/shortcutreconciler.h:22-60` implements KDE's
  foreign-shortcut override contract from `docs/decisions.md:749-836`.
- [I] Windows implements HWND observation, DPI conversion, window setters,
  visibility recovery, input hooks and Snap conflict resolution. macOS later
  supplies its own accessibility/Space observations. Neither imports KWin
  D-Bus, effect rendering, shortcut writes or process boundaries.

## Suggested extraction order and gates

Reuse the Engine first; move other decisions only after a second host exposes
their exact common inputs and KWin fixtures preserve existing behavior.

1. [I] Define adapter observation/capability types for physical frames,
   visibility, fullscreen, focus and input. Compare Windows geometry with
   `crates/tiler-core/src/geometry.rs:108-165` and
   `crates/tiler-core/src/seed.rs:65-80` without moving Engine code.
2. [I] Share settings validation and pure border/underlay/preview geometry.
   Keep KWin scene timing. Fixtures must preserve Meta-held group visibility
   and applet-popup exclusion (`kwin/native-effect/activeborderlogic.h:20-84`).
3. [I] Share shortcut *intent* and drag verdict types after Win-key tests.
   Leave KDE key registration and native drag events in the adapter
   (`kwin/src/plan-adapter-entry.ts:281-398`,
   `crates/tiler-kwin-effect-ffi/src/drag_oracle.rs:103-152`).
4. [I] Compare complete-observation classification fixtures across both
   hosts before extracting TS classification. Core already handles actual
   membership convergence (`kwin/src/plan-adapter.ts:2360-2450`,
   `crates/tiler-core/src/session/world.rs:671-865`).
5. [I] Prototype Windows workspace recovery, then design shared logical
   selection, send, trailing-empty and displacement operations. Compare KWin
   modes before moving its model. Windows is the *trigger* for the deferral
   in `docs/decisions.md:55-58`, not a reason to bulk-migrate TS now.

[I: `docs/principles.md:34-66`, `VISION.md:30-52`] Accept extraction only
with KWin fixture parity and Windows owned-window readback, including stale
observation fences, focus, visual gating, settings and game exclusion.
