# Learned size limits - reconciliation phase 2 (parked 2026-09-28)

Status: parked by the user (2026-09-28, option A) pending multi-output test-system evidence. The
unaccepted candidate is preserved on branch `wip/learned-size-limits` (commit
"WIP: learned size limits (reconciliation phase 2, parked)"); its full
change note is there.

## Candidate summary

- Rust: optional per-request `learned_max_sizes` caps, projected separately
  from native hints; feasible caps give spare extent to siblings, native
  maximums unchanged. About +257 production lines.
- KWin: per-window cap learning/expiry from completed writes. About +517 net
  production lines; interim three-strike acceptance kept as fallback.
- Not accepted: infeasible or ignored caps can be re-promoted and resent (no
  reply feedback), learned/expired logs are uncorrelated, and cap state can
  survive a changed allocation. Exceeds the complexity rule for its value.

## Why parked

The recorded unexplained shortfalls are from the multi-output test system, not the
single-output test system (test-system trace `plasma-auto-tiler-dev.uE1S5n.log` shows only
1-2 px work-area settling). DP-6 writes of `8,52,2032,1092` were observed at
`1920x1036`, and Ghostty-class requests of height 1092 held 1036. 1920x1036
equals HDMI-A-2's work area (`2048,116,1920,1036`), which suggests the window
is being constrained to the other output (our output assignment or bounds, or
KWin's per-output constraint) rather than a client-chosen limit. Unproven; the
`p13` 36 px shortfall is not explained by this.

## Next action

On the multi-output test system, capture a `just dev trace` with one tall tiled window on DP-6 and
confirm its output, bounds and KWin constraints at the shortfall. If it is an
output mismatch, fix that root cause and re-evaluate whether phase 2 is
needed. Resume from the branch only if a genuine client-held limit remains.
