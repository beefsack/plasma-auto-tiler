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
- Hyprland work in progress at local HEAD 19fb395d45314960e6f79f17994a84094f1cd4f6 (2026-10-04); older ae50c4d6 citations/profile will be reconciled to the source actually read.
