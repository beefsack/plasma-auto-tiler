# Live-test VM research

- Status: complete and archived; baseline `21f025d`, 2026-10-07.
- Goal: propose repeatable, user-operated VM sessions for the 508-cell
  reference-WM queue in `docs/changes/archive/reference-matrix-expansion.md`.
- Scope: `docs/research/live-test-vms/proposal.md` and this record, following
  the archived COSMIC floating-navigation and macOS readiness research records.
- Acceptance: sourced route trade-offs, exact-profile pinning, graphics/input/
  multi-output constraints, repeatable fixtures and observers, platform limits,
  complete environment/count map, bounded first slice, effort and user decisions.
- Constraints: research only; no VM builds/boots, live tests, dependency installs,
  dependency/config/matrix edits, or principles/decisions/backlog changes.
- Units: sequential muse-spark Worker investigation/draft and correction;
  Lead integration and evidence review; independent read-only claim review.
- Material correction: first draft treated nixpkgs versions as the default and
  misstated queue/profile/platform details. Corrected draft requires exact source
  pins; qualified VM/backend and hotplug evidence never resolves another profile.
- Verification: compare queue families/counts and pins with local sources;
  review primary web evidence, Markdown links, ASCII and diff whitespace.
- Recommendation: one flake with per-WM NixOS `build-vm` configurations;
  i3/sway/bspwm first, user operates guests and records outcomes. No architecture
  or product behavior decision approved; proposal needs the user's choices.
- Accepted evidence: independent Worker review passed source pins, all 14 queue
  counts/families (389 Linux + 82 macOS + 37 Windows = 508), fixture/observer CLI
  source checks, route trade-offs and primary graphics/UTM/module documentation.
  Lead inspected final proposal and reconciled estimates and dependency scope.
- Outcome: proposal covers every requested topic; source builds, host GPU/KVM,
  multi-head and hotplug remain untested implementation prerequisites. No VM,
  live-test, install, product, configuration or matrix changes were performed.
- Handover: user selects first slice and confirms RAM/disk budget; next scoped
  change authors guests/fixtures/observer. No backlog update required.
- Completion: stage only proposal and this record; whitespace/ASCII/link checks,
  authorized commit and `git pull --rebase` before push.
