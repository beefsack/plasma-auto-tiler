# KDE Keep-preserving shortcut Apply (M13)

## Goal and scope

- Deliver User 2026-10-08 M13 = B: KDE project Apply/Force preserves current native assignments for Keep; only explicitly staged Authentic requests canonical reset. Compatible resets to Keep and disables known/discovered conflicts without replacements.
- Native reconciler, KCM staged intent/preview, regression coverage and delivery records only. Ordinary Save isolation, explicit confirmation, owner/foreign-holder revalidation, separate Revert and native-store authority remain acceptance invariants; Windows runtime unchanged.

## Readings and approach

- Keep of a present empty assignment stays empty, including unresolved registration. An absent enabled action retains the existing narrow missing-row refusal, never canonical repair.
- Keep of a conflicting custom assignment shows/scans the actual chord; no silent reset. Canonical/default conflict information remains visible for preset selection.
- Authentic is one-shot staged intent: confirmed successful Apply/Force consumes it, so later external KDE customization survives the next Apply even with the KCM still open. Failure or decline retains it; Compatible/load/defaults clear it.
- Use the existing disabled-ID draft plus staged Authentic flag, bind that intent into Force preview/revalidation, skip writes to Keep, and compare final Keep images exactly with preflight/confirmed images. Existing foreign cleared-ID persistence remains unchanged.
- Minimal action-sequence variants: [R-CTL-05 M13 readings](../../spec/reference-outcomes.md#r-ctl-05-m13-readings). Unsupported reference/live outcomes remain TBD.

## Bounded units and review

- Four sequential units: implementation, full offline verification, independent review, and bounded Authentic lifecycle correction. Existing stashes untouched.
- First implementation required a semantic correction: presence-only Keep verification could claim preservation after drift. Exact preflight/confirmed-image comparisons plus selected-write/foreign-clear drift regressions corrected it.
- Independent mutation-boundary review passed. Persistent post-success Authentic intent then corrected with two lifecycle regressions; final focused review verifies the consumed-intent contract.

## Verification and outcome

- Initial tree clean at `6ad929e`. All agent work offline; no live desktop mutation or dependency changes.
- Regression oracles cover custom/canonical/empty Keep; staged-only Authentic; Compatible disabled conflicts and unchanged nonconflicts; custom-chord Force preview/removals; stale draft/intent/project/foreign image refusal; exact preserved-image verification; ordinary Save isolation; and Apply/Force consuming Authentic before later customization.
- Full gates: KWin 1238/1238; Rust workspace 1270; native CTest 33/33 under `-Wall -Wextra -Werror`; clippy/fmt; `just check-portable`; TypeScript typecheck/bundle; nine offline shell suites; `git diff --check` clean.
- Native recipe: `nix build .#checks.x86_64-linux.native-effect-tests --no-link --print-build-logs` (the authoritative check attribute, including vendored Rust-backed suites).
- Initial KWin gate failed only the old Authentic button-label static assertion (1237/1238); one causal test-only expectation repair passed the full 1238 suite. Lifecycle correction initially failed two old `applied` status expectations (31/33); updating them to consumed Keep/`preserved` restored 33/33 without changing mutation oracles.
- Logs report staged intent and per-binding kept/assigned/cleared outcome kinds with catalog identities; no raw payloads added.
- Updated decisions, REQ-CTL-05/06, discriminating rows and active KDE acceptance record; removed the implementation P1 backlog item. Shared Windows handoff wording remains platform-scoped and needs no edit.
- Pending user-owned live check: **M13 Keep preserves custom KDE chords across Apply**, including restart/physical delivery in [the live checklist](../../live-shortcut-override-verification.md#pending-m13-keep-preserves-custom-kde-chords-across-apply). Offline delivery complete; live acceptance stays with the user.
