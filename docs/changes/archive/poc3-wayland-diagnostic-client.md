# POC3 Wayland Diagnostic Client

## Goal

Provide a manually launched, project-owned raw xdg-shell diagnostic client for
one private nested-KWin POC3 slice. It distinguishes client protocol/lifecycle
failure from nested-KWin failure and, if successful, supplies exactly three
visible disposable windows.

## Scope And Non-Goals

- Add one Rust diagnostic binary with strict explicit nested target validation,
  bounded structured diagnostics, minimal SHM xdg-shell mapping, and slots 1-3.
- Bind the existing manual-client route to the exact built binary and its three
  manifest slots. Retain exact identity-bound cleanup and private `env -i`.
- Add static Rust and shell coverage, and only required Cargo/Nix dependencies.
- Do not run a live nested attempt, alter product runtime/shared engine code,
  add toolkit/UI/input/decorations/persistence/IPC/async runtime, or retain a
  Konsole fallback in this route.

## Acceptance

- The binary refuses absent, host, default, or ambient Wayland targets and
  accepts only explicit private runtime/socket inputs or a validated manifest.
- Each explicit slot maps an xdg-shell SHM window after configure acknowledgement
  and emits bounded, redacted diagnostics through close, signal, and protocol
  exit/error paths.
- The manifest launcher admits exactly slots 1-3 for the exact built binary,
  with no duplicate or host fallback, and cleanup remains exact.
- Pure Rust and shell regressions cover the stated failure and lifecycle cases.

## Plan

1. Choose and add the minimum protocol/SHM dependencies.
2. Implement the binary and pure state/validation tests.
3. Bind the existing manual launcher and cleanup contract to the binary.
4. Add shell regressions and required Nix/Cargo metadata.
5. Run static verification, independent adversarial review, correct findings,
   and update the POC3 record/backlog with the restart gate.

## Material Decisions

- This is disposable diagnostic tooling, not production architecture.
- The user authorized only implementation and static verification. No nested
  KWin/Plasma live action is authorized in this unit.

## Outcome

- Implemented `poc3-diagnostic-client` with raw xdg-shell, SHM mapping,
  strict target validation, slots 1-3, and bounded redacted diagnostics.
- Added `launch-diag` to the manifest-bound manual-client route with exact
  binary identity, private `env -i`, no fallback client, and exact cleanup.
- Added `memmap2 0.9`, `wayland-client 0.31` without defaults,
  `wayland-protocols 0.32` client without defaults, and `rustix` `mm`. No
  `devenv.nix` or system dependency changed.
- Current static evidence: full `cargo test`, diagnostic binary Clippy,
  shell syntax, manual/cleanup fixture suites, and `git diff --check` pass.
  Full-target Clippy is blocked only by existing unmodified `src/tray.rs`
  lints. Independent review findings were corrected.
- No live nested attempt occurred. Any live diagnostic launch requires fresh
  authorization.
