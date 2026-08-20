# COSMIC video state timeline (unit-C1)

Source video: `2026-08-20 12-36-28.mp4` (2560x1440, 59.25s, 60fps, 3555 frames).
Shows repeated tiled-window moves in COSMIC, focused on directional moves
toward screen edges (testing no-window-in-direction behaviour).

## Interpretation correction (post-C1, user-confirmed 2026-08-20)

unit-C2's first attempt misread the early frames as an OBS source-picker
dialog. The user confirmed directly: OBS is visible only in the opening
frames, on workspace 2, before switching to workspace 1 (where all testing
happened). Consequences for this timeline, recorded here rather than
re-derived at image-read cost:

- **t=0.0s is confirmed OBS Studio on workspace 2 - excluded from
  interpretation**, not COSMIC tiling evidence.
- **t=0.567s is ambiguous and likely still mid-workspace-switch** (0.567s
  after start, only fragmentary/transitional geometry detected) -
  excluded from interpretation pending any contrary signal, not asserted
  as workspace-1 content.
- **t=11.4s onward (21 remaining states) is workspace 1**: the "grid of
  rectangular cells" throughout this timeline is tiled terminal windows,
  the lavender/purple outline is the COSMIC active-window border
  (`#BD93F9`, 3px, per unit-A `[C-OBS-1]`), and any `<cols> x <rows>` text
  overlay marks a window mid-resize/move, not a picker label.
- The other low-confidence/transitional states (t=16.85s, t=26.4s,
  t=36.033s) are **not** excluded - under the corrected reading they are
  plausible in-progress-move frames and are back in scope for
  interpretation, prioritised rather than discarded.

## Method and confidence caveats

- Scene-change timestamps found via `ffmpeg -filter:v "select='gt(scene,0.08)',showinfo"`
  (threshold 0.08, chosen after 0.04 produced too many near-duplicate hits
  from mid-drag animation sub-frames - see summary below).
- One frame extracted per timestamp (plus t=0.0 as the initial state) via
  `ffmpeg -ss <t> -frames:v 1 -pix_fmt rgb24 -f rawvideo`, giving 23 raw
  RGB frames.
- Window/border geometry reconstructed via pure byte-level run-length
  scanning (Python stdlib, no image libraries), looking for pixel runs
  matching the known COSMIC border colours: ACTIVE `#BD93F9` (189,147,249)
  and INACTIVE `#53555E` (83,85,94), with absolute-tolerance matching
  (tol=18) plus clustering of adjacent thin (<=15px) runs into border
  lines, filtering out thick "runs" that are actually solid-colour window
  *content* (a major source of false positives in this video - unlike
  unit-A's static screenshots, this video is H.264-compressed and window
  content frequently contains large areas of near-uniform grey that
  coincidentally match the inactive-border tolerance).
- **Confidence is lower than unit-A's screenshot analysis.** Window counts
  and split orientation are inferred from detected divider-line
  positions/extents and are best-effort; several states have sparse or
  ambiguous divider data (noted per-entry as "low confidence" /
  "ambiguous"). Bounding boxes are approximate (+/- ~10-20px near edges
  due to anti-aliasing/compression). Active/focused-window attribution is
  the least reliable signal - lavender hits were sometimes found only as
  partial/fragmentary edges, or possibly panel/dock UI elements rather
  than true window borders; these are flagged as "unclear" where the
  evidence was not a clean, edge-length border run.

## State timeline

Each state: timestamp (s), window count, approximate bounding boxes
(x,y,width,height in px, full-screen area is roughly 0-2560 x 40-1430
below the top panel), split orientation, focus, extracted frame path.

### t=0.0s (frame `f01_0.0.rgb`)
- 1 window, fullscreen/maximized.
- bbox: ~(6,39)-(2551,1431), ~2545x1392.
- split: none (single window).
- focus: ACTIVE (left/top edges clearly lavender; right edge colour was
  ambiguous, likely a compression artefact rather than a second window).

### t=0.567s (frame `f02_0.566667.rgb`)
- 1 window, likely mid-drag/animation transition frame (low confidence).
- bbox: ~(8,147)-(2551,1440) approx, edges show inactive colour with a
  small active fragment near top-left - consistent with a move/resize in
  progress.
- split: none detected.
- focus: unclear (transition frame).

### t=11.4s (frame `f03_11.4.rgb`)
- **4 windows** (3-column layout, middle column further split top/bottom).
- bboxes (approx): col1 (11,43)-(849,1429) ~838x1386; col2-top
  (851,43)-(1710,754) ~859x711; col2-bottom (851,756)-(1710,1416)
  ~859x660; col3 (1711,44)-(2551,1429) ~840x1385.
- split: vertical (3 columns), with col2 additionally horizontally split.
- focus: unclear - lavender hits found were fragmentary/wide and likely
  reflect a dock/panel element rather than a clean window border.

### t=16.85s (frame `f04_16.85.rgb`)
- Ambiguous, low confidence (sparse divider data) - likely a transitional
  frame during a window move. Estimated 1-2 windows.
- No confident bboxes.
- split: undetermined.
- focus: unclear.

### t=17.517s (frame `f05_17.516667.rgb`)
- 2 windows, side by side (inferred from a bottom-edge active-border gap).
- bboxes (approx): left ~(176,?)-(1296,1417); right ~(1662,?)-(2480,1417).
- split: horizontal (side-by-side).
- focus: ambiguous - both edges showed active-tinted colour, possibly a
  drag-transition frame.

### t=24.767s (frame `f06_24.766667.rgb`)
- 2 windows, side by side.
- bboxes (approx): left ~(54,?)-(1230,1407); right ~(1307,?)-(2528,1073+).
- split: horizontal (side-by-side), divider near x~1237-1300.
- focus: left window shows an active top-edge fragment (56-848 @ y716) -
  weak signal, left window tentatively ACTIVE.

### t=25.817s (frame `f07_25.816667.rgb`)
- 2 windows, stacked top/bottom (full-width active divider at y~716).
- bboxes (approx): top ~(82,54)-(2482,716); bottom ~(82,716)-(2482,1427).
- split: horizontal divider (top/bottom stack).
- focus: unclear which of the two is focused (divider itself shows active
  colour on both sides).

### t=26.4s (frame `f08_26.4.rgb`)
- Ambiguous, low confidence (very sparse divider data) - likely
  transitional frame. Estimated 1-2 windows.
- split: undetermined.
- focus: unclear.

### t=26.817s (frame `f09_26.816667.rgb`)
- **3 windows**: left column split top/bottom, plus one right window
  (right window bbox not confidently isolated in this pass).
- bboxes (approx): left-top ~(12,44)-(1272,754); left-bottom
  ~(12,756)-(1272,1427); right window x>~1280 (extent not confidently
  bounded here).
- split: left column vertically split; overall layout has a vertical
  divider around x~1280 plus horizontal sub-split on the left.
- focus: unclear (full-width active line at y~1416 likely a bottom
  panel/dock highlight, not window focus).

### t=32.033s (frame `f10_32.033333.rgb`)
- **3 windows**: right window (active) plus left column apparently
  split into two.
- bboxes (approx): right ~(1728,62)-(2536,1409) ~808x1347, ACTIVE;
  left-top and left-bottom occupy roughly x=[31,1668], divided near
  y~952-957 (approximate; left bboxes not tightly bounded).
- split: vertical divider (~x=1700) plus horizontal split on the left.
- focus: right window - ACTIVE (matching top and bottom edges at same
  x-range, y=62-63 and y=1408-1409, both lavender).

### t=32.6s (frame `f11_32.6.rgb`)
- **4 windows**, same 3-column-with-split-middle layout as t=11.4s.
- bboxes: same approximate columns as f03 (col1 ~11-849, col2-top/bottom
  split at y~718, col3 ~1711-2551).
- split: vertical (3 columns), col2 further horizontally split.
- focus: col2-top and col3 both show active top-edge fragments at y~54-55
  - ambiguous, possibly reflects a recent focus change or drag.

### t=34.65s (frame `f12_34.65.rgb`)
- **3 windows**: left column split top/bottom, right window inferred.
- bboxes (approx): left-top ~(50,63)-(1236,716) ACTIVE (top edge
  lavender); left-bottom below y~756; right window x>~1240 (bbox not
  tightly bounded).
- split: vertical divider ~x=1238, left column horizontally split.
- focus: left-top window - ACTIVE (y=63 and y=716 both show lavender
  spanning its width).

### t=35.617s (frame `f13_35.616667.rgb`)
- **4 windows**, same 3-column-with-split-middle layout as t=11.4s/32.6s.
- bboxes: same approximate columns as f03/f11.
- split: vertical (3 columns), col2 further horizontally split.
- focus: ambiguous (wide active fragments spanning col2/col3 boundary at
  both y~54 and y~718, not a single clean box).

### t=36.033s (frame `f14_36.033333.rgb`)
- Ambiguous, low confidence (sparse divider data) - likely transitional.
  Estimated 2-3 windows based on two separated horizontal fragments at
  y=519 (x=40-821 and x=1742-2524).
- split: undetermined.
- focus: unclear.

### t=36.633s (frame `f15_36.633333.rgb`)
- **3 windows**: left column split top/bottom (matches t=26.8s pattern),
  right window inferred.
- bboxes (approx): left-top ~(688,?)-(1274,754); left-bottom below
  y~754; right window x>~1280.
- split: vertical divider near x~1280, left column horizontally split.
- focus: unclear (full-width active line at y~1416 likely dock/panel).

### t=46.317s (frame `f16_46.316667.rgb`)
- **Complex multi-window state, likely 4-6 windows (3+ confirmed)**.
  Divider x-positions differ between the top half (x~1324, x~2503) and
  bottom half (x~1621, x~2204) of the screen, indicating independent
  splits per row rather than a simple grid - consistent with COSMIC's
  BSP-style auto-tiling after several moves.
- bboxes: not confidently isolated at this complexity; left-top region
  (x=64-1232, y up to ~707) shows an active top edge.
- split: mixed (vertical + horizontal, asymmetric between rows).
- focus: left-top window - tentatively ACTIVE (y=62-63, x=64-1232,
  lavender).

### t=47.45s (frame `f17_47.45.rgb`)
- **Complex multi-window state, likely 4-6 windows (3+ confirmed)**,
  same asymmetric-divider pattern as t=46.3s (dividers at x~1321/2515
  top vs x~1317/1897 bottom).
- bboxes: not confidently isolated.
- split: mixed (vertical + horizontal, asymmetric between rows).
- focus: left window - tentatively ACTIVE (y=56, x=35-1248, lavender).

### t=48.183s (frame `f18_48.183333.rgb`)
- 2 windows, side by side, with what looks like a small internal
  dialog/popup overlay in the left window (localized box at
  x=123-1176, y=414-699 - too small/isolated to be a tiled window).
- bboxes (approx): left ~(12,744)-(978,1427); right
  ~(1580,744)-(2546,1427) (heights below y~744 only - upper portion of
  this pair not confidently bounded).
- split: horizontal (side-by-side).
- focus: unclear (full-width active line at y~1416 likely dock/panel,
  not window border).

### t=48.75s (frame `f19_48.75.rgb`)
- **Complex multi-window state, likely 6-7 windows (3+ confirmed)** -
  highest apparent window count in the timeline. Left region shows
  multiple internal dividers (x~45, x~613/618, x~663, x~1241) each
  further split top/bottom (~y=708), suggesting several small tiles
  packed into roughly the left half of the screen; a separate large
  window occupies the right half (x>~1288).
- bboxes: not confidently isolated for individual small tiles; right
  window approx x=[1288,2547], near-full height.
- split: mixed grid (multiple vertical + horizontal divisions).
- focus: unclear (active fragment at y=56-57, x=1312-2528 sits on the
  right window's top edge - tentative).

### t=50.45s (frame `f20_50.45.rgb`)
- **Complex multi-window state, likely 4-5 windows (3+ confirmed)**.
  Horizontal dividers detected at y~708 (active on both sides,
  x=174-960 and x=1454-2386) and y~1298 (inactive, x=64-1228 and
  x=1332-2496), with additional vertical substructure near the top
  (x~438, x~448, x~2122).
- bboxes: not confidently isolated; two regions meeting at y~708 span
  roughly x=[174,960] and x=[1454,2386].
- split: mixed (horizontal bands with further vertical subdivision).
- focus: ambiguous - active colour appears on both sides of the y~708
  divider.

### t=51.383s (frame `f21_51.383333.rgb`)
- **4 windows**, similar 3-column/split-middle layout to t=11.4s but
  with an asymmetry: the outer (left/right) columns' *top* edges start
  further in from the screen edge (x~67 / x~2492) than their *bottom*
  edges (x~16-19 / x~2540-2543). This mismatch is consistent with a
  window recently moved toward (or away from) a screen edge, leaving a
  brief inset before it snaps flush - a plausible **edge-move-in-progress
  state**.
- bboxes: outer columns approx (16-67,?)-(748-1422 range) on the left and
  mirrored on the right; middle column split near y~1066 as in t=11.4s.
- split: vertical (3 columns), middle column horizontally split.
- focus: unclear (wide active line at y~760-761 spans most of the width,
  ambiguous).

### t=51.883s (frame `f22_51.883333.rgb`)
- **3 windows** (the middle column's top/bottom split present in
  neighbouring states has merged into a single window here, i.e. a
  window resize/close/move reduced the previous 4-window layout to 3).
- bboxes (approx): middle window ~(896,760)-(1669,1408) ~773x648,
  ACTIVE (top and bottom edges both lavender, matching x-range); left
  and right columns inferred from horizontal dividers at y~981
  (x=60-812 and x=1748-2501) but not tightly bounded.
- split: vertical (3 columns, middle only).
- focus: middle window - ACTIVE (clean matching top/bottom edges at
  y=760-761 and y=1408-1409, x=896-1669/1668).

### t=52.35s (frame `f23_52.35.rgb`)
- **4 windows**, same 3-column/split-middle layout as t=51.383s
  (outer-column top/bottom edge asymmetry again present at x~67 top vs
  x~16-19/2540-2543 bottom) - another candidate edge-move state.
- bboxes: same approximate columns as t=51.383s.
- split: vertical (3 columns), middle column horizontally split.
- focus: unclear (active line at y~1408-1409 spans most of the width).

## Extracted candidate-frame files (scratch, not in repo)

All under `/tmp/opencode/cosmic-evidence-mining/unit-c1/frames/`:

- `f01_0.0.rgb`
- `f02_0.566667.rgb`
- `f03_11.4.rgb`
- `f04_16.85.rgb`
- `f05_17.516667.rgb`
- `f06_24.766667.rgb`
- `f07_25.816667.rgb`
- `f08_26.4.rgb`
- `f09_26.816667.rgb`
- `f10_32.033333.rgb`
- `f11_32.6.rgb`
- `f12_34.65.rgb`
- `f13_35.616667.rgb`
- `f14_36.033333.rgb`
- `f15_36.633333.rgb`
- `f16_46.316667.rgb`
- `f17_47.45.rgb`
- `f18_48.183333.rgb`
- `f19_48.75.rgb`
- `f20_50.45.rgb`
- `f21_51.383333.rgb`
- `f22_51.883333.rgb`
- `f23_52.35.rgb`

Raw format: `rgb24`, 2560x1440, no header (extract via
`ffmpeg -ss <t> -i <video> -frames:v 1 -pix_fmt rgb24 -f rawvideo <out>.rgb`).
