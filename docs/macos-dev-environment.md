# Native macOS development environment

- **P:** use a physical Apple Silicon Mac and native zsh. A second display
  is needed for multi-display acceptance; a Mac-hosted VM can supplement
  disposable permission/installer tests, not physical input/game evidence.
- Evidence checked 2026-10-03: **V** = fetched primary doc/source below;
  **R** = repository inspection; **O** = upstream report; **U** = unverified on a Mac;
  **P** = recommendation, not an adopted decision. Source keys at the end.
  Documented commands still need host verification.
- Related research: [prior art](research/macos-port/prior-art.md) and the
  [tentative plan](research/macos-port/plan.md). The proposed default uses
  public AX without reducing SIP; surveyed managers use different routes.
  This runbook grants no live-testing authority and makes no install.
- Tentative floor: macOS 15 (Sequoia), open decision. **V: S8:** Xcode 16.x
  runs on Sequoia 15.x with a macOS 15 SDK; **V: S14:** Homebrew supports
  Apple Silicon on Sequoia (15) or higher. Floor stays open; the user
  confirms the actual host OS. No adoption/date claims are made here.
- Intel scope is open. **P:** recommend arm64-first until a physical Intel
  host exists; do not claim Intel parity without one.

## Decisions needed from the user

| Decision | Options and consequences | Recommendation (P) |
| --- | --- | --- |
| Install governance | This doc as the macOS dependency list (mirrors the Windows rule in root `AGENTS.md`) vs another declaration file. New macOS tools added here first with user approval; the user performs installs. | Adopt this doc; open. |
| OS floor and Intel | Tentative macOS 15 floor vs higher; arm64-first vs committing to Intel. Intel needs its own host and CI leg before parity claims. | Confirm macOS 15 floor; arm64-first; open. |
| Dev signer and release membership | Local unsigned/ad-hoc vs Apple Development or persistent local self-signed cert for TCC dev; Developer ID plus paid Developer Program membership for notarized release. Choice fixes the stable identity strategy below. | Decide before first TCC grant; open. |
| mise as install route | Tool-agnostic installs now vs adopting mise later as the cross-platform route. | **Adopted:** root `mise.toml` manages Rust (via rustup), just, gh, rg, jq with OS-filtered entries (Linux ignores it); `yq` stays Windows-only and is not in the macOS inventory. Manual prerequisites stay manual: Xcode/CLT, host shell bootstrap, Git route per user choice. User runs `mise trust` / `mise install` from the repo root; gates use `mise exec -- cargo ...`. |
| UI language | Rust AppKit bindings vs a small Swift UI bridge. | Rust-first spike; add Swift only for a demonstrated gap; open. |

## Day-one setup, in order

Commands are for the **user on the Mac**. Agents ask before any install.
Use an ordinary admin-capable account; restart the shell after PATH
changes. Native zsh throughout; no bash-isms required.

### 1. Confirm host, chip, and displays

```zsh
sw_vers
uname -m
system_profiler SPDisplaysDataType
```

- **P:** require `arm64` (`uname -m` prints `arm64`) for the arm64-first
  path. Record the macOS version against the tentative floor above.
- Second display is optional. Accept single-display first; two-display
  proof needs the physical second screen, not a virtual one.

### 2. Install CLT or full Xcode, then verify the toolchain

**V: S1:** the Command Line Tools package carries the same macOS SDK,
man pages, and toolchain binaries as Xcode and installs at
`/Library/Developer/CommandLineTools`. CLT is sufficient as the Rust
linker/SDK. **V: S1:** `xcodebuild` (and `xctrace`) ship with Xcode only,
so the full Xcode GUI plus archive/export/signing workflow needs Xcode.

```zsh
xcode-select --install
xcode-select -p
xcrun --show-sdk-path
xcrun --show-sdk-version
clang --version
pkgutil --pkg-info=com.apple.pkg.CLTools_Executables
```

- If Xcode is installed instead, select it and check both tools:
  `sudo xcode-select -s /Applications/Xcode.app`, then
  `xcodebuild -version` and the `xcrun` SDK path above.
- **V: S1:** after a macOS upgrade, re-check with Software Update or
  `softwareupdate -l`; an old CLT package may be incompatible. Exact
  CLT/Xcode versions on the future host are **U** (not yet recorded).

### 3. Install mise, then Rust and CLIs (root `mise.toml`)

**V: S11/S12:** rustup remains the Rust installer; mise drives it (installs
rustup if absent, sets [process-local `RUSTUP_TOOLCHAIN`](https://mise.jdx.dev/lang/rust.html),
no persisted directory override). Pre-1.0 policy tracks latest stable
(consistent with Windows); rustfmt plus clippy; no toolchain file.
Follow the [official mise installation route](https://mise.jdx.dev/installing-mise.html),
then run the declared tools from the repo root:

```zsh
curl -fsSL https://mise.run | sh
# or optionally: brew install mise
```

For the curl route, add mise to this shell's PATH (and the user's zsh
startup configuration for future shells):

```zsh
export PATH="$HOME/.local/bin:$PATH"
```

From the repo root:

```zsh
mise trust
mise install
mise exec -- rustup show
mise exec -- rustc -vV
mise exec -- cargo -vV
mise exec -- rustup which rustc
mise exec -- rustup which cargo
```

- Git comes from CLT or the route the user chooses (system Git prompt or
  a manager). just, gh, rg and jq are mise-managed (root `mise.toml`,
  [OS-filtered entries](https://mise.jdx.dev/dev-tools/)).
  **V: S16:** just offers Homebrew, Cargo and prebuilt routes;
  verify `mise exec -- just --version`. The root justfile remains
  Linux-oriented.
- **V: S14:** Homebrew is optional, never forced. Default prefix on
  Apple Silicon is `/opt/homebrew`; follow its homepage post-install
  shellenv directions for zsh.
- Run gates with `mise exec -- cargo ...` so they consume the
  mise-selected toolchain; no toolchain file.

### 4. Prove the portable offline Cargo baseline (allowlist only)

**R:** `Cargo.toml` workspace members are `tiler-core`,
`tiler-protocol`, `plasma-auto-tiler`, `tiler-kwin-effect-ffi`, and
`tiler-windows`. Only the three portable crates below are the Mac
baseline. `plasma-auto-tiler` is the Linux/KDE service (rustix plus
zbus/D-Bus integration), not a supported Mac target; `tiler-windows`
is the Windows adapter. This is a supported-gate boundary, not a claim
that every excluded crate necessarily fails to compile on macOS.

```zsh
mise exec -- cargo build --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi
mise exec -- cargo test --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi
mise exec -- cargo fmt --all -- --check
mise exec -- cargo clippy --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi --all-targets -- -D warnings
```

- **P:** explicit `-p` flags are the boundary; do not change
  `default-members` or gate dependencies to fake a workspace build.
- Linux gates (workspace tests/clippy, Nix, KWin) stay on Linux.

### 5. Signing: dev versus release

- Local dev builds need no notarization; arm64 Mach-O executables normally
  receive at least an ad-hoc signature. This is not a stable TCC identity.
  Downloaded/quarantined builds may also hit Gatekeeper (see below).
- **V: S4/S6:** release distribution outside the Mac App Store needs a
  Developer ID certificate (Account Holder generates it) plus
  notarization; ad-hoc, Apple Developer, local development, and Mac
  Distribution certificates do not qualify.
- **V: S7:** paid Apple Developer Program membership ($99/year page)
  backs Developer ID distribution and notarization services.
- **V: S4/S5:** notarization prerequisites are hardened runtime enabled,
  valid Developer ID signature, secure timestamp, macOS 10.9+ SDK link,
  and no `com.apple.security.get-task-allow=true`.
- **V: S3:** `xcrun notarytool submit ... --wait` uploads (keychain
  profile preferred over cleartext password), `xcrun notarytool log`
  always gets checked, and `xcrun stapler staple` attaches the ticket.
- For TCC dev, either an Apple Development identity or one persistent
  local self-signed cert can stabilize the identity; both have limits
  (self-signed trust is local-only). **O: S17; V: S18:** the local route uses
  Keychain Access > Certificate Assistant > Create a Certificate, with
  type Code Signing; retain that certificate/private key across builds.
  Inspect available identities with `security find-identity -v -p codesigning`.
  Sign nested executables first and the bundle last. User picks the identity;
  no certificate or bundle ID has been adopted here.

### 6. Permissions, TCC resets, and stable identity

- Purpose: Accessibility for AX control; Input Monitoring (`ListenEvent`)
  may be needed for keyboard observation depending on tap mode/OS;
  Screen Recording (`ScreenCapture`) only if
  a future feature captures pixels. Request only what is needed; default
  is no Screen Recording capture. Do not claim AX consent alone grants
  every input mode; event-tap shapes, Secure Input blackout, and
  timeout-disable vary by route (see prior-art survey).
- The commands below are permission **resets**, not grants. After a
  reset the user relaunches the app and grants again in System Settings.
  Service support varies by host OS: check `man tccutil` on the Mac.
  The following is a template: replace the quoted placeholder with the
  future app's actual bundle ID before running. No ID has been selected.

```zsh
man tccutil
tccutil reset Accessibility '<actual-dev-bundle-id>'
tccutil reset ListenEvent '<actual-dev-bundle-id>'
tccutil reset ScreenCapture '<actual-dev-bundle-id>'
```

- **V: S9:** omitting the bundle ID resets that service for every app in
  the current account; `All` affects all services. Use the per-app forms.
- Stable-identity rule: keep the same bundle ID, install path, and
  signing identity across runs. **O: S17:** changed ad-hoc binaries can
  acquire a different cdhash and lose TCC grants. Standard mitigations: one
  persistent dev identity, fixed ID and path, separate dev vs release
  IDs, and stop/recover the app before rebuilding. Verify grant survival
  across real rebuilds; a stable path alone is insufficient. **V: S18:**
  designated requirements, rather than a filename, define signed identity.
- Inspect what TCC will see before blaming the OS:
  `codesign --display --verbose=2 <path-to-app>` and
  `codesign -d -r - <path-to-app>` show the authority and designated
  requirement. Self-signed local trust does not transfer to other
  machines; release uses Developer ID (see above). Never edit the TCC
  database directly.

### 7. Unsigned runs, quarantine, and Gatekeeper

- **V: S10:** an unnotarized/unknown-developer app shows a warning; the
  documented user path is System Settings > Privacy and Security > Open
  Anyway (about an hour after the blocked launch), not a bypass.
- Do not recommend disabling Gatekeeper or SIP. Keep both on; treat an
  unsigned dev build as dev-only friction, not a shipping state.
- **V: S18:** `spctl -a -vvv -t exec <path-to-app>` reports the Gatekeeper
  assessment for a built artifact; it is a diagnostic, not a grant.

### 8. CI (cheap macOS smoke job)

- **V: S13 (fetched inventory):** macOS arm64 labels are `macos-14`,
  `macos-15`, `macos-26`, `macos-latest`; Intel labels are
  `macos-15-intel`, `macos-26-intel` (plus an `xcode-27` preview label).
  `macos-latest` currently resolves to the macOS 26 arm64 image.
- Implemented: one arm64 job pinned at `macos-15` using
  `jdx/mise-action@v4` (runs `mise install`), with tool version smoke
  checks (`mise exec -- <tool> --version` for rustc, cargo, just, gh, rg,
  jq), a `rustc -vV` host check (`aarch64-apple-darwin`), rustfmt/clippy
  component checks, and `git diff --check`. No live TCC/AX claims from CI;
  headless success does not establish TCC, AX, visuals or gaming.

### 9. Future native iteration loop

- No macOS adapter, bundle target or dev/stop/restore recipe exists yet.
  The proposed loop is restore parked windows, stop the old owner, build
  and sign a fixed-path `.app`, relaunch, then recheck AX/input status.
  Sync source via Git with separate host `target/` and recovery state.
  Before window/input experiments, establish a macOS live-testing protocol
  and separately authorize the scope, as for the Windows port.

## Verification checklist

- [ ] Physical Apple Silicon host recorded: `sw_vers`, `uname -m`,
  display topology; second display noted if present.
- [ ] CLT or Xcode path verified: `xcode-select -p`, SDK path, and
  (Xcode only) `xcodebuild -version`.
- [ ] `mise exec -- rustc -vV` shows `aarch64-apple-darwin`;
  mise-selected stable toolchain, no persisted directory override or toolchain file.
- [ ] Section 4 allowlist build/test/fmt/strict clippy pass via
  `mise exec`; root Linux crate and `tiler-windows` correctly excluded.
- [ ] Dev signer vs release membership decided; no cert secrets stored.
- [ ] Only needed TCC services requested; resets understood as resets;
  `man tccutil` checked on the host; stable ID/path/identity kept.
- [ ] Gatekeeper/SIP left on; quarantine path exercised via Open Anyway
  at most; `spctl` assessment recorded where relevant.
- [ ] CI smoke job (`macos-15`, mise install + version/host/component
  checks) green; labels re-verified at authoring time (fetched labels
  drift).

## Sources (only URLs fetched in this unit, 2026-10-03)

- S1: https://developer.apple.com/documentation/xcode/installing-the-command-line-tools.md
- S3: https://developer.apple.com/documentation/security/customizing-the-notarization-workflow.md
- S4: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution.md
- S5: https://developer.apple.com/documentation/security/hardened-runtime.md
- S6: https://developer.apple.com/developer-id/
- S7: https://developer.apple.com/programs/
- S8: https://developer.apple.com/support/xcode/
- S9: https://developer.apple.com/documentation/xcode/resetting-access-to-protected-resources-in-macos.md
- S10: https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac
- S11: https://www.rust-lang.org/tools/install
- S12: https://rust-lang.github.io/rustup/installation/other.html
- S13: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- S14: https://docs.brew.sh/Installation
- S15: https://mise.jdx.dev/getting-started.html
- S16: https://just.systems/man/en/packages.html
- S17 (upstream development report, not an Apple guarantee): https://github.com/jackielii/skhd.zig/blob/main/docs/CODE_SIGNING.md
- S18: https://developer.apple.com/library/archive/technotes/tn2206/_index.html
- R: `Cargo.toml`, `crates/tiler-core/Cargo.toml`,
  `crates/tiler-protocol/Cargo.toml`,
  `crates/tiler-kwin-effect-ffi/Cargo.toml`,
  `crates/plasma-auto-tiler/Cargo.toml`,
  `docs/research/macos-port/prior-art.md`, root `AGENTS.md`.
