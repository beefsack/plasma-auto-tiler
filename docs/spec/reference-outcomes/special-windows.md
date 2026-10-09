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
  `make_above`. The rejected path shows without extension activation, so
  focus follows host activation policy: focus TBD (host: GNOME activation
  policy for shown floats untraced). Switcher presence follows host
  `NORMAL_ALL` type membership for splash/utility: TBD (host: Mutter
  tab-list type filter untraced). `S(S-pap-spc)` + `S(S-pap-fltanchor)` +
  `S(S-pap-switcher)`; focus/switcher queued (host).
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
- Then PaperWM: no PiP branch exists in `add_filter`, `insertWindow`, or the registered action inventory, so an ordinary Normal non-transient client would tile as a fresh column at the open-position index with widths per column layout - but the scenario's required pre-act record (toolkit, app, version, actual flags and rules) is omitted, so whether this app's PiP client satisfies that antecedent is unestablished: admission TBD (fixture: record toolkit, app, version, actual flags and rules before acting). App-specific stay-on-top beyond the tiled branch's `unmake_above` TBD (host/live: app above-flag behavior untraced). `S(S-pap-spc)` + `S(S-pap-ins)` + `S(S-pap-layout)` + `S(S-pap-acts)`; admission queued (fixture), stay-on-top queued (host).
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
- Then PaperWM: allocation policy tile-authoritative. A tiled B's app-owned resize or minimum-hint raise has no hint branch (no minima consult); `size-changed` queues a column relayout which recomputes targets from preferredWidth/client frame (not guaranteed to overwrite a preferredWidth the client keeps asserting) with no re-float. Recomputed targets settle natively X11-sync/Wayland-async (post-request re-read, actuals feed layout): exact native frames TBD (live: client settle timing). `S(S-pap-appresize)` + `S(S-pap-layout)`; frames queued (live).
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
- Then bspwm: tiles in both variants; `_apply_hints` requires
  min_width==max_width and min_height==max_height together, so one-axis
  equality fails. `S(S-bsp-spc)`.
- Then i3: tiles in both variants; the fixed branch requires max_width>0
  and max_height>0 with both axes equal, so one-axis equality fails.
  `S(S-i3-min)`.
- Then xmonad/Tall+Navigation2D: tiles in both variants; `isFixedSize`
  is whole-tuple `sh_min_size==sh_max_size`, so one-axis equality fails.
  `S(S-xmo-float)`.
- Then sway: xdg floats in both; Xwayland floats in both (both minima>0
  with either-axis equality). `S(S-sway-fixed-hints)` + `S(S-sway-spc)`.
- Then qtile/Columns: tiles in both variants; `has_fixed_size` requires
  both flags with 0<min==max on both axes, so one-axis equality fails.
  `S(S-qti-min)`.
- Then awesome/tile: neither variant satisfies implicit fixed-size floating;
  both axes must match. `S(S-awe-fixed-dynamic)`.
- Then niri: width-fixed tiles while height-fixed floats; the predicate is
  height-only (`min.h>0` and `min.h==max.h`), so only the height-fixed
  variant satisfies it. `S(S-nir-spc)`.
- Then PaperWM: tiles in both variants; `add_filter` admits Normal
  non-transient windows with no fixed-size exclusion. `S(S-pap-spc)`.
- Then karousel/Lazy: tiles in both variants; one-axis difference keeps
  KWin `isResizable` true under either-axis strict inequality, so the
  shapeability gate still tiles (given moveable ordinary clients).
  `S(S-kar-spc)` + `S(S-kwin-resizeable)`.
- Then paneru: no fixed-size admission counterpart (role-gated admission
  has no size-hint predicate; float is rule-assigned; AX exposes no
  min/max hint equality). `S(S-pan-admit)`.
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
  both partial-zero variants and the sentinel do and float. X11 absent
  does not match; present-zero and sentinel X11-native handling TBD
  (optional-hint mapping not pinned). `S(S-cos-fixed-hints)`.
- Then Hyprland/Dwindle: unset and zero/partial-zero variants do not
  satisfy the fixed branch on either backend; the sentinel floats on
  both (no sentinel branch; Wayland minima>1 with either-axis equality,
  X11 all>0 with both-axis equality); the height-absent guard tiles on
  both (Wayland min<=1 gate, X11 min>0 gate). `S(S-hyp-fixed-hints)`.
- Then bspwm: absent tiles (flag gate fails); (0,0), both partial-zero
  and sentinel float (raw whole-size equality, no zero/sentinel guard);
  the height-absent guard stays TBD (absent-height xcb representation
  not pinned; no equality-positive inference). `S(S-bsp-spc)`.
- Then i3: absent, (0,0), both partial-zero and the height-absent guard
  tile (max_width>0 and max_height>0 gate fails); the sentinel floats
  (both axes positive and equal). `S(S-i3-min)`.
- Then xmonad/Tall+Navigation2D: absent tiles (`Nothing`); (0,0), both
  partial-zero and sentinel float (whole-tuple `Just` equality, no zero
  guard); the height-absent guard stays TBD (absent-height `Maybe`
  representation not pinned). `S(S-xmo-float)`.
- Then sway: xdg unset/zero/partial-zero and the height-absent guard fail
  (both minima nonzero gate); xdg sentinel floats. Xwayland unset/zero/
  partial-zero and the guard fail (both minima>0 gate); Xwayland
  sentinel floats (either-axis equality). `S(S-sway-fixed-hints)` +
  `S(S-sway-spc)`.
- Then qtile/Columns: absent, (0,0), both partial-zero and the
  height-absent guard tile (both flags with 0<min==max on both axes);
  the sentinel floats. `S(S-qti-min)`.
- Then awesome/tile: unset, zero/partial-zero and the height-absent guard
  fail the fixed branch (all four bounds >0 required); the sentinel
  floats (both axes positive and equal). `S(S-awe-fixed-dynamic)`.
- Then niri: absent, (0,0), (640,0) and the height-absent guard tile
  (height gate `min.h>0` fails); (0,480) and the sentinel float (height
  equality holds). `S(S-nir-spc)`.
- Then PaperWM: tiles every hint variant (Normal non-transient admission
  only; no fixed-size branch). `S(S-pap-spc)`.
- Then karousel/Lazy: Wayland absent, (0,0), both partial-zero and the
  height-absent guard tile (enforced-minimum vs `INT_MAX` mapping keeps
  strict inequality); Wayland sentinel floats (min==max). X11
  present-value (0,0), partial-zero and sentinel legs float (raw hint
  equality, no inequality); X11 absent and guard-height representation
  stays TBD (NET SizeHints defaults outside the pinned KWin files; no
  positive inference). `S(S-kar-spc)` + `S(S-kwin-resizeable)`.
- Then paneru: no fixed-size admission counterpart for any hint variant
  (same rule-gated admission; AX exposes no min/max hint equality).
  `S(S-pan-admit)`.
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
- Then COSMIC: tiled B stays tiled after becoming fixed; automatic fixed
  float stays floating after becoming resizable (`is_dialog` runs once at
  map; no hint-change reclassification in source). Frames and focus TBD
  (client timing, live-only). `S(S-cos-fixed-admission)`.
- Then Hyprland/Dwindle: tiled B stays tiled; automatic float stays
  floating (`suggestsFloat` applies at initial map with group/predict
  gates; no hint-signal recompute). Frames and focus TBD (client
  timing, live-only). `S(S-hyp-float)`.
- Then bspwm: tiled B stays tiled; automatic float stays floating (hint
  refresh only updates stored hints with arrange; admission state is not
  re-run, and arrange ignores hints under the shipped default). Frames
  and focus TBD (client timing, live-only). `S(S-bsp-hint)`.
- Then i3: tiled B stays tiled; automatic float stays floating (fixed
  check is admission-only; later hint updates only clamp floating via
  `floating_check_size`, never re-admit tiles; tiled render ignores
  hints). Frames and focus TBD (client timing, live-only). `S(S-i3-min)`
  + `S(S-i3-fixed-runtime)`.
- Then xmonad/Tall+Navigation2D: tiled B stays tiled; automatic float
  stays floating (fixed/transient check runs once in `manage`; later
  status changes only via manual float/sink). Frames and focus TBD
  (client timing, live-only). `S(S-xmo-float)`.
- Then sway: tiled B stays tiled; automatic float stays floating (float
  admission evaluated at map; the runtime Xwayland hint path handles
  urgency only, no re-admission). Frames and focus TBD (client timing,
  live-only). `S(S-sway-min)`.
- Then qtile/Columns: tiled B stays tiled; automatic float stays floating
  (hint refresh updates stored hints with no tiled promotion; only
  floating increments relayout). Frames and focus TBD (client timing,
  live-only). `S(S-qti-min)`.
- Then awesome/tile: implicit floating turns on/off respectively unless
  explicitly overridden; exact resulting frames/focus TBD.
  `S(S-awe-fixed-dynamic)`.
- Then niri: tiled B stays tiled; automatic float stays floating
  (`compute_open_floating` runs at the four open callsites only; later
  status changes only via the plain tile-move toggle). Frames and focus
  TBD (client timing, live-only). `S(S-nir-fixed-open)` +
  `S(S-nir-flttoggle)`.
- Then PaperWM: tiled B stays tiled; automatic float does not arise (no
  fixed-size branch; `add_filter` is admission-only). Where B floats by
  another gate, hint loss alone does not retile it. Frames and focus TBD
  (client timing, live-only). `S(S-pap-spc)`.
- Then karousel/Lazy: tiled B stays tiled; automatic float stays
  floating (gates evaluated once at `addClient`; only a caption-follow
  signal re-evaluates, with no size-hint watcher). Frames and focus TBD
  (client timing, live-only). `S(S-kar-admit)`.
- Then paneru: no fixed-size admission counterpart, so hint gain/loss has
  no reclassification to observe (role-gated admission; rule-assigned
  float only). `S(S-pan-admit)`.
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
- Then Hyprland/Dwindle: explicit tile survives observation (toggle via
  `changeFloatingMode` with no refusal branch; `suggestsFloat` applies at
  initial map only). Exact frames/focus TBD (client timing, live-only).
  `S(S-hyp-float)`.
- Then bspwm: explicit tile survives observation (state toggle is vacant
  in place; later hint refresh does not re-run admission). Exact
  frames/focus TBD (client timing, live-only). `S(S-bsp-state)`.
- Then i3: explicit tile survives observation (`floating_disable`
  inserts after the tiling-focused descendant; later hint updates never
  re-admit). Exact frames/focus TBD (client timing, live-only).
  `S(S-i3-flt-toggle)`.
- Then xmonad/Tall+Navigation2D: explicit tile survives observation
  (`sink` clears only the floating map; no automatic re-float on later
  observation). Exact frames/focus TBD (client timing, live-only).
  `S(S-xmo-float)`.
- Then sway: explicit tile survives observation (`container_set_floating`
  is the explicit path; `wants_floating` is evaluated at map only).
  Exact frames/focus TBD (client timing, live-only). `S(S-sway-float)`.
- Then qtile/Columns: explicit tile survives observation (toggle flips
  state with tile-frame retain and layout re-add; float rules are
  evaluated at admission, not re-applied on observation). Exact
  frames/focus TBD (client timing, live-only). `S(S-qti-float)`.
- Then awesome/tile: explicit floating=false overrides implicit fixed
  status; exact sticky-command equivalent TBD. `S(S-awe-fixed-dynamic)`.
- Then niri: explicit tile survives observation (plain tile-move toggle;
  `compute_open_floating` runs at open only). Exact frames/focus TBD
  (client timing, live-only). `S(S-nir-flttoggle)` + `S(S-nir-fixed-open)`.
- Then PaperWM: F is already tiled on admission, so explicit tile retains
  the tile (no fixed-size float to override). Exact frames/focus TBD
  (client timing, live-only). `S(S-pap-spc)`.
- Then karousel/Lazy: explicit tile is refused for the unshapeable fixed
  float (float-to-tile requires `canTileEver`), so F stays floating;
  observation does not retile it. Exact frames/focus TBD (client timing,
  live-only). `S(S-kar-admit)`.
- Then paneru: no fixed-size admission counterpart, so an explicit tile of
  a fixed client has no automatic-float override to test (role-gated
  admission; rule-assigned float only). `S(S-pan-admit)`.
- Then Ours KDE: explicit tile wins for the same live client, including
  sticky Meta+G; ordinary observation does not re-float it. Exact-ref
  suppression survives omitted/scoped/released observations; new refs
  classify again (NORMATIVE D3, no setting). Implemented offline 2026-10-08,
  [real Planner and sticky fixtures](../../../kwin/tests/fixed-size-admission.test.ts).
  D7 now restores matched fixed-window tile overrides across owner restart
  ([restart fixtures](../../../kwin/tests/float-intent.test.ts)); no positions persist.
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
- Then Hyprland/Dwindle: fixed E admits floating at map (`suggestsFloat`
  min==max applied at initial map); born-maximized applies as
  `FSMODE_MAXIMIZED` at the work area (pending maximum consumed at map);
  native unmaximize exits to `NONE` leaving placement to recalc with
  floating retained. Exact frames/focus TBD (client timing, live-only).
  `S(S-hyp-float)` + `S(S-hyp-fs)` + `S(S-hyp-bornmax)`.
- Then bspwm: E floats (min==max hints rule); no maximize command/state
  exists (desktop layout tiled/monocle only; maximize flags are not tree
  state), so the born-maximized/unmaximize legs have no counterpart.
  Client ack TBD. `S(S-bsp-spc)` + `S(S-bsp-layout)` + `S(S-bsp-admit)`.
- Then i3: E floats (min==max branch); no maximize verb/state exists
  (maximize is derived-only), so the born-maximized/unmaximize legs have
  no counterpart. Client ack TBD. `S(S-i3-min)` + `S(S-i3-max)`.
- Then xmonad/Tall+Navigation2D: E floats (fixed/transient manage); no
  maximize command/state exists (`Full` is a workspace layout, not
  per-window maximize), so the born-maximized/unmaximize legs have no
  counterpart. `S(S-xmo-float)` + `S(S-xmo-layout)`.
- Then sway: E floats (xdg either-axis min==max; xwayland fixed branch);
  no maximize verb exists (request only schedules a configure), so the
  born-maximized/unmaximize legs have no counterpart. Client ack TBD.
  `S(S-sway-spc)` + `S(S-sway-max)`.
- Then qtile/Columns: E admits floating via the fixed-size rule;
  maximize is a floating-layer state at work-area size. Maximize entered
  after fixed-float admission saves `FLOATING`, and unmaximize restores
  that saved state without re-running the fixed rule. X11 client maximize
  messages echo the property without driving this mode; Wayland requests
  drive the setter. Exact born-request ordering, frames and focus TBD
  (client/native timing). `S(S-qti-spc)` + `S(S-qti-fs)` +
  `S(S-qti-fs-restore)`.
- Then awesome/tile: E admits implicitly floating (both positive axes
  equal; maximized also implies implicit float; manage-time maximized
  hint applies), so born-maximized stays implicitly floating; native
  unmaximize clears maximized but fixed keeps implicit float, so it stays
  floating. Exact frames/focus TBD (client timing, live-only).
  `S(S-awe-fixed-dynamic)` + `S(S-awe-float)` + `S(S-awe-fs)`.
- Then niri: fixed height floats via `compute_open_floating`, but a
  pending-maximized tile opens in the scrolling layout; so born-maximized
  E admits as a scrolling maximized column; native restore clears the flag
  and lands tiled (restore-to-floating only when a normal tile was
  maximized from floating). Exact frames TBD.
  `S(S-nir-spc)` + `S(S-nir-fixed-open)` + `S(S-nir-maxfs)`.
- Then PaperWM: E tiles (Normal non-transient admission; no fixed-size
  branch). Born-maximized admission hits the `maximized-horizontally`
  handler (:3514-3526), which unmaximizes BOTH first - clearing the native
  flag - then width-toggles with `unmaximizedRect` memory at the shipped
  100 percent; with no native maximized flag left, a native restore has
  nothing to clear: moot. `unmaximizedRect` restores only via a second
  width-toggle (:4794-4830 uses `move_resize_frame` only and never sets a
  native maximize flag; no native toggle-off path is claimed). Exact
  native frames TBD (live: client settle timing). `S(S-pap-spc)` +
  `S(S-pap-widthmax)` + `S(S-pap-layout)`; frames queued (live).
- Then karousel/Lazy: E floats as untileable under the shapeability gate
  (both-axes min==max keeps `isResizable` false); gates evaluate once at
  `addClient` with no size-hint watcher, so born-maximized stays floating
  and native unmaximize leaves it floating. Exact native maximize
  frames/focus TBD. `S(S-kar-spc)` + `S(S-kwin-resizeable)` +
  `S(S-kar-admit)`.
- Then paneru: no fixed-size admission counterpart (role-gated admission
  with no size predicate; float is rule-assigned) and no maximize verb,
  so the combined fixed+maximize/unmaximize outcome TBD (no built-in
  equivalent). `S(S-pan-admit)` + `S(S-pan-cmds)`.
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
- Then COSMIC: born E and non-fixed N both skip normal mapping (None
  restore) and exit to the tiling default with no hint check; previously
  floating E restores floating with retained geometry; hint changes while
  fullscreen have no effect (float/tile decided at map); re-entering
  fullscreen from the exited tile carries Some restore, so repeated exit
  restores the saved tile/float layer, not current hints. Exact frames/focus
  TBD (client timing, live-only). `S(S-cos-fixed-admission)` +
  `S(S-cos-fixed-fullscreen)` + `S(S-cos-fsrestore)`.
- Then Hyprland/Dwindle: non-fixed N applies fullscreen over ordinary
  tiling and exit to `NONE` recovers tiles; E born/prior retain floating
  as before with float size remembered. Product predicate switch has no
  counterpart (Wayland either-axis minima>1 / X11 both positive axes
  hardcoded, no setting); hint changes while fullscreen have no effect
  (`suggestsFloat` at initial map only); repeated exits follow the same
  recalc path, not current hints. Exact frames/focus TBD (client timing,
  live-only). `S(S-hyp-float)` + `S(S-hyp-fs)` + `S(S-hyp-fixed-hints)`.
- Then bspwm: non-fixed N admits fullscreen state and exit returns to
  last-state tiled (vacant in place); E born/prior end floating as before.
  Predicate switch is product-only (whole-size equality hardcoded in
  `_apply_hints`); hint changes update stored hints only with arrange
  ignoring them under the shipped default, so exits follow last-state, not
  current hints; repeated exits replay last-state. Exact frames/focus TBD
  (client timing, live-only). `S(S-bsp-spc)` + `S(S-bsp-admit)` +
  `S(S-bsp-fs)` + `S(S-bsp-state)` + `S(S-bsp-hint)`.
- Then i3: non-fixed N toggles fullscreen mode on a tiled container and
  exit clears it staying tiled; E born/prior stay floating as before.
  Predicate switch is product-only (both-axes positive equality hardcoded);
  hint updates route to `floating_check_size` for floating containers only
  and never re-admit tiles, so mid-fullscreen hint changes do not alter the
  exit layer; repeated exits clear the mode to the same saved layer. Exact
  frames/focus TBD (client timing, live-only). `S(S-i3-min)` +
  `S(S-i3-admit)` + `S(S-i3-fs)` + `S(S-i3-fixed-runtime)`.
- Then xmonad/Tall+Navigation2D: non-fixed N admits tiled (no manage float
  cause) then `doFullFloat`, exit `doSink` stays tiled; E born/prior land
  tiled as before (sink clears the map, no re-float). Predicate switch is
  product-only (whole-tuple equality, no setting); hint changes have no
  post-manage path (manage once; later only manual float/sink); repeated
  exits sink again. Exact frames TBD. `S(S-xmo-float)` + `S(S-xmo-ewmh)` +
  `S(S-xmo-admit)`.
- Then sway: non-fixed N maps fullscreen on a tiled container and exit
  clears the mode staying tiled; E born/prior retain floating as before.
  Predicate switch is product-only (xdg/xwayland either-axis hardcoded);
  the runtime hint path handles urgency only with map-time evaluation, so
  hint changes do not alter the exit; repeated exits replay the mode clear.
  Exact frames/focus TBD (client timing, live-only). `S(S-sway-spc)` +
  `S(S-sway-full)` + `S(S-sway-min)` + `S(S-sway-fixed-hints)`.
- Then qtile/Columns: X11-established legs: non-fixed N and born-fixed E
  both admit fullscreen-first (`auto_fullscreen` before the fixed-rule
  `elif`, match skipped) saving `NOT_FLOATING`, so both exit tiled via
  save/restore; prior floating E (admitted `FLOATING` via the fixed rule,
  then fullscreen saving `FLOATING`) restores floating. Exit never re-runs
  the float-rule match; hint updates never promote tiles (floating
  increments only), so mid-fullscreen hint changes do not alter the exit;
  repeated exits replay save/restore. Native ack/focus TBD.
  `S(S-qti-spc)` + `S(S-qti-fs)` + `S(S-qti-fs-restore)` + `S(S-qti-min)`.
- Then awesome/tile: non-fixed N admits implicit float via fullscreen and
  native exit clears it landing tiled; E born/prior stay floating while
  fixed holds as before. One-axis start tiles (both axes must match;
  product predicate switch has no counterpart, hardcoded). Changing hints
  to both-axis fixed while fullscreen recomputes implicit float (hint
  signals unless explicitly overridden), so the first exit floats; losing
  hints while fullscreen recomputes but fullscreen retains, and the second
  exit clears to tiled. Repeated exits track current hints, not saved
  state. Exact frames/focus TBD (client timing, live-only).
  `S(S-awe-fixed-dynamic)` + `S(S-awe-float)` + `S(S-awe-fs)`.
- Then niri: non-fixed N opens scrolling fullscreen (no fixed float) and
  exit lands tiled; E born opens scrolling fullscreen exiting tiled while
  prior floating restores floating, as before. Predicate switch is
  product-only (height-only predicate hardcoded); hint changes have no
  open-path caller (open only; later plain toggle), so exits follow
  `restore_to_floating` memory, not current hints; repeated exits replay
  memory. Exact frames TBD. `S(S-nir-spc)` + `S(S-nir-fixed-open)` +
  `S(S-nir-maxfs)`.
- Then PaperWM: non-fixed N is honored fullscreen and exit restores the
  saved tiled frame to tiled, same as born-fixed E (fixed tiles: no
  fixed-size exclusion, then the same fullscreen memory); the prior-floating
  fixed leg still has no faithful start (no fixed float exists to begin
  with: fixture-inapplicable for that leg). Hint changes have no branch
  (no fixed-size exclusion); repeated exits restore the saved frame again.
  Exact native frames TBD (live: client settle timing). `S(S-pap-spc)` +
  `S(S-pap-fsframe)` + `S(S-pap-layout)`; frames queued (live).
- Then karousel/Lazy: non-fixed N born-fullscreen tiles (fullscreen is
  shapeable) and exit restores tiled; E born exits floating via
  untileable-after-exit while prior floating stays floating. Predicate
  switch is product-only (KWin either-axis strict inequality hardcoded, no
  both/either setting); hint changes have no watcher (only caption-follow
  re-evaluates) but the exit check reads current shapeability, so a hint
  change takes effect at exit; repeated exits re-evaluate at each exit.
  Exact frames/focus TBD. `S(S-kar-spc)` + `S(S-kwin-resizeable)` +
  `S(S-kar-maxfs)` + `S(S-kar-admit)`.
- Then paneru: non-fixed N follows the same role-gated admission as E (no
  size predicate; float is rule-assigned) with fullscreen as a host AX
  marker, so N/E born/prior exits stay TBD (owner-specific journey);
  predicate/hint variants have no size path to act on. `S(S-pan-admit)` +
  `S(S-pan-cmds)` + `S(S-pan-axfs)`.
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
- Then COSMIC: retiles E, C, and F arrivals without a fixed-hint check
  (enable maps every ordinary floater); disable/give-fixed/enable still
  tiles with fixed ignored; predicate switch is product-only (whole-size
  equality, no setting); explicit override is moot in the cited path
  (tiles anyway); maximized control tiles then re-overlays maximized with
  the layer retargeted, and restore reveals the retained slot. Exact
  frames/focus TBD. `S(S-cos-fixed-workspace)` + `S(S-cos-fixed-maximize)`.
- Then Hyprland/Dwindle: no workspace-mode counterpart per R-FLT-04;
  F-arrival, changed-hints/predicate, override, and maximized legs share
  the absence (no workspace action to enable; conditional legs never run).
  Outcome TBD. `S(S-hyp-float)`.
- Then bspwm: no workspace-mode counterpart per R-FLT-04; F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence.
  Outcome TBD. `S(S-bsp-layout)`.
- Then i3: no workspace-mode counterpart per R-FLT-04; F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence.
  Outcome TBD. `S(S-i3-wsmode)`.
- Then xmonad/Tall+Navigation2D: no workspace-mode counterpart per
  R-FLT-04; F-arrival, changed-hints/predicate, override, and maximized
  legs share the absence. Outcome TBD. `S(S-xmo-layout)`.
- Then sway: no workspace-mode counterpart per R-FLT-04; F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence.
  Outcome TBD. `S(S-sway-wsmode)`.
- Then qtile/Columns: no workspace-mode counterpart per R-FLT-04;
  F-arrival, changed-hints/predicate, override, and maximized legs share
  the absence. Outcome TBD. `S(S-qti-float)`.
- Then awesome/tile: per-tag layout switch (floating<->tile, no global
  flag): F arrival admitted under the floating layout keeps geometry
  (`c.floating` unset), then re-tile recalc floats fixed F (excluded from
  `tiled_clients`) while ordinary arrivals tile; disable/give-fixed/enable
  floats fixed E on recalc and tiles one-axis (both axes must match);
  predicate switch is product-only; explicit `floating=false` survives the
  recalc staying tiled (explicit over implicit); maximized control stays
  maximized-and-implicitly-floating across the switch, and
  restore-then-unmaximize keeps fixed E floating while non-fixed rejoins
  tiled order. Intentional C stays explicitly floating throughout. Exact
  frames/focus TBD. `S(S-awe-layout)` + `S(S-awe-float)` + `S(S-awe-tile)`
  + `S(S-awe-fixed-dynamic)` + `S(S-awe-fs)`.
- Then niri: no workspace-mode counterpart; F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence
  (per-window toggle only). Outcome TBD. `S(S-nir-float)`.
- Then PaperWM: no workspace-mode counterpart (no workspace tiling toggle in the registered action inventory); F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence:
  no-counterpart with no applicable journey.
  `S(S-pap-acts)`.
- Then karousel/Lazy: no workspace-mode counterpart (no toggle verb in the
  Actions inventory; `windowToggleFloating` is per-window only); F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence.
  Outcome TBD. `S(S-kar-acts)`.
- Then paneru: no workspace-mode counterpart; F-arrival,
  changed-hints/predicate, override, and maximized legs share the absence.
  Outcome TBD. `S(S-pan-cmds)`.
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
- Discriminating variants: successful override then re-float/close; a complete
  startup inventory omits a closed client vs a partial inventory omits a live
  hidden client; old v1 file has no tile field, corrupt file, or stored ID does
  not match E. Each restarts independently. Hint-loss/enable and non-fixed
  controls are in R-RST-04. Reference outcomes for all added legs remain TBD;
  native Ours outcomes remain TBD.
- Observe: fixed classification at adoption vs open-only classification;
  previous explicit tile override vs recomputed automatic identity.
  Reference outcomes for the unavailable-store variant are TBD.
- Then COSMIC: exact owner-adoption counterpart/outcome TBD; ordinary
  compositor map is not evidence for this script-owner journey.
  Store-fault/ID/omission variants have no counterpart in the
  pinned-workspace persistence inventory (orderly persist only).
  `S(S-cos-persist)`.
- Then Hyprland/Dwindle: no-counterpart for this owner restart with
  clients alive (no re-exec verb in the dispatcher inventory; reload keeps
  the live tree only and exit stops the compositor). Outcome TBD, including
  re-float/close and store-fault/ID/omission variants (no dump or store
  in inventory). `S(S-hyp-reload)` + `S(S-hyp-shortcut)`.
- Then bspwm: owner `wm -r` dumps full state and re-execs restoring it
  (ratios, WS membership, float frames, sticky/state/lastState, focus
  history/stack round-trip); fixed E stays floating and explicitly tiled E
  stays tiled as dumped state. Re-floated E restores as floating and closed
  E is absent (dump reflects live state). Store-fault (missing/unreadable/
  corrupt/v1/mismatched) and complete-vs-partial omission variants have no
  counterpart in the dump/load inventory (orderly fields only). Exact
  restart/visibility journey TBD. `S(S-bsp-restore)`.
- Then i3: restart carries the layout file and re-execs (percents, focused
  flag/activation, floating geometry round-trip); fixed E stays floating
  and explicitly tiled E stays tiled. Re-floated E restores as floating and
  closed E is absent. Store-fault/ID/omission variants have no counterpart
  in the layout-file inventory (in-place restart fields only). Fresh-login
  session wiring TBD. `S(S-i3-restart)`.
- Then xmonad/Tall+Navigation2D: restart resumes the windowset including
  the floating map with Tall recalculated; fixed E carries as an ordinary
  float and explicitly tiled E (sink clears the map) stays tiled. Re-floated
  E carries as floating and closed E is absent. Store-fault/ID/omission
  variants have no counterpart (StateFile carries the whole StackSet only).
  `S(S-xmo-restart)` + `S(S-xmo-float)`.
- Then sway: no-counterpart for this owner restart with clients alive
  (command inventory carries `reload` and `exit` with no restart verb;
  reload is in-place config only). Outcome TBD, including re-float/close
  and store-fault/ID/omission variants. `S(S-sway-reload)`.
- Then qtile/Columns: groups/layouts/screens restore while widths reset
  and windows re-admit (state carries no per-window float); fixed E
  re-admits floating via the fixed-size rule, so an explicit tile override
  is lost (re-float moot) and closed E is absent. Store-fault/ID/omission
  variants have no counterpart (groups/layouts/screens/scratchpads only,
  no tile store). Exact placement/focus TBD. `S(S-qti-state)` +
  `S(S-qti-reload)` + `S(S-qti-spc)`.
- Then awesome/tile: client order and floating state restore with tags
  recreated (shares recalculate); fixed E recomputes to implicit float on
  re-manage while explicit `floating=false` persists as a property.
  Re-floated E restores as floating and closed E is absent. Store-fault/ID/
  v1 variants have no counterpart (order+floating only, no tile store).
  Exact frames/focus TBD. `S(S-awe-ctl)` + `S(S-awe-float)` +
  `S(S-awe-fixed-dynamic)`.
- Then niri: no-counterpart for this owner restart with layout recovery
  (Quit exits and LoadConfigFile reloads config only; no layout dump or
  re-exec verb). Outcome TBD, including re-float/close and store-fault/ID/
  omission variants (no store in inventory). `S(S-nir-rst)`.
- Then PaperWM: adoption classification determined: controlled disable+enable stages SaveState and re-adds
  existing windows with prevSpace layout restored; fixed E tiles (no
  fixed-size branch, so the pre-stop explicit tile is moot) and stays tiled. Closed E is
  absent (dead pruned). Store-fault/ID/omission variants have no
  counterpart (SaveState covers monitors/spaces/widths only):
  no-counterpart. Exact widths need A's live frame, unstated in the fixture: TBD (fixture: A's live frame).
  Selection is the host tab-list head: TBD (host: tab-list order policy untraced). `S(S-pap-rst)` +
  `S(S-pap-spc)` + `S(S-pap-layout)`; widths queued (fixture), focus queued (host).
- Then karousel/Lazy: script enable adopts existing clients in workspace
  order via `addClient` with live-only Grid state (no persisted layout);
  fixed E re-admits floating via the shapeability gate, so an explicit
  tile override is lost. Re-floated E is Floating and closed E is absent.
  Store-fault/ID/omission variants have no counterpart (no store at all).
  Exact order/widths/focus TBD. `S(S-kar-start)` + `S(S-kar-rst)` +
  `S(S-kar-spc)` + `S(S-kar-admit)`.
- Then paneru: startup windows match SessionRestore within grace; fixed E
  has no size predicate so it follows role-gated admission (float only if
  rule-assigned). Closed E is absent from matching. Store-fault/ID/omission
  variants have no counterpart beyond grace-windowed matching. Exact
  strips/widths/focus TBD. `S(S-pan-rst)` + `S(S-pan-admit)`.
- Then Ours KDE: startup foreground/hidden adoption floats fixed E;
  fixed-window user tile overrides persist across owner restart in the
  same intentional-float store, recompute fallback if missing/degraded/unmatched
  (NORMATIVE D7, User 2026-10-08; persistence delivered offline 2026-10-09).
  Startup classification implemented offline 2026-10-08;
  [startup entry fixtures](../../../kwin/tests/fixed-size-workspace-entry.test.ts)
  and [restart fixtures](../../../kwin/tests/fixed-size-admission.test.ts).
  [D7 real Planner/entry and lifecycle fixtures](../../../kwin/tests/float-intent.test.ts)
  prove success-only persistence, tile hydration, clear on re-float/close and
  complete-inventory filtering; partial omission retains membership.
  Legacy v1 without tile reads compatibly empty for overrides; degraded reads
  log and proceed empty, both recompute fixed E to untouched float.
  Native owner journey TBD; [D7 record](../../changes/archive/fixed-window-tile-override-restart.md).
- Then Ours Windows: TBD (handoff only; behavior frozen).
- Variant hook: NORMATIVE admission/adoption scope (User 2026-10-08);
  explicit identity persistence is separately selected by R-RST-01,
  tile-override persistence delivered offline.
