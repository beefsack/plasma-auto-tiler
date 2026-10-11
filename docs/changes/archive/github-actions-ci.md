# GitHub Actions CI

Goal: Run KWin TypeScript, Rust workspace, and hermetic shell checks on pushes and PRs to main.

Scope: Three independent jobs using the pinned devenv environment. KWin runs `npm test` and `npm run typecheck`; Rust runs workspace tests, fmt, and strict workspace/all-targets Clippy; shell builds the ignored KWin bundle and worktree tray binary, then runs all nine `scripts/*.test.sh` suites with private D-Bus. Add D-Bus, systemd CLI, and unzip to devenv for headless shell checks. No live KWin or Plasma session work.

Native effect build/CTest is excluded: `just build-native-effect` resolves `/run/current-system/sw/bin/kwin_wayland` to the running NixOS host's exact KWin derivation, which Ubuntu GitHub-hosted runners do not have. A fake host would not verify the ABI or native build.

Acceptance: YAML parses; every CI check command runs successfully offline; correct paths and shell dependencies; no system mutation, commit, or push. The first remote run remains pending.

Outcome: `.github/workflows/ci.yml` adds independent `kwin`, `rust`, and `shell` jobs. `docs/backlog.md` records the native exclusion; no local check command changed, so `docs/dev-loop.md` stays as is.

Offline evidence (2026-09-28): `yq -o=json '.' .github/workflows/ci.yml | jq -e ...` parsed and verified the triggers/jobs. From the project devenv shell: `npm ci --prefix kwin`, `npm test --prefix kwin` (788 passed), `npm run typecheck --prefix kwin`, `cargo test --workspace` (all passed), `cargo fmt --all -- --check`, and `cargo clippy --workspace --all-targets -- -D warnings` passed. For the shell job, `npm run build --prefix kwin`, `just build-rust`, then all nine `scripts/*.test.sh` passed in one loop, including the private-bus tray fixture (29) and its self-test (16). The added D-Bus, busctl, and unzip resolve from the pinned Nix store in the new shell. `git diff --check` passed. This is offline evidence; the first GitHub run requires a push.
