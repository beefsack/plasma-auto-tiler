# Cross-platform core extraction

Status: source audit updated 2026-09-30. Most layout, initial-fit, drag and
membership policy already lives in Rust. **User decision 2026-09-30:**
extract portable pieces under KDE first, with KWin fixtures and user live
checks before Windows work. Windows/macOS still motivate the same portable
intents without transplanting KWin's native implementation. Compare the
[Windows plan](../windows-port/plan.md) and [macOS plan](../macos-port/plan.md).

`V` means verified vendor documentation or checked license, `O` observed
repository/upstream code at the cited path, and `I` proposed API or unverified
behavior. Local source checked 2026-09-30. `docs/decisions.md:50-58,
149-153,201-224,1143-1160` sets the Rust/native boundary and defers workspace
extraction until a non-KWin host needs it; `:689-747,749-836` governs
workspaces and shortcuts. No Windows/macOS live tests accompany this audit.

## Existing portable contract to reuse

Keep the Engine's existing typed domain and layout authority. Windows and
macOS supply observations and apply plans; neither needs KWin's D-Bus route.
The `Engine::handle(&CoreEvent)->CoreReply` entry is already present
(`crates/tiler-core/src/engine.rs:635`) [O]; the simplified handle shape
below is a proposed adapter sketch, not its current signature [I].

| Item | Current implementation (O) | Host-neutral API shape / work (I) | KWin risk and order (I) |
| --- | --- | --- | --- |
| Engine/domain identity | `crates/tiler-core/src/engine.rs:52-85` owns per-domain Sessions; `crates/tiler-core/src/session/world.rs:31-75` defines `(OutputId,WorkspaceId)` domain, bounds, gap, adjacency. `crates/tiler-protocol/src/planner_protocol.rs:789-909` decodes directional domain and calls `inset_bounds`. | `Engine::handle(Observation, Command)->Plan/Refusal` is conceptual; opaque IDs normalized by adapter, with complete observation for the operation's domain(s); preserve generation/revision/correlation fences. Protocol is optional at external IPC, not mandatory in a Windows/macOS process. | Low for initial adapters; **do not** merge per-domain revisions or reuse KWin D-Bus request objects wholesale. Preserve existing typed Engine. |
| Gap/projection math | `crates/tiler-core/src/geometry.rs:108-165,190-276` already owns outer inset, ordered N-ary integer allocation and gaps; `crates/tiler-core/src/size_hints.rs:377` begins hint-aware projection; `crates/tiler-protocol/src/planner_protocol.rs:823-889` bounds and normalizes wire gaps; `kwin/src/domain-gap.ts:10-43,56-109` supplies setting defaults and startup/config-read validation. | `ProjectionInput{normalized_work_area,outer_gap,inner_gap,hints}` -> `ProjectedLeaves/Refusal`; adapters establish unit/rounding rules for Windows pixels vs macOS AX points and convert to integer core coordinates. Share validated settings *semantics*, not TS `readConfig`. | Low. Existing Rust math first; align validator defaults/ranges with KWin fixtures. Never treat DWM visible bounds or a Quartz pixel rectangle as the portable work area without normalization. |
| Initial adoption fit | `crates/tiler-core/src/seed.rs:31-73,77-106,142-179,240-332` does recursive cuts, max(gap,3%) crossing and overlapping-window centre split; `crates/tiler-core/src/engine.rs:73-79,833-930` tracks/uses fresh-fit; `crates/tiler-protocol/src/planner_protocol.rs:578-642` logs fit. | `AdoptFit::attempt(Domain, NormalizedWindowRect[])->Fit{tree,links,centre_splits}/Decline`; fresh complete observation only, normal seed fallback. | Low: reuse as-is; native window eligibility/geometry quality determine outcome, not a new fit algorithm. |
| Core convergence and drop policy | `crates/tiler-core/src/session/world.rs:671-865` converges complete membership/float changes; `crates/tiler-core/src/session/ops/drag.rs:66-181,216-312,341-532,638-846` retains drag capture/preview/drop placement. | `Converge(CompleteDomainObservation)->Counts/Plan`; `Drag::begin/preview/drop(Capture, Pointer, ObservedState)->Preview/Plan/Refusal`. Adapter supplies normalized pointer/geometry and observed finish, no native hook calls in core. | Low to medium: this is portable today; add cross-host contract fixtures rather than copying KWin drag oracle. Preserve no-setter-replay and stale-scope gates. |

## Remaining portable pieces at a KWin boundary

The border, underlay and shortcut tables contain small pure decisions worth
sharing. Rendering, native input and process-lifecycle timing stay with each
host adapter.

| Item | Current location and host-only boundary (O) | Proposed core shape and responsibilities (I) | KWin path risk; suggested order (I) |
| --- | --- | --- | --- |
| Active border geometry/visibility | Pure C++ `kwin/native-effect/activeborderlogic.h:11-53` chooses color/inner rect and excludes missing/deleted/minimized/fullscreen/maximized/applet popups. `kwin/native-effect/activewindowborder.cpp:984-1015` reads KWin focus/window state and maps through `windowItem()->mapFromScene`, paints `OutlinedBorderItem`. | `BorderStyle{color,width,radius,gap}` and `BorderTarget{present,visible,fullscreen,maximized,excluded,frame}` -> `VisibleBorder{outer_rect,style}?`. Adapter translates KWin applet popup / Windows eligibility into `excluded`, obtains theme and renders. Do not assume Windows native border supports arbitrary width/gap/radius. | Low for pure predicate/rect migration; medium for C++ scene integration. Migrate and prove on KWin *before* Windows; keep native signal timing and scene placement in effect. |
| Active group + filled underlay | `crates/tiler-core/src/active_group.rs:45-58,71-98,109-164` derives immediate-parent members and union of *projected* rectangles; `crates/tiler-core/src/boundary.rs:824-901` exposes query. `crates/tiler-kwin-effect-ffi/src/group_highlight.rs:492-518` checks focus, hidden state and Meta-held eligibility; `kwin/native-effect/activeborderlogic.h:69-84` computes underlay extension/outer rect; `kwin/native-effect/activewindowborder.cpp:1018-1079` parses and anchors scene item; `kwin/src/active-group-highlight.ts:567-629` bridges KWin event stream. | `GroupVisual::resolve(ActiveGroup, FocusEvidence, ModifierHeld, Style)->Optional<GroupVisualIntent{members,union,expanded_rect,fill}>`; core provides membership/rect/visibility predicates, adapter handles stacking anchors, effect availability, theme and paint. Keep existing Rust group-resolution source of truth. | Low-medium: move only C++ extension arithmetic and eligibility predicate with integer/float edge fixtures. KWin scene parenting stays native; Windows tests a non-topmost underlay directly beneath the lowest member, with Z-order rechecks; macOS cannot claim a true foreign-window underlay from `NSWindow` levels alone [I: macOS plan, M5,U5]. After active border. |
| Drop overlay / final drag verdict | `crates/tiler-core/src/session/ops/drag.rs:216-312,341-532` owns preview and commit policy. `crates/tiler-kwin-effect-ffi/src/drag_oracle.rs:86-152` validates optional press and compares start/end, builds correlated cancelled/moved verdict; `kwin/src/drag-oracle-pull.ts:46-119,124-226` validates response, applies KWin-specific thirds/resize route; `kwin/native-effect/activeborderlogic.h:55-67` validates preview rect and `kwin/native-effect/activewindowborder.cpp:1096-1143` paints screen-space fill. | `DragEvidence{window,start,end,press?,grab_kind?,correlation}` -> `DragVerdict{moved,cancelled,reason}`; `PreviewIntent{target_rect,visual_style,visible}` from core. Adapter owns pointer hooks, KWin D-Bus pull or Windows WinEvent final rect, hit testing, coalescing, paint. KWin grabbed-edge/thirds classifier stays host until second host establishes shared semantics. | Medium: port pure verdict/preview bounds after working Windows drag lifecycle. Moving synchronous effect callbacks or timing may introduce lag/stale preview; require KWin fixtures and native effect acceptance separately. |
| Observation/difference classification | `kwin/src/plan-adapter.ts:2321-2450` applied-scope cache and `classifyCompleteObservation` compare identities/flags/rects/gaps, raw out-of-bounds; `crates/tiler-core/src/session/world.rs:671-865` owns membership changes; `crates/tiler-core/src/reconcile.rs:236-246,379-477` owns propose/ack/verify. | `Classify(CompleteObservation, AppliedEvidence, DomainScope, HostExceptionFlags)->{membership_or_flags_change,pure_drift,scope_change,equal,uncertain}` as pure policy only. Adapter owns collecting complete frames, sticky multi-home normalization, single-flight, retries, quarantine, write echo and client-specific clamp handling. | High: KDE-first may extract only comparison of already-normalized complete evidence after fixtures and live KWin checks; defer host exception flags and timing until Windows observations. Preserve three-strike and unreadable-domain fences (`docs/decisions.md:36-49,617-641`). |
| Workspace lifecycle and per-output mapping | `kwin/src/workspace-native.ts:19-37,94-149,347-400,409-556,1260-1394` owns native backing desktop catalog, logical selection/numbered shortcuts, trailing empty, output displacement/reconnect. `crates/tiler-core/src/session/world.rs:31-75` and `crates/tiler-core/src/session/ops/workspace.rs:36-80` already plan domain keys and same-output send. | **Triggered by a new host:** design `LogicalWorkspaceState{mode,outputs,active_by_output,ordered_workspaces,membership,displaced}` and commands `select/send/ensure_trailing_empty/disconnect/reconnect`; host backing capabilities describe `observe/select/reveal/park/move/restore`. Native KWin desktop pool, Windows hide/reveal and future macOS AX parking/restore stay adapters. | **Highest**: `docs/decisions.md:55-58` defers migration until a non-KWin host needs it. Windows now supplies that trigger, but not the backing-visibility contract. First prove Windows visibility/recovery on owned windows and compare KWin fixtures, then extract pure lifecycle. macOS can extend this later; no bulk TS move in the KDE-first phase. |
| Shortcut command catalog | `kwin/src/plan-adapter-entry.ts:281-398` builds COSMIC HJKL + arrow focus/move/resize, float/maximize/fullscreen, while `kwin/src/workspace-native.ts:68-149` builds numbered select/send and shifted US symbol aliases. `kwin/native-effect/shortcutreconciler.h:22-60` maps exact KDE override rows. | `ActionId` + `CommandKind{focus,move,resize,float,sticky,maximize,fullscreen,select_workspace,send_workspace}` + `ProfileCatalog::actions(profile)`; host `ShortcutBinding{physical_or_logical_key,modifiers,availability,conflict}` maps intent to chords. Do not put literal `Meta+L` or KDE foreign-holder IDs into portable policy. | Low-medium: extract action *intent* under KDE first; the Windows chord mapping waits for Win+Arrow input evidence. Preserve KDE's catalog, US aliases and Force/Revert with fixtures; KWin profiles still share one catalog (`kwin/src/plan-adapter-entry.ts:288-290`). |
| Settings schema and live apply | `kwin/contents/config/main.xml:8-41` stores mode/defaultTiled/profile/gaps with defaults/ranges; `kwin/native-effect/activeborderconfig.kcfg:7-39` stores border/drag/underlay; `kwin/src/domain-gap.ts:10-43,56-109` normalizes gaps; `kwin/native-effect/unifiedsettings_module.cpp:27-80` builds KCM; live caveats in `docs/decisions.md:85-95,228-252`. | `SettingDescriptor{key,type,default,validation,capability,apply_mode,conflict_state}` and `ValidatedSettings` used by all adapters; `apply(changes)->Applied/Deferred/Rejected` must have observed confirmation. Portable defaults/semantic validation can move, but Windows-native color/accessibility and keyboard formatting stay adapter-specific. | Medium: extract gap/style validation under KDE first without rewriting `kwinrc` or KCM; add Windows-only capability and conflict descriptions after Windows evidence. Do not claim all KWin settings already apply live. |

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
  visibility recovery, input hooks and Snap conflict resolution. macOS owns
  Accessibility (AX) permission, AX/Quartz identity, app refusal/readback,
  point conversion, Space observation, parking recovery and overlay ordering.
  Neither imports KWin D-Bus, effect rendering, shortcut writes or process
  boundaries [V: macOS plan, M5-M8; O: U1].

## KWin, Windows and macOS capability comparison

Use shared names for *what is wanted*, not a claim of equal authority. Each
row separates actual KWin code [O] from proposed host behavior [I] and
documented limits [V]. References M/U and W/U resolve in the linked plans.

| Capability | KWin | Windows | macOS |
| --- | --- | --- | --- |
| Process | [O: `crates/plasma-auto-tiler/src/planner_service.rs:1-46`, `docs/decisions.md:50-54`] KWin script + D-Bus Rust Engine, native effect and tray. | [I: Windows plan, W1,W2] One per-user interactive Rust process; no Session 0 service. | [I: macOS plan, M4] One signed GUI-login app/Engine, registered through `SMAppService`; no KWin D-Bus hop. |
| Observation | [O: `kwin/src/plan-adapter.ts:2321-2450`] KWin complete domains, native signals and applied evidence. | [V/I: Windows plan, W2,W16] WinEvent + `EnumWindows`, DPI and DWM visible-frame readback. | [V/I: macOS plan, M6-M8] TCC-authorized per-PID AX observers, fresh AX enumeration + Quartz supplemental list; Space/Stage Manager uncertainty. |
| Actuation | [O: `docs/decisions.md:563-663`] KWin frame/desktop setters, exact-scope follow, no setter replay. | [V/I: Windows plan, W2,W16] `SetWindowPos`, conditional focus, batch/readback and visibility recovery. | [V/I: macOS plan, M6] AX position/size/focus best effort; no atomic batch, per-app clamp/refusal and readback. |
| Workspaces | [O: `kwin/src/workspace-native.ts:19-37,409-556`, `docs/decisions.md:689-727`] Native backing desktops implement three logical modes. | [V/I: Windows plan, W5,W6] Public virtual desktops lack full lifecycle; managed hide/reveal proposed. | [V/O/I: macOS plan, M8,U1,U2] Public native Spaces lack lifecycle/send; AX corner parking is a proposed managed route. |
| Visuals | [O: `kwin/native-effect/activeborderlogic.h:11-84`, `crates/tiler-core/src/active_group.rs:109-164`] Effect paints active ring, filled underlay and drop preview. | [V/I: Windows plan, W2,W31,W34-W38] Layered non-topmost underlay and one-monitor custom-drawn surface are experiments; Task View visibility unverified, outline fallback approved. | [V/O/I: macOS plan, M5,U5,U6] Public AppKit click-through panels for border/preview; no proven below-foreign-window underlay. |
| Shortcuts | [O: `kwin/src/plan-adapter-entry.ts:281-398`, `kwin/native-effect/shortcutreconciler.h:22-60`] KGlobalAccel registration/explicit Force/Revert. | [V/I: Windows plan, W3,W12] Non-Win defaults selected; opt-in Win+Arrow must pass a physical Windows test for this user's feature-complete experience; Win+L remains unproven. | [V/I: macOS plan, M12,M13] Carbon hotkeys/event tap, TCC/Secure Input and reserved lock/Mission Control chords. |
| Settings UI | [O: `kwin/native-effect/unifiedsettings_module.cpp:27-80`, `kwin/contents/config/main.xml:8-41`] KCM/kwinrc; some settings still startup-only. | [I: Windows plan, W23-W26] Native desktop settings/tray, host-owned storage and apply confirmation. | [V/I: macOS plan, M15] AppKit/SwiftUI settings + `NSStatusItem`; native TCC onboarding. |
| Distribution | [O: `docs/decisions.md:253-307`] KPackage, host-matched effect/KCM and Nix/Home Manager. | [V/I: Windows plan, W19,W20,W39-W45] Store MSIX or signed Store-listed MSI/EXE plus signed GitHub installer and winget; package/update route needs proof. | [V/O/I: macOS plan, M9,M16,M17] Developer ID signed, notarized app/DMG, optional Cask/Sparkle. |

## Which shared layer, and when?

KDE alone can verify pure mathematical and policy extractions against its
current behavior. A workspace visibility contract needs Windows evidence;
neither host forces an abstract platform trait now [I].

| Candidate | Decision and evidence |
| --- | --- |
| Desktop adapter trait | [I: `docs/decisions.md:1149-1160`; macOS plan, M6-M8] Not yet: a synchronous `move_window`/`switch_space` trait would falsely promise AX setter success, native Spaces and KWin's stronger workspace authority. Start with capability/result vocabulary (supported, refused, applied-readback, uncertain) and per-host adapters; extract a narrow trait only after real implementations need the same call boundary. |
| Settings schema | [O: `kwin/contents/config/main.xml:8-41`, `kwin/native-effect/activeborderconfig.kcfg:7-39`; I] KDE-first: share pure gap/style defaults, bounded values and action intent with KWin fixtures. Wait to model Windows permissions and per-host live-apply status until actual frontends exist. Keep TCC/UI, KWin's kwinrc and host conflict writes, Windows storage and labels local. |
| Logical-workspace model | [O: `crates/tiler-core/src/session/world.rs:31-75`, `kwin/src/workspace-native.ts:409-556`; I: Windows plan W5,W6] Strongest **post-Windows-visibility** candidate: ordered sets, trailing empty, per-output selection/send and displacement can be shared. Window hiding, journal, exact restore and shell/Task View behavior cannot. Windows recovery proof plus matching KWin fixtures is the minimum extraction gate; macOS may extend it later. |
| Overlay intent | [O: `crates/tiler-core/src/active_group.rs:109-164`, `kwin/native-effect/activeborderlogic.h:20-84`; I: macOS plan M5,U5] Share projected border/group/preview geometry, style and a `requires_below_members` intent. Capability/refusal must say when macOS cannot honor a true underlay. Native z-order, click-through, game suppression timing and paint stay host-owned. |
| Tray/menu intent | [O: `docs/decisions.md:1015-1074`; I: macOS plan M15; Windows plan W13] Share confirmed workspace/tiling status, permission/conflict/action IDs if duplication materializes; keep menu lifecycle, notifications, icons, focus and Settings opening host-native. Optional indicator is never workspace authority. |

[I] Premature sharing includes KWin's D-Bus/FFI routing, window ID joins,
`ShowWindow` vs AX parking behind a single `hide()` call, universal shortcut
chords, TCC/UIPI permission models, overlay z-order algorithms, one settings
widget or updater, and app-specific AX hint/refusal heuristics. They do not
share a common reliable actuation contract today [V: macOS plan M5-M8;
Windows plan W2,W4-W6].

## KDE-first migration phases

K0 accepted 2026-09-30; test-only baseline needs no live checks. See the
[coverage audit and gate evidence](../../changes/archive/portable-core-k0-baseline.md).
K1 offline extraction completed 2026-09-30: `tiler-core::visual` owns pure
policy, and the native header adapts Qt values through the existing effect FFI.
User K1 single-output test-system checks confirmed; multi-output test system checks deferred. See the
[implementation and handover](../../changes/archive/portable-core-k1-visual-policy.md).
K2 and K3 deferred (user 2026-09-30) after the [boundary audit](../../changes/archive/portable-core-k2-settings-actions.md):
the KWin script cannot call Rust in-process, so sharing settings, the action
catalog or the difference classifier needs a new JS-to-Rust route or
artifact. Rust keeps what it already owns; the rest is revisited when the
Windows port needs a shared contract. The KDE-first phase ends at K1.

**User sequence, 2026-09-30:** move reusable pure policy under KDE first.
Before each change, add a fixture that captures current KWin behavior; after
offline checks, the user verifies visual/physical behavior in the real KDE
session under `docs/live-kwin-testing.md`. Live checks are proposed evidence,
not permission to mutate the host or bypass ownership/restoration guards.

| Step | Fixture first | Exit evidence including user KDE checks | KWin risk |
| --- | --- | --- | --- |
| K0. Baseline, already-core policy | [O/I: `crates/tiler-core/src/geometry.rs:108-165`, `crates/tiler-core/src/seed.rs:65-80`, `crates/tiler-core/src/session/world.rs:671-865`] Capture nested splits, gaps, near-fit centre fallback, complete membership/float convergence and refusal on incomplete frames; no redundant API wrappers. | Rust core/protocol fixture parity, `just check-portable`, KWin script typecheck/tests. Accepted test-only work; no live checks required (Orchestrator acceptance 2026-09-30). | Low: baseline only, no product movement. |
| K1. Visual policy predicates and expansion | [O/I: `kwin/native-effect/activeborderlogic.h:20-84`, `crates/tiler-kwin-effect-ffi/src/group_highlight.rs:499-518`] Fixture current color/fallback, border gap, all maximize axes, fullscreen, applet popup, Meta-held group, translucent underlay extension and invalid/clear drop preview; exact rounding and no group for lone leaf. Write matching Rust pure tests before routing C++ to them. | `cargo test -p tiler-core -p tiler-kwin-effect-ffi`, effect C++ tests/build against exact host ABI, KWin TS tests. User checks active border on ordinary, fullscreen, maximized and applet-popup windows; holds Meta over a nested group; drags to a valid slot and cancels. Observe visible state and logs, not only a setter reply. | Medium: float/double conversion and effect paint timing. Keep KWin scene placement, modifier spy and POD FFI untouched. |
| K2. Settings and action intent | [O/I: `kwin/src/domain-gap.ts:10-43`, `kwin/contents/config/main.xml:8-41`, `kwin/src/plan-adapter-entry.ts:281-398`, `kwin/src/workspace-native.ts:94-149`] Fixture defaults, 0/64/invalid gaps, mode/tiling defaults, COSMIC action IDs and exact HJKL/arrow/shifted-US aliases. Pin saved `kwinrc` keys and KGlobalAccel conflict handling. Move only typed validation/action *intent*, not KDE binding or installer writes. | Rust tests and `just check-portable`; `npm --prefix kwin run typecheck` and `npm --prefix kwin test`; native KCM build/tests. User checks Settings gap save actually reflows live, existing physical focus/move/resize and numbered workspace shortcuts, then verifies current KDE Apply/Force/Revert only if separately authorized. | Medium: alias dispatch, config storage and live pickup. Keep `shortcutProfile` behavior and startup-only `workspaceMode` unchanged. |
| K3. Pure difference comparison, only if fixtures justify it | [O/I: `kwin/src/plan-adapter.ts:2360-2450`, `crates/tiler-core/src/session/world.rs:671-865`] Fixture complete foreground/hidden equality, missing/arriving/float member, gap/bounds change, raw out-of-area drift, maximize/fullscreen overlay, sticky multi-home and unreadable/incomplete fences. Extract only host-normalized comparison; no polling, three-strike, event ordering or write-echo ownership in core. | Rust + TS classifier fixtures agree on decision and bounded diagnostics. User checks foreground open/close/drag, hidden workspace change without focus theft and rapid cross-output/workspace send, reading correlated outcomes rather than relying on visuals alone. If equivalent KWin evidence cannot be proven, leave this classifier in TS for now. | High: hidden/sticky and single-flight fences are easy to disturb; narrowly reversible change only. |
| W-gate. Host-dependent pieces | [I: Windows plan W3-W6,W34-W38] No speculative KWin extraction fixture can prove Windows hide/reveal recovery, Win+Arrow interception, Task View or overlay stacking. Record capability/refusal vocabulary, not a universal setter trait. | Windows owned-window spikes prove visibility, crash restore, two monitors, shell UI, gaming and shortcuts. Only then design the shared logical workspace model and any host-dependent difference classification, preserving KWin fixtures and user live checks when migrated. | Highest if moved early: native backing desktops and project-managed hiding have different failure paths. |

Do not move JSON serialization, stateful drag-oracle correlation, KWin Qt
scene items or `kwinrc` ownership into `tiler-core`. It currently has no
normal crate dependencies, as checked by `just check-portable`
(`justfile:1306-1321`); retain that guard [O]. macOS-specific capability
evidence comes from its later Lead; Windows need not wait for macOS work.

### Decided: workspace model in the KDE-first phase

User decision 2026-09-30: take the recommended option below. Stop before
workspace lifecycle extraction; refine the core shape during Windows spiking.

Windows needs logical workspaces, but KDE alone cannot show whether the
Windows hiding model can preserve Task View, focus and post-crash recovery.

| Option | Consequence | Recommendation |
| --- | --- | --- |
| Move full `kwin/src/workspace-native.ts` logical model to Rust now | [O/I: `docs/decisions.md:55-58`, `kwin/src/workspace-native.ts:409-556`] Earlier shared types and extensive KWin churn, with risk of encoding backing-desktop behavior Windows cannot use. KDE fixtures cannot establish Windows visibility/recovery semantics. | Do not do this in K0-K3. |
| Stop before workspace lifecycle extraction; preserve `(output,workspace)` Engine domains | [O/I: `crates/tiler-core/src/session/world.rs:31-75`] Smaller KDE regression surface; after the Windows owned-window hide/reveal spike, define pure select/send/trailing/displacement state and replay matching KWin fixtures before migration. | **Recommended.** This honors the previous deferral: Windows now triggers design, but its backing evidence determines shape. |

The later extraction must preserve KWin's per-output-local, global-unique and shared semantics plus
trailing-empty and reconnect behavior in fixtures and user live checks
(`docs/decisions.md:689-727`) [I].
