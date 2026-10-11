# Decision review - 2026-10-08

- Outcome: M01-M32 applied as authorized; documentation only, no code or live tests.
- Authority: user choices 2026-10-08, merged findings
  `decision-review-merged-2026-10-08.md`, and the original
  `decision-review-findings-2026-10-08.md` coverage ledger.
- Register: organized across platforms by behavior; superseded intent removed,
  current implementation gaps qualified, duplicate contracts consolidated.
  Proof/history already present in existing records was not copied again.
  Live procedures remain in the guide; active grants and prohibitions remain
  in decisions. VISION.md and AGENTS.md are unchanged.

## User choices M01-M15

| Finding | Selection |
| --- | --- |
| M01 | Project-principles header and short vision/principles/spec/decisions roles. |
| M02 | Remove Scope, Not Arbitrary Limits; do not reintroduce its process guidance. |
| M03 | Narrow refusal preserves unaffected functionality and later recovery; terminal, host-drift and spontaneous-window rules retained. |
| M04 | Aim for zero gaming cost; demonstrate unavoidable residual minimal and imperceivable; unwanted interference remains prohibited. |
| M05 | What/why observability principle; all concrete lifecycle, correlation, redaction, outcome and noninterference safeguards consolidated in decisions. |
| M06 | Remove Alignment and Bias Towards Action; retain Simplicity unchanged. |
| M07 | Current user-approved register only; Git retains superseded intent; platform gaps do not change selected rules. |
| M08 | Keep Authentic Win+G/F11 ownership with disclosure; Compatible/disable/rebind for Game Bar; containment parked for later test/review. |
| M09 | B9 unmaximize then fresh-admit; COSMIC observation is confirmation, not an implementation gate. |
| M10 | Preserve clean/tolerance-valid adoption; overlap/minimum-infeasible fallback uses sequential long-edge seed without centre inference; not exact COSMIC parity. |
| M11 | Windows overlay minimum hints remain lifetime/slot-bound until fresh queries; existing-pump two-second wake is observation, not expiry or latency. |
| M12 | Ratify all nine Windows settings/tray/first-run choices, including amber warning semantics, singleton UI, accent fallback, rebind limit and automation-only send. |
| M13 | Ratify KDE staged controls; Apply preserves Keep/custom assignments, Authentic explicitly resets canonical; native store authoritative and separate Revert retained. |
| M14 | Rolling latest CLI/stable Rust, no mise lock, Windows/macOS install/smoke CI until 1.0; no Nix/mise equality gate. |
| M15 | `group-with-neighbor` default / `swap-with-neighbor`, functional labels and WM tooltips; no migration; implementation pending. |

## Offline code findings and backlog

- M09: KDE `kwin/src/plan-adapter.ts` `requestFloat` dispatches maximized
  unfloat without clearing maximize; Windows `tiling.rs` `float_toggle_refusal`
  refuses. Added shared-core/KDE B9 implementation and Windows handoff item.
- M10: `crates/tiler-core/src/engine.rs` declines `CentreSplit` and `MinInfeasible`
  fits; Windows uses the shared Engine adoption path. No implementation gap
  found for the ratified hybrid; native acceptance remains separate.
- M13: `shortcutreconciler.cpp` `expectedPost` and
  `unifiedsettings_module.cpp` `catalogPost` choose canonical posts, including
  Keep. Added KDE Keep-preserving Apply implementation item.
- M15 exact IDs added to the existing 2026-10-08 D1 implementation item.
- M16 unmeasured 100 ms pump gaming-cost measurement added alongside parked
  coexistence work, tied to M04. Completed review and resolved provisional
  review backlog entries removed; containment remains an open user review.
- Spec: nine PROVISIONAL rows ratified plus B9's no-refusal sub-leg selected;
  105 NORMATIVE, 60 OPEN, 0 PROVISIONAL rows. Windows conflict-control matrix
  cells now cite Windows evidence and qualify unsupported KDE-only legs.

## Verification

- Independent muse-spark Worker compared old/new rules and safety boundaries.
  Seven corrections addressed duplication, obsolete target/gap wording, B9
  sub-row status, convention provenance and logging safeguards. Lead found
  and restored the omitted amber-warning/menu-lifecycle semantics; subsequent
  independent clause-level review confirmed all nine Windows choices and no
  remaining active-rule loss or blocker.
- Repository-wide decisions/principles anchor check: 204 references, zero
  broken anchors. Requirement counts verified; `git diff --check` clean.
- No Markdown/link-check recipe exists in the justfiles or CI; an offline
  anchor/count check was used. No product or live-host tests were run.
- Delegation: one Lead, four sequential muse-spark Workers (register/code
  investigation, spec/matrix/links, independent review, corrective edits),
  one active at a time; resumes used for corrections and final review.
- No unresolved ambiguity or unapplied user selection was identified.
