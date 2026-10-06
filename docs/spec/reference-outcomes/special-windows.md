# Special windows (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there.

Candidates: R-SPC-01 through R-SPC-05 (transients/modals, splash/utility types, PiP, fixed-size admission, app-owned resize/hint changes). No existing special rows to backfill (0 existing rows, 0 cells). PiP is app/flags-specific with no universal native type; no profile invents one.

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
- Then Ours KDE: ordinary tile admission (Normal kind passes the
  observer; the Engine carries no fixed-size exception: normal tiled
  admission). Native clamp TBD. `S(S-ours-spc-kde)` +
  `S(S-ours-admit)`; queued.
- Then Ours Windows: tiles with its declared-hint clamp carried
  into the Engine rows (`WM_GETMINMAXINFO` per member; no
  fixed-size exclusion). `S(S-ours-spc-win)`.
- Variant hook: provisional/TBD (fixed-size hook, to discuss).

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
