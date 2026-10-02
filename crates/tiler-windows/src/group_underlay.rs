//! Portable Windows group-underlay policy, settings, and fill-raster math.
//!
//! KDE parity source: `kwin/native-effect/activeborderconfig.kcfg`
//! (underlay enabled, `#40808080`, extension -1 resolves to border width).
//! Shared Engine geometry lives in `tiler-core::visual`
//! (`group_underlay_effective_extension`, `group_underlay_outer_rect`) and
//! `tiler-core::active_group` (immediate-parent projected union); the trigger
//! OR lives in `tiler-core::visual::group_underlay_trigger`. This module adds
//! only the Windows-side composition: options/flags parsing, hide reasons,
//! the native hit-test classification, modifier aggregation, and the
//! premultiplied-alpha fill raster. Native creation/presentation/placement
//! reuse the owned carrier in [`crate::active_border_sys`].

use tiler_core::geometry::Rect;
use tiler_core::visual::{VisualRect, group_focus_eligible};

/// Underlay default: on (mirrors the KDE highlight default).
pub const DEFAULT_ENABLED: bool = true;
/// KDE-parity default fill `#40808080` (ARGB): alpha 0x40 over grey.
pub const DEFAULT_COLOR_ARGB: (u8, u8, u8, u8) = (0x40, 0x80, 0x80, 0x80);
/// Extension sentinel: -1 follows the active-border width (KDE parity).
pub const DEFAULT_EXTENSION: f64 = -1.0;
/// Explicit extension range: the -1 sentinel or a 0..=32 logical width.
pub const MAX_EXTENSION: f64 = 32.0;

/// Configured underlay style. Colour is the KDE ARGB fill; extension is the
/// logical KDE-point outset beyond gap plus border width (-1 follows border).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroupUnderlayStyle {
    pub color: (u8, u8, u8),
    pub alpha: u8,
    pub extension: f64,
}

impl Default for GroupUnderlayStyle {
    fn default() -> Self {
        Self {
            color: (
                DEFAULT_COLOR_ARGB.1,
                DEFAULT_COLOR_ARGB.2,
                DEFAULT_COLOR_ARGB.3,
            ),
            alpha: DEFAULT_COLOR_ARGB.0,
            extension: DEFAULT_EXTENSION,
        }
    }
}

/// Full underlay switch: default on, explicit `--no-group-underlay` off.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroupUnderlayOptions {
    pub enabled: bool,
    pub style: GroupUnderlayStyle,
}

impl Default for GroupUnderlayOptions {
    fn default() -> Self {
        Self {
            enabled: DEFAULT_ENABLED,
            style: GroupUnderlayStyle::default(),
        }
    }
}

/// Parse `#aarrggbb` (case-insensitive, `#` required): the KDE ARGB config
/// form, alpha first. Six-digit `#rrggbb` is refused: a missing alpha must
/// never silently become opaque or transparent.
pub fn parse_color_argb(value: &str) -> Result<((u8, u8, u8), u8), String> {
    let usage = "refuse: --group-underlay-color needs #aarrggbb";
    let hex = value.strip_prefix('#').ok_or_else(|| usage.to_owned())?;
    if hex.len() != 8 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(usage.to_owned());
    }
    let channel = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&hex[range], 16).map_err(|_| usage.to_owned())
    };
    Ok((
        (channel(2..4)?, channel(4..6)?, channel(6..8)?),
        channel(0..2)?,
    ))
}

/// Parse a logical extension: exactly -1 (follow border width) or 0..=32.
pub fn parse_extension(value: &str) -> Result<f64, String> {
    let usage = "refuse: --group-underlay-extension needs -1..=32";
    let parsed: f64 = value.parse().map_err(|_| usage.to_owned())?;
    if !parsed.is_finite() || (parsed != -1.0 && (parsed < 0.0 || parsed > MAX_EXTENSION)) {
        return Err(usage.to_owned());
    }
    Ok(parsed)
}

/// Render a colour back to `#aarrggbb`.
#[must_use]
pub fn render_color_argb(((r, g, b), alpha): ((u8, u8, u8), u8)) -> String {
    format!("#{alpha:02x}{r:02x}{g:02x}{b:02x}")
}

/// Focused-only interactive move/size classification from the official
/// `WM_NCHITTEST` result sampled at move/size start. `HTCAPTION` starts a
/// move; sizing borders start a resize; anything else (client, menus,
/// nowhere, errors, timeouts) is unknown and never triggers. Pure over the
/// stable Win32 hit codes so the future Win+drag producer (parity item 7) can
/// feed `Move` directly without a hit test.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveSizeKind {
    Move,
    Resize,
    Unknown,
}

/// Classify one raw `WM_NCHITTEST` result (`HT*` codes are stable Win32 ABI:
/// `HTNOWHERE` 0, `HTCLIENT` 1, `HTCAPTION` 2, `HTSYSMENU` 3, sizing borders
/// 10..=17).
#[must_use]
pub fn classify_hit_test(hit: u32) -> MoveSizeKind {
    if hit == 2 {
        MoveSizeKind::Move
    } else if (10..=17).contains(&hit) {
        MoveSizeKind::Resize
    } else {
        MoveSizeKind::Unknown
    }
}

/// Fold raw modifier key states into the `(win, shift)` pair the shared chord
/// predicate consumes. Either side counts; extras are ignored (allowed), and
/// level sampling makes either press order work.
#[must_use]
pub const fn aggregate_chord_keys(
    win_l: bool,
    win_r: bool,
    shift: bool,
    shift_l: bool,
    shift_r: bool,
) -> (bool, bool) {
    (win_l || win_r, shift || shift_l || shift_r)
}

/// Closed hide-reason vocabulary for the underlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnderlayHideReason {
    Disabled,
    NoSubject,
    Maximized,
    Fullscreen,
    Floating,
    RootLeaf,
    NoGroup,
}

impl UnderlayHideReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NoSubject => "no-subject",
            Self::Maximized => "maximized",
            Self::Fullscreen => "fullscreen",
            Self::Floating => "floating",
            Self::RootLeaf => "root-leaf",
            Self::NoGroup => "no-group",
        }
    }
}

/// Underlay eligibility for one focused subject. `has_group` is the Engine
/// `ActiveGroup` verdict (false covers root-leaf focus); `floating` is a
/// focused window with no tiled membership. Maximized/fullscreen come from
/// the fresh foreground facts. Reasons derive after the verdict, mirroring
/// the border pattern.
pub fn underlay_eligible(
    enabled: bool,
    has_subject: bool,
    has_group: bool,
    maximized: bool,
    fullscreen: bool,
    floating: bool,
) -> Result<(), UnderlayHideReason> {
    if !enabled {
        return Err(UnderlayHideReason::Disabled);
    }
    if !has_subject {
        return Err(UnderlayHideReason::NoSubject);
    }
    if maximized {
        return Err(UnderlayHideReason::Maximized);
    }
    if fullscreen {
        return Err(UnderlayHideReason::Fullscreen);
    }
    if floating {
        return Err(UnderlayHideReason::Floating);
    }
    if !has_group {
        return Err(UnderlayHideReason::RootLeaf);
    }
    // The shared core focus gate agrees on the overlapping flags: a visible
    // non-deleted foreground subject is eligible exactly when neither
    // fullscreen nor maximized suppresses it.
    if !group_focus_eligible(true, false, false, fullscreen, false, maximized) {
        return Err(UnderlayHideReason::NoGroup);
    }
    Ok(())
}

fn visual_of(rect: Rect) -> VisualRect {
    VisualRect {
        x: rect.x as f64,
        y: rect.y as f64,
        w: rect.w as f64,
        h: rect.h as f64,
    }
}

/// Outer rectangle: the Engine-projected group union expanded by the physical
/// gap, border width, and resolved extension on every side, via the shared
/// `tiler-core::visual` expansion. `None` on overflow or degenerate output.
#[must_use]
pub fn underlay_outer_rect(
    union_rect: Rect,
    gap_px: i32,
    width_px: i32,
    extension_px: i32,
) -> Option<Rect> {
    if gap_px < 0 || width_px < 0 || extension_px < 0 {
        return None;
    }
    // Physical pixels throughout: the -1 extension sentinel is resolved
    // against the border width in logical units and scaled before this call,
    // so the resolved outset here is literal.
    let outer = tiler_core::visual::group_underlay_outer_rect(
        visual_of(union_rect),
        f64::from(gap_px),
        f64::from(width_px),
        f64::from(extension_px),
    );
    let x = outer.x.round() as i64;
    let y = outer.y.round() as i64;
    let w = outer.w.round() as i64;
    let h = outer.h.round() as i64;
    if w <= 0
        || h <= 0
        || w > i64::from(i32::MAX)
        || h > i64::from(i32::MAX)
        || x < i64::from(i32::MIN)
        || x > i64::from(i32::MAX)
        || y < i64::from(i32::MIN)
        || y > i64::from(i32::MAX)
    {
        return None;
    }
    if union_rect.w <= 0 || union_rect.h <= 0 {
        return None;
    }
    Some(Rect {
        x: x as i32,
        y: y as i32,
        w: w as i32,
        h: h as i32,
    })
}

/// Fill a BGRA buffer with the premultiplied-alpha underlay colour: straight
/// RGB scaled by `alpha/255` (rounded) with the alpha byte itself, over the
/// whole surface (the DIB is exactly the outer rect). Returns the FNV-1a
/// checksum over the owned bytes in the same pass. Non-premultiplied input
/// would render wrong under `ULW_ALPHA`: layered composition requires
/// premultiplied source.
pub fn paint_fill_argb(pixels: &mut [u8], w: i32, h: i32, color: (u8, u8, u8), alpha: u8) -> u64 {
    let (r, g, b) = color;
    // Straight-to-premultiplied with rounding: (c * a + 127) / 255.
    let premultiplied = |c: u8| ((u16::from(c) * u16::from(alpha) + 127) / 255) as u8;
    let (pr, pg, pb) = (premultiplied(r), premultiplied(g), premultiplied(b));
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut mix = |byte: u8| {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    };
    for y in 0..h {
        for x in 0..w {
            let idx = (y as usize * w as usize + x as usize) * 4;
            if idx + 3 >= pixels.len() {
                continue;
            }
            pixels[idx] = pb;
            pixels[idx + 1] = pg;
            pixels[idx + 2] = pr;
            pixels[idx + 3] = alpha;
            mix(pb);
            mix(pg);
            mix(pr);
            mix(alpha);
        }
    }
    hash
}

/// Echo of parsed underlay flags for argv-consistency verification.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UnderlayArgvEcho {
    pub no_group_underlay: bool,
    pub color: Option<String>,
    pub extension: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn defaults_match_kde_parity() {
        let options = GroupUnderlayOptions::default();
        assert!(options.enabled);
        assert_eq!(
            (options.style.color, options.style.alpha),
            ((0x80, 0x80, 0x80), 0x40)
        );
        assert_eq!(options.style.extension, -1.0);
        assert_eq!(
            render_color_argb((options.style.color, options.style.alpha)),
            "#40808080"
        );
    }

    #[test]
    fn color_requires_aarrggbb() {
        assert_eq!(
            parse_color_argb("#40808080"),
            Ok(((0x80, 0x80, 0x80), 0x40))
        );
        assert_eq!(
            parse_color_argb("#FF112233"),
            Ok(((0x11, 0x22, 0x33), 0xff))
        );
        assert!(parse_color_argb("#808080").is_err());
        assert!(parse_color_argb("40808080").is_err());
        assert!(parse_color_argb("#4080808").is_err());
        assert!(parse_color_argb("#408080800").is_err());
        assert!(parse_color_argb("#zzzzzzzz").is_err());
    }

    #[test]
    fn extension_accepts_sentinel_or_bounded_width() {
        assert_eq!(parse_extension("-1"), Ok(-1.0));
        assert_eq!(parse_extension("0"), Ok(0.0));
        assert_eq!(parse_extension("32"), Ok(32.0));
        assert!(parse_extension("-2").is_err());
        assert!(parse_extension("-0.5").is_err());
        assert!(parse_extension("32.1").is_err());
        assert!(parse_extension("nan").is_err());
    }

    #[test]
    fn hit_test_classifies_move_vs_resize() {
        use MoveSizeKind::{Move, Resize, Unknown};
        assert_eq!(classify_hit_test(2), Move);
        for hit in [10, 11, 12, 13, 14, 15, 16, 17] {
            assert_eq!(classify_hit_test(hit), Resize, "hit={hit}");
        }
        for hit in [0, 1, 3, 4, 5, 9, 18, 0xffff] {
            assert_eq!(classify_hit_test(hit), Unknown, "hit={hit}");
        }
    }

    #[test]
    fn modifier_aggregation_either_side_extras_ignored() {
        // (win_l, win_r, shift, shift_l, shift_r) -> (win, shift).
        for (keys, want) in [
            ((false, false, false, false, false), (false, false)),
            ((true, false, false, false, false), (true, false)),
            ((false, true, false, false, false), (true, false)),
            ((false, false, true, false, false), (false, true)),
            ((false, false, false, true, false), (false, true)),
            ((false, false, false, false, true), (false, true)),
            ((true, false, false, true, false), (true, true)),
            ((false, true, true, false, false), (true, true)),
            ((true, true, true, true, true), (true, true)),
        ] {
            let (wl, wr, s, sl, sr) = keys;
            assert_eq!(aggregate_chord_keys(wl, wr, s, sl, sr), want);
        }
    }

    #[test]
    fn eligibility_suppression_matrix() {
        let frame_ok = || underlay_eligible(true, true, true, false, false, false);
        assert!(frame_ok().is_ok());
        assert_eq!(
            underlay_eligible(false, true, true, false, false, false),
            Err(UnderlayHideReason::Disabled)
        );
        assert_eq!(
            underlay_eligible(true, false, true, false, false, false),
            Err(UnderlayHideReason::NoSubject)
        );
        assert_eq!(
            underlay_eligible(true, true, true, true, false, false),
            Err(UnderlayHideReason::Maximized)
        );
        assert_eq!(
            underlay_eligible(true, true, true, false, true, false),
            Err(UnderlayHideReason::Fullscreen)
        );
        assert_eq!(
            underlay_eligible(true, true, true, false, false, true),
            Err(UnderlayHideReason::Floating)
        );
        assert_eq!(
            underlay_eligible(true, true, false, false, false, false),
            Err(UnderlayHideReason::RootLeaf)
        );
    }

    #[test]
    fn eligibility_agrees_with_core_focus_gate() {
        // Whenever the underlay verdict is Ok, the shared core focus gate on
        // the overlapping flags agrees; whenever core suppresses, so do we.
        for bits in 0..4u32 {
            let maximized = bits & 1 != 0;
            let fullscreen = bits & 2 != 0;
            let core = group_focus_eligible(true, false, false, fullscreen, false, maximized);
            let verdict = underlay_eligible(true, true, true, maximized, fullscreen, false).is_ok();
            assert_eq!(verdict, core, "bits={bits:02b}");
        }
    }

    #[test]
    fn outer_expands_union_by_gap_width_extension() {
        // Union 100x80 at (10,20), gap 2, width 4, extension 3: pad 9.
        assert_eq!(
            underlay_outer_rect(rect(10, 20, 100, 80), 2, 4, 3),
            Some(rect(1, 11, 118, 98))
        );
        // Zero pad is the identity.
        assert_eq!(
            underlay_outer_rect(rect(10, 20, 100, 80), 0, 0, 0),
            Some(rect(10, 20, 100, 80))
        );
        // Degenerate or negative inputs fail closed.
        assert_eq!(underlay_outer_rect(rect(10, 20, 0, 80), 2, 4, 3), None);
        assert_eq!(underlay_outer_rect(rect(10, 20, 100, 80), -1, 4, 3), None);
    }

    #[test]
    fn fill_raster_is_premultiplied() {
        // Default grey at 0x40 alpha: 0x80*0x40/255 rounds to 0x20.
        let mut pixels = vec![0u8; 2 * 2 * 4];
        let checksum = paint_fill_argb(&mut pixels, 2, 2, (0x80, 0x80, 0x80), 0x40);
        assert_eq!(
            &pixels[0..4],
            &[0x20, 0x20, 0x20, 0x40],
            "BGRA premultiplied"
        );
        assert_eq!(pixels.len(), 16);
        // Checksum is stable and content-sensitive.
        let mut other = vec![0u8; 2 * 2 * 4];
        let same = paint_fill_argb(&mut other, 2, 2, (0x80, 0x80, 0x80), 0x40);
        assert_eq!(same, checksum);
        let mut opaque = vec![0u8; 2 * 2 * 4];
        let different = paint_fill_argb(&mut opaque, 2, 2, (0x80, 0x80, 0x80), 0xff);
        assert_ne!(different, checksum);
        assert_eq!(&opaque[0..4], &[0x80, 0x80, 0x80, 0xff]);
    }
}
