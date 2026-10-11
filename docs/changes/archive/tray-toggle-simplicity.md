# Tray Toggle Simplicity

## Goal and scope

- Simplify tray workspace-toggle Rust code, primarily `crates/omnitiler/src/tray.rs` and tray-only tests/helpers. Prefer deletion where complexity brings no meaningful value.
- Preserve visible menu and action behavior, schema-2 D-Bus/snapshot protocol, security and noticeable failure semantics. Retain the `stage=persist ... outcome=written`, `plan:config-reloaded stage=default-tiled`, `native-failed` and `stage=toggle ... outcome=sent-unconfirmed` evidence paths.
- No live KWin/Plasma runs or changes to the KWin script, `devenv.nix`, `docs/backlog.md`, or `docs/research/architecture-review/review.md`.

## Approach and acceptance

- Review constants, diagnostics, stale-scope refusal, menu fingerprint caching/poison recovery and writer path check. Stop for user choice before any visible behavior, protocol, security or noticeable failure-semantics change.
- Implement bounded tray-only simplifications; delete tests tied only to removed internals, retain behavior tests. Skim Worker diffs for unnecessary defenses, fallbacks, retries, comments or accessors before accepting.
- Verify Rust workspace tests, fmt, strict clippy, diff check and diff stat. If changes outside `crates/` require it, verify KWin typecheck/tests and `nix flake check --no-build --offline`.

## Outcome and evidence

- Consolidated identical poison recovery for the three tray-owned `Option` mutexes into one helper, retaining the reset-to-empty/re-emission/spawn behavior. Removed the unreachable optional-value branch from default-persistence diagnostics; logged text is unchanged. No tests tied solely to removed internals needed deletion.
- Retained named D-Bus/menu/config constants for contract readability; request, persistence, and projection diagnostics for bounded, redacted dispatch/failure and pending live evidence; fresh non-empty scope refusal to avoid stale/wrong-workspace toggles while leaving default controls usable; scope-aware menu fingerprint to keep snapshot heartbeats silent but publish actual changes; and the baked writer's absolute-path check for security. Poison recovery remains because a poisoned cache should not crash tray operation.
- No product-intent decision or new durable decision required. No live KWin/Plasma testing performed.
- `cargo test --workspace --offline -q`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --offline -- -D warnings`, `npm run typecheck --prefix kwin`, `npm test --prefix kwin` (833 passed), `nix flake check --no-build --offline`, and `git diff --check` passed. User-owned pending live log checks remain pending.
