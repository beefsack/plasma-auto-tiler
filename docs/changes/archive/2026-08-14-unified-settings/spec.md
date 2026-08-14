# Unified Settings

## Intent

Provide the smallest platform-standard KConfigXT-backed settings surface for
the existing KWin script configuration, while preserving every current default
and startup behavior.

## Scope

- Add the generic scripted-KCM package metadata and a KConfigXT schema.
- Expose `tilingAlgorithm`, defaulting to the current automatic `dwindle`
  preset, and use a valid configured preset for initial automatic takeover.
- Expose existing `workspaceMode`, defaulting to `per-output-local`, for the
  existing dynamic-workspace model.
- Expose existing `shortcutProfile`, defaulting to `cosmic`, as a startup-only
  profile selection without changing shortcut registration or migration.
- Read all three values at startup and apply deterministic validation fallback
  for missing or invalid values.
- Regenerate the KWin bundle through the existing build rather than editing it.

## Non-Goals

- Hot application, runtime reconfiguration, or live KWin/Plasma testing.
- A bespoke C++ KCM, new dependency, or visual redesign.
- Dynamic-workspace enable/disable, pin/persist controls, or other workspace
  behavior beyond the current `workspaceMode` model.
- Shortcut remapping, migration, or changes to shortcut defaults.
- Any unrelated setting or host configuration mutation.

## Constraints

- Do not hand-edit `kwin/contents/code/main.js`.
- Use the existing generic scripted KCM convention: KConfigXT
  `contents/config/main.xml` and `X-KDE-ConfigModule` package metadata.
- Preserve `dwindle`, `per-output-local`, and `cosmic` as behavioral defaults.
- Invalid or missing configuration must select the corresponding default
  deterministically; invalid supplied values must retain the existing
  diagnostic convention.

## Acceptance Criteria

- The package metadata and KConfigXT schema are valid and linked by the
  verified KWin generic scripted-KCM convention.
- `tilingAlgorithm`, `workspaceMode`, and `shortcutProfile` retain their
  current defaults when configuration is absent.
- Valid configured values are read at startup and affect only their existing
  or specified startup seam.
- Missing and invalid configured values fall back deterministically.
- Focused regressions, typecheck, reproducible build, full KWin tests,
  relevant package/install static checks, and `git diff --check` pass.

## Decision Status

- The generic scripted KCM is sufficient for this bounded surface; no bespoke
  KCM architecture is required.
- Workspace on/off/pinning and shortcut remapping are intentionally parked as
  outside this bounded scope.

## Completion

- Static acceptance is verified for the generic KCM metadata, KConfigXT schema
  and bindings, startup defaults and validation fallback, generated bundle,
  package installation checks, typecheck, and tests.
- Live generic scripted-KCM rendering and KWin reload behavior remain
  unverified by design.
