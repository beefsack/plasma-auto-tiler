# Native Windows development environment

- Use Windows 11 x64, Windows Terminal, PowerShell 7 and Rust MSVC natively.
  Keep a separate Windows clone; synchronize source through Git, never Linux
  `target/`, settings or compiled effects. No WSL or development VM.
- Evidence checked 2026-09-30: **V** = verified primary documentation/source;
  **R** = verified repository inspection; **O** = upstream issue report;
  **U** = unverified on this PC; **P** = recommendation, not an adopted decision.
  Source keys are at the end. Documented commands still need PC verification.
- **R:** [Windows decisions](decisions.md#windows-port) select this same PC as
  the KDE multi-output host (DP-6 and HDMI-A-2). Dual-boot is **U**: the
  [plan](research/windows-port/plan.md#development-and-iteration) says "if".
  Confirm the boot arrangement; do not change it. Windows monitor IDs differ.
- **R:** KDE-first extraction ended at K1. Start Windows Phase 1 with native
  build/tests, two-monitor baseline, independent stop/restore on owned test
  windows, then physical Win+Arrow proof. `tiler-windows` and its restore/stop
  commands do not exist yet. This runbook grants no live-testing authority.

## Decisions needed from the user

### Before the first Windows session (on the laptop)

| Decision | Options and consequences | Recommendation (P) |
| --- | --- | --- |
| Root AGENTS.md dependency rule | Amend for a Windows contract, or leave the Nix-only rule and have the user perform setup. The current rule forbids agent ad-hoc/global installs, including on Windows. | Approve a Windows-specific exception preserving Linux `devenv.nix` authority; record tools, versions and sources before agent installation. |
| Dependency declaration file | Keep the reviewed version/command list here, or add `.config/configuration.winget` with VS workload declaration. DSC improves repeatability but adds resource/module maintenance. | Use this runbook for day one; approve a small WinGet Configuration later if repeated provisioning warrants it. Keep rustup selection and Coreutils disabling explicit, not custom DSC machinery. |
| `.gitattributes` | **Decided (user 2026-09-30): repository-wide LF policy**, the contract below, added on the laptop before the Windows clone. Renormalization changed no tracked file. | Done. |
| Rust pinning | Document an exact Windows Rust version matching Nix, or introduce `rust-toolchain.toml`. A TOML file controls rustup but does not automatically control the current direct Nix toolchain. | Document parity first (local rustc is 1.98.1); verify that exact official MSVC release is available. Defer a shared TOML pin until its Nix/CI integration is reviewed. |
| Windows live-testing governance | User-only experiments, or approve an equivalent to `live-kwin-testing.md` with explicit Windows authority/recovery. A setup guide cannot authorize hooks or desktop/policy mutation. | Approve a Windows live-testing document before agent-run experiments; outline below. Until then, build/test only inspected non-live targets. |

### During the first Windows session

| Decision | Options and consequences | Recommendation (P) |
| --- | --- | --- |
| Storage and long paths | Short NTFS checkout, or optional ReFS Dev Drive for repo/caches. Dev Drive needs resources/admin setup; OS long-path policy is a separate host change. | Start at `C:\src\pat`, or an already approved `D:\src\pat` Dev Drive. Enable Git long paths per clone; keep paths short without changing host registry. |
| Credentials | HTTPS + bundled Git Credential Manager, or SSH with an existing approved key. GCM manages HTTPS credentials, not SSH keys. | HTTPS unless SSH is already configured; do not copy credentials into the runbook. |
| CLI scope | Git, rg, PS7, Rust and Build Tools; optionally Coreutils and the named jq/yq/qsv/gh/just tools. Coreutils is preview and introduces a linker-name collision. | Native rg plus the required build tools; add only named tools actually needed. Coreutils is optional; disable its `link` before any build. |
| opencode configuration and plugin version | Transfer the known-working laptop configuration with Windows paths, or adopt new versions/configuration. Native Windows plugin behavior needs proof. | Official native CLI binary, explicit MSI pwsh path, proposed permissions below; smoke-test skills and `gpt-sol` -> `muse-spark` routing before work. Stop/report incompatibility rather than silently changing routing/plugins. |
| Isolation | Sandbox if edition/virtualization permit, or a clean Windows machine. Neither is needed for development; neither replaces physical input/display/game tests. | Sandbox for clean runtime and guest-only policy/crash probes. If unavailable, defer Win+L policy writes; no policy experiments on the daily desktop. |

### Line-ending contract

Adopted in root `.gitattributes` (user 2026-09-30). **V: G1:** covers Rust, TS, shell, Nix, CMake, docs, JSON/TOML and future
PowerShell files without an extension-by-extension list. PS7 accepts LF; use
UTF-8 without BOM for project text. Future CMD/batch files check out as CRLF.

```gitattributes
* text=auto eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
*.kwinscript binary
```

- **R:** at adoption the index held 445 LF text files and one binary
  `.kwinscript` ZIP, no CRLF text; a renormalization dry run changed no
  tracked file.
- **P:** the fresh-clone command below also stores LF settings before
  checkout (belt and braces). For an existing clone, inspect first; stop on
  conversion churn and ask the user, rather than resetting/re-checking out.

### Dependency declaration and Rust parity

- **V: W1:** `winget configure` is a supported Microsoft provisioning feature
  since WinGet 1.6.2631, not a universal package lockfile or Nix substitute.
  Microsoft's convention is `.config/configuration.winget`. Package resources
  can declare versions; referenced DSC modules also need reviewed versions.
  Resources execute code and can request admin/UAC (`securityContext:
  elevated`); start unelevated so user-scoped installs keep the user's identity.
- **V: W1:** `Microsoft.WinGet.DSC/WinGetPackage` installs packages;
  `Microsoft.VisualStudio.DSC/VSComponents` can apply workloads/components
  from `.vsconfig` (Microsoft's example permits prerelease resources).
  A package declaration for Build Tools alone does not prove C++/SDK installed.
  `winget configure show -f FILE`, `validate -f FILE`, `test -f FILE`, then
  `winget configure -f FILE` are the review/validation/application sequence.
  These files are proposals and are not present in this repository.
- **P:** WinGet installs rustup, not the chosen rustup toolchain or project
  override. `coreutils-manager disable link` is also an explicit post-install
  action. Generic DSC Script resources could do both, but add executable
  automation without a demonstrated need. WinGet import/export alone cannot
  represent these post-install states or a VS workload contract.
- **R; V: R1:** `devenv.nix` selects default nixpkgs Rust from pinned
  `devenv.yaml`; current local rustc/cargo are 1.98.1/1.98.0. No rustup or
  toolchain file is used. Direct Nix binaries ignore `rust-toolchain.toml`;
  devenv can explicitly use `languages.rust.toolchainFile` with rust-overlay.
  Existing Ubuntu CI invokes Cargo inside devenv, so a TOML file alone does
  not align CI. Rustup proxies elsewhere would honor it and might download
  a toolchain. Verify actual command paths before claiming cross-OS parity.

## Day-one setup, in order

Commands are for the **user on the PC**, after the decisions above. Agents
need the approved dependency contract before installation. Use an ordinary
account/terminal; allow installer UAC only where required. Reopen Terminal
after installers change PATH; restart opencode after configuration changes.

### 1. Establish PowerShell 7 and a short checkout location

**V: W2:** WinGet's `winget` source installs PowerShell MSI, not the Store
execution alias. Make Windows Terminal's profile launch that actual executable.

```powershell
winget --version
winget install --exact --id Microsoft.PowerShell --source winget
```

Open a fresh Terminal profile using `C:\Program Files\PowerShell\7\pwsh.exe`:

```powershell
$PSVersionTable
$PSHOME
where.exe pwsh
winver
```

- **P:** require edition `Core`, version >= 7.4 if Coreutils is installed;
  use current stable PS7 (Coreutils recommends >= 7.6 for `~` support).
- **V: W3:** optional Dev Drive: Windows 11 build >= 22621.2338, 8 GB RAM
  minimum/16 GB recommended, >= 50 GB free, admin setup. ReFS Dev Drive is
  Microsoft-recommended for repos/package caches, not VS/SDK/tool installs.
  Use Settings to create it only with user approval; do not repartition the
  shared KDE test PC as part of setup. Defender performance mode requires a
  trusted drive, Defender primary AV and real-time protection on (platform
  >= 4.18.2303.8, intelligence >= 1.385.1455.0). It scans asynchronously;
  it is not an exclusion. Verify `fsutil devdrv query D:` and Windows Security
  > Dev Drive protection. Keep default Cargo cache paths initially; a later
  `CARGO_HOME` relocation also requires updating the rustup shim PATH.

### 2. Install native Git and rg, then clone safely

**V: G2:** Git installer defaults: PATH option `Cmd` (Git from command line
and third-party tools), `core.autocrlf=true`, Credential Manager enabled.
Choose `Cmd`, not `CmdTools` (adds `mingw64\bin` and `usr\bin` GNU/MSYS tools).
For interactive installation choose "Checkout as-is, commit as-is"; WinGet
defaults can instead be overridden for this clone as shown. Git Bash remains
an explicit escape hatch; never the default agent shell or native build path.

```powershell
winget install --exact --id Git.Git --source winget
winget install --exact --id BurntSushi.ripgrep.MSVC --source winget
```

In a fresh PS7 window, verify `C:\src` exists/is the intended parent (create
it only if the user selected it), then:

```powershell
git clone --config core.autocrlf=false --config core.eol=lf --config core.longpaths=true https://github.com/beefsack/plasma-auto-tiler.git C:\src\pat
Set-Location C:\src\pat
git branch --show-current
git config --show-origin --get-regexp '^core\.(autocrlf|eol|longpaths)$'
git config --show-origin --get-all credential.helper
git check-attr text eol -- Cargo.toml kwin/src/entry.ts scripts/nix-host-kwin-build.sh devenv.nix kwin/native-effect/CMakeLists.txt docs/windows-dev-environment.md example.ps1 example.cmd
git ls-files --eol
git status --short
git diff --check
where.exe git
where.exe rg
rg.exe --version
$env:PATH -split ';'
```

- **V: G3:** Git `core.longpaths` covers built-in Git operations, not every
  shell/tool. **V: W4:** Windows' separate `LongPathsEnabled` opt-in also
  needs app `longPathAware` support (or supported extended-path APIs); it
  does not make every Rust build script/SDK/linker/Explorer path safe.
  **U:** this PC's deep Cargo target paths have not been tested. Prefer short
  checkout/cache/output roots; no policy write is needed on day one.
  Read-only check:

```powershell
Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled
```

- **P:** `example.ps1`/`example.cmd` above are deliberate attribute-pattern
  probes, not files to create. After adopting the proposal they should report
  `text: set`, with `eol: lf`/`crlf`; otherwise `unspecified` is expected.

### 3. Optional named CLI tools and Coreutils

**V: W5/W6:** only tools named by the global instructions/project are included.
Install needed tools after recording approved versions (WinGet supports
`--version VERSION`). qsv: choose the upstream Windows x64 MSVC release ZIP
and put `qsv.exe` in the user's approved tools directory on PATH; no verified
WinGet ID is assumed. No Node or additional package manager is needed for
the official opencode CLI executable or the portable Rust gates.

```powershell
winget install --exact --id jqlang.jq --source winget
winget install --exact --id MikeFarah.yq --source winget
winget install --exact --id GitHub.cli --source winget
winget install --exact --id Casey.Just --source winget
```

**V: W7:** Microsoft Coreutils is a separate preview Windows package built
on uutils (first release `v2026.5.29`), including a hard-link utility named
`link`. If selected, install and disable it **before building**:

```powershell
winget install --exact --id Microsoft.Coreutils --source winget
coreutils-manager disable link
where.exe link
Get-Command ls, ls.exe, cat, cat.exe, rm, rm.exe
```

- **V: W7:** PowerShell aliases shadow utilities; use `.exe` suffixes for
  native binaries. No sed/awk; use dedicated agent tools, PS7 or jq/yq/qsv.
  The PSReadLine input wrapper is interactive, not an agent-shell guarantee.
  Coreutils does not make POSIX scripts native PowerShell scripts.

### 4. Install Build Tools and an explicitly selected Rust MSVC toolchain

**V: R2/W8:** Desktop development with C++ plus recommended MSVC x64/x86
tools and Windows SDK; full Visual Studio IDE is unnecessary. Confirm these
components in Visual Studio Installer after installation.

```powershell
winget install --exact --id Microsoft.VisualStudio.2022.BuildTools --source winget --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --addProductLang En-us"
winget install --exact --id Rustlang.Rustup --source winget --override "-y --default-host x86_64-pc-windows-msvc --default-toolchain none --profile minimal"
```

Reopen PS7 at the checkout. Set `$RustVersion` to the user-approved exact
version; 1.98.1 is the laptop baseline, its rustup availability is **U**.
Stop/report an unavailable pin; do not silently select newer stable.

```powershell
$RustVersion = 'USER-APPROVED-VERSION'
rustup toolchain install "${RustVersion}-x86_64-pc-windows-msvc" --profile minimal --component rustfmt --component clippy
rustup override set "${RustVersion}-x86_64-pc-windows-msvc"
rustup show
rustup which rustc
rustup which cargo
rustc -vV
cargo -vV
where.exe rustc
where.exe cargo
```

- **P:** directory override is user-scoped rustup state, not a checked-in pin;
  use explicit `cargo +VERSION-x86_64-pc-windows-msvc` instead if preferred.
  Require `host: x86_64-pc-windows-msvc`; never GNU/MSYS for product builds.

### 5. Prove linker discovery and run native offline-development gates

**R:** source/dependency inspection, not an MSVC compilation result:

| Crate / gate | Native Windows recommendation |
| --- | --- |
| `tiler-core`, `tiler-protocol` | Build/test: pure Rust policy; zero normal core dependencies, protocol serde/serde_json. |
| `tiler-kwin-effect-ffi` | Include Rust tests/staticlib build: only portable Rust/core/serde/POD exports. Its Qt/KWin C++ consumer is Linux-only. |
| `plasma-auto-tiler` | Exclude: unguarded `rustix::process::geteuid` plus D-Bus/KDE service/tray integration. It cannot compile as-is on MSVC; Windows needs its own adapter. |
| fmt / strict clippy | fmt all packages without compilation; clippy only the allowlist. |
| KWin npm | `npm ci` and `typecheck` can use native Node >= 24. Current build/test scripts use POSIX `rm -rf`/`VAR=value`; tests also invoke `npx` with `execFileSync` (Windows `.cmd` issue). Keep build/tests on Linux unchanged. |
| Linux gates | Workspace Rust tests/clippy, `just check-portable` (bash/jq/grep), shell suites, Nix checks, native KWin build/CTest and user live tests stay on Linux. |

- **R:** Windows target std is absent from the laptop devenv sysroot; no
  offline `cargo check --target x86_64-pc-windows-msvc` was run or installed.
  **P:** explicit package flags are the smallest reliable boundary; changing
  `default-members` changes Linux defaults, while target-gating dependencies
  alone cannot repair unguarded Linux source. No Cargo changes are selected.

From ordinary PS7:

```powershell
where.exe link
cargo build --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi
cargo test --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi
cargo fmt --all -- --check
cargo clippy --locked -p tiler-core -p tiler-protocol -p tiler-kwin-effect-ffi --all-targets -- -D warnings
```

- **V: R3:** rustc's MSVC discovery normally finds an absolute VS linker and
  injects SDK/LIB/PATH even outside a Developer shell. No `where.exe link`
  result in ordinary PS can coexist with a successful Rust build. In a
  Developer environment (`VCINSTALLDIR`), discovery trusts the first matching
  PATH tool: a foreign `link.exe` there can break a build despite installed VS.
  Failed discovery falls back to PATH; explicit linker overrides can bypass
  the discovered executable. `cc` build scripts discover `cl`/`lib` too;
  scripts directly invoking `link.exe` still depend on their own PATH.
- **V: W9; P:** diagnostic: open Start's **x64 Native Tools Command Prompt
  for VS 2022**, then run this CMD command to inherit its environment in PS7:

```cmd
"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile
```

```powershell
where.exe link
where.exe cl
where.exe lib
link.exe /?
$env:VCINSTALLDIR
$env:LIB
$env:INCLUDE
```

- **P:** first linker must be Microsoft's MSVC `Hostx64\x64\link.exe`.
  Do not permanently add SDK/MSVC or Git `usr\bin` to PATH; do not set an
  arbitrary Cargo linker override to hide incomplete installation.
- **P:** proposed Windows CI job: `windows-latest`, `shell: pwsh`, checkout,
  approved MSVC Rust pin + rustfmt/clippy, the four commands above, then
  `git diff --check`. Add `-p tiler-windows` only once that package exists.
  No Nix/KWin/live tests in this job. Hosted runner preinstalled tools are
  **not** clean-runtime evidence [W10].
- **P:** Windows sessions touching shared code must pass these native gates
  plus all applicable Linux gates via user-authorized push/CI or the laptop.
  Report Linux gates pending until green; physical KDE/Windows acceptance is
  user-owned. Do not claim deferred gates passed. Root `just dev` remains
  Linux-only; a future PowerShell justfile is a Phase 1 proposal, not present.

### 6. Configure opencode and smoke-test the actual agent environment

- **V: O1; P:** download the chosen official Windows x64 **CLI** release
  archive from the opencode releases page; extract `opencode.exe` into an
  approved user tools directory on PATH. Record version and published asset
  digest where available. Do not add Chocolatey/Scoop/Node solely to install
  it. Native Windows is supported although upstream recommends WSL.
- **V: O2:** global paths are `~/.config/opencode/opencode.json` and
  `~/.config/opencode/AGENTS.md` (normally `$HOME\.config\opencode\...` on
  Windows). Transfer the user's existing global rules and named agents,
  adapt Linux paths and merge the snippets below; preserve provider settings.
- **V: O3:** processed-beef's documented plugin is
  `processed-beef@git+https://github.com/beefsack/processed-beef.git`.
  It registers skills, not agents. Restore the existing `gpt-sol` Lead and
  `muse-spark` Worker definitions/provider routing; full nesting uses
  `subagent_depth: 2` and appropriate task permissions. Do not invent model IDs.
- **O; U: O4:** reports cover Store pwsh -> 5.1 fallback, ripgrep extraction,
  Windows plugin cache paths containing illegal `:`, and Git/PATH casing.
  Reports are verified, their applicability/fix status on the chosen binary
  and processed-beef's native Windows compatibility are unverified. Installing
  rg on PATH does not prove opencode's internal bootstrap will use it.

```powershell
opencode --version
opencode debug config
```

- **P:** inspect effective config locally (it can contain secrets); restart
  opencode after changes. Ask the agent to make a shell tool call executing:

```powershell
$PSVersionTable
$PSHOME
Get-Location
Get-Command git.exe, rg.exe, rustc.exe, cargo.exe
rustc -vV
where.exe link
git status --short
```

- **P:** require `PSEdition = Core` from that **tool call**, not just Terminal;
  verify paths with spaces, dedicated glob/read/grep on `Cargo.toml`, skill
  loading, then one fresh read-only `gpt-sol` -> `muse-spark` Worker unit.
  Confirm effective task routing and permissions for both roles. A harmless
  `reg.exe query` request should be denied by the proposed rule; never probe
  an actual shutdown, policy write or destructive delete. Report failure.

### 7. Separate clean runtime from risky experiments

- **V: R4:** MSVC is genuinely native but defaults to dynamic C runtime.
  For the future Windows release binary, recommend target-scoped
  `-C target-feature=+crt-static`, with compatible native dependencies, to meet
  "no extra runtime installation". This is a build recommendation, not a
  Cargo change. In the VS environment inspect the actual executable:
  `dumpbin.exe /DEPENDENTS C:\path\to\actual-built.exe`. Only intended
  Windows 11 OS DLLs should be required, no VC redistributable/dev/MSYS DLLs.
  A staticlib `.lib` is not runnable runtime proof.
- **V: W11:** optional Windows Sandbox requires a supported edition
  (Pro/Enterprise/Education, not Home), BIOS virtualization, compatible CPU
  virtualization/SLAT, >= 4 GB RAM (8 recommended), two cores, >= 1 GB disk.
  Enable Windows Sandbox in Windows Features as a user/admin action; restart
  if prompted. It is a disposable test guest on the **PC**, not development
  in a VM or an assumption that the laptop can host one.
- **P:** map only the exact shipped-payload directory read-only, disable
  networking/clipboard in `.wsb`, copy payload into guest-local storage and
  run without installing Rust, Git, PS7 or build tools. Repeat on a clean
  machine if Sandbox is unavailable. Test startup/stop/restore there before
  general windows. **U:** actual runtime dependency closure is not yet proven.
- **V: W11:** closing Sandbox discards guest state; guest restarts retain it
  on Win11 22H2+, but writable mapped folders persist host changes. Avoid
  writable mappings. Win11 24H2 does not guarantee inbox Notepad/Terminal;
  bring the owned test harness. Verify process integrity: Sandbox's default
  user is an administrator, not proof of ordinary medium-integrity behavior.

| Phase 1 experiment | Environment and evidence limits |
| --- | --- |
| Clean binary startup; owned-window hide/reveal and forced-process-loss recovery | Sandbox first, then owned-window user repeat physically. Discarding the guest is containment, not proof the independent restore path works. |
| Win+L policy | Guest-only snapshot/write/readback/locking-API/restore experiment. **U:** redirected Win+L may reach the host; no primary guarantee of guest chord delivery or reliable guest unlock. Never modify host policy; defer if isolation is unavailable. |
| Win+Arrow, Snap/Start suppression, down/up and disable reversal | User's physical desktop; guest hooks see redirected input, not equivalent shell behavior. All four directions, ordinary integrity and game-disable proof. |
| Two monitors, mixed DPI, games/anti-cheat, UAC/secure desktop | Physical PC. Sandbox's one guest display is not the host's two-output topology (**U:** exact current display/input limits); vGPU/RDP is not physical game compatibility. |

### Verification checklist

- [ ] Approved Windows dependency contract, Rust pin and live-test boundary.
- [ ] Agent tool call: Core PS7, correct `$PSHOME`, native executable paths.
- [ ] `rustc -vV`: x86_64-pc-windows-msvc; approved version active in checkout.
- [ ] Native build/test/fmt/strict clippy pass; required Linux gates identified.
- [ ] `where.exe link` checked in ordinary and x64 VS environments; no foreign
  linker in the VS environment; Coreutils link disabled if installed.
- [ ] Git settings/origins, LF checkout/attributes, `core.longpaths`, short
  paths, clean status and `git diff --check`; no mass conversion.
- [ ] processed-beef skills and named Lead/Worker routing work; config restarted.
- [ ] Two physical displays/scale/work areas recorded by user; dual-boot confirmed
  or explicitly unknown. No boot/session changes assumed.
- [ ] Clean-runtime and independent recovery evidence obtained when a runnable
  Windows spike exists; no extra runtime install needed. Host input/game gates
  remain pending until user-tested.

## Proposed PC global AGENTS.md section

**P:** append to the user's existing global rules, not replace them. Root
dependency/live-testing amendments remain separate user decisions.

```markdown
## Native Windows

- Use native PowerShell 7 Core for shell calls; verify $PSVersionTable in a tool call.
- No WSL, MSYS/Git Bash default shell or GNU Rust target for native builds.
- Use dedicated read/search/edit tools; otherwise PowerShell and named native tools.
  Call .exe explicitly when PowerShell aliases would change semantics. No assumed sed/awk.
- Dependencies require the approved Windows contract; ask before installs, git-config,
  PATH, profile, registry/policy, security-setting or external-file changes.
- Build/test portable packages explicitly; root justfile/KWin/Nix gates run on Linux.
  Shared changes need applicable Linux evidence before acceptance.
- Do not execute input hooks, window movement/hiding or policy experiments without
  the approved Windows live-testing protocol and explicit scoped user authorization.
  Inspect build scripts/test targets before running; builds can execute code too.
- Prove independent stop/restore and out-of-hook recovery on owned test windows first.
  Never pause a hooking process in a debugger; no policy writes outside Sandbox.
- No broad deletes, security exclusions or changes to boot/session setup.
  Use the exact approved resource identity; ask on ownership/restoration ambiguity.
```

## Proposed opencode configuration

**V: O2/O5; P:** carry over the laptop's existing permission block and plugins
(`processed-beef@git+https://github.com/beefsack/processed-beef.git` and
`opencode-claude-auth@latest`), preserving `edit: ask`, `subagent_depth: 2`
and the existing bounded command allowlist. Merge these additions into the
PC's global `opencode.json`; do not replace the allowlist. `shell` applies to
agent shell tool calls; the permission key remains `bash` with PowerShell.
Patterns use literal command text and `*`, not regex alternatives. Keep the
existing `"*": "ask"` first and the deny rules last: last matching rule wins.
That catch-all already asks for deletes; `external_directory` defaults to ask.

Replace unavailable or differently behaving Unix command entries with the
PowerShell read-only equivalents below. **Only if Coreutils is installed**,
also add `allow` entries for `cat.exe *`, `head.exe *`, `tail.exe *`,
`ls.exe *`, `wc.exe *`, `sort.exe *`, `find.exe *`, `grep.exe *` and
`stat.exe *`. Use `Get-Command`/`where.exe` instead of assuming `which` exists.

```json
{
  "shell": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  "permission": {
    "bash": {
      "cargo fmt *": "allow",
      "Get-ChildItem*": "allow",
      "Get-Content*": "allow",
      "Select-String*": "allow",
      "Get-Command*": "allow",
      "Test-Path*": "allow",
      "Resolve-Path*": "allow",
      "where.exe *": "allow",
      "reg *": "deny",
      "reg.exe *": "deny",
      "regedit*": "deny",
      "Set-ItemProperty*": "deny",
      "New-ItemProperty*": "deny",
      "Remove-ItemProperty*": "deny",
      "shutdown*": "deny",
      "logoff*": "deny",
      "Stop-Computer*": "deny",
      "Restart-Computer*": "deny"
    }
  }
}
```

- **P:** retain the existing bounded allows; no auto-approve mode or blanket
  `cargo *`/`git *` allow. Review project and per-agent rules; they can override
  global rules. For commands outside the allowlist, approve once rather than
  "always" for a broad interpreter/build prefix.
- **V/U: O5:** permissions are command patterns, not a security sandbox.
  Aliases, case/path forms, nested interpreters, scripts, native APIs and
  imperfect directory inference can evade narrow patterns. Default ask is
  the containment; inspect actual commands and effective version behavior.
  Registry/lock experiments are user-run inside the guest, not permission
  exceptions for the host agent. Restart opencode after saving.

## Windows live-testing document: required outline

**P:** the Windows counterpart to [live KWin testing](live-kwin-testing.md)
should specify, before any relevant agent execution:

- Authority: user-approved operation/environment/resources, duration, owned
  test windows first; no inherited KWin authorization, autostart or elevation.
- Baseline: executable/hash, PID/start identity, user/session/integrity,
  displays/DPI, window ownership/geometry/visibility and policy preimages.
- Recovery: prove graceful stop, exact-identity emergency kill, independent
  owner-verified restore and mouse/shortcut access outside the hook before
  any hide or ordinary-app experiment; startup disabled for crash probes.
  HWND/PID reuse must not authorize restoring unrelated windows.
- Input: dedicated message-pump thread, immediate callback return, no waits
  or raw-keystroke logs. **V: W12:** LowLevelHooksTimeout can silently remove
  a hook on Win7+; Win10 1709+ caps it at 1000 ms. Never change that timeout
  or pause an active hooking process in a debugger (**P**, timeout consequence).
  Timeout is not hidden-window recovery. User recovery includes Ctrl+Alt+Del
  secure attention/Task Manager; an ordinary hook cannot replace SAS.
- Policy: no writes outside Sandbox; exact preimage/readback/restore inside
  guest, no claim that disabling locking simply relocates Win+L. No game,
  elevated-app or secure-desktop takeover. Physical observations are user-owned.
- Failure: stop on ambiguous identity, authority, residue or failed restoration;
  preserve evidence and report, not broad cleanup or retry loops.

## Risk table

| Risk | Trigger | Containment | Verification |
| --- | --- | --- | --- |
| CRLF/normalization churn | Git installer defaults or editor conversion | Proposed attributes, per-clone LF before checkout | Config origins, attributes, ls-files --eol, diff check |
| Wrong linker/native tool | Coreutils/Git usr-bin ahead in dev PATH; explicit override | Disable Coreutils link; Git Cmd PATH; VS discovery | Ordinary build plus first MSVC linker in x64 VS shell |
| Dependency/pin drift | Nix-only rule on Windows; rustup stable | User-approved Windows contract and parity pin | Versions/paths, workload/SDK inventory, both OS gates |
| Deep target path failure | Rust dependencies/build script uses legacy path API | Short repo/cache paths; Git longpaths is partial | Actual native build, OS policy readback |
| Desktop/input stranded | Hook hang, hiding, forced crash | Owned windows, independent restore/kill proven first | User live protocol and crash-recovery readbacks |
| Lock loss / invalid guest evidence | Win+L policy or redirected keyboard | Guest-only policy; no host writes; defer if unavailable | Guest exact restore; physical chord remains unproven |
| AV block / SmartScreen reputation | Low-prevalence unsigned builds; detection | Keep Defender/SmartScreen on; inspect own hash/detection, submit false positive | Windows Security history and Microsoft submission [W13]; **U** hook-specific keylogger heuristic, not guaranteed |
| Slow build | Scan-heavy repo/cache | Optional trusted Dev Drive performance mode, no broad exclusions | Drive query, Defender UI, measured build [W3] |
| Extra runtime dependency | Dynamic CRT/dev DLLs | Future static CRT and artifact-only clean guest/machine | dumpbin imports plus clean launch; hosted CI insufficient |
| Agent environment mismatch | Store alias, rg bootstrap, git plugin cache/path issue | Absolute MSI pwsh, official CLI, fresh smoke before delegation | Tool-call Core/version/path, dedicated search, skills and routing |

## Sources

All accessed **2026-09-30**. Primary docs/source verify mechanisms; issue
reports do not prove current-PC behavior. Local inspection is **R**, not a
Windows execution result.

- G1: [Git attributes](https://git-scm.com/docs/gitattributes).
- G2: [Git installer options/defaults](https://gitforwindows.org/silent-or-unattended-installation.html), [installer source](https://github.com/git-for-windows/build-extra/blob/master/installer/install.iss).
- G3: [Git for Windows core.longpaths source docs](https://github.com/git-for-windows/git/blob/master/Documentation/config/core.adoc).
- R1: [devenv Rust](https://devenv.sh/languages/rust/), [module implementation](https://github.com/cachix/devenv/blob/main/src/modules/languages/rust.nix), [rustup overrides](https://rust-lang.github.io/rustup/overrides.html).
- R2: [rustup MSVC setup](https://rust-lang.github.io/rustup/installation/windows-msvc.html), [rustup installer arguments](https://rust-lang.github.io/rustup/installation/other.html).
- R3: [rustc linker discovery](https://github.com/rust-lang/rust/blob/master/compiler/rustc_codegen_ssa/src/back/linker.rs), [find-msvc-tools 0.1.14](https://docs.rs/find-msvc-tools/0.1.14/src/find_msvc_tools/find_tools.rs.html) (especially lines 517-553), [cc](https://docs.rs/cc/latest/cc/).
- R4: [Rust CRT linkage](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes), [dumpbin /DEPENDENTS](https://learn.microsoft.com/en-us/cpp/build/reference/dependents?view=msvc-170).
- W1: [WinGet configure](https://learn.microsoft.com/en-us/windows/package-manager/winget/configure), [authoring/VS resources/UAC](https://learn.microsoft.com/en-us/windows/package-manager/configuration/create).
- W2: [PowerShell Windows installation](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows).
- W3: [Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/), [Defender performance mode](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-antivirus-performance-mode).
- W4: [Windows long paths](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation).
- W5: [WinGet manifests](https://github.com/microsoft/winget-pkgs): [rg MSVC](https://github.com/microsoft/winget-pkgs/tree/master/manifests/b/BurntSushi/ripgrep/MSVC), [jq](https://github.com/microsoft/winget-pkgs/tree/master/manifests/j/jqlang/jq), [yq](https://github.com/microsoft/winget-pkgs/tree/master/manifests/m/MikeFarah/yq), [gh](https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/GitHub/cli).
- W6: [just Windows installation](https://just.systems/man/en/packages.html), [qsv Windows release assets](https://github.com/dathere/qsv/releases).
- W7: [Microsoft Coreutils overview](https://learn.microsoft.com/en-us/windows/core-utils/overview), [preview/manager/shell conflicts](https://github.com/microsoft/coreutils), [first release](https://github.com/microsoft/coreutils/releases/tag/v2026.5.29).
- W8: [VS Build Tools workloads/components](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022).
- W9: [VS native command-line environments](https://learn.microsoft.com/en-us/cpp/build/building-on-the-command-line?view=msvc-170).
- W10: [GitHub hosted runner images/software](https://github.com/actions/runner-images).
- W11: [Sandbox editions/requirements](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/), [installation](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install), [configuration/isolation/persistence](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file).
- W12: [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), [Windows shortcut/security path context](research/windows-port/plan.md#shortcuts-and-host-setting-conflicts).
- W13: [Defender false positives](https://learn.microsoft.com/en-us/defender-endpoint/defender-endpoint-false-positives-negatives), [submission](https://www.microsoft.com/wdsi/filesubmission), [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
- O1: [Native install docs](https://opencode.ai/docs/), [official CLI releases](https://github.com/anomalyco/opencode/releases), [Windows guidance](https://opencode.ai/docs/windows-wsl).
- O2: [opencode config/shell](https://opencode.ai/docs/config/), [global rules](https://opencode.ai/docs/rules/), [published schema](https://opencode.ai/config.json).
- O3: [processed-beef integration/roles](https://github.com/beefsack/processed-beef/blob/main/docs/integrations/opencode.md).
- O4 (**O**): [Store shell resolution #41426](https://github.com/anomalyco/opencode/issues/41426), [rg extraction #24489](https://github.com/anomalyco/opencode/issues/24489), [git plugin cache path #22280](https://github.com/anomalyco/opencode/issues/22280), [Git/PATH #21826](https://github.com/anomalyco/opencode/issues/21826).
- O5: [opencode permissions/patterns/agent overrides](https://opencode.ai/docs/permissions/), [Windows child-process .cmd limitation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).
- **R:** `Cargo.toml`, `crates/*/Cargo.toml`, FFI Rust sources,
  `crates/plasma-auto-tiler/src/planner_service.rs`, `devenv.nix`, `devenv.yaml`,
  `.github/workflows/ci.yml`, `justfile`, `kwin/package.json`,
  `kwin/tests/{trace,source-rev,artifact-smoke,refresh-quiet-trace}.test.ts`;
  `git ls-files --eol`, current sysroot inventory. No Windows target installed.
- **U remaining:** dual-boot arrangement, rustup availability of the laptop
  pin, actual tool/plugin/permission behavior on the chosen opencode version,
  exact Sandbox display/input behavior, security detection, deep target paths,
  clean runtime closure and all physical shortcut/display/game acceptance.
