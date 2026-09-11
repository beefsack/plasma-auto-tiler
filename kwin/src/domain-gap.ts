// Bounded gap restoration: historical fixed 8px value, valid under 0..64 validation.

export const DOMAIN_GAP = 8;

// Distinct outer domain inset adjacent to DOMAIN_GAP: Rust owns the inset,
// KWin only carries this fixed 8px value, valid under 0..64 validation.
export const OUTER_DOMAIN_GAP = 8;
