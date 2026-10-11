# Nested live-test proposal and workspace defaults

- Status: complete and archived 2026-10-07.
- Goal: document single-output-sized nested/VM reference environments and correct workspace send/follow comparisons to shipped bindings.
- Scope: research proposal, reference workspace outcomes, consensus, and R-WS-01 functional requirement.
- Non-goals: implementation, live testing, builds, dependency changes, governance files, commits, and pushes.
- Acceptance: shared per-WM design; sourced nested feasibility and shortcut handling; qualified resource estimates and queue routing; shipped-default tallies and alternate verbs; user decision reflected in the requirement; documentation checks pass.
- Approach: two sequential bounded units, followed by diff/evidence review and documentation validation.
- Units: (1) proposal research/update; (2) workspace matrix/consensus/requirement correction. Neither depends on the other's edits.
- Decision: 2026-10-07 user chose follow by default plus a separate send-and-stay command; binding deferred to implementation.
- Verification: inspect cited evidence, diff and links; run applicable documentation checks without builds or live sessions.
- Accepted evidence: shared nested/VM definitions and optional source mode documented; first-slice store estimate 1.5-3 GiB, VM adds shared OS/QEMU closure plus sparse writable state. Estimates are reasoned, not measured. Current GNOME >=49 devkit replaces the old nested backend; KWin active-window shortcut rule is sourced, Meta-tap remains unverified.
- Review: first proposal's repeated 80-120 GiB reserve and child-shortcut framing rejected and corrected; independent source review corrected Xephyr screen assumptions, restart/enable routing and balloon reporting. Final reconciliation corrected first-slice arithmetic and replaced obsolete GNOME/wlroots citations.
- Outcome: original-eight R-WS-01 defaults verified as 3 follow / 5 stay; adding niri and PaperWM gives 5 follow / 5 stay across ten evidenced profiles. Alternatives and relative/output send framing corrected. User-selected follow plus separate send-and-stay is NORMATIVE; no implementation change.
- Verification: `git diff --check` passed; documentation checker passed ASCII, added local links/anchors, source keys, and 50 NORMATIVE / 83 OPEN / 11 PROVISIONAL totals. Source/docs only, no builds or live tests.
- Accepted resolution: PaperWM shipped take/move completion accepted on 2026-10-07: `Main.activateWindow` (tiling.js:5528-5555 at 8bf6dd2) establishes follow. Inactive-space insertion no-steal is a different journey. PaperWM's send-and-stay alternate remains TBD; no acceptance blocker remains.
- Deliverables: [environment proposal](../../research/live-test-vms/proposal.md), [workspace matrix](../../spec/reference-outcomes/workspaces.md), [consensus](../../research/reference-wm-consensus.md), [functional requirement](../../spec/functional-spec.md).
- Exact next action: user reviews the documentation; environment implementation remains a separately scoped change.
