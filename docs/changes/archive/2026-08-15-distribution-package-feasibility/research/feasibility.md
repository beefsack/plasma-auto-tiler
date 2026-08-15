# Distribution Package Feasibility

Status: Bounded research complete. This records an accepted future artifact
boundary and its required proof. No archive was built, installed, published, or
delivered.

## Accepted Documentation Basis

- [Package composition research](../../../integrated-plasma-structural-feasibility/research/package-composition.md)
  records the KWin script package entrypoint plus its KConfig schema and generic
  KCM UI surface. It also leaves package lifecycle behavior requiring runtime
  confirmation.
- [Installer dry-run archive](../../2026-08-14-installer-dry-run/plan.md)
  records an inspection-only command. It neither creates a package nor changes
  distribution, release-channel, or live-install behavior.

## Proposed Artifact Boundary

The future deterministic artifact contains exactly these four files:

```text
metadata.json
contents/code/main.js
contents/config/main.xml
contents/ui/config.ui
```

`contents/code/main.js` is generated output. The artifact has no effect
payload, release metadata, signing material, updater, or additional files.

## Required Future Proof

1. Build from a clean input state twice. Each ZIP must contain the exact
   four-file payload above, list entries in sorted order, normalize ZIP metadata,
   and match byte-for-byte.
2. Use `kpackagetool6` only with a temporary data root to install the resulting
   artifact. Inspect that temporary root to establish package discovery without
   writing host Plasma data.
3. Confirm on the target runtime whether the `.kwinscript` archive extension is
   accepted by the selected install path. Its accepted extension/install
   behavior remains unverified.

## Dependency Boundary and Parked State

The current `devenv.nix` declares neither `kpackagetool6` nor ZIP
creation/inspection tooling. A future implementation must add the required
system dependencies there. Because a `devenv.nix` change requires a user session
restart before the dependency is assumed available, implementation is parked.

Release channel, signing, updates, effect packaging, and version policy are
separate decisions. This archive does not select any of them and does not claim
package delivery.
