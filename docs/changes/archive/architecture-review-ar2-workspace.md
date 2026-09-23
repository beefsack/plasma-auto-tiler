# AR2: Cargo workspace split

## Goal and scope

Move the existing Rust crate into a portable core crate, a protocol crate and a Linux delivery crate without changing the binary name, CLI, D-Bus surface or shipped behavior. Move tests to their owning crates and update build/package references. No AR3 protocol redesign, live KWin/Plasma testing or host mutation.

## Approach and acceptance

- Map module imports, platform dependencies, test ownership and source-path consumers before moving code. Keep coupled codec and Planner orchestration together in protocol if separation is not mechanical.
- Keep the nixpkgs Rust toolchain and add a pinless offline portability gate for core dependencies and platform-bound source constructs.
- Document adapter-normalized integer core units and adapter-owned frame insets. Update only stale layout references in decisions and the AR2 backlog line.
- Verify format, check, Clippy and the full 516-test baseline across workspace/crates; KWin typecheck/full tests/build; evaluate or build affected Nix packages offline if feasible; independent diff review. Archive this note with outcome and evidence.

## Outcome and evidence

- Split into dependency-free `tiler-core`, serde/serde_json `tiler-protocol` (existing DTOs and coupled Planner orchestration together), and Linux `plasma-auto-tiler` (unchanged binary name, CLI and D-Bus route). Tests moved with their owners: core 280, protocol 123, Linux 113; 516 total, equal to baseline. The two core `Session` operations called from protocol became public solely to cross the new crate boundary.
- Updated Cargo.lock, Nix tray fileset/package selection, just Rust build recipes, the tray shell-test source path and a KWin source-inspection test path. Native-effect CMake uses independent local Rust files and needed no edit. `docs/decisions.md` had no references to this project's old crate or Rust source layout.
- `tiler-core/src/lib.rs` records that core units are adapter-normalized integers and adapters retain host-specific frame insets. `devenv.nix` matches its pre-AR2 version: the proposed target additions required an unwanted rust-overlay/channel override and were withdrawn. `just check-portable` now uses offline Cargo metadata to require zero normal core dependencies and scans core Rust sources for Linux/host-bound constructs. The gate passed, failed on an injected `std::os::unix` import, and passed again after exact restoration.
- Offline verification: `cargo fmt --check`, `cargo check --workspace --offline`, `cargo clippy --workspace --all-targets --offline` (existing style warnings only), `cargo test --workspace --offline --quiet` (516 pass); `cargo build -p plasma-auto-tiler --offline`; KWin `npm run typecheck`, `npm test` (715 pass), `npm run build`; `just --fmt --check`, `scripts/dev-loop-split.test.sh` (327 pass), `scripts/dev-native-effect.test.sh` (157 pass), `scripts/tray-05a.test.sh` (19+4 pass), `scripts/build-kpackage.test.sh` (pass). `nix flake check --no-build --offline path:<checkout>` and tray offline dry-run evaluation pass. The tray Nix build was not run: dry-run shows a large missing offline toolchain/bootstrap closure. A standard Git flake input cannot see unstaged new crate files; explicit `path:` evaluation included them without staging.
- Independent Worker review found no behavior or package-layout regression; its documentation-link and outcome-record findings were resolved by archiving this note.
