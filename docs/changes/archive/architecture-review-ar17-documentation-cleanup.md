# AR17 Documentation and comment cleanup

## Goal and scope

Keep `docs/decisions.md` as the current decision register. Move historical evidence to matching change notes, remove entries proven obsolete, and replace process-history comments in `crates/`, `kwin/src/`, and `kwin/native-effect/` with current explanations. Preserve all active decision substance, approval attribution, dates, verbatim approval quotes, executable code, assertions, and log strings. No live testing, toolchain changes, or edits to the architecture review or principles.

## Acceptance and approach

- Compare every old decision with the edited register; retain ambiguous decisions and list them.
- Record original and final line counts, evidence destinations and proof for removed entries.
- Show remaining process-history comment tokens and explain any retained identifiers; confirm code-file diffs affect comments only.
- Verify Rust tests, KWin typecheck/tests/build, `just check-portable`, and backlog links.
- Obtain an independent entry-by-entry Worker review before completion.

## Units

1. Reconcile the decision register with the tree and existing change notes; move evidence and report a source-to-destination map, obsolete-entry proofs and ambiguity.
2. Clean code comments without changing executable lines or log output.
3. Independently compare the original and final decision entries; resolve concrete findings.
4. Integrate, verify, remove the completed backlog item, and archive this note.

## Outcome and evidence

- `docs/decisions.md`: 1069 -> 990 lines. No complete decision entry deleted: no candidate was proven obsolete without ambiguity. Binding constraints, approval dates/attribution, and verbatim approval quotes remained in place; independent entry-by-entry Worker review confirmed no decision substance lost or altered after resolving three initially missing evidence destinations.
- Historical evidence destinations: active-border observation -> `archive/native-active-border-hot-apply.md`; gap reload -> `archive/window-gap-configurability.md` and `archive/planner-dbus-activation.md`; confirmed Planner recovery -> `archive/planner-dbus-activation.md`; carrier/preflight and Python dependency status -> `custom-tile-runtime.md`; background tiling -> `background-tiling.md`; hotplug -> `architecture-review-ar6-workspaces.md`; shortcut KCM -> `shortcut-override.md`; group-effect source citations -> `archive/active-group-highlight-design.md`; Nix/session pending-live enumeration -> `archive/nix-current-host-delivery.md`; tray live/manual observations -> `archive/tray-managed-live-acceptance.md`; edge-drag live/static evidence -> `edge-drag-share-adjustment.md`; POC3 pilot limitations -> `archive/poc3-disposable-rust-actuation.md`.
- Retained ambiguous decisions: the standing `DescribeAdvisoryPlan` authorization has no matching current executable journey; the edge-drag decision still names the former standalone `plasma-auto-tiler-drag-oracle` plugin although `kwin/native-effect/CMakeLists.txt` builds the unified active-border effect hosting its endpoint. Neither authorization nor plugin-name reference was silently reinterpreted.
- Comment-only code diff across `crates/`, `kwin/src/`, and `kwin/native-effect/`: `git diff --unified=0` filtered for added/removed non-comment lines returned none; `git diff --check` passed. Remaining history-token grep hits are four `Phase 1/2` comments for actual runtime ordering (two Planner name-presence checks, two shortcut migration steps); COSMIC R1-R4 identifiers remain by design. No code, assertions, or log strings changed.
- `cargo test --workspace` (also repeated after final comment edits), `npm --prefix kwin run typecheck`, `npm --prefix kwin test` (732 passing), `npm --prefix kwin run build`, and `just check-portable` passed. All 47 local Markdown links in `docs/backlog.md`, including both decision anchors, resolved; modified documentation links resolved as well. No live testing.
