# Windows tray and first-run preset

## Goal and scope

- Add an owner-owned official Win32 notification icon with KDE-parity supported
  status/menu, Settings, unresolved shortcut conflict warning, and Stop.
- Offer authentic (default) or compatible before normal first startup when the
  settings file is absent, with brief Game Bar/Xbox disclosure.
- Omit workspace controls if their runtime is unsupported; no taskbar workspace
  indicator, registry/policy writes, new toolkit or unrelated refactoring.

## Acceptance

- Icon/menu reflect current owner settings; Settings opens the existing UI and
  Stop follows normal owner cleanup. TaskbarCreated re-add and crash recovery
  remove/reconcile the icon through official APIs.
- First-run choice persists through the validated store; existing settings and
  explicit proof configuration retain their intended semantics.
- Native locked build/test/strict all-target clippy and rustfmt pass; independent
  review has no blocking findings; pushed commits have green hosted CI.
- Scoped live proof and screenshots demonstrate prompt, tray, Settings, Stop,
  conflict updates and posted TaskbarCreated recovery without killing Explorer.
- Restore settings-file absence, no project owner/helper/UI/overlay/ledger,
  normal taskbar, SPI arranging 1 and pen visualization 35. Hosting Terminal
  survives; close only disposable apps opened by this change.

## Units and approach

1. Investigate KDE/Windows runtime and implement the smallest coherent tray and
   first-run slice; targeted regression checks and native gates.
2. Independent review and bounded corrections; live proof using identified owned
   actors and existing recovery paths; final native gates and hosted CI.
3. Promote provisional decisions, record evidence and archive this note.

## Material decisions and evidence

- Initial tree clean on main, tracking origin/main. Live
  authorization and hosting-Terminal boundary read in full.
- First-run tests must restore the original absent settings file. Physical
  input and real Explorer restart remain user-owned; use a posted registered
  TaskbarCreated message for automated recovery proof.
- Independent review rejected hover-pruned crash ghosts, pre-lease prompting,
  stale first-run overwrite, duplicate TaskbarCreated adds, mandatory teardown
  panics and a falsely headless tray test. Corrections use one stable icon GUID
  deleted under the existing recovery lease, lease-held prompting, atomic
  create-if-absent publication, MODIFY-first recovery and RAII teardown.
- Follow-up review accepted lifecycle corrections. Unused boolean
  policy helpers and implementation-mirroring tests removed; actual storage no-overwrite
  coverage remains. Current native gates await the final live-verification unit.
- Provisional choices: Yes=Authentic (default), No=Compatible via native prompt;
  current workspace/default mode controls omitted because Windows runtime has
  no workspace tiled/floating state; warning covers enabled actual G/F11 chords
  with known incomplete containment and kept Win+L with runtime opt-in, and
  clears when takeover is disabled.
- Live integration exposed the separate Settings process being admitted and
  shrunk by the unfiltered owner. A scoped/unfiltered differential established
  the cause. Own executable plus Settings class now uses existing dialog skip
  gates for observation, held targets and hide admission; targeted regression
  covers own/foreign executable and other-class distinctions.

## Accepted verification and outcome

- Native locked build/test and strict all-target clippy for `tiler-core`,
  `tiler-protocol`, `tiler-kwin-effect-ffi`, `tiler-windows`, full rustfmt and
  diff checks pass after the final source change. Installed native MSVC Cargo
  was used because mise is unavailable; no tool/dependency installs.
- Live proof on 2026-10-04, physical Windows 11 build 26200, medium/session 1,
  DISPLAY1 2560x1440 DPI 120. Broker-launched owners and an identified helper;
  no ordinary app opened, no gaming/lock chord injected, no Explorer kill.
  Final normal owner was unfiltered, allowing Settings admission proof.
- First-run default Yes/Authentic and No/Compatible saved correctly; compatible
  has 35 disabled rows. Existing-file startup skips prompt, a second owner
  refuses before UI, and accepting a stale choice preserves an appeared file.
- Initial tray interaction evidence was rejected: fixture used the wrong
  NIF_GUID constant, lacked Unicode registration and PMv2 pixel handling, and
  missed the icon in Explorer's overflow. Corrected native structures/constants,
  DPI handling and exact UIA icon lookup established the fixture before retest.
  Earlier mistaken SPI reports are superseded by explicit numeric GET readbacks.
- Full UI/lifecycle proof artifact
  `target/windows-tray-first-run/final/tiler-windows.exe` SHA-256:
  `050812DF93BC6121172349E0F3DA704C6F0B0B010EA00ED40EA0B4DDEBED8758`.
  Live source was baseline `a09ddda` plus this reviewed change. Final owner log
  `run-01dd53b171994141.log`, PID 9972, Explorer-child, 600-second cap.
- Final screenshots inspected: visible warning glyph in overflow, both
  menu buttons, conflict/status/Settings/Stop, and full usable Settings client
  (1173x962 at DPI 120). Conflict and Settings rows bring the same singleton UI.
  Compatible/Apply clears the warning row; Authentic/Apply reinstates it.
- Posted TaskbarCreated with present icon logs `revalidated`; fixture deletion
  of our GUID followed by the registered message logs `re-added`, with one
  overflow icon. Actual Stop clicked before the deadline: `tray-end`,
  `tile-end`, stopped run, no process/window/icon. Separate exact-owner crash
  and independent restore leave GUID GetRect failing and no ghost.
- Local ignored evidence: `target/windows-tray-first-run/evidence.jsonl` and
  `final-*.png`. Key screenshot SHA-256 values:
  - `final-settings-full.png`:
    `C1F7BF01D205C1E3CC3F9CCAD86081C9BF6BE5126C7EE1ABC808ACA754A21BEA`.
  - `final-menu-left.png` (right-click screenshot identical):
    `7800457EB6CCCFBC5383C3FDBF2BC9C7FF7883BA193529B881E41B55B6F5A96F`.
  - `final-overflow-icon.png`:
    `B03B187205AE7A5C2B4E9A5FBCE3EC08FC241389F69781E76E8B4DF95F587993`.
- Final stop/restore and read-only recheck: no project actor, Settings,
  prompt, tray window or ledger; settings-file absence restored; SPI arranging
  GET succeeds with 1, pen visualization GET succeeds with 35; normal taskbar
  present and hosting Terminal survived.
- Final acceptance review included the unresolved opt-in Win+L lock chord.
  Projection now uses both effective runtime takeover and allow-Win+L lanes;
  targeted tests cover gate, CLI-over-file policy, rebind-away and disable.
  All four native package gates passed again after that correction.
- Latest artifact `target/windows-tray-first-run/lock-check/tiler-windows.exe`
  SHA-256 `202443EA02DB24EF556CFC1D9AC6EEBC1C890688D6D0A347F66425EF4EEFF763`.
  Narrow live differential: compatible with only focus-right kept produces no
  warning while gated; same unchanged file with `--allow-win-l` produces warning
  row and full Settings UI. File allow-Win+L remains false, proving runtime CLI
  policy. No lock chord was injected. TaskbarCreated and actual Stop pass on
  this artifact; cleanup confirms settings absent, no actors/UI/ledger, SPI 1/35.
  `lockcheck-menu-allowed.png` SHA-256:
  `72B6E5A00FA945058E9F85D1676276C77FB336D6B7F8DBD61D9A72D94F2C112C`.
- Implementation and decisions committed/pushed as `60fd7bb`; all hosted CI
  jobs green (Windows native, Linux Rust/KWin/shell, macOS tooling):
  <https://github.com/beefsack/OmniTiler/actions/runs/37175689240>.
  Accepted evidence complete; record archived. No implementation next action.

## Residual user-owned checks

- Physical tray/mouse/keyboard feel, actual user-driven Explorer restart,
  real Xbox/Game Bar containment and other DPI/output setups.
- Explorer controls overflow placement; UIA may concatenate old/new tooltip
  strings after updates. Menu, saved revision and glyph are the effect evidence.
- Workspace-mode controls await runtime support; taskbar workspace indicator
  remains parked.
