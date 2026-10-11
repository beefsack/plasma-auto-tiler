# OmniTiler project rename

## Goal and scope

- Apply the user-approved 2026-10-11 OmniTiler identity across source,
  packaging, integration IDs, filenames, tests and documentation, including
  archived records. Keep generic internal crate names unchanged.
- Use `OmniTiler` for display/CamelCase, `omniTiler` for lower CamelCase,
  `omnitiler` for lowercase/snake identifiers, `OMNITILER_` for environment
  variables/macros, and `com.omnitiler.*` or `/com/omnitiler/...` for
  reverse-DNS identities. Record host-format exceptions.
- No migrations or compatibility shims. The local checkout directory stays
  unchanged. Live tests and external configuration changes are excluded.

## Acceptance and approach

- Mechanically rename tracked contents and product-named files/directories;
  regenerate lock metadata and reconcile concurrent main changes by preserving
  their semantics and reapplying the rename.
- Record the durable name decision and close the project-name backlog item.
- An old-name sweep leaves only the decision's intentional former-name mention.
- Sequential gates: Rust workspace tests, strict clippy/fmt, portable checks,
  Windows Linux-portable allowlist, KWin JS tests/typecheck/bundle, native CMake
  build/CTest, all flake packages and flake check, shell suites.
- Container distro builds are excluded; recipes receive mechanical renames.
- Independently review the broad identity change, then publish with a final
  rebase and check CI. Report external configuration changes and exact stale
  live-state names for user-owned cleanup.

## Bounded units

1. Mechanical source/path rename and integration inventory.
2. Sequential full verification and narrowly causal corrections.
3. Independent review, record outcome, archive and publish.

## Evidence and outcome

- Initial pull was current at `cc7614d`; tracked working tree was clean.
- Mechanical rename covers 296 tracked files and 17 product-path moves, plus
  this outcome record. The initial source had 3700 occurrences on 3476 matching
  lines; one concurrent Windows addition was also renamed. Cargo lock metadata
  and the tracked KWin archive/checksum were regenerated. No naming exceptions
  were required.
- Sequential offline gates passed: Rust workspace (1419 tests), strict
  clippy/fmt, portable check, Windows Linux-portable allowlist (1267 tests),
  KWin typecheck/bundle and JS (1308 tests in 188 suites), native CMake build,
  CTest (33 effect/full-tree and 26 settings-only), all five flake package
  attributes and flake check. All ten shell suites passed, including the
  source-archive contract suite after committing the renamed HEAD.
- Narrow causal corrections: Rust line reflow after shortening identifiers,
  reverse-DNS regex expectations in one JS test, and regenerated npm dependency
  hash in the flake. No behavior change or semantic failed approach.
- Durable decision recorded; project-name backlog item removed and OBS/AUR
  names recorded. Independent review passed; its historical diagnostic app-ID
  inventory prompted applying `com.omnitiler.*` to those archived IDs too.
  Only the decision's former-name entry remains in the old-name sweep.
- Final rebase preserved concurrent Windows changes `94fa4ef` and `ba92c01`
  without conflicts. Their new first-run window class was renamed in a narrow
  follow-up; Rust gates and the affected tray Nix build were refreshed and
  passed. No external configuration or live-state mutation was performed.
- Rename published as `b639878`. All six CI jobs passed:
  [CI evidence](https://github.com/beefsack/omnitiler/actions/runs/38106207577).
  The follow-up publishes the concurrent class-name correction and archives
  this completed record. Container distro builds were excluded as requested.
