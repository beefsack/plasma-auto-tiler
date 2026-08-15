# KPackage Distribution Specification

## Intent

Produce a reproducible KWin Script distribution archive suitable for KDE Store
and GitHub Release publication without changing a user's live Plasma state.

## Scope

- Package type: `KWin/Script`.
- User-facing artifact suffix: `.kwinscript`; archive format: ZIP.
- Archive contains exactly these four regular files:
  - `metadata.json`
  - `contents/code/main.js`
  - `contents/config/main.xml`
  - `contents/ui/config.ui`
- Build the JavaScript bundle before staging it; generated bundle content is
  never hand-edited.
- Create the archive from clean deterministic staging with safe regular files
  only: no symlinks, absolute paths, or traversal paths.
- Normalize timestamps, modes, ZIP metadata, locale, timezone, and entry order.
  Use the existing declared Info-ZIP tools.
- Generate release output and its `.sha256` under repository-root `dist` by
  default; `--output-dir` remains available. Both are ignored and never
  committed. The one byte-identical archive is the artifact for both KDE Store
  and GitHub Release.
- Publish the archive and sidecar as a failure-safe pair: failures while
  building, validating, or publishing either member preserve prior output and
  leave no orphaned or mismatched pair. Final release files use mode `0644`.
- Resolve relative declared `*_BIN` overrides to stable executable paths before
  entering staging directories.
- Validate with `kpackagetool6` using temporary `HOME` and XDG roots plus
  `--packageroot`. Assert installed output remains below the temporary root and
  clean temporary paths on success and failure.

## Non-Goals

- Native `.so` payloads or dependencies.
- Signatures, attestations, publishing automation, or distribution packages.
- Live installation, enablement, reconfiguration, KWin effects, or shortcut
  migration.
- Writes to user paths, user configuration, or a live KWin session.

## Acceptance Criteria

1. The generated `.kwinscript` is a ZIP KPackage of type `KWin/Script` and has
   exactly the four scoped members.
2. The staged payload contains only safe regular files and the generated
   JavaScript bundle was built before staging, not manually changed afterward.
3. Two independent clean builds produce byte-identical archives and matching
   SHA-256 values under stable locale, timezone, timestamps, modes, metadata,
   and ordering.
4. The archive and checksum are generated under ignored repository-root `dist`
   by default, or the requested `--output-dir`, and are not committed; the same
   archive is usable for KDE Store and GitHub Release. Existing output is
   preserved on build, validation, or either publication failure, neither
   output is orphaned or mismatched, and final modes are `0644`.
5. Isolated `kpackagetool6` validation uses temporary `HOME`, XDG roots, and
   `--packageroot`; installation is proven contained and temporary state is
   removed on both success and failure.
6. No excluded capability is introduced or exercised.
7. An independent review accepts path safety and temporary-install isolation
   before final comprehensive verification.
8. Unit tests exercise the real default command against a fake declared build
   that cleans `kwin/dist`, existing-output failure preservation, exact
   timestamp normalization, final modes, and relative `*_BIN` overrides.

## KDE Suffix Evidence

KWin 6.7.3 uses `KWin Script (*.kwinscript)` in its import dialog and passes
the selected file to `PackageJob::update("KWin/Script", ...)`:
https://github.com/KDE/kwin/blob/45ec9a6d0ed312a803ff5658a2a3e61f221566c6/src/kcms/scripts/module.cpp#L46-L62

The suffix is user-facing convention. ZIP runtime acceptance is a separate
accepted constraint and must not be inferred from the suffix.

## Decisions And Questions

- Approved decisions: all scope and non-goals above.
- Pending decisions: none.
