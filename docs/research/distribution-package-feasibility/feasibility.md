# Distribution Package Feasibility

Status: Bounded research complete. The reproducible KPackage artifact is
delivered locally; KDE Store and GitHub Release publication remain manual.

## Accepted Documentation Basis

- [Package composition research](../integrated-plasma-structural-feasibility/package-composition.md)
  records the KWin script package entrypoint plus its KConfig schema and generic
  KCM UI surface. It also leaves package lifecycle behavior requiring runtime
  confirmation.
- [The package build script](../../../scripts/build-kpackage.sh) creates the
  reproducible artifact and validates it in a temporary package root before
  publishing the local output.

## Delivered Artifact Boundary

The delivered deterministic artifact contains exactly these four files:

```text
metadata.json
contents/code/main.js
contents/config/main.xml
contents/ui/config.ui
```

`contents/code/main.js` is generated output. The artifact has no effect
payload, release metadata, signing material, updater, or additional files.

## Delivered Artifact Evidence

The delivered local artifact is `plasma-auto-tiler-kwin.kwinscript`, 69642 bytes,
with SHA-256
`99afa2657f6707c6e19399ff7fd6a7d872baf333a03e495cad471e53f616fd75`. Its
payload is the exact four-file set above. The build validates installation with
`kpackagetool6` under a temporary package root before publishing the archive and
checksum sidecar. KDE Store and GitHub Release publication are not claimed.

## Build Boundary

The build requires `kpackagetool6`, ZIP tooling, `npm`, and `sha256sum`. No
additional package lifecycle or release-channel behavior is inferred.

Release signing, updates, effect packaging, and version policy are outside the
delivered artifact. No behavior beyond the local reproducible package is claimed.
