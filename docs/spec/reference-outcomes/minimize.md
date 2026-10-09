# Minimize (native icon-minimize) (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there.

R-MIN-01..03 are size constraints, not icon-minimize coverage. A hide
verb alone never proves minimize: only a sourced client/host iconify
request path (or its evidenced absence) votes here.

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Givens are separate fixtures, never H/V ancestry
claims. Ours KDE and Ours Windows cite separate adapter keys.

### R-MNZ-01: native minimize of a middle tile

- Given (tree profiles): `H[A,B,C]`, history A,C,B (B focused).
  Ordinary windows, no rules.
- Given (column profiles): `COL[C1[A],C2[B*],C3[C]]`, shipped defaults.
  Same history.
- Given (layout-driven projections): xmonad `[A,B*,C]` master/stack;
  qtile three single-window columns; awesome `[A,B*,C]` master/stack.
- When: native minimize B (client/host iconify request; per-profile
  path in each Then).
- Observe: tiling allocation (leaves vs stays) plus restore path; refocus.
- Then COSMIC: B unmaps from the tiling tree (siblings reflow) into
  `MinimizedWindow::Tiling` restore state; focus falls to MRU
  unminimized (C). `S(S-cos-minimize)` + `S(S-cos-focusfix)`.
- Then Hyprland/Dwindle: no-counterpart (native minimize requests are
  consumed and dropped with no tiling effect: the sole `stateRequest`
  listener `onUpdateState` handles fullscreen/maximize only and no layout
  path consults minimized, so B stays tiled; the X11 flag echo is
  client-only; no minimize verb in the action/dispatcher inventory).
  `S(S-hyp-mininv)`.
- Then bspwm: no-counterpart (no `WM_CHANGE_STATE`/iconic request
  branch and no minimize verb; `hidden` is WM-owned hide, never a
  minimize vote). `S(S-bsp-mininv)`.
- Then i3: no-counterpart (iconic request rejected and reverted to
  normal; B stays tiled). Scratchpad is separate. `S(S-i3-mininv)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (no minimize verb in the
  core key inventory and no iconify request branch anywhere in the profile
  event chain: core `ClientMessage` handling only restarts or broadcasts,
  EWMH handles close/desktop/active only, fullscreen handling is
  fullscreen-atom-only, and Navigation2D carries no event hook; the
  internal hide/reveal primitives never vote per the header, contrib
  minimize actions/layout are out-of-profile, and the startup iconified
  scan is admission-only). `S(S-xmo-mininv)`.
- Then sway: no-counterpart (the focused minimize request is cleared to
  unminimized and the container never detaches: the sole minimize listener
  only echoes the xwayland flag when unfocused, activation clears it, and
  neither visibility nor arrange consults the flag; B stays tiled; no
  minimize verb in the command table, scratchpad separate).
  `S(S-sway-mininv)`.
- Then qtile/Columns: B leaves the Columns allocation (`mark_floating`
  removes from `tiled_windows`/layouts into the floating layout) and hides
  (`IconicState`) as `MINIMIZED` float under shipped `auto_minimize`;
  reflow geometry and refocus TBD. `S(S-qti-minimize)`; queued.
- Then awesome/tile: B is banned (excluded) from the arrangement
  (`ICONIC`) keeping client order; HIDDEN request maps to the same
  setter. Refocus follows history (C). `S(S-awe-minimize)` +
  `S(S-awe-hist)`.
- Then niri: no-counterpart (`SetMinimized` is an explicit no-op; no
  Action verb). `S(S-nir-mininv)`.
- Then PaperWM: B leaves the space tiling when `stick()` emits workspace
  `window-removed` into `remove_handler` and `space.removeWindow` (column
  spliced with empty-column drop and space relayout plus neighbor
  selection); the tiled mark is kept; exact sibling widths and GNOME focus
  TBD. `S(S-pap-minimize)`; queued.
- Then karousel/Lazy: B enters `TiledMinimized` (B is the sole window of
  C2, so its removal empties and destroys C2 via `onColumnRemoved`); focus
  passes Immediate (B is the last-focused client) to the left column A
  (left-else-right `columnToFocus` via `getWindowToFocus`); exact reflow
  frames TBD. `S(S-kar-minimize)`; queued.
- Then paneru: B is marked `Unmanaged::Minimized` (off screen per the
  on-screen check) with strip removal plus remembered
  `PreviousManagedStrip` and nearest-center `give_away_focus` on the
  active strip; exact reflow and focus target TBD.
  `S(S-pan-minimize)`; queued.
- Then Ours KDE: TBD (`observeNative` has no minimized filter, so the
  minimized frame read decides between stale-frame observation and
  fail-closed whole-domain null; Engine effect TBD). `S(S-ours-minkde)`;
  queued.
- Then Ours Windows: B keeps its Engine slot (last-known rect, hintless,
  no writes) with retained membership; focus TBD. `S(S-ours-minwin)`;
  queued.
- Variant hook: provisional/TBD (minimize-slot hook, to discuss).

### R-MNZ-02: native restore of the minimized tile

- Given: the actual minimized state from R-MNZ-01 (same identities).
- When: native restore (unminimize) B.
- Observe: slot restoration; focus.
- Then COSMIC: B remaps from the stored tiling state (old slot); focus
  TBD. `S(S-cos-minimize)`; focus queued.
- Then Hyprland/Dwindle: no-counterpart (nothing minimized to restore;
  backend `setMinimized` is echo-only/no-op and no unminimize path exists
  in the pinned inventory). `S(S-hyp-mininv)`.
- Then bspwm: no-counterpart (same missing request path and verb).
  `S(S-bsp-mininv)`.
- Then i3: no-counterpart (nothing minimized to restore).
  `S(S-i3-mininv)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (nothing minimized to
  restore; same missing verb and request path as R-MNZ-01).
  `S(S-xmo-mininv)`.
- Then sway: no-counterpart (nothing minimized to restore; no unminimize
  verb, scratchpad separate). `S(S-sway-mininv)`.
- Then qtile/Columns: restore via `minimized=false` into `floating=false`
  re-admits B at the focused (`cc`) column position per `add_client`
  (shipped `insert_position` 0), not the old slot; focus TBD.
  `S(S-qti-minimize)`; queued.
- Then awesome/tile: B remaps `NORMAL` at its retained client order;
  focus TBD. `S(S-awe-minimize)`; focus queued.
- Then niri: no-counterpart. `S(S-nir-mininv)`.
- Then PaperWM: marked B leaves the scratch layer via `unmakeScratch`
  (float cleared, `unstick`) into workspace `window-added` handling, which
  re-inserts after the selected window per `getOpenWindowPositionIndex`
  (shipped RIGHT default), not the old slot; exact position and focus TBD.
  `S(S-pap-minimize)`; queued.
- Then karousel/Lazy: unminimize constructs a new `Tiled` in a fresh column
  after the last-focused (else last) column, not the old slot; exact column
  and focus TBD. `S(S-kar-minimize)`; queued.
- Then paneru: the `Minimized` mark is removed and
  `window_managed_trigger` reinserts at the remembered
  `PreviousManagedStrip` index (old slot) when that workspace/virtual-strip
  still exists and no `index` insertion rule overrides (none under shipped
  defaults); otherwise the active-strip overlap/end fallback applies; focus
  TBD. `S(S-pan-minimize)`; queued.
- Then Ours KDE: TBD (re-observation over the restored frame; slot
  TBD). `S(S-ours-minkde)`; queued.
- Then Ours Windows: B is observed eligible again over its kept slot;
  focus TBD. `S(S-ours-minwin)`; focus queued.
- Variant hook: provisional/TBD (restore-slot hook, to discuss).

### R-MNZ-03: native minimize of a sole workspace window

- Given: `WS1=H[A*]` shown, `WS2` occupied. Columns: `WS1` holds one
  column; paneru uses virtual rows (A on VW1, C on VW2).
- When: native minimize A on WS1 (same paths as R-MNZ-01).
- Observe: workspace occupancy/cleanup; focus fallback.
- Then COSMIC: A is stored in `minimized_windows`; the tiling layer
  holds nothing. Cleanup and focus TBD. `S(S-cos-minimize)`; queued.
- Then Hyprland/Dwindle: no-counterpart (request dropped as in R-MNZ-01;
  WS1 never empties this way). `S(S-hyp-mininv)`.
- Then bspwm: no-counterpart (same missing request path and verb).
  `S(S-bsp-mininv)`.
- Then i3: no-counterpart (request rejected; WS1 never empties this
  way). `S(S-i3-mininv)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (same missing request
  path as R-MNZ-01; the sole workspace never empties this way).
  `S(S-xmo-mininv)`.
- Then sway: no-counterpart (focused request cleared as in R-MNZ-01; WS1
  never empties this way). `S(S-sway-mininv)`.
- Then qtile/Columns: A hides as `MINIMIZED`; occupancy and focus TBD.
  `S(S-qti-minimize)`; queued.
- Then awesome/tile: A unmaps (`ICONIC`), order kept; occupancy and
  focus TBD. `S(S-awe-minimize)`; queued.
- Then niri: no-counterpart. `S(S-nir-mininv)`.
- Then PaperWM: same stick-to-scratch path as R-MNZ-01; sole-space
  empty-column splice plus GNOME cleanup TBD. `S(S-pap-minimize)`; queued.
- Then karousel/Lazy: same `TiledMinimized` path as R-MNZ-01 (A is the
  sole window of the sole column C1, so C1 is destroyed; being the last
  column, the focus target is null); occupancy and native focus TBD.
  `S(S-kar-minimize)`; queued.
- Then paneru: same Minimized-mark plus strip-remove path as R-MNZ-01;
  sole-row strip emptiness/reaping and focus TBD.
  `S(S-pan-minimize)`; queued.
- Then Ours KDE: TBD (sole minimize's native active-window value and
  Engine occupancy/focus unestablished; a null active window makes
  observation fail closed). `S(S-ours-minkde)`; queued.
- Then Ours Windows: A stays retained on its kept slot (cleanup drops
  only absent HWNDs); focus TBD. `S(S-ours-minwin)`; focus queued.
- Variant hook: provisional/TBD (minimized-occupancy hook, to discuss).
