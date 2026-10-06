# Minimum-size transitions (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14).

## 12. Minimum-size transitions

### R-MIN-01: newcomer minimum exceeds shares

- Given (tree profiles): Tiled `H[A*,B]`, inner area 1080x300, gap 8; A/B minima 500x100

- Given (column profiles): `COL[C1[A*],C2[B]]`, viewport 1080x300, gap 8; A/B
  minima 500x100; newcomer C minimum 100x100. Shipped defaults apply;
  viewport recorded. Full-rect prerequisite for a faithful projection: both
  columns fully visible at these widths before admission. An independent
  strip may instead scroll to show C, so tree-style member infeasibility is
  never assumed here.

- When: Open C with minimum 100x100.

- When (column leg): open C (same action as this scenario).

- Observe: Newcomer vs existing member infeasibility; which window floats, skips or overlaps; alternative arrangement considered or not

- Observe (column leg): newcomer vs existing member infeasibility; clamp, skip, overlap
  or reflow; focus.

- Then COSMIC: Traced allocation/cropping without minimum enforcement; fixed-size admission floats separately; admission maps once at the resolved MRU anchor, no alternative search; `S(S-cos-min)` + `S(S-cos-last)`; exact native fixture TBD
- Then Hyprland/Dwindle: Tiled limits off by default; opt-in clamp/recenter may overlap/overflow, not auto-float; `S(S-hyp-min)`; exact fixture TBD
- Then bspwm: Hints default off `S(S-bsp-hint)`; opt-in clamps every leaf on reflow, including existing members `S(S-bsp-min)`; exact fixture/fence wiring TBD
- Then i3: Traced tiled render without minimum clamping; fixed-size min==max admits floating while ordinary resizable tiles; float min/max clamp is float-only; exact fixture frames/native response TBD; `S(S-i3-min)`
- Then xmonad/Tall+Navigation2D: Tall `tile` allocates unconditionally with no hint consult in the cited tile path; ordinary resizable C tiles even when minima exceed shares (fixed-size/transient admission floats separately; size hints shape only float frames); no alternative-arrangement search; exact fixture frames/native response TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)`
- Then sway: Ordinary resizable C tiles unclamped even when minima exceed shares: tiled arrange fraction-normalizes with no client-hint consult (10px zeroing only, `MIN_SANE` 100x60 gap reservation only); fixed-size min==max admits floating instead (xdg parent/fixed-size; xwayland modal/dialog/utility/toolbar/splash/fixed-size at map, runtime hints urgency-only); float clamp is config min/max plus client hints on floating resize only; exact fixture frames/native response TBD; `S(S-sway-min)` + `S(S-sway-max)`
- Then qtile/Columns: Ordinary resizable C tiles unclamped even when minima exceed shares: tiled place runs with respect_hints=false (no client-hint consult in the Columns path); fixed-size min==max admits floating instead (X11 hint check; Wayland respect_hints is an unhandled TODO); exact fixture frames/native response TBD; `S(S-qti-min)` + `S(S-qti-float)`
- Then awesome/tile: Ordinary resizable C tiles with size-hint shaping only (tile arrange applies hints without minimum-infeasibility float/skip, no alternative-arrangement search); fixed-size min==max floats implicitly instead; exact fixture frames/native response TBD; `S(S-awe-tile)` + `S(S-awe-float)`
- Then niri: column width resolves with min/max clamp (`S(S-nir-min)`);
  exact newcomer admission/focus TBD; queued.
- Then PaperWM: TBD (minimum handling untraced). `S(S-pap-base)`; queued.
- Then karousel/Lazy: column width clamps to the client minimum
  (`getMinWidth`, capped at the tiling width); exact newcomer admission
  TBD. `S(S-kar-min)`; admission queued.
- Then paneru: TBD (minimum handling untraced). `S(S-pan-model)`; queued.
- Then Ours KDE: Shared projection reallocates within the selected tree, without alternative-arrangement search; overconstrained members keep slots; KDE skips writes. Exact fixture/result TBD; automatic victim/return policy unselected, `D(D-min-games)`.
- Then Ours Windows: Shared projection reallocates within the selected tree, without alternative-arrangement search; overconstrained members keep slots; Windows uses origin+minimum. Exact fixture/result TBD; automatic victim/return policy unselected, `D(D-min-games)`.
- Variant hook: V-START-MIN.

### R-MIN-02: shrink makes members infeasible

- Given (tree profiles): Tiled `H[A,B]`, inner width 1220, gap 8; both minimum widths 600

- Given (column profiles): `COL[C1[A],C2[B]]`, viewport width 1220, gap
  8; A/B minimum widths 600. Shipped defaults apply.
  Full-rect prerequisite: both columns fully visible
  at 1220 before the shrink. A strip may absorb the shrink by scrolling
  rather than by member infeasibility, so reflow is never assumed here.

- When: Shrink inner width to 1080.

- When (column leg): shrink the viewport width to 1080, then grow back to 1220 in
  the same fixture without a reset (wide-row shrink and recovery).

- Observe: Existing members become infeasible; native frames, focus, float intent and recovery after width grows

- Observe (column leg): infeasible members; clamp, overlap, focus and recovery on grow.

- Then COSMIC: Same traced allocation/cropping `S(S-cos-min)`; native shrink/grow/focus TBD
- Then Hyprland/Dwindle: Same tiled clamp setting `S(S-hyp-min)`; default unclamped, opt-in recentered clamp; exact shrink/grow/focus TBD
- Then bspwm: Same per-leaf hint clamp when enabled `S(S-bsp-min)`; off by default; exact recovery/fence TBD
- Then i3: Same unclamped tiled allocation (float clamp float-only); exact shrink/grow frames/focus/float intent TBD (native response not in allocation source); `S(S-i3-min)`
- Then xmonad/Tall+Navigation2D: Same unconditional Tall sizing on shrink (no reflow clamp; the float map is untouched); exact shrink/grow frames/focus/float intent TBD (native response not in the tile path); `S(S-xmo-layout)`
- Then sway: Same unclamped tiled allocation on shrink (fraction renormalize, 10px zeroing only; float clamp float-only including client hints on floating resize); exact shrink/grow frames/focus/float intent TBD (native response not in allocation source); `S(S-sway-min)`
- Then qtile/Columns: Same unclamped tiled allocation on shrink (no reflow clamp in the Columns path; hint clamp is float-only via respect_hints=true); exact shrink/grow frames, focus, and float intent TBD; `S(S-qti-min)`
- Then awesome/tile: Same hint-shaped tiled allocation on shrink (no reflow clamp or float intent in the tile path); exact shrink/grow frames, focus, and float intent TBD (native response not in allocation source); `S(S-awe-tile)`
- Then niri: TBD (shrink clamp/reflow untraced). `S(S-nir-min)`; queued.
- Then PaperWM: TBD (minimum handling untraced). `S(S-pap-base)`; queued.
- Then karousel/Lazy: column widths stay clamped to client minima via
  `setWidth`; exact shrink/grow frames TBD. `S(S-kar-min)`; frames queued.
- Then paneru: TBD (minimum handling untraced). `S(S-pan-model)`; queued.
- Then Ours KDE: Same shared minimum projection; current KDE skip, neither auto-floats. Exact shrink/grow journey TBD. A hint-only change on KDE is not an independent dispatch trigger, `D(D-min-games)`.
- Then Ours Windows: Same shared minimum projection; current Windows origin+minimum, neither auto-floats. Exact shrink/grow journey TBD, `D(D-min-games)`.
- Variant hook: V-START-MIN.

### R-MIN-03: oversized sole minimum

- Given (tree profiles): Empty tiled domain, inner area 1080x600

- Given (column profiles): empty strip, viewport 1080x600; incoming A has declared
  minimum 1200x500. Shipped defaults apply; viewport recorded. A strip may
  show an overflowed sole column with scrolling rather than tiling it
  into the viewport, so sole-leaf tiling is never assumed here.

- When: Open A with declared minimum 1200x500.

- When (column leg): open A (same action as this scenario).

- Observe: Tile/flag vs automatic float; overflow remains even without siblings

- Observe (column leg): tile/flag vs automatic float; overflow with no siblings.

- Then COSMIC: Same tile allocation/cropping; fixed-size exception not oversized-min policy; `S(S-cos-min)`; native sole-leaf result TBD
- Then Hyprland/Dwindle: Same default-unclamped/opt-in-clamped tiling `S(S-hyp-min)`; native sole-leaf result TBD
- Then bspwm: Default hints off; honored hints grow leaf at origin `S(S-bsp-min)`; native exact frame TBD
- Then i3: Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min); float clamp float-only; exact sole-leaf native frame TBD; `S(S-i3-min)`
- Then xmonad/Tall+Navigation2D: Ordinary resizable A tiles unconditionally even when its minimum exceeds the work area (the fixed-size/transient float exception is not an oversized-min policy); exact sole-leaf native frame TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)`
- Then sway: Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min; xwayland type/modal branches likewise admission-only); float clamp float-only; exact sole-leaf native frame TBD; `S(S-sway-min)` + `S(S-sway-max)`
- Then qtile/Columns: Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (the fixed-size float exception is min==max, not oversized-min); exact sole-leaf native frame TBD; `S(S-qti-min)` + `S(S-qti-float)`
- Then awesome/tile: Ordinary resizable A tiles with hint shaping even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min); exact sole-leaf native frame TBD; `S(S-awe-float)` + `S(S-awe-tile)`
- Then niri: TBD (sole-leaf oversized-minimum result untraced).
  `S(S-nir-min)`; queued.
- Then PaperWM: TBD (minimum handling untraced). `S(S-pap-base)`; queued.
- Then karousel/Lazy: width clamps to the client minimum capped at the
  tiling width (`getMinWidth`); exact sole-leaf frame TBD. `S(S-kar-min)`;
  frame queued.
- Then paneru: TBD (minimum handling untraced). `S(S-pan-model)`; queued.
- Then Ours KDE: Core projects the sole leaf and flags its violated minimum; KDE skips. Floating cannot make this minimum fit the work area; exact native journey TBD, `D(D-min-games)`.
- Then Ours Windows: Core projects the sole leaf and flags its violated minimum; writable Windows raises width at tile origin. Floating cannot make this minimum fit the work area; exact native journey TBD, `D(D-min-games)`.
- Variant hook: V-START-MIN.
