# Reference WM columns and Hyprland source outcomes

## Goal and scope

- Add sway, qtile and awesome to every reference outcome section, initially TBD, with explicit source/config profiles.
- Source every Hyprland outcome under the pinned default Dwindle profile; preserve unsupported fixture, native-response, timing and visual outcomes as reasoned TBD.
- Preserve COSMIC, Ours, Variant and product decisions; read upstream clones only. No live testing or dependency changes.

## Acceptance and approach

- Use consistent minimally disruptive column order and source evidence keys with pinned file:line references.
- Delegate bounded edits/investigation to muse-spark Workers sequentially; Lead reviews diffs and evidence.
- Commit/push structural columns separately, then complete Hyprland evidence as a second commit.
- Stage only intended documentation; never stage user-owned devenv.nix.
- Verify section column counts, protected cells, evidence coverage and git diff --check before commits.

## Units

1. Structure and new-WM profiles.
2. Hyprland insertion, movement and workspace rows.
3. Hyprland float, maximize and startup rows.
4. Hyprland close, groups, outputs, drag and controls rows.
5. Lead evidence review, reconciliation, accounting and completion.

## Outcome

- Structure accepted: 12 section tables, 58 rows, three TBD columns before Ours; existing cells preserved. Profiles use shipped sway config, qtile Columns and awesome floating. Source defaults inspected; git diff --check passes.
- Structure committed and pushed as 098422c, Add sway, qtile and awesome reference columns.
- Hyprland accepted at local HEAD 19fb395d45314960e6f79f17994a84094f1cd4f6 (2026-10-04); older ae50c4d6 citations/profile consistently repinned. All 58 cells assessed: 56 source-cited, two wholly TBD (R-WS-07 external Alt+Tab switcher unspecified; R-FLT-05 owner restart/persistence unspecified). Seven have no TBD; 49 source-cited cells retain exact-fixture or live-only TBDs.
- Independent source review and Lead reconciliation corrected existing-group auto-join, tiled pin refusal, the return-anchor claim (R-WS-02 retains both C and A), and floating-return admission (R-WS-05 stays floating). No rows added or product decisions changed.
- Source gotchas: directional moves carry a focal-point override, unlike ordinary send/open; preserve_split=false recalculates geometry axes; square admission orders by y while recalc selects H. Missing binary embeddings, cursor/monitor fixtures, native responses and owner-specific equivalents remain explicit TBDs.
- Lead verification: 12 consistent 14-column section tables; 58 unchanged scenario IDs; all non-Hyprland cells byte-identical to 098422c; 22 Hyprland evidence keys resolve; no old ae50c4d6 pin; git diff --check clean. No live testing. User-owned devenv.nix remains unstaged.
- Sequential direct muse-spark Workers and one independent review completed; no nested delegation required.

## Handover

- Orchestrator backlog advancement: reference column expansion and Hyprland source pass complete; advance to sway source outcomes under the recorded shipped profile, then the remaining requested WMs in later parts.
- Exact next action for this change: none. Next session: source all sway cells using its local HEAD and the same evidence/fixture conventions.
