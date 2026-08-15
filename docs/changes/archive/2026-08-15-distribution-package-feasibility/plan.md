# Plan: Distribution Package Feasibility

Ownership and approval:
- Owner: Lead
- Status: Research complete; implementation parked 2026-08-15

## Technical Approach

No implementation is scheduled. A future bounded implementation must stage only
the four specified files, create a sorted ZIP with normalized metadata, and use
`kpackagetool6` only against a temporary data root. It must first declare the
required system tools in `devenv.nix`; the user must restart the session before
those tools are used.

## Work Units

| ID | Objective | Depends on | File scope | Verification |
|---|---|---|---|---|
| distribution-package-01 | Produce and verify the deterministic script archive. | User decisions; `devenv.nix` dependency declaration and session restart; target-runtime extension confirmation | Future packaging-only scope | Repeat clean ZIP production; compare bytes; inspect sorted normalized entries; install with `kpackagetool6` in a temporary data root. |

## Progress

- [x] distribution-package-01 research boundary recorded.
- [ ] distribution-package-01 implementation and verification are parked.

## Pending User Decisions

- Select the release channel, signing mechanism, update path, effect packaging,
  and version policy independently of this archive.
- Approve the `devenv.nix` dependency change and restart the session before any
  implementation verification.

## Acceptance-Criterion Evidence

| Acceptance criterion | Required reproducible evidence | Current result |
|---|---|---|
| Exact payload | Archive listing contains only `metadata.json`, generated `contents/code/main.js`, `contents/config/main.xml`, and `contents/ui/config.ui`. | Not run; implementation parked. |
| Deterministic ZIP | Two clean builds have identical checksums; listing proves sorted entries and normalized ZIP metadata. | Not run; ZIP tooling is undeclared. |
| Isolated KPackage install | `kpackagetool6` installs the artifact with a temporary data root and the installed package is inspected there. | Not run; `kpackagetool6` is undeclared. |
| `.kwinscript` behavior | Target-runtime install evidence records extension acceptance and resulting package discovery. | Unverified. |

## Residual Risks

- The accepted `.kwinscript` extension/install behavior has not been confirmed.
- No release, signing, update, effect-package, or version-policy decision exists.
- The [installer dry-run archive](../2026-08-14-installer-dry-run/plan.md)
  remains inspection-only and supplies no package-delivery evidence.

## Final Outcome

- This is a research archive, not a package delivery. Source files,
  `devenv.nix`, and installer behavior were not changed.
