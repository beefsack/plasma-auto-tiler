# AR10 Cargo-Built Native Effect

## Goal

Replace the bare-rustc effect Rust build with a Cargo workspace staticlib invoked by CMake, use serde and existing portable types where appropriate, and retire the hand-written JSON parser without changing runtime behavior or C ABI.

## Scope And Non-Goals

- Keep group visibility and drag verdict policy in Rust; retain POD-only ABI and panic containment on every Rust callback.
- Preserve parser size, validation, ordering, and fail-closed semantics and the 27 native tests.
- Keep tiler-core zero-dependency and free of Qt/KWin; no live session mutation, installation, host changes, toolchain pin/target changes, or edits to the architecture review.

## Approach

- Use a CMake custom command invoking workspace Cargo for the staticlib, avoiding a new system dependency and session restart. Pass explicit manifest, target and build outputs with proper rebuild dependencies.
- Adapt effect Rust to serde JSON, reuse core/protocol types only where they preserve existing validation and policy; add focused parser parity tests.
- Update the Nix native-effect source and vendored Cargo build inputs to cover both the caller-pkgs factory and convenience package, preserving host-matched dev and dogfood routes.
- Obtain independent FFI/parser/Nix review; run requested Rust, KWin, native, and Nix build checks. Archive when accepted and update only AR10 backlog entry.

## Outcome And Verification

- Cargo workspace `tiler-kwin-effect-ffi` builds one staticlib through a plain CMake custom command. It uses serde JSON with strict struct fields and `tiler-core` ID/rectangle gates; the two bare-`rustc` build paths and hand-written parser were removed. Rust still owns group visibility and drag verdict policy; all 11 exported callbacks catch panics and retain the POD C ABI.
- Parser tests cover duplicate/unknown/missing keys, malformed numbers, non-UTF8, trailing data, and exact 4096-byte acceptance/rejection boundary. Independent review confirmed parity against the retired parser and C header layout. Two actionable review findings (transitive geometry rebuild dependency and CTest Cargo target/offline flags) were fixed; existing panic fallback only clears `has_group`, as before, with no observable stale display.
- `cargo test --workspace --offline`: 629 passed (593 prior + 36 effect tests). `cargo fmt --all -- --check`: pass. `cargo clippy --workspace --all-targets --offline`: pass, only pre-existing warnings outside the new crate. `just check-portable`: pass, core still zero-dependency. In `kwin/`, `npm run typecheck`, `npm test` (794 passed), and `npm run build` passed.
- `just build-native-effect` built/staged both artifacts in repo-local `target/` against current host KWin 6.7.5. CMake/CTest in the exact host derivation development shell: 27/27 passed. Host builder hermetic tests: 93 passed; dogfood hermetic tests: 546 passed. No session mutation or install.
- Nix builds: `nix build path:.#packages.x86_64-linux.native-effect --no-link --print-out-paths` passed against pinned KWin 6.7.4; `nix build --impure --expr 'let sysPkgs = import (builtins.getFlake "nixpkgs") { system = "x86_64-linux"; }; f = builtins.getFlake "path:/home/beefsack/Development/plasma-auto-tiler"; in f.lib.mkNativeEffect { pkgs = sysPkgs; }' --no-link --print-out-paths` passed against caller-pkgs KWin 6.7.5. Vendored crates from `Cargo.lock`, Cargo offline in Nix builder; Nix may fetch store closures. Path-flake evaluation includes untracked new crate without staging; git-flake builds require that source to be tracked in a future commit.
- No new system dependency, no `devenv.nix` change or required development-session restart. Native runtime acceptance still requires authorized native delivery and a fresh KWin session; no live test was performed.
