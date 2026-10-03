# Windows send split axis

Status: complete, 2026-10-03. Implementation: `c4a837b`.

## Goal and acceptance

- Resolve the 2026-10-03 dogfood report, checking minimum-size feasibility
  before changing placement. A tall target's default split is vertical.
- Compare Windows send and ordinary admission with the KDE/shared Engine route;
  fix the smallest demonstrated defect without inventing platform behavior.
- Exact-scenario regression coverage, native four-package gates, hosted CI and
  a normal-desktop owned-window live check with verified clean recovery.
- No other backlog work; backlog updates remain Orchestrator-owned.

## Bounded units

1. Trace admission/send and reproduce the actual failure.
2. Implement the causal fix with focused regression/adapter fixtures.
3. Review relevant behavior, run native and live checks, publish and check CI.
4. Record outcome, promote any durable decision and archive this note.

## Investigation evidence

- Nominal public Engine events on 2560x1440 already produce
  `H[W1 V[W2 W3]]`; ordinary third-window admission also splits vertically.
- Dogfood `run-01dd52e26d954c9c.log`, act-106 then act-109: send away and
  back without target reconciliation leaves `last_active` pointing at the
  departed mover. Send misses that leaf and wraps the whole root using the
  wide output's Horizontal axis. Both platforms use this shared Engine route.
- Fresh act-109 visible physical minima are 401x246, 864x617 and 582x95
  (matching Notepad, Paint and Terminal roles). A nested Vertical split fits;
  hints explain the resulting 401/864/1263 columns, not axis selection.
  Current outer track dimensions are not in the trace.
- Prior probes all passed but their send-away case reconciled the target before
  sending back. Temporary probes were removed; the retained regression covers
  send-away/return with no target reconciliation and the logged minima.

## Implementation and verification

- Shared `session/ops/workspace.rs` now resolves valid destination focus history
  after an invalid remembered leaf, before the existing no-focus root fallback.
  The same leaf supplies the projected long-edge axis and insertion target.
  No Windows-specific policy or minimum-feasibility axis search was added.
- `observation_send_r4_step3.rs`: regression fails before the fix with
  `H[H[Notepad Paint] Terminal]`, passes with `H[Notepad V[Paint Terminal]]`,
  checks minimum-feasible geometry, assignment/source retirement and exact
  topology stability on reconciliation. It uses ordinary admission to create
  the causal focus state rather than reproducing the live spatial shares.
- `kwin/tests/workspace-send-engine-fixture.test.ts`: real persistent Planner
  fixture exercises stale return-send, vertical geometry, membership and follow.
  Native locked four-package build/test/strict all-target clippy, rustfmt and
  whitespace gates pass. Independent review accepted the repair and required
  this KWin fixture plus the corrected placement documentation.
- Hosted Windows/Rust/KWin/shell CI passed for `c4a837b`, including the new
  KWin Engine fixture and typecheck:
  [CI run 37094726063](https://github.com/beefsack/plasma-auto-tiler/actions/runs/37094726063).

## Current-artifact live evidence, 2026-10-03

- Report: `C:\Users\beefs\AppData\Local\Temp\opencode\`
  `ws-exact-20261003-134921-33236/ws-exact-report.json`.
  Owner log: `%LOCALAPPDATA%/plasma-auto-tiler/session-1/`
  `run-01dd52ea2dcb23be.log`. Source `61a09bc` plus this core repair;
  owner SHA-256 `19B8BE7B8E27453B157C797225F24798C6CFF5B281F29DA1A19B7A684C395555`.
- Normal desktop verified with visible taskbar and physical 2560x1380 work area.
  Fresh read-only queries at DPI 120: Notepad outer415x253 / visible401x246;
  Paint outer880x625 / visible864x617; Terminal outer598x103 / visible582x95.
  One existing top-level window per process role was sampled, not all instances.
- Three owned helpers: away at tick5, back at tick9, no intervening ws1 select
  or reconcile (tick8 polled ws2 only). Tick11 physical visible-frame desired
  and readback match: left `(8,8,1268,1364)`, top-right `(1284,8,1268,678)`,
  mover bottom-right `(1284,694,1268,678)`. Helper minima150x39 are nonbinding.
  The report's helper-inspect arrays are logical outer LTRB, not physical XYWH;
  physical geometry claims use the owner log. No physical user-input acceptance
  is inferred from this injected helper proof.
- Temporary harness had three pre-effect errors and two partial live runs with
  oracle/teardown defects before the final pass. Both partial runs recovered by
  exact-owner stop/restore; no product semantic failure. The corrected harness
  remains temporary, outside the repository.
- Final stop/restore and audit at `2026-10-03T03:49:32Z`: zero project actors,
  helpers or overlays, no hidden app window or ledger/stop/workspace residue,
  arranging raw1 and pen raw35. A subsequent read-only check confirmed actor
  and request absence. Physical Notepad/Paint/Terminal return-send remains
  user-owned; no new provisional product decision was needed.

## Outcome and succession

- Minimums did not force the reported axis. The invalid remembered target was
  a shared-core defect; destination focus-history fallback repairs it on both
  KDE and Windows, retaining minimum-aware projection and no-focus fallback.
- No implementation action remains. Physical ordinary-app return-send is a
  user-owned confirmation. Local live evidence is not included in Git.

## Live scope

- Standing user authorization covers this normal desktop, owned helpers and
  approved apps, input hooks, geometry/hiding and overlays. Preserve the agent's
  hosting Terminal process tree. No registry/policy writes.
- Confirm taskbar/normal desktop before launch; no synthetic Win+G or Win+F11.
- Stop/restore and verify no project actor, overlay, ledger or hidden window;
  arranging 0x0082 = 1 and pen visualization 0x201E = 35.
