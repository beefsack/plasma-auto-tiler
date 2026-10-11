# Windows Foreground And Acceptance Closure

## Goal And Scope

- Diagnose and clear the cloaked Explorer foreground blocker, then close the
  bounded fullscreen and per-window float acceptance gaps. KDE remains the
  behavior reference; parity item 6 is outside this change.
- Current authority permits desktop window control, synthetic hooks, overlays,
  exact project-owner crash probes, narrow shell-window closure and, if needed,
  verified Explorer restart. Preserve the hosting Terminal process tree.
- No registry/policy writes or dependency installs. Every run ends with no
  project actors, overlays, ledger/requests or hidden residue; arranging 1,
  pen visualization 35, hosting Terminal alive.

## Units And Acceptance

1. Bounded foreground diagnosis and narrow recovery; verify whether cloaked or
   shell foreground incorrectly suspends tiling. Repair only reproduced defects
   and make fixtures report environment precondition failures explicitly.
2. Independently review product/live changes; native locked four-package build,
   test, strict all-target Clippy, rustfmt and relevant harness parse/mock gates.
   Commit/push accepted units and require hosted Windows/Rust/KWin/shell CI.
3. Rerun fullscreen repeat/focus/refusal/held-underlay, retained workspace,
   crash/watcher/restart and approved-app cover/exit stages.
4. Rerun float placement/reflow, focus/repeats, geometry retention, visuals/band,
   direction/send, workspace, overlay refusal, recovery/restart and born-hold
   stages. Fix minimal defects with gates and independent review.
5. Update archived acceptance and durable decisions with observed evidence.
   After reasonable effort, explicitly transfer unattainable checks to the user.

## Verification And Evidence

- Start: clean main `5dfc9aa`, equal to origin/main, 2026-10-03.
- Existing evidence and limits: `windows-fullscreen.md`, `windows-float.md`,
  and the corresponding `docs/decisions.md` sections.
- Synthetic evidence proves only automated observations; physical input,
  appearance/feel and other output/DPI arrangements remain user-owned.
- Local receipts stay under ignored `target/`; records retain concise artifact
  identities, observed effects, limits and independently checked cleanup.

## Outcome

- Diagnosis/recovery: fresh reads found the same Explorer-owned captionless,
  topmost monitor-covering ApplicationFrameWindow, now uncloaked, with no hosted
  child. Its precise shell purpose and activation refusal mechanism remain
  unidentified. WM_CLOSE and graceful termination left it intact; exact-identity
  forced Explorer exit plus out-of-Terminal-tree relaunch cleared it. New taskbar
  visible, shell handle present, hosting Terminal creation identity intact.
- Receipt: `target/windows-foreground/clean-end-audit.json`; zero project actors
  or ledger/requests, arranging 1, pen 35.
- Source defect: foreground veto lacks the cloak check used by window admission;
  a cloaked captionless covering frame can therefore suspend tiling. Minimal
  fresh DWM cloak correction now excludes cloaked cover, preserves unreadable
  fail-closed and real fullscreen gates, and adds a bounded boolean diagnostic.
  Fixtures explicitly record environment precondition failures with fresh facts.
  No shell-specific exception inferred from the unidentified frame.
- Independent review accepted the product path; two fixture diagnostic findings
  (missing native helper installation and signed-style conversion) repaired and
  independently verified with read-only native probes. Both diagnostics report
  an ordinary uncloaked captioned foreground after recovery.
- Lead locked four-package build/test/strict all-target Clippy, rustfmt,
  whitespace and both fullscreen/float mocks pass after the repairs. Unit 1
  accepted before the bounded live stages.
- Unit 1 shipped as `3f70136`; hosted Windows/Rust/KWin/shell
  [CI 37072709516](https://github.com/beefsack/omnitiler/actions/runs/37072709516)
  green. Fullscreen bounded stages added held-repeat evidence but did not close
  the full matrices; float admission failed before any toggle. Archive follow-up
  tables retain exact observed scope, limits and local artifact identities.
- Recurring shell takeover required one additional authorized exact Explorer
  restart; taskbar and Terminal verified. Unexpected maximize bits and mass cloak
  reads arose later; do not infer their cause from absence of explicit setters.
- Independent ownerless probes reproduce a fresh helper cloak 0->2 after native
  move, exact geometry/style intact, with cloak 2 persisting after geometry
  restoration. Mechanism unknown. Receipts:
  `target/windows-float/ownerless-20261003-085453-15412/` and
  `target/gate-probe/20261003-091317-33692/`.
- Final fixtures use one shared disposable-helper gate before every owner/stage;
  environment failures are explicit, not ambiguous convergence partials. Gate
  requires cloak 0 before/after/restore and never counts unreadable -1 as cloak.
  Actual consumer verification: fullscreen `20261003-092018-35968`, float
  `20261003-092035-18828` abort before any owner, with exact helper cleanup.
- Initial fixture attempt rejected by independent review (XYWH/LTRB mismatch,
  unreadable attribution, polluted acceptance subject); replaced rather than
  shipped. Review then found receipt collision on clean hosts and unchecked
  restored cloak; both corrected and independently verified. Six executed mock
  gate cases, four harness parse/mock checks and whitespace gates pass. Earlier
  probe quoting/loader errors were pre-effect tooling failures, not product proof.
- Remaining fullscreen and all float behavior rows transferred to user-owned
  acceptance after bounded effort, as authorized. No new provisional product
  decision; existing fullscreen metadata and crash-topmost decisions stand.
  No parity item 6 work performed.
- Lead read-only audit 2026-10-03 09:23:27 +10:00: zero project actors or native
  surfaces (including hidden helpers), ready false, ledger/stop/workspace requests
  absent, arranging 1, pen 35, taskbar visible, shell present, hosting Terminal
  same creation. All Workers completed.
- Next action: user restores normal desktop state and passes the ownerless move
  gate, then reruns bounded stages and physical approved-app dogfood. Full live
  acceptance remains open; do not mark parity items 4/5 fully accepted.
