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
- Existing evidence and limits: `archive/windows-fullscreen.md`,
  `archive/windows-float.md`, and the corresponding `docs/decisions.md` sections.
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
  or ledger/requests, arranging 1, pen 35. Activation needs fresh proof.
- Source defect: foreground veto lacks the cloak check used by window admission;
  a cloaked captionless covering frame can therefore suspend tiling. Minimal
  fresh DWM cloak correction now excludes cloaked cover, preserves unreadable
  fail-closed and real fullscreen gates, and adds a bounded boolean diagnostic.
  Fixtures explicitly record environment precondition failures with fresh facts.
  No shell-specific exception inferred from the unidentified frame.
- Independent review accepted the product path; two fixture diagnostic findings
  (missing native helper installation and signed-style conversion) repaired and
  independently verified with read-only native probes. Both diagnostics report
  an ordinary uncloaked captioned foreground after recovery; activation itself
  remains for the bounded live stages.
- Lead locked four-package build/test/strict all-target Clippy, rustfmt,
  whitespace and both fullscreen/float mocks pass after the repairs. Unit 1
  accepted; bounded live acceptance follows on the shipped artifact.
