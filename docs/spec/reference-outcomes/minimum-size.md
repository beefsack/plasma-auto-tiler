# Minimum-size transitions (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Wide tables moved here unchanged.

## 12. Minimum-size transitions

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-MIN-01 | Tiled `H[A*,B]`, inner area 1080x300, gap 8; A/B minima 500x100 | Open C with minimum 100x100 | Newcomer vs existing member infeasibility; which window floats, skips or overlaps; alternative arrangement considered or not | Traced allocation/cropping without minimum enforcement; fixed-size admission floats separately; admission maps once at the resolved MRU anchor, no alternative search; `S(S-cos-min)` + `S(S-cos-last)`; exact native fixture TBD | Tiled limits off by default; opt-in clamp/recenter may overlap/overflow, not auto-float; `S(S-hyp-min)`; exact fixture TBD | Hints default off `S(S-bsp-hint)`; opt-in clamps every leaf on reflow, including existing members `S(S-bsp-min)`; exact fixture/fence wiring TBD | Traced tiled render without minimum clamping; fixed-size min==max admits floating while ordinary resizable tiles; float min/max clamp is float-only; exact fixture frames/native response TBD; `S(S-i3-min)` | Tall `tile` allocates unconditionally with no hint consult in the cited tile path; ordinary resizable C tiles even when minima exceed shares (fixed-size/transient admission floats separately; size hints shape only float frames); no alternative-arrangement search; exact fixture frames/native response TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)` | Ordinary resizable C tiles unclamped even when minima exceed shares: tiled arrange fraction-normalizes with no client-hint consult (10px zeroing only, `MIN_SANE` 100x60 gap reservation only); fixed-size min==max admits floating instead (xdg parent/fixed-size; xwayland modal/dialog/utility/toolbar/splash/fixed-size at map, runtime hints urgency-only); float clamp is config min/max plus client hints on floating resize only; exact fixture frames/native response TBD; `S(S-sway-min)` + `S(S-sway-max)` | Ordinary resizable C tiles unclamped even when minima exceed shares: tiled place runs with respect_hints=false (no client-hint consult in the Columns path); fixed-size min==max admits floating instead (X11 hint check; Wayland respect_hints is an unhandled TODO); exact fixture frames/native response TBD; `S(S-qti-min)` + `S(S-qti-float)` | Ordinary resizable C tiles with size-hint shaping only (tile arrange applies hints without minimum-infeasibility float/skip, no alternative-arrangement search); fixed-size min==max floats implicitly instead; exact fixture frames/native response TBD; `S(S-awe-tile)` + `S(S-awe-float)` | Shared projection reallocates within the selected tree, without alternative-arrangement search; overconstrained members keep slots, KDE skips writes, Windows uses origin+minimum. Exact fixture/result TBD; automatic victim/return policy unselected, `D(D-min-games)` | V-START-MIN |
| R-MIN-02 | Tiled `H[A,B]`, inner width 1220, gap 8; both minimum widths 600 | Shrink inner width to 1080 | Existing members become infeasible; native frames, focus, float intent and recovery after width grows | Same traced allocation/cropping `S(S-cos-min)`; native shrink/grow/focus TBD | Same tiled clamp setting `S(S-hyp-min)`; default unclamped, opt-in recentered clamp; exact shrink/grow/focus TBD | Same per-leaf hint clamp when enabled `S(S-bsp-min)`; off by default; exact recovery/fence TBD | Same unclamped tiled allocation (float clamp float-only); exact shrink/grow frames/focus/float intent TBD (native response not in allocation source); `S(S-i3-min)` | Same unconditional Tall sizing on shrink (no reflow clamp; the float map is untouched); exact shrink/grow frames/focus/float intent TBD (native response not in the tile path); `S(S-xmo-layout)` | Same unclamped tiled allocation on shrink (fraction renormalize, 10px zeroing only; float clamp float-only including client hints on floating resize); exact shrink/grow frames/focus/float intent TBD (native response not in allocation source); `S(S-sway-min)` | Same unclamped tiled allocation on shrink (no reflow clamp in the Columns path; hint clamp is float-only via respect_hints=true); exact shrink/grow frames, focus, and float intent TBD; `S(S-qti-min)` | Same hint-shaped tiled allocation on shrink (no reflow clamp or float intent in the tile path); exact shrink/grow frames, focus, and float intent TBD (native response not in allocation source); `S(S-awe-tile)` | Same shared minimum projection; current KDE skip/Windows origin+minimum, neither auto-floats. Exact shrink/grow journey TBD. A hint-only change on KDE is not an independent dispatch trigger, `D(D-min-games)` | V-START-MIN |
| R-MIN-03 | Empty tiled domain, inner area 1080x600 | Open A with declared minimum 1200x500 | Tile/flag vs automatic float; overflow remains even without siblings | Same tile allocation/cropping; fixed-size exception not oversized-min policy; `S(S-cos-min)`; native sole-leaf result TBD | Same default-unclamped/opt-in-clamped tiling `S(S-hyp-min)`; native sole-leaf result TBD | Default hints off; honored hints grow leaf at origin `S(S-bsp-min)`; native exact frame TBD | Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min); float clamp float-only; exact sole-leaf native frame TBD; `S(S-i3-min)` | Ordinary resizable A tiles unconditionally even when its minimum exceeds the work area (the fixed-size/transient float exception is not an oversized-min policy); exact sole-leaf native frame TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)` | Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min; xwayland type/modal branches likewise admission-only); float clamp float-only; exact sole-leaf native frame TBD; `S(S-sway-min)` + `S(S-sway-max)` | Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (the fixed-size float exception is min==max, not oversized-min); exact sole-leaf native frame TBD; `S(S-qti-min)` + `S(S-qti-float)` | Ordinary resizable A tiles with hint shaping even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min); exact sole-leaf native frame TBD; `S(S-awe-float)` + `S(S-awe-tile)` | Core projects the sole leaf and flags its violated minimum; KDE skips, writable Windows raises width at tile origin. Floating cannot make this minimum fit the work area; exact native journey TBD, `D(D-min-games)` | V-START-MIN |

## Scrolling assessment (additive; existing wide tables above unchanged)

Each block states a separate column Given reusing the same identities
and action; projections are rectangle-level links only, never split-tree
proof. Ours columns carry no cells here (Ours minimum policy is already in
the wide rows).

### R-MIN-01 backfill: newcomer minimum exceeds shares (scrolling)

- Given (columns): `COL[C1[A*],C2[B]]`, viewport 1080x300, gap 8; A/B
  minima 500x100; newcomer C minimum 100x100. Shipped defaults apply;
  viewport recorded. Full-rect prerequisite for a faithful projection: both
  columns fully visible at these widths before admission. An independent
  strip may instead scroll to show C, so tree-style member infeasibility is
  never assumed here.
- When: open C (same action as the wide row).
- Observe: newcomer vs existing member infeasibility; clamp, skip, overlap
  or reflow; focus.
- Then niri: column width resolves with min/max clamp (`S(S-nir-min)`);
  exact newcomer admission/focus TBD; queued.
- Then PaperWM: TBD (minimum handling untraced). `S(S-pap-base)`; queued.
- Then karousel/Lazy: column width clamps to the client minimum
  (`getMinWidth`, capped at the tiling width); exact newcomer admission
  TBD. `S(S-kar-min)`; admission queued.
- Then paneru: TBD (minimum handling untraced). `S(S-pan-model)`; queued.

### R-MIN-02 backfill: shrink makes members infeasible (scrolling)

- Given (columns): `COL[C1[A],C2[B]]`, viewport width 1220, gap
  8; A/B minimum widths 600. Shipped defaults apply.
  Full-rect prerequisite: both columns fully visible
  at 1220 before the shrink. A strip may absorb the shrink by scrolling
  rather than by member infeasibility, so reflow is never assumed here.
- When: shrink the viewport width to 1080, then grow back to 1220 in
  the same fixture without a reset (wide-row shrink and recovery).
- Observe: infeasible members; clamp, overlap, focus and recovery on grow.
- Then niri: TBD (shrink clamp/reflow untraced). `S(S-nir-min)`; queued.
- Then PaperWM: TBD (minimum handling untraced). `S(S-pap-base)`; queued.
- Then karousel/Lazy: column widths stay clamped to client minima via
  `setWidth`; exact shrink/grow frames TBD. `S(S-kar-min)`; frames queued.
- Then paneru: TBD (minimum handling untraced). `S(S-pan-model)`; queued.

### R-MIN-03 backfill: oversized sole minimum (scrolling)

- Given (columns): empty strip, viewport 1080x600; incoming A has declared
  minimum 1200x500. Shipped defaults apply; viewport recorded. A strip may
  show an overflowed sole column with scrolling rather than tiling it
  into the viewport, so sole-leaf tiling is never assumed here.
- When: open A (same action as the wide row).
- Observe: tile/flag vs automatic float; overflow with no siblings.
- Then niri: TBD (sole-leaf oversized-minimum result untraced).
  `S(S-nir-min)`; queued.
- Then PaperWM: TBD (minimum handling untraced). `S(S-pap-base)`; queued.
- Then karousel/Lazy: width clamps to the client minimum capped at the
  tiling width (`getMinWidth`); exact sole-leaf frame TBD. `S(S-kar-min)`;
  frame queued.
- Then paneru: TBD (minimum handling untraced). `S(S-pan-model)`; queued.
