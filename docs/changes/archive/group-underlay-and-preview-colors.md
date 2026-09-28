# Group Underlay and Drop Preview Color

## Goal

User decisions 2026-09-28: replace the Meta-held group outline with a grey
filled rectangle below the group's windows; let users configure its colour
(including alpha) and extension beyond the window-border outer edge, defaulting
to the configured border width. Make the underlay slide with the workspace,
while retaining all existing visibility and maximize/fullscreen suppression.
Expose the drop-target preview colour including alpha on the unified settings
page, defaulting to today's look. All settings hot-apply through the effect's
existing reconfigure path and effect `kwinrc` group.

## Scope and acceptance

- Preserve existing border and drop-preview geometry, effect group policy,
  shortcut semantics, and all existing settings keys/defaults. No new
  controller coordination, fences, or optional-tool build gates.
- Native build/CTest, KWin tests/typecheck, Rust tests/fmt/strict clippy,
  relevant shell suites and staging pass offline. Provide line deltas and a
  concise user-owned laptop `just dev` live-check table. No live agent testing.
- `docs/backlog.md`, `devenv.nix`, and research review are untouched.

## Mechanism and decision boundary

- Active border is a child of the focused `WindowItem` with Z=-1; the Slide
  effect translates window paint data and the item's whole subtree. The group
  outline is instead a scene overlay painted after windows, so it remains
  stationary. The user's lower-layer hypothesis is not the slide mechanism.
- Orchestrator decision applying the user's beneath-all requirement: anchor
  below the lowest-stacked group member, re-anchor on stacking or membership
  change; reject the active-window anchor. Default underlay colour is
  `#40808080` (translucent grey). Accept painting over the edge of a non-group
  window stacked below the anchor where the extension overlaps it.
- Orchestrator authorization: add one `SetGroupHighlight` field with the
  already-validated group member IDs (the focused-window identifier kind),
  without logging raw IDs. Native effect can then identify the lowest member
  with public KWin stacking order; re-anchor on stack/membership changes.
- Orchestrator decision: raise the setter payload limit to the existing 64 KiB
  Planner reply bound, with a plain member list and no new storage machinery,
  fences, or fallbacks. Update the existing limit test; no new large-payload
  harness. No size-dependent suppression within the accepted reply bound.
- Orchestrator size interpretation: extension in px beyond border outer edge;
  unset default follows configured border width.

## Bounded units

1. Apply the independent drop-preview colour setting to the existing effect
   config, unified UI and preview image path; keep default #2A82DA at alpha 64.
2. Carry the already-validated group member IDs across the existing setter,
   then choose the lowest stacked member with public KWin APIs and replace
   the group visual, preserving all policy gates.
3. Verify offline, promote user and Orchestrator decisions to
   `docs/decisions.md`, then archive this note (complete).

## Outcome and evidence

- The script forwards one validated member-ID list in the existing setter;
  Rust validates the 9-field payload under the shared 64 KiB bound and keeps
  the POD state unchanged. C++ extracts IDs only after Rust accepts, anchors a
  filled `ImageItem` to the lowest painted member in public KWin stacking
  order, and re-anchors on stack, member-visibility, and membership changes.
  Anchor frame changes remap the Rust union; no extra transport, timer or
  private API. The drop-preview remains above windows with its configurable
  ARGB fill, defaulting to the original blue/64-alpha appearance.
- KConfigXT stores both colours and extension in the existing effect group;
  `-1` means "Match border width" and explicit zero means no extra extension.
  Existing border, script gaps, shortcut routes and keys/defaults are untouched.
- Source/history: commit `ba354ca` and host KWin 6.7.5 `slide.cpp` show that
  window-item parenting, not a lower scene layer, supplies slide movement.
  Host-matched `just build-native-effect` stages the effect and both KCMs;
  final native build and CTest 29/29 pass. KWin
  typecheck and 800/800 tests, Rust workspace tests (630), fmt and strict
  clippy passed. Shell suites: dogfood-install 572/0, dev-loop-split 380/0,
  dev-native-effect 163/0, nix-host-kwin-build 93/0, build-kpackage pass.
  Flake native-effect check built. `git diff --check` passes. Production delta
  +460/-84, behavior/static tests +360/-40. No agent ran live KWin/Plasma
  testing.
- Accepted residual: the extension may paint over a non-group window's edge
  if that window is stacked below the anchor. Native visual output, exact
  alpha, slide appearance and KCM hot-apply require the user's laptop check.

## Laptop live check (user-owned)

| Step (`just dev` after delivering rebuilt native effect in a fresh Plasma session) | Expected | Red flag |
| --- | --- | --- |
| Nest 2+ tiled windows, hold Meta over a focused member; release Meta | Filled translucent grey rectangle below every group window; outer edge at group union + border gap + twice border width by default; hide on release. `[kwin] plasma-auto-tiler:group-highlight:dispatch correlation=<id>` then `[kwin] plasma-auto-tiler:group-highlight:setter-submitted correlation=<id> revision=<n>` | Old outline, underlay over a group surface, wrong extension or lingering after release; setter line alone is not proof of pixels |
| From unified Settings, change underlay colour/alpha and extension, Save; then change border width with extension set to Match border width | Underlay colour/transparency and edge update live, including border-width-linked default; explicit 0 leaves no extra extension | Old colour, opaque fill, static 3 px default, no update until session restart |
| Change drop-target preview colour/alpha and Save, then drag an eligible tiled window | Preview uses new transparent colour above windows; `[kwin] plasma-auto-tiler:route-diag:drag-preview-shown correlation=<drag-N>` / `drag-preview-cleared ...` on end | Default blue despite Save, preview behind windows, uncleared preview |
| Hold Meta while changing active group or stacking order and slide between workspaces | Underlay follows lowest visible member and slides with its workspace like active border | Underlay static on screen, jumps above members, persists on old workspace |
| Fullscreen and each native maximize axis on the active window; restore | Both active border and group underlay hide immediately, then return for eligible normal focus. `[kwin] plasma-auto-tiler:active-border:visible vis=0 reason=<fullscreen|maximized>` | Either visual remains while maximized/fullscreen or requires manual reload |

`[kwin]` script lines are dispatch/queued evidence, not confirmation of native
composition. No agent performed live KWin/Plasma testing.

## 2026-09-29 Laptop Follow-up

- User saw the underlay only on workspace 2 in `FeTnf4`, then nowhere after a
  `just dev` restart in the same Plasma session (`y3jVs3`). The script kept
  submitting group setters; those lines do not prove native acceptance.
- The group effect previously reused the fixed Planner `kwin-plan-adapter` /
  `plan-1` stream across script restarts. Its Rust high-water mark survives
  display clear while the effect stays loaded; the old trace reached revision
  60 and the restarted script reached only 19. The follow-up fix gives only
  the group setter a per-script-instance generation; Planner identity and
  tiling behavior stay unchanged. Native redacted setter and transition logs
  now expose stale/focus/parse/anchor/Meta outcomes for the workspace-specific
  observation, whose exact cause the original traces cannot prove. See
  [group-underlay-restart-visibility](group-underlay-restart-visibility.md).
