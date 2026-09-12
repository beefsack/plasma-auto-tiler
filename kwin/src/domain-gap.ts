// Bounded gap restoration: historical fixed 8px value, valid under 0..64 validation.

export const DOMAIN_GAP = 8;

// Distinct outer domain inset adjacent to DOMAIN_GAP: Rust owns the inset,
// KWin only carries this fixed 8px value, valid under 0..64 validation.
// Effective COSMIC work-area edge margin outer+inner=8 from raw theme (0,8): keep 8, not raw 0.
export const OUTER_DOMAIN_GAP = 8;
