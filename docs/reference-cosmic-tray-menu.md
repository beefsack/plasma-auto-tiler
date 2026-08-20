# Reference: COSMIC Tray Icon and Menu (Observed)

## Evidence

- `[C-OBS-2]`: refers to direct visual observation of two local screenshot
  files, read by the agent's image tool during this research task:
  - `/home/beefsack/Pictures/Screenshots/Screenshot_2026-08-20_12-46-44.png`
  - `/home/beefsack/Pictures/Screenshots/Screenshot_2026-08-20_12-46-57.png`
  - Both captured 2026-08-20. Both show the COSMIC top panel with the same
    tray menu open (this project's window-tiling tray item), differing only
    in the state of the "Tile current workspace" toggle (on in the first
    shot, off in the second). No closed/icon-only shot was provided in this
    pair - both shots show the menu open.

## Tray icon `[C-OBS-2]`

- Located in the COSMIC top panel, to the right of a keyboard-layout
  indicator labelled "us" and to the left of a workspace/window-tiling-style
  icon, a volume icon, and other panel icons (screenshot/app tray, battery,
  chat, bluetooth, power).
- Shape: a circle.
- Content: the circle is divided into pie-chart-like wedge segments in
  alternating dark and light shades (resembles a clock/pie icon rather than
  a literal window-tiling glyph). Exact segment count and colours are not
  fully resolvable at the rendered icon size (approx. 20x20px) - it reads as
  a circular icon with several light/dark wedges rather than a single flat
  colour or a distinct symbol.
- No visible badge, notification dot, or overlay indicator on the icon in
  either screenshot.
- The icon state (segment appearance) does not visibly differ between the
  two screenshots despite the "Tile current workspace" toggle being on in
  one and off in the other - any such difference, if it exists, is too
  subtle to make out at this resolution.

## Menu structure and items `[C-OBS-2]`

The menu is a single-level popup (rounded rectangle, dark background) with
no visible submenus. Items in top-to-bottom order, grouped by the
separators (thin horizontal lines) that appear in the popup:

**Group 1**
1. "Tile current workspace" - row with a toggle switch (purple/on in shot
   1, grey/off in shot 2) on the right.

*(separator line)*

**Group 2**
2. "New workspace behavior" - plain text label (heading, not a clickable
   item).
3. A segmented two-option control below that heading, styled as a pill with
   two halves:
   - "Tiled" (left half) - has a purple checkmark to its left in both
     screenshots, indicating it is the selected option. Text colour purple.
   - "Floating" (right half) - no checkmark, grey text, indicating it is
     the unselected option.

*(separator line)*

**Group 3**
4. "Navigate windows" - label on left, shortcut hint "Super + arrows" on
   right.
5. "Move window" - label on left, shortcut hint "Shift + Super + arrows"
   on right.
6. "Toggle floating window" - label on left, shortcut hint "Super + G" on
   right.

*(separator line)*

**Group 4**
7. "Active hint" - row with a toggle switch on the right. In both
   screenshots this toggle is purple/on (unaffected by the state of the
   "Tile current workspace" toggle above).

*(separator line)*

**Group 5**
8. "Window management settings..." - plain text item, trailing ellipsis,
   presumably opens a separate settings window/dialog. No submenu is shown
   expanding from this item in either screenshot; its destination content
   is not visible and is not documented here.

No radio-button markers are used anywhere except the purple checkmark on
"Tiled"/"Floating"; no items appear greyed-out/disabled in either
screenshot; no other checkmarks, badges, or nested submenus are visible.

## Shortcut hints summary `[C-OBS-2]`

| Menu item | Shortcut shown |
|---|---|
| Navigate windows | Super + arrows |
| Move window | Shift + Super + arrows |
| Toggle floating window | Super + G |

No shortcut hints are shown next to any other item (toggles, the
Tiled/Floating selector, or "Window management settings...").

## Unresolved / not fully visible

- Exact tray icon glyph/segment pattern at full resolution is not
  determinable from these screenshots - described above at best effort.
- Contents behind "Window management settings..." are not shown in either
  screenshot and are not documented.
- No screenshot in this pair shows the tray icon alone (closed/no menu) for
  direct closed-state icon comparison against the open-menu icon.
