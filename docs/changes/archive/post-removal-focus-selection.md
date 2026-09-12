# Post-Removal Focus Selection

## Goal

Ground and align portable `cosmic_v1` source-domain focus after a tiled window
is removed, including send-to-workspace, against `cosmic-comp`
`81cd5fdbaa41c3973369ae85bccf829137836e20`.

## Scope

- Compare the audited source focus fallback with the portable Session and add
  focused regression coverage for any faithful behavior changed or confirmed.
- Record the established durable behavior in `docs/decisions.md` and remove the
  resolved named parity gap from the backlog.

## Non-Goals

- KWin adapter delivery, live KWin/Plasma work, workspace-mapping selection,
  and any change outside portable behavior.

## Acceptance

- Source citations establish focused/unfocused removal, send, fallback order,
  and empty-source behavior without unsupported inference.
- Portable behavior matches the established source behavior with durable tests.
- Workspace mapping is reported only.

## Approach

1. Audit upstream removal and focus code.
2. Audit and test the portable implementation against the established rule.
3. Update durable records, verify, commit, and push.

## Evidence

- Upstream audit found source focus fallback is focus-stack recency, then the
  workspace's first mapped element, then fullscreen, rather than a structural
  sibling or parent preference. Send with `direction=None` does not call
  `set_focus`; it removes the source element and maps it into the target.
- Portable `Session` now retains source-domain tiled MRU focus through lifecycle
  commits and ordinary activation. Focused removal and send select the remaining
  source stack top; unfocused removal preserves focus; an empty source clears
  the tiled-only focus. Fullscreen/mapped fallback remains unselected because
  the portable focus type can name tiled leaves only.

## Outcome

- Durable source citations: `workspace.rs` `unmap_element` 641-685 removes the
  element from every focus stack; `focus/mod.rs` 700-751 falls back through the
  stack, mapped workspace elements, then fullscreen. `actions.rs` 284-311 and
  `shell/mod.rs` 3448-3556 establish that Send does not set target focus.
- `tests/session_lifecycle.rs` and `tests/session_send_to_workspace.rs` cover
  MRU-over-sibling removal, unfocused removal, empty-source clearing despite
  another domain, and source-retained send focus.
- `cargo fmt --check`, `cargo check --all-targets`, `cargo clippy --all-targets
  -- -D warnings`, and `cargo test --locked --lib --tests` pass without live
  session access.
