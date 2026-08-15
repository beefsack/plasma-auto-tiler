# State: Drag-and-Drop Reorganisation

- Status: static implementation is complete; live acceptance is pending
  user-run evidence.
- Completed: `unit-01` through `unit-05` in [plan.md](plan.md), including
  finish-only reflow, per-signal attach diagnostics, and static verification.
- Blocker: static tests cannot establish KWin signal delivery, drag reflow, or
  Esc-cancellation behavior. No live acceptance is claimed.
- Next action: obtain user journal evidence under
  [live-kwin-testing.md](../../live-kwin-testing.md) that distinguishes
  attachment from signal delivery and confirms the post-drop behavior.
