# Specification: Distribution Package Feasibility

Ownership and approval:
- Owner: Lead
- Status: Bounded research complete and archived 2026-08-15

## Intent and Desired Outcome

Record the bounded feasibility and acceptance boundary for a future deterministic
KWin script distribution artifact. This archive does not build, publish,
install, or otherwise deliver a package.

## Scope and Non-Goals

In scope:

- Define the proposed artifact payload as exactly its metadata, generated
  `main.js`, KConfig schema, and KCM UI.
- Record deterministic ZIP reproduction and temporary-root KPackage installation
  as future acceptance requirements.
- Record the undeclared tooling dependency and the unverified `.kwinscript`
  extension/install behavior.

Non-goals:

- Release-channel selection, signing, update delivery, effect packaging, and
  version policy.
- Any source, generated-output, dependency, installer, live-KWin, or package
  delivery change.

## Constraints

- The artifact must contain exactly `metadata.json`,
  `contents/code/main.js`, `contents/config/main.xml`, and
  `contents/ui/config.ui`.
- A future implementation requires `kpackagetool6` and ZIP creation/inspection
  tooling, neither of which is declared by the current `devenv.nix`.
- Changing `devenv.nix` requires the user to restart the session before the new
  dependencies are assumed available.
- The accepted `.kwinscript` archive extension and its install behavior remain
  unverified.

## Acceptance Criteria

- [ ] A clean reproduction creates a ZIP with the exact four-file payload,
  sorted entries, and normalized ZIP metadata; repeated builds are byte-for-byte
  identical.
- [ ] A `kpackagetool6` installation into a temporary data root accepts the
  artifact and exposes the expected KWin script package without using host
  Plasma data.
- [ ] The target runtime confirms whether the `.kwinscript` extension is
  accepted by the selected install path.
- [ ] Tooling is declared through `devenv.nix`, with the session restarted
  before verification uses it.

## Unresolved Questions

- Which release channel, signing mechanism, update path, effect packaging
  policy, and version policy should govern a delivered package?

## Parked State

Implementation is parked pending the separate decisions and the dependency
change above. The [installer dry-run archive](../2026-08-14-installer-dry-run/plan.md)
is inspection-only evidence, not package delivery.
