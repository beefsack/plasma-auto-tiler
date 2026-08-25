# Specification: KWin Version Alignment

Ownership and approval:
- Owner: Lead
- Status: Approved bounded correction

## Intent and Desired Outcome

Correct native-effect discovery/loading regression caused by building against
KWin 6.7.3 while the host runs KWin 6.7.4. The development environment and
native-effect CMake package must select the same evaluated KWin 6.7.4 package.

## Scope

- Replace literal KWin store paths in `devenv.nix` with
  `pkgs.kdePackages.kwin` and `pkgs.kdePackages.kwin.dev`.
- Export the evaluated KWin CMake package directory from `devenv.nix`.
- Make `scripts/dogfood-install.sh` consume that exported directory while
  preserving `DOGFOOD_KWIN_DEV_CMAKE_DIR` as the test override.
- Select the project Nixpkgs lock revision only through `devenv update nixpkgs`,
  changing only `nodes.nixpkgs.locked.{lastModified,narHash,rev}` and
  `nodes.nixpkgs-src.locked.{lastModified,narHash,rev}` in `devenv.lock`.
- Maintain focused tests only if needed to establish the approved behavior.
- Maintain this change's artifacts and the existing one-line backlog entry only
  if required for accurate status.

## Non-Goals

- Change any other `devenv.lock` node or field, input, overlay, host path or
  policy, Home Manager reference, ad hoc dependency, source/build-script/native
  code, package installation, or host mutation.
- Perform a Plasma session boundary.
- Restore the old KWin 6.7.3 plugin or refactor unrelated code.
- Commit, push, or perform cleanup outside scoped repository files.

## Acceptance Criteria

- The canonical development environment resolves KWin runtime and development
  packages to 6.7.4 and exports the matching `kwin-6.7.4-dev/lib/cmake/KWin`
  directory.
- Native-effect configuration uses that exported directory unless the existing
  `DOGFOOD_KWIN_DEV_CMAKE_DIR` test override is set.
- No literal `6.7.3` or `builtins.storePath` ownership remains in either scoped
  production file.
- The dogfood regression suite passes at least 281/281 after the required
  development-session restart.
- After that restart, build/stage succeeds, reload succeeds, and status reports
  discovery and loading as yes.

## Constraints and Risks

- The user performs the required development/OpenCode session restart. No
  Plasma logout/login is authorized or needed for this correction.
- Version matching is not proof of runtime discovery/loading until the post-
  restart build, reload, and status gates pass.
- Agents do not commit or push. At final completion, the Lead stages only
  approved paths and proposes one one-line commit message for the user.
