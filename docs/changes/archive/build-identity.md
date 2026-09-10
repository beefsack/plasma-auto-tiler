# Build Identity

## Goal

Expose a reproducible source identity at KWin connector and Planner startup so
stale deployments are visible in route diagnostics.

## Scope

- Inject the flake source revision at package build time, with a bounded local
  development fallback.
- Emit one bounded startup record per production component and document its
  comparison through the existing diagnostic viewer.
- Keep the identity inspectable in installed package artifacts where practical.

## Acceptance

- A shared Nix source builds matching KWin and Planner identities.
- Plain Cargo and npm development builds use an explicit bounded fallback.
- Route diagnostics expose only component, package version, and bounded build
  identity, without changing command or service semantics.

## Outcome

- Nix injects `self.rev or "local-dev"` into both package builds at compile
  time. KWin and Planner emit their respective `started` route-diag records
  after successful startup, including `gen=<id>:version=0.1.0:result=ok`.
- Installed Nix artifacts contain a static `build-id` marker; compare both
  startup records with `scripts/route-diag-follow.sh --gen <id>`.

## Evidence

- `bash scripts/build-identity.test.sh` (20 checks)
- KWin typecheck, focused identity test, and ordinary/installed bundle checks
- Rust identity and Planner tests, `cargo fmt --check`, `cargo clippy -- -D warnings`
- `nix eval .#lib`
