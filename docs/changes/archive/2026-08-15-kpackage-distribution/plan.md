# KPackage Distribution Plan

## Approach

Use only existing declared tooling, including Info-ZIP and `kpackagetool6`; this
change does not add system, native, or project dependencies. Build JavaScript
before creating a clean staging tree, then create the ignored release archive
and checksum from that tree. All install validation is isolated in disposable
temporary roots.

The production interface is `bash scripts/build-kpackage.sh --output-dir <dir>`;
without `--output-dir`, it writes to repository-root `dist`. The script resolves its
production package source relative to the repository and exposes no
source/package-root override. Tests live in `scripts/build-kpackage.test.sh`,
use isolated fixture repository copies, and may use established `*_BIN` command
overrides only to make required external commands deterministic. Relative
overrides must resolve to stable executable paths before the script enters a
staging directory.

## Units

| ID | Unit | Scope | Dependencies | Verification evidence | Status |
|---|---|---|---|---|---|
| unit-01 | Regression-first contract tests | In `scripts/build-kpackage.test.sh`, add failing coverage using an isolated fixture repository copy for declared-build-before-staging: a build-order sentinel must replace stale/manual bundle content and the newly generated bundle must be archived; the exact ordered four-member whitelist; regular-file sources with no symlinks; normalized timestamp, mode, and extra fields under locale/timezone variation; byte identity and SHA-256 sidecar semantics; and no partial archive or sidecar outputs on build/archive failure. Isolated validation arguments must be rooted in the fixture. No source-root or member input is exposed: safety is structural through the fixed repository-relative whitelist, regular-file checks, and exact archive audit. Native-effect exclusion follows from the exact members. | Approved spec | Focused contract test passes against the production command. | Accepted and complete 2026-08-15 |
| unit-02 | Packaging implementation | Build JavaScript before staging; implement deterministic safe staging and Info-ZIP archive/checksum generation under the approved ignored dist path. | unit-01 | Passing contract tests; archive member listing; generated bundle provenance; Git ignore evidence. | Accepted and complete 2026-08-15 |
| unit-03 | Determinism and isolation evidence | Run two clean builds under stable locale/timezone and compare archive SHA-256; validate through temporary `HOME`, XDG roots, and `--packageroot`, including containment and success/failure cleanup checks. This unit exclusively supplies full temporary install-tree and cleanup evidence. | unit-02 | Matching byte hashes; ZIP metadata audit; isolated install tree and cleanup assertions. | Accepted and complete 2026-08-15 |
| unit-04 | Independent review then comprehensive verification | Initial independent KPackage review is accepted with correction required. After `unit-05`, independently re-review path safety, temporary-install isolation, and the correction before executing the full acceptance suite. | unit-05 | Corrective reviewer acceptance, then complete evidence map and final verification record. | Accepted and complete after independent corrected re-review 2026-08-15 |
| unit-05 | Mandatory KPackage review correction | Update the packaging command and focused unit test only: default release output is repository-root `dist`; preserve the `--output-dir` interface; publish archive and sidecar failure-safely with rollback/preservation across build, validation, and either publication failure; final release modes are `0644`; resolve relative declared `*_BIN` overrides before staging-directory `cd`; and require the installed tree to contain exactly the real plugin-root, `contents`, and `contents/{code,config,ui}` directories with no symlinks or external directories. Tests exercise the real default command against a fake declared build that cleans `kwin/dist`, existing-output failure preservation, exact timestamp normalization, final modes, relative override behavior, and external empty-directory rejection. | unit-03 | Focused tests and production checks demonstrate all corrected behavior; scoped diff and whitespace checks pass. | Accepted by independent final re-review 2026-08-15 |

## Acceptance-Evidence Map

| Acceptance criterion | Evidence-producing unit | Evidence |
|---|---|---|
| `.kwinscript`, ZIP, `KWin/Script`, exact members | unit-01, unit-02 | Contract assertions and ZIP member listing. |
| Build-before-stage and no manual generated bundle edits | unit-01, unit-02 | Build/staging test and generated-file provenance. |
| Safe regular files, normalized metadata, stable environment/order, byte identity | unit-01, unit-03 | Safety assertions, ZIP audit, two clean hashes. |
| Default ignored archive/checksum, `--output-dir`, and one release artifact | unit-05 | Real default-command and explicit-output tests; ignore and output-path evidence. |
| Failure-safe archive/sidecar pair and final `0644` modes | unit-05 | Existing-output preservation across forced build, validation, and either publish failure; final mode assertions. |
| Stable relative declared tool overrides | unit-05 | Relative `*_BIN` override test across staging-directory entry. |
| Temporary `HOME`/XDG/packageroot containment and cleanup | unit-03 | Install-boundary and cleanup assertions. |
| Excluded native, publishing, package, and live operations | unit-01, unit-04 | Exact member whitelist excludes native effect payloads; scoped diff review covers the remaining exclusions. |
| Independent safety/isolation review before final verification | unit-04 | Independent review record preceding final verification. |

## Completion Outcome

- Status: statically delivered and reproducible on 2026-08-15. All acceptance
  criteria are accepted after the mandatory independent review correction and
  corrected independent re-review.
- Two independent archives are byte-identical: 69642 bytes, SHA-256
  `99afa2657f6707c6e19399ff7fd6a7d872baf333a03e495cad471e53f616fd75`.
  Each sidecar is exactly `<digest>  plasma-auto-tiler-kwin.kwinscript`.
- The normalized ordered members are exactly `metadata.json`,
  `contents/code/main.js`, `contents/config/main.xml`, and
  `contents/ui/config.ui`; entries are regular files with the normalized
  timestamp and no ZIP extra fields.
- Isolated `kpackagetool6` validation installed only the exact package tree
  under its disposable root and removed temporary state. The focused suite also
  proves failure cleanup and output-pair preservation.
- Accepted non-live baseline evidence: typecheck and build passed; generated
  bundle SHA-256 was
  `7d422cfec258edb2682d41c6abd0e5055c1ad562d28418689aa8bfff437fb4ba`;
  Node 805/76, start 271, fake live 195, and dogfood 156 passed. Scoped diff
  and whitespace checks passed.

## Unit-01 Interface And Attempt Clarification

- Production command: `bash scripts/build-kpackage.sh --output-dir <dir>`;
  omitted output directory defaults to repository-root `dist`.
- Production package source is resolved relative to the repository. No
  source/package-root override is part of the command interface.
- Fixture repository copies isolate tests. Established `*_BIN` overrides are
  limited to deterministic external-command substitution and do not expand the
  production package source scope.
- `unit-01/attempt-01` and `unit-01/attempt-02` are rejected. Neither test
  harness is accepted.
- The replacement attempt is limited to the focused regression contract in the
  unit table. Its build-order sentinel must show that stale or manually written
  bundle content cannot be staged.
- Absolute and traversal safety require no malicious-entry injection test: the
  fixed repository-relative whitelist accepts no source-root or member input,
  regular-file checks reject unsafe sources, and an exact archive audit proves
  the resulting members.
- Unit-01 may only assert that any isolated validation arguments are rooted in
  its fixture. Temporary `HOME`, XDG, `--packageroot`, install-tree containment,
  and cleanup evidence remain exclusively in unit-03.
- The mandatory review correction retains the fixed repository-relative source
  boundary. It changes only generated-output handling, command-override path
  resolution, and their focused regression coverage.

## Review Gate

Unit-04 begins with a reviewer independent from the implementation Worker.
Path traversal, absolute paths, symlinks, and writes outside temporary install
roots are mandatory review topics. Any unresolved finding blocks comprehensive
verification.

The initial independent KPackage review is accepted with correction required.
After unit-05, an independent re-review must also cover repository-root default
output, failure-safe pair publication, final modes, and stable relative command
override resolution before comprehensive verification resumes.

## Residual Risks

- KDE Store and GitHub Release publication are deliberately manual and remain
  outside this change.
- No live installation, enablement, or KWin behavior validation is performed;
  the isolated package installation test does not prove live runtime behavior.
- Existing declared tools must be available in the active environment before
  the implementation units begin.

## Pending User Decisions

None.
