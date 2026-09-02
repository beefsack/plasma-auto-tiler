# Nix Current-Host Delivery

## Goal

Provide a Nix-first consumer contract for the KWin script, native effect/KCM,
and optional tray without changing the external consumer repository.

## Scope And Non-Goals

- Scope: reproducible flake packages, caller-pkgs package factories, default
  NixOS and Home Manager modules, explicit source filesets, and the existing
  namespaced user-local dogfood boundary.
- Direct `packages.native-effect` is a convenience package built from this
  flake's pinned nixpkgs input. A direct external consumer must make this
  repository's nixpkgs input follow the host nixpkgs for native ABI alignment.
- `lib.mkNativeEffect { pkgs = hostPkgs; }` and the NixOS module's default
  factory path use caller package sets and are host-pkgs safe.
- Non-goals: live current-host installation, KWin/session load or reload,
  session-boundary delivery, login/autostart validation, or Nix generation
  activation and rollback claims.

## Acceptance

- Static outputs expose the script, native effect/KCM, and tray packages for
  the declared Linux systems, the package factories, and both module entry
  points.
- Module boundaries keep script enablement, native package ownership, and tray
  autostart ownership within their documented scopes.
- Runtime and session acceptance remains pending the live gates listed below.

## Approach And Dependencies

- Keep `devenv.nix` as the development build baseline and use the repository
  flake for Nix consumption.
- Use explicit source filesets; factory and module native-effect builds use the
  matching KWin development package from the selected caller package set.
  Direct convenience-package builds use this flake's selected package set and
  require the consumer nixpkgs follow for host ABI alignment.
- The direct convenience native package depends on a consumer nixpkgs follow;
  factory and module paths depend on the consumer's caller `pkgs` and matching
  KWin ABI. `flake.lock` pins this repository's evaluation input.
- Retain the namespaced, reversible dogfood path as a non-coexistent
  alternative to a Nix-managed copy of the same plugin IDs.

## Material Decisions

- Nix-first current-host delivery is selected; the external consumer repository
  is not inspected or modified.
- The NixOS module owns the script/native-effect system packages and writes
  only `[Plugins] plasma-auto-tiler-kwinEnabled=true`; it does not enable the
  native border or mutate shortcuts.
- The Home Manager module owns only the optional immutable tray XDG autostart
  file, with store-backed `Exec` and `TryExec`, and no activation hook.
- The native effect is always rebuilt for the package set and KWin ABI used by
  its selected build; it is not a portable binary.

## Accepted Static Evidence And Outcome

- `nix flake check --all-systems --no-update-lock-file` passed for the declared
  `aarch64-linux` and `x86_64-linux` systems, including module-boundary and
  package derivation evaluation.
- `bash scripts/dogfood-install.test.sh` passed 482 checks with no failures.
- Static delivery is accepted for the declared package, factory, module,
  source-fileset, ownership, and dogfood rollback contracts. No live result is
  claimed.

## Pending Live Gaps

- Consume the flake from an external NixOS/Home Manager configuration and
  validate the host KWin ABI and native effect discovery/load.
- Validate KWin/session script and native-effect load/reload, including the
  required logout/login or new-session boundary.
- Validate watcher ordering, tray login/autostart, clean install/update, Nix
  generation rollback activation, and session lifecycle behavior.

## Next Action

With separate authorization and the reviewed live-test protocol, consume the
flake from an external host configuration and run the bounded current-host
ABI/session, install/update/rollback, and tray lifecycle validation; until
those gates pass, make no live-delivery claim.
