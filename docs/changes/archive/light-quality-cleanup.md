# Light quality cleanup

Goal: Remove clear, low-risk code and documentation drift without changing behavior, protocol, logs, or settings.

Scope: decisions wording and formatting supported by explicit backlog evidence; unused Rust, KWin TypeScript, and native C++ statements. No live tests, broad refactors, changes to backlog items, restricted research files, or `devenv.nix`.

Acceptance: Review each diff; run every CI gate (KWin tests/typecheck, Rust tests/fmt/strict clippy, shell fixtures), native build and CTest, offline flake check, and diff check. Report untouched candidates and ignored root artifacts.

Approach: review each diff and perform final verification for docs, Rust, TypeScript, and C++. Decisions stay limited to the user's cleanup constraints.

Outcome: Corrected decisions indentation and live-status wording against explicit backlog evidence; removed unused Rust, TypeScript, and C++ statements and corrected a Rust test name. Nested and top-level docs link audits found no broken relative links or non-ASCII typography. Root `CMakeFiles/` is ignored and untracked; left in place.

Evidence: Rust workspace tests, format and strict Clippy; KWin fixture build, 833 KWin tests and typecheck; CI shell suites; `just build-native-effect` and 30 native CTests; offline flake check; and `git diff --check` all passed. No live KWin/Plasma run.
