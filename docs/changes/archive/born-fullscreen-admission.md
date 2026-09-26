# Born-Fullscreen Admission

## Goal and acceptance

- A window first observed fullscreen is excluded from tiled allocation throughout its first fullscreen lifetime. Siblings fill the space; removal leaves no residue. Its first non-fullscreen observation receives normal fresh admission; later fullscreen retains its tile and skips geometry writes. Existing tiled fullscreen behavior stays unchanged.
- Startup and hidden/background observations obey the same rule. No borderless heuristic.

## Approach and bounded units

- Keep a KWin-local per-window admission marker and translate only born-fullscreen windows to the existing floating observation sent to Rust; never mark them as intentional native floats. Resolve the marker permanently on the first non-fullscreen observation; clean it on removal and adapter reset.
- Verify observation and admission integration first, then focused foreground/hidden regressions, then independent checks of adjacent paths and complete static checks. No Rust protocol/engine edits and no live KWin testing.
- Preserve admission-time maximize clearing on first non-fullscreen observation if still maximized. Startup fullscreen is a first fullscreen observation.

## Evidence

- Investigation: existing Rust convergence treats wire `floating` newcomers as slotless exceptions and admits them fresh on the first `floating=false` observation. Fullscreen and maximize are KWin-local overlays. KWin intentional float state must remain independent.
- First green point: `npm test --prefix kwin` 752/752 and `npm run typecheck --prefix kwin` pass; regression groups cover foreground, hidden startup, close, later tiled fullscreen, and admission-time maximize clearing. Diff review identified a repeated-observation exception-retention edge case to correct before final acceptance.
- The held exception now survives repeated same-window observations after applied replies; a focused regression checks sibling drift without a new slot. Markers are pinned to native object identity and removed on exact native removal, not per-domain relocation. Review found no confirmed integration issues; normalized-id reuse before old applied evidence prunes and missed removal signals are residual low-probability identity/lifetime risks.
- Final offline verification after correction and durable documentation: `npm test --prefix kwin` 753/753 pass, `npm run typecheck --prefix kwin` pass, `git diff --check` pass. Rust untouched. No live KWin/Plasma testing or commit. User dogfood: open a game already in KWin fullscreen beside existing tiles, verify siblings fill the usable tiling area with no empty slot; exit fullscreen and verify fresh tile placement, then enter/exit fullscreen on the newly tiled game and verify its tile allocation remains. Optionally close the game before first exit and verify no gap remains.
