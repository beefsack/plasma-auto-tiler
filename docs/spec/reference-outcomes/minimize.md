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
- Then Hyprland/Dwindle: TBD (request consumed and echoed; tree effect
  untraced). `S(S-hyp-mininv)`; queued.
- Then bspwm: no-counterpart (no `WM_CHANGE_STATE`/iconic request
  branch and no minimize verb; `hidden` is WM-owned hide, never a
  minimize vote). `S(S-bsp-mininv)`.
- Then i3: no-counterpart (iconic request rejected and reverted to
  normal; B stays tiled). Scratchpad is separate. `S(S-i3-mininv)`.
- Then xmonad/Tall+Navigation2D: TBD (no runtime request handling
  traced; only the startup iconified scan). `S(S-xmo-mininv)`; queued.
- Then sway: TBD (xwayland echoes the flag; tree effect untraced).
  `S(S-sway-mininv)`; queued.
- Then qtile/Columns: B hides (`IconicState`) as `MINIMIZED` float under
  shipped `auto_minimize`; reflow and refocus TBD. `S(S-qti-minimize)`;
  queued.
- Then awesome/tile: B is banned (excluded) from the arrangement
  (`ICONIC`) keeping client order; HIDDEN request maps to the same
  setter. Refocus follows history (C). `S(S-awe-minimize)` +
  `S(S-awe-hist)`.
- Then niri: no-counterpart (`SetMinimized` is an explicit no-op; no
  Action verb). `S(S-nir-mininv)`.
- Then PaperWM: B moves to the scratch layer with the tiled mark;
  reflow and refocus TBD. `S(S-pap-minimize)`; queued.
- Then karousel/Lazy: B enters `TiledMinimized` (no longer tiles);
  reflow and focus target TBD. `S(S-kar-minimize)`; queued.
- Then paneru: B is marked `Unmanaged::Minimized` (off screen); strip
  reflow and refocus TBD. `S(S-pan-minimize)`; queued.
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
- Then Hyprland/Dwindle: TBD (no minimized state or restore path
  sourced). `S(S-hyp-mininv)`; queued.
- Then bspwm: no-counterpart (same missing request path and verb).
  `S(S-bsp-mininv)`.
- Then i3: no-counterpart (nothing minimized to restore).
  `S(S-i3-mininv)`.
- Then xmonad/Tall+Navigation2D: TBD. `S(S-xmo-mininv)`; queued.
- Then sway: TBD. `S(S-sway-mininv)`; queued.
- Then qtile/Columns: restore path exists (`minimized=false`); slot and
  focus TBD. `S(S-qti-minimize)`; queued.
- Then awesome/tile: B remaps `NORMAL` at its retained client order;
  focus TBD. `S(S-awe-minimize)`; focus queued.
- Then niri: no-counterpart. `S(S-nir-mininv)`.
- Then PaperWM: marked B leaves the scratch layer; position and focus
  TBD. `S(S-pap-minimize)`; queued.
- Then karousel/Lazy: unminimize retiles (or floats); position and focus
  TBD. `S(S-kar-minimize)`; queued.
- Then paneru: the `Minimized` mark is removed; position and focus TBD.
  `S(S-pan-minimize)`; queued.
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
- Then Hyprland/Dwindle: TBD. `S(S-hyp-mininv)`; queued.
- Then bspwm: no-counterpart (same missing request path and verb).
  `S(S-bsp-mininv)`.
- Then i3: no-counterpart (request rejected; WS1 never empties this
  way). `S(S-i3-mininv)`.
- Then xmonad/Tall+Navigation2D: TBD. `S(S-xmo-mininv)`; queued.
- Then sway: TBD. `S(S-sway-mininv)`; queued.
- Then qtile/Columns: A hides as `MINIMIZED`; occupancy and focus TBD.
  `S(S-qti-minimize)`; queued.
- Then awesome/tile: A unmaps (`ICONIC`), order kept; occupancy and
  focus TBD. `S(S-awe-minimize)`; queued.
- Then niri: no-counterpart. `S(S-nir-mininv)`.
- Then PaperWM: TBD (sole-space occupancy and GNOME cleanup untraced).
  `S(S-pap-minimize)`; queued.
- Then karousel/Lazy: TBD (sole-column occupancy and focus untraced).
  `S(S-kar-minimize)`; queued.
- Then paneru: TBD (sole-row reaping and focus untraced).
  `S(S-pan-minimize)`; queued.
- Then Ours KDE: TBD (sole minimize's native active-window value and
  Engine occupancy/focus unestablished; a null active window makes
  observation fail closed). `S(S-ours-minkde)`; queued.
- Then Ours Windows: A stays retained on its kept slot (cleanup drops
  only absent HWNDs); focus TBD. `S(S-ours-minwin)`; focus queued.
- Variant hook: provisional/TBD (minimized-occupancy hook, to discuss).
