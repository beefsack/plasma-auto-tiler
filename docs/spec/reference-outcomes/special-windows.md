# Special windows (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there.

Candidates: R-SPC-01 through R-SPC-05 (transients/modals, splash/utility types, PiP, fixed-size admission, app-owned resize/hint changes). No existing special rows to backfill (0 existing rows, 0 cells). PiP is app/flags-specific with no universal native type; no profile invents one.

Q2 discriminators R-SPC-06..13 cover fixed-size edge cases. D1-D8 are
user-selected NORMATIVE (User 2026-10-08; REQ-SPC-04a..h); D1 setting delivered
offline, D5/D6 delivered offline; D7 remains implementation pending in Ours KDE;
[offline delivery and review record](../../changes/archive/fixed-size-admission.md).

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours KDE cells cite the KDE observer gate
(`S(S-ours-spc-kde)`); Ours Windows cells cite the Windows candidate
gates (`S(S-ours-spc-win)`); the shared Engine carries no
type distinction and is never delivery evidence here. Selected intent
and doc assertions are never evidence.

R-SPC-01 fixture roles: D is a typed-dialog transient for A (both
flags set). The fresh modal-D leg keeps transient-for and adds the
modal flag. Profiles with no modal branch report the identical outcome
explicitly; the flag is never silently dropped. A normal-type
transient (no dialog flag) is a different fixture and is not claimed.

### R-SPC-01: open a transient dialog, then request parent focus; fresh modal variant

- Given (tree profiles): `H[A*]`, A parent-eligible; typed-dialog
  transient D for A not yet mapped. Modal-D leg adds the modal flag.
- Given (column profiles): `COL[C1[A*]]` sole column; same D legs.
  Shipped defaults apply; viewport recorded.
- When: open D transient for A; request focus on A.
- Observe: transient float vs tile, parent-relative placement, and
  modal focus fence; dialog and modal flags recorded separately.
- Then COSMIC: D floats (Wayland parent branch; X11 dialog-or-modal
  branch). Placement and any modal fence TBD. `S(S-cos-admit)`;
  queued.
- Then Hyprland/Dwindle: D floats (parent/transient/modal all
  suggest float). Placement and fence TBD. `S(S-hyp-spc)`; queued.
- Then bspwm: D floats centered (transient rule plus dialog-type
  center); no modal mechanism exists so no fence.
  `S(S-bsp-spc)`.
- Then i3: D floats (transient-for plus dialog-type branches).
  Frame and fence TBD. `S(S-i3-min)` + `S(S-i3-ins)`; queued.
- Then xmonad/Tall+Navigation2D: D floats at its managed native
  geometry with newcomer focus; the modal flag is inert (no branch),
  so the modal leg matches. `S(S-xmo-float)`.
- Then sway: xdg D floats (parent branch); xwayland D floats
  (modal/dialog branch). Placement and fence TBD.
  `S(S-sway-spc)`; queued.
- Then qtile/Columns: D floats (dialog type matches shipped rules)
  centered on A (transient placement) with stealable focus; the
  modal flag is inert (no branch). `S(S-qti-spc)`.
- Then awesome/tile: D floats (dialog type is implicitly floating),
  admitted on A's screen and tags with raise; the modal flag is
  inert. `S(S-awe-manage)` + `S(S-awe-float)`.
- Then niri: D floats alongside the parent (`compute_open_floating`:
  explicit rule, parent, or fixed positive height min==max; the
  boolean feeds `add_window`); Smart focus applies and the tiler
  imposes no modal fence. `S(S-nir-spc)` + `S(S-nir-maxfs)`.
- Then PaperWM: D floats above (`add_filter` rejects transients;
  `make_above` so it is not hidden); takes focus. Wayland fence
  enforcement TBD. `S(S-pap-spc)`; queued.
- Then karousel/Lazy: D floats (transient fails `shouldTile`;
  modal fails it too). Placement and KWin-side focus TBD.
  `S(S-kar-spc)`; queued.
- Then paneru: management is role-gated (non-standard roles skipped
  unless forced); D's dialog/transient role outcome untraced. TBD;
  queued.
- Then Ours KDE: TBD (observer gates on KWin `normalWindow`; the
  dialog-type eligibility mapping is untraced with no pinned KWin
  source in-repo, so no admission outcome is claimed).
  `S(S-ours-spc-kde)`; queued.
- Then Ours Windows: D is excluded from tile targets (owner gate
  plus dialog-class gate). Host placement and modal focus fence TBD;
  exclusion does not establish that native journey. `S(S-ours-spc-win)`;
  queued.
- Variant hook: provisional/TBD (dialog-float hook, to discuss).

### R-SPC-02: open a typed splash window; fresh utility variant

- Given (tree profiles): `H[A*]`, no custom rules. U typed splash;
  fresh leg U typed utility. Backend/protocol legs split only where
  the profile has two backends.
- Given (column profiles): `COL[C1[A*]]` sole column; same U legs.
- Given (niri): X11 U through working xwayland-satellite; native xdg
  splash/utility types have no counterpart.
- Given (Ours Windows): utility U uses `WS_EX_TOOLWINDOW`; record the
  standalone splash's actual class, owner and extended styles.
- When: open U.
- Observe: excluded/unmanaged vs floating/tiled, focus steal, and
  task-switcher presence. All three legs are load-bearing; a cell
  missing any applicable leg stays P.
- Then COSMIC: X11 splash floats while X11 utility tiles (Utility
  excluded from `is_dialog`); Wayland-native typed legs are
  fixture-inapplicable (xdg has no splash/utility type counterpart).
  Focus and switcher TBD. `S(S-cos-admit)`; queued.
- Then Hyprland/Dwindle: both float (SPLASH and UTILITY atoms) and
  neither takes initial focus (non-DIALOG float atoms suggest no
  initial focus). Switcher presence TBD. `S(S-hyp-spc)`; queued.
- Then bspwm: splash tiles as ordinary with newcomer focus (no
  splash branch); utility tiles without focus (`focus=false`).
  Switcher presence TBD. `S(S-bsp-spc)`; queued.
- Then i3: both float (DIALOG/UTILITY/TOOLBAR/NOTIFICATION/SPLASH
  plus MODAL branch) with visible-workspace newcomer focus.
  Switcher presence TBD. `S(S-i3-min)`; queued.
- Then xmonad/Tall+Navigation2D: both tile as ordinary newcomers
  with focus (no type branch; only fixed/transient float).
  Switcher presence TBD. `S(S-xmo-float)`; queued.
- Then sway: xwayland U floats (DIALOG/UTILITY/TOOLBAR/SPLASH and
  modal branches); xdg typed legs are fixture-inapplicable (xdg has
  no window-type counterpart; only parent/fixed-size float). Focus
  and switcher TBD. `S(S-sway-spc)`; queued.
- Then qtile/Columns: both float (utility/splash/dialog in shipped
  rules; unplaced floats center) with stealable focus. Switcher
  presence TBD. `S(S-qti-spc)`; queued.
- Then awesome/tile: both implicitly float (non-normal type).
  Focus and switcher presence TBD. `S(S-awe-float)`; queued.
- Then niri: parentless resizable splash/utility tiles as ordinary
  columns (`compute_open_floating` is exhaustive over explicit rule,
  parent, and fixed height; `Match` carries no window-type field;
  xwayland-satellite translates typed X11 windows to native). Smart
  focus applies. Switcher presence TBD. `S(S-nir-spc)`; queued.
- Then PaperWM: both float (`add_filter` admits Normal only) with
  `make_above`. Focus and switcher presence TBD. `S(S-pap-spc)`;
  queued.
- Then karousel/Lazy: TBD (KWin kind-flag mapping for
  splash/utility against the shapeability gate untraced). Queued.
- Then paneru: role-gated management; splash/utility role outcome
  untraced. TBD; queued.
- Then Ours KDE: TBD (same `normalWindow` type-eligibility gap as
  R-SPC-01). `S(S-ours-spc-kde)`; queued.
- Then Ours Windows: utility is toolwindow-excluded from tile
  targets; standalone splash eligibility TBD.
  `S(S-ours-spc-win)`; queued.
- Variant hook: provisional/TBD (window-type hook, to discuss).

### R-SPC-03: enter app picture-in-picture mode

- Given (all profiles): `H[A*]` (tree) or `COL[C1[A*]]` (columns);
  playing media app. Record toolkit, app, version, actual flags and
  rules before acting.
- When: enter the app's PiP mode.
- Observe: separate float/topmost vs ordinary tile; app-rule vs
  native window-type distinction. No universal PiP type is assumed.
- Then COSMIC: TBD (no PiP branch traced; app/flags-specific).
  Queued.
- Then Hyprland/Dwindle: TBD (no PiP branch traced). Queued.
- Then bspwm: TBD (no PiP branch traced). Queued.
- Then i3: TBD (no PiP branch traced). Queued.
- Then xmonad/Tall+Navigation2D: TBD (no PiP branch traced). Queued.
- Then sway: TBD (no PiP branch traced). Queued.
- Then qtile/Columns: TBD (no PiP branch traced; float rules are
  type/class/transient, not PiP). Queued.
- Then awesome/tile: TBD (no PiP branch traced). Queued.
- Then niri: shipped Firefox PiP app-id/title rule floats
  (`open-floating true`); every other app TBD (no native PiP type).
  `S(S-nir-spc)`; queued.
- Then PaperWM: TBD (no PiP branch traced). Queued.
- Then karousel/Lazy: TBD (no PiP branch traced). Queued.
- Then paneru: TBD (no PiP branch traced). Queued.
- Then Ours KDE: TBD (no PiP type or rule in the observer or the
  Engine). `S(S-ours-spc-kde)`; queued.
- Then Ours Windows: TBD (owned/tool/dialog gates do not name PiP;
  app-specific eligibility untraced). `S(S-ours-spc-win)`; queued.
- Variant hook: provisional/TBD (PiP hook, to discuss; app-specific).

### R-SPC-04: open a fixed-size window (min=max 640x480)

- Given (tree profiles): `H[A*]`, no custom rules. E fixed at
  min=max 640x480, resizable otherwise ordinary.
- Given (column profiles): `COL[C1[A*]]`; same E.
- When: open E.
- Observe: fixed-size admission exception (float) vs forced tile,
  and any size-only clamp. Exact frames and focus are not
  load-bearing for this predicate.
- Then COSMIC: E floats (min==max is `is_dialog`).
  `S(S-cos-admit)`.
- Then Hyprland/Dwindle: E floats (FIXED_SIZE hints branch).
  `S(S-hyp-spc)`.
- Then bspwm: E floats (min==max hints rule). `S(S-bsp-spc)`.
- Then i3: E floats (min==max branch). `S(S-i3-min)`.
- Then xmonad/Tall+Navigation2D: E floats. `S(S-xmo-float)`.
- Then sway: E floats (xdg either-dimension min==max; xwayland
  fixed branch). `S(S-sway-spc)`.
- Then qtile/Columns: E floats (`has_fixed_size` in shipped rules).
  `S(S-qti-spc)`.
- Then awesome/tile: E implicitly floats (`is_fixed`).
  `S(S-awe-float)`.
- Then niri: E floats (fixed positive height min==max under
  `compute_open_floating`). `S(S-nir-spc)`.
- Then PaperWM: E tiles (Normal type passes `add_filter`; no
  fixed-size exclusion). `S(S-pap-spc)`.
- Then karousel/Lazy: floats as untileable under the shapeability
  gate; the KWin resizeable-flag mapping for fixed-size clients
  stays TBD. `S(S-kar-spc)`; queued.
- Then paneru: fixed-size admission path untraced. TBD; queued.
- Then Ours KDE: E is an automatic float outside the tile tree. No E
  geometry, focus, stacking or keep-above writes from classification;
  exact native/game journey TBD. Implemented offline 2026-10-08 under
  NORMATIVE D1-D8 (User 2026-10-08; D1/D5/D6 delivered offline,
  D7 implementation pending); [real Planner fixtures](../../../kwin/tests/fixed-size-admission.test.ts),
  [record](../../changes/archive/fixed-size-admission.md).
- Then Ours Windows: tiles with its declared-hint clamp carried
  into the Engine rows (`WM_GETMINMAXINFO` per member; no
  fixed-size exclusion). `S(S-ours-spc-win)`.
- Variant hook: NORMATIVE D1/D8 (User 2026-10-08; delivered offline).
  KDE `fixedSizePredicate=both-axes-fixed` default (`Width and height both fixed`,
  tooltip COSMIC) or `either-axis-fixed` (`Width or height fixed`, tooltip
  Hyprland (Wayland), sway); both float this fixture. Windows handoff
  `core.fixed_size_predicate`; no migration.

### R-SPC-05: app-owned resize and minimum-hint change on a tile

- Given (tree profiles): `H[A,B*]`, B initially resizable, no
  limiting rules. Fresh run: B raises its minimum hints above its
  allocation instead of requesting a size.
- Given (column profiles): `COL[C1[A],C2[B*]]`; same two legs.
- When: B requests 900x700 (fresh run: B changes minimum hints
  above allocation).
- Observe: app-owned resize vs tile-authoritative allocation, and
  reactive clamp/reflow/float vs ignored request/hint. Client-side
  acknowledgement chatter is not load-bearing beyond the reactive
  outcome.
- Then COSMIC: allocation stays tile-authoritative (tiling without
  minimum enforcement; the compositor drives configure serials).
  `S(S-cos-min)`.
- Then Hyprland/Dwindle: allocation stays authoritative (tiled size
  limits default off; tiled X11 configure requests are refused via
  an authoritative size resend). `S(S-hyp-min)` + `S(S-hyp-cfg)`.
- Then bspwm: request ignored (`honor_size_hints=false` default);
  allocation retained. `S(S-bsp-hint)`.
- Then i3: request ignored (tiled render ignores size hints).
  Allocation retained. `S(S-i3-min)`.
- Then xmonad/Tall+Navigation2D: request has no path (Tall recalc
  owns geometry). Allocation retained. `S(S-xmo-layout)`.
- Then sway: request ignored (arrange ignores hints; the runtime
  hint path handles urgency only). Allocation retained.
  `S(S-sway-min)`.
- Then qtile/Columns: request ignored (tiled place without hints).
  Allocation retained. `S(S-qti-min)`.
- Then awesome/tile: request ignored while B stays resizable
  (tiled geometry early-return refuses the client resize; hints
  update emits `property::size_hints`; only the implicit float
  updater watches it and arrange listens for `size_hints_honor`, so
  no immediate reflow). Later arrange hint-shaping is the qualifier.
  `S(S-awe-hint)` + `S(S-awe-tile)`.
- Then niri: width clamped to min/max; reflow TBD. `S(S-nir-min)`;
  queued.
- Then PaperWM: app-resize reaction path untraced. TBD; queued.
- Then karousel/Lazy: width clamped to size hints; reflow TBD.
  `S(S-kar-manual-width)`; queued.
- Then paneru: hint path untraced. TBD; queued.
- Then Ours KDE: Engine allocation stays authoritative (geometry
  applied from the tree). Host hint reaction TBD.
  `S(S-ours-spc-kde)` + `S(S-ours-admit)`; queued.
- Then Ours Windows: Engine allocation stays authoritative with
  declared hints carried per member (min-enforcing rows); exact
  reflow TBD. `S(S-ours-spc-win)`; queued.
- Variant hook: provisional/TBD (client-hint hook, to discuss).

## Q2 fixed-size admission discriminators (2026-10-08)

R-SPC-04's 640x480 fixture is reused for ordinary fixed admission. Its
focus/frame-neutral automatic admission is NORMATIVE D8 (User 2026-10-08);
COSMIC's floating placement/focus is not evidence for our Gaming Compatibility fence.
Native game geometry/focus/stacking must remain untouched by automatic
classification. Existing sticky origin/toggle rules reuse R-FLT-02/05 and
R-RST-01; transient/dialog eligibility reuses R-SPC-01, not new type gates.
All fresh variants below reset the client and WM state independently.

### R-SPC-06: admit a client fixed on only one axis

- Given (tree profiles): `H[A*]`; ordinary non-transient E has min
  640x480, max 640x960 (width fixed). Fresh variant: max 1280x480
  (height fixed). No rules, overlays or explicit float state.
- Given (column profiles): `COL[C1[A*]]`; same hint variants.
- When: open E.
- Observe: width-only/height-only float vs tile; no geometry claim.
- Then COSMIC: tiles in both variants; whole-size equality fails.
  `S(S-cos-fixed-hints)`.
- Then Hyprland/Dwindle: Wayland floats in both; X11 tiles in both.
  `S(S-hyp-fixed-hints)`.
- Then bspwm: TBD (single-axis fixture not separately traced here).
- Then i3: TBD (single-axis fixture not separately traced here).
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: xdg floats in both; Xwayland outcome TBD here.
  `S(S-sway-fixed-hints)`.
- Then qtile/Columns: TBD.
- Then awesome/tile: neither variant satisfies implicit fixed-size floating;
  both axes must match. `S(S-awe-fixed-dynamic)`.
- Then niri: TBD (fixture-specific admission not traced here).
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD (native resizeable mapping untraced).
- Then paneru: TBD.
- Then Ours KDE: `both-axes-fixed` default tiles in both variants;
  `either-axis-fixed` floats in both without target writes (NORMATIVE D1).
  Switch to either-axis after admitting tiled E: E remains tiled; a new
  otherwise identical F floats. Switching back leaves F floating; explicit
  user tile overrides still win for the live client. This setting-change
  leg has no reference-WM outcome claim. Delivered offline 2026-10-08;
  [predicate/Planner fixtures](../../../kwin/tests/fixed-size-admission.test.ts),
  [D1 record](../../changes/archive/admission-and-move-settings.md). Native TBD.
- Then Ours Windows: TBD (handoff only; behavior frozen).
- Variant hook: NORMATIVE whole-size default or either-axis setting
  (User 2026-10-08); functional IDs delivered offline.

### R-SPC-07: admit with unset, zero or equal partial-zero hints

- Given (tree profiles): `H[A*]`; ordinary non-transient E. Independent
  hint variants: min/max absent; min=max (0,0); min=max (640,0);
  min=max (0,480); min=max (2147483647,2147483647), a KWin unbounded
  sentinel rather than a usable fixed size. Fresh guard variant: width
  min=max=640 but both height bounds absent. No rule/overlay/type exception.
- Given (column profiles): `COL[C1[A*]]`; same independent variants.
- When: open E with one hint variant.
- Observe: absence/zero/sentinel normalization vs raw equality.
- Then COSMIC: Wayland unset/(0,0) do not satisfy the fixed branch;
  both partial-zero variants do and float. X11 absent does not match;
  present zero hints and sentinel-native handling TBD.
  `S(S-cos-fixed-hints)`.
- Then Hyprland/Dwindle: unset and zero/partial-zero variants do not
  satisfy the fixed branch on either backend; sentinel-native handling TBD.
  `S(S-hyp-fixed-hints)`.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: xdg unset/zero/partial-zero fail the fixed branch;
  Xwayland and sentinel-native handling TBD. `S(S-sway-fixed-hints)`.
- Then qtile/Columns: TBD.
- Then awesome/tile: unset and zero/partial-zero fail the fixed branch;
  sentinel-native handling TBD. `S(S-awe-fixed-dynamic)`.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: missing/full-zero/sentinel do not auto-float; equal
  partial-zero vectors do (NORMATIVE D1, no resizeable inference).
  Implemented offline 2026-10-08; [shared predicate fixtures](../../../crates/tiler-core/tests/fixed_size_admission.rs),
  [KDE fixtures](../../../kwin/tests/fixed-size-admission.test.ts).
  Both predicates preserve these guards; the width-fixed/height-absent
  variant tiles under both (whole vectors must be usable). Reference outcomes
  for that added guard variant and native hint representation remain TBD.
- Then Ours Windows: TBD (max-track extraction not wired).
- Variant hook: NORMATIVE whole-size equality vs meaningful-bound
  normalization (User 2026-10-08).

### R-SPC-08: gain or lose fixed hints after admission

- Given (tree profiles): `H[A,B*]`, both ordinary resizable tiles.
  Fresh reverse variant: B is an automatically admitted fixed float at
  min=max 640x480; no explicit user float/tile state.
- Given (column profiles): `COL[C1[A],C2[B*]]`; reverse starts with
  A in a column and B fixed-floating where supported.
- When: tiled B sets min=max 640x480. In the fresh reverse variant,
  floating B removes its maximum hints and becomes resizable.
- Observe: admission-only identity vs reactive float/tile status; frames
  and focus separately TBD. This is not R-SPC-05's minimum-raise fixture.
- Then COSMIC: fixed classification traced at initial admission only;
  exact post-admission transitions TBD. `S(S-cos-fixed-admission)`.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD (hint refresh alone does not establish status).
- Then awesome/tile: implicit floating turns on/off respectively unless
  explicitly overridden; exact resulting frames/focus TBD.
  `S(S-awe-fixed-dynamic)`.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: tiled B stays tiled after becoming fixed; automatic
  fixed float stays floating after becoming resizable. Existing hint
  projection/clamp continues (NORMATIVE D2); react to self-resize to avoid
  gaps/overlaps, no new hint-signal work. Implemented offline
  2026-10-08 with real Planner [fixtures](../../../kwin/tests/fixed-size-admission.test.ts);
  native exact frames/focus TBD.
- Then Ours Windows: TBD (handoff only; behavior frozen).
- Variant hook: NORMATIVE admission-only vs dynamic classification
  (User 2026-10-08).

### R-SPC-09: explicitly tile an automatically admitted fixed float

- Given (tree profiles): A tiled, F ordinary fixed-floating with
  min=max 640x480; tiled workspace, no overlay. Fresh sticky variant:
  F is fixed and sticky, with the same hints.
- Given (column profiles): `COL[C1[A]]` plus F floating; sticky
  variant conditional on that profile's sticky model.
- When: explicitly tile F; observe again with identical hints. KDE
  sticky variant uses Meta+G, not origin-preserving Meta+Shift+G.
- Observe: user override survives observation vs immediate re-float.
- Then COSMIC: ordinary fixed F tiles directly without a hint check;
  sticky command equivalence and later reclassification TBD.
  `S(S-cos-fixed-toggle)`.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: explicit floating=false overrides implicit fixed
  status; exact sticky-command equivalent TBD. `S(S-awe-fixed-dynamic)`.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: explicit tile wins for the same live client, including
  sticky Meta+G; ordinary observation does not re-float it. Exact-ref
  suppression survives omitted/scoped/released observations; new refs
  classify again (NORMATIVE D3, no setting). Implemented offline 2026-10-08,
  [real Planner and sticky fixtures](../../../kwin/tests/fixed-size-admission.test.ts).
  Physical hide/show/domain reassignment TBD.
- Then Ours Windows: TBD (handoff only; behavior frozen).
- Variant hook: NORMATIVE explicit intent vs automatic fixed
  classification (User 2026-10-08).

### R-SPC-10: admit fixed and maximized, then unmaximize

- Given (tree profiles): `H[A*]`; E ordinary min=max 640x480,
  born maximized, not fullscreen/sticky, no custom rule.
- Given (column profiles): `COL[C1[A*]]`; same E.
- When: open E; natively unmaximize E.
- Observe: floating base vs reserved tiled slot beneath maximize;
  no launch unmaximize or focus/geometry claim is inferred.
- Then COSMIC: fixed E admits floating, then maximizes with original
  layer Floating; unmaximize returns to that layer. Exact frame/focus TBD.
  `S(S-cos-fixed-admission)` + `S(S-cos-fixed-maximize)`.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD (combined birth/restore path not traced).
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: fixed E floats beneath native maximize, no reserved
  tile on admission; unmaximize leaves it floating (NORMATIVE D4).
  Non-fixed Q3 is unchanged. D6 workspace enable while maximized keeps a
  fixed automatic float slotless; native unmaximize stays floating.
  Explicit user tile overrides retain Q3 R-MAX-03's reserved-slot route.
  Implemented offline 2026-10-08; [production-entry fixtures](../../../kwin/tests/fixed-size-workspace-entry.test.ts),
  [D5/D6 record](../../changes/archive/fixed-size-exit-and-enable.md). Native TBD.
- Then Ours Windows: TBD (same intersection; handoff only).
- Variant hook: NORMATIVE fixed-float base vs Q3 reserved tiled base
  (User 2026-10-08).

### R-SPC-11: fixed client exits fullscreen, born or previously floating

- Given (tree profiles): `H[A*]`; E ordinary min=max 640x480,
  born fullscreen. Fresh variant: E first admits fixed-floating, then
  enters fullscreen. Non-fixed variant: N ordinary resizable, born
  fullscreen on a tiled workspace. Workspace remains tiled; no sticky/maximize/rules.
- Given (column profiles): `COL[C1[A*]]`; same independent lifecycles,
  including the non-fixed N variant.
- When: exit E's fullscreen natively (non-fixed variant: exit N's fullscreen natively).
- Discriminating variant: E starts one-axis-fixed under `both-axes-fixed`;
  while fullscreen switch to `either-axis-fixed` or change hints to both-axis
  fixed; exit once; enter fullscreen again, lose fixed hints, exit again.
- Observe: classify fixed hints on first normal admission vs restore
  previously recorded layer. Non-fixed N first exit tiles. During fullscreen, game state is untouched.
  Reference outcomes for the non-fixed N and changed-hints/predicate/repeated-exit
  variants are TBD for every reference profile; native Ours legs remain TBD.
- Then COSMIC: born fullscreen skips normal float/tile mapping, has no
  restore state and tiles on exit to a tiled workspace; previously
  floating E restores floating with retained geometry.
  `S(S-cos-fixed-admission)` + `S(S-cos-fixed-fullscreen)`.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD (combined lifecycle not traced).
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: born-fullscreen first exit classifies as newly admitted:
  fixed floats with no writes, otherwise tiles; previously automatic
  floating restores floating. No target writes while fullscreen (NORMATIVE
  D5 CHANGED, User 2026-10-08; deliberate COSMIC deviation for game safety,
  pending live observation). First observed exit for the exact live client
  uses current hints/predicate, so the discriminator floats on first exit;
  later exits retain that float even after hint loss (D2), never re-admit.
  Implemented offline 2026-10-09, [real Planner fixtures](../../../kwin/tests/fixed-size-admission.test.ts),
  [record](../../changes/archive/fixed-size-exit-and-enable.md); native game/restore journey TBD.
- Then Ours Windows: TBD; current borderless-game inference stays frozen.
- Variant hook: NORMATIVE first normal admission vs fullscreen restore
  identity (User 2026-10-08; first-exit classification delivered offline).

### R-SPC-12: enable workspace tiling with an automatic fixed float

- Given (tree profiles): workspace floating-only with ordinary fixed E
  (min=max 640x480), no explicit per-window override. Separate intentional
  float C is a control; no sticky/fullscreen/maximize/rules. Arrival
  variant: ordinary fixed F arrives while the workspace is floating, then
  tiling is enabled for that workspace.
- Given (column profiles): same free-floating clients on a workspace
  where a floating-to-tiled workspace action exists, including the F
  arrival variant.
- When: enable tiling for that workspace.
- Discriminating variants: disable tiling for an ordinary tile, give it fixed
  hints, enable; or disable for a one-axis automatic float, switch predicate
  to `both-axes-fixed`, enable. Control: explicit user tile override, then
  disable/enable with fixed hints. Maximized control: fixed automatic float,
  disable/enable while maximized, then natively unmaximize.
- Observe: E auto-float survives vs workspace action explicitly tiles it;
  F fixed arrival stays/becomes untouched float while other arrivals tile;
  intentional C is distinguished, not silently reclassified.
  Reference outcomes for the F arrival and changed-hints/predicate/override/
  maximized-control variants are TBD for every reference profile; native Ours
  legs remain TBD.
- Then COSMIC: retiles both E and C without a fixed-hint check; exact
  frames/focus TBD. `S(S-cos-fixed-workspace)`.
- Then Hyprland/Dwindle: no workspace-mode counterpart per R-FLT-04;
  fixed-specific outcome TBD. `S(S-hyp-float)`.
- Then bspwm: no workspace-mode counterpart per R-FLT-04; outcome TBD.
  `S(S-bsp-layout)`.
- Then i3: no workspace-mode counterpart per R-FLT-04; outcome TBD.
  `S(S-i3-wsmode)`.
- Then xmonad/Tall+Navigation2D: no workspace-mode counterpart per
  R-FLT-04; outcome TBD. `S(S-xmo-layout)`.
- Then sway: no workspace-mode counterpart per R-FLT-04; outcome TBD.
  `S(S-sway-wsmode)`.
- Then qtile/Columns: no workspace-mode counterpart per R-FLT-04;
  outcome TBD. `S(S-qti-float)`.
- Then awesome/tile: layout-mode action exists; exact fixed E outcome
  TBD here. `S(S-awe-layout)`.
- Then niri: no workspace-mode counterpart; outcome TBD. `S(S-nir-float)`.
- Then PaperWM: no workspace-mode counterpart; outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: no workspace-mode counterpart; outcome TBD.
  `S(S-kar-acts)`.
- Then paneru: no workspace-mode counterpart; outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: enabling workspace tiling checks every window being
  tiled including arrivals while floating: fixed stays/becomes untouched
  float, others tile; explicit user tile overrides stay tiled;
  intentional C and sticky floats keep their existing exceptions
  (NORMATIVE D6 CHANGED, User 2026-10-08; COSMIC deviation, pending live
  check). Current hints/predicate recheck ordinary admission pins and automatic
  records; the variants respectively float, tile, retain the explicit tile,
  and retain slotless float under maximize and after unmaximize.
  Implemented offline 2026-10-09;
  [production-entry release/retile fixtures](../../../kwin/tests/fixed-size-workspace-entry.test.ts)
  and [intentional/sticky controls](../../../kwin/tests/fixed-size-admission.test.ts).
  [record](../../changes/archive/fixed-size-exit-and-enable.md). Native release/placement TBD.
- Then Ours Windows: fixed E TBD (handoff only); intentional C
  preservation reuses R-FLT-04 evidence.
- Variant hook: NORMATIVE automatic vs intentional float identity at
  workspace enable (User 2026-10-08; check-every-window delivered offline).

### R-SPC-13: adopt an already mapped fixed client on owner startup

- Given (tree profiles): tiler owner stopped, A ordinary and E ordinary
  min=max 640x480 already mapped on a tiled-designated workspace. Fresh
  restart variant: E was explicitly tiled before this owner stop.
  Unavailable-store variant: the intentional-float store is missing or
  unreadable at restart, so the tile override falls back to recompute.
- Given (column profiles): same already mapped A/E with native owner
  startup/restart where supported; no H/V tree is asserted, including the
  explicit-tile and unavailable-store variants.
- When: start the tiler owner with the clients still alive.
- Observe: fixed classification at adoption vs open-only classification;
  previous explicit tile override vs recomputed automatic identity.
  Reference outcomes for the unavailable-store variant are TBD.
- Then COSMIC: exact owner-adoption counterpart/outcome TBD; ordinary
  compositor map is not evidence for this script-owner journey.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: startup foreground/hidden adoption floats fixed E;
  fixed-window user tile overrides persist across owner restart in the
  same intentional-float store, recompute fallback if unavailable
  (NORMATIVE D7, User 2026-10-08; persistence selected, implementation pending).
  Startup classification implemented offline 2026-10-08;
  [startup entry fixtures](../../../kwin/tests/fixed-size-workspace-entry.test.ts)
  and [restart fixtures](../../../kwin/tests/fixed-size-admission.test.ts).
  Native owner journey TBD; R-RST-01 float identity work stays separate.
- Then Ours Windows: TBD (handoff only; behavior frozen).
- Variant hook: NORMATIVE admission/adoption scope (User 2026-10-08);
  explicit identity persistence is separately selected by R-RST-01,
  tile-override persistence selected, implementation pending.
