# Specification: Dogfood Install Packaging

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-12 by user

## Intent and Desired Outcome

Provide a locally installable KWin script package so a developer can build,
install, enable, inspect, disable, and uninstall plasma-auto-tiler from this
repository without packaging or mutating the running session during automated
tests.

## Scope and Non-Goals

In scope:

- Shell commands to build and copy the `kwin/` package to the local KWin script
  directory, remove that installed package, toggle its exact KWin plugin setting,
  reconfigure KWin after a toggle, and report installed and enabled state.
- An overridable data/config root for prevalidating every mutating shell-command
  path in a temporary throwaway root.
- A root `README.md` quickstart covering prerequisites, install, enable, the
  keyboard-shortcut catalog summary, disable, uninstall, and the automatic
  session-local dwindle ownership of the managed scope.
- Shell tests following `scripts/start-test.test.sh` conventions.

Non-goals:

- Live host installation, KWin reconfiguration, D-Bus invocation, or `kwinrc`
  mutation by agents or automated tests.
- Changes to authored TypeScript, generated `kwin/contents/code/main.js`, tiling
  behavior, persistence formats, multi-output policy, or the structural pipeline.
- Changes to `test-output`, `Project Technical Report and Implementation Plan.md`,
  `docs/principles.md`, or `docs/decisions.md`.

## Applicable Principles and Decisions

- `AGENTS.md:3-18`: no live KWin/Plasma testing without the operational guide and
  no ad hoc system dependencies.
- `docs/handover.md:7-27`: preserve protected untracked content, do not create
  governance artifacts, and do not push or amend commits.
- `docs/live-kwin-testing.md:5-21`: live reconfiguration is a mutation; it is
  outside this change's automated validation boundary.

## Constraints

- Build with `npm --prefix kwin run build`; never edit the generated bundle.
- Install only `kwin/metadata.json` and `kwin/contents/` below
  `$XDG_DATA_HOME/kwin/scripts/plasma-auto-tiler-kwin/`, or
  `$HOME/.local/share/kwin/scripts/plasma-auto-tiler-kwin/` when
  `XDG_DATA_HOME` is unset.
- The exact configuration key is `[Plugins] plasma-auto-tiler-kwinEnabled`,
  derived from `kwin/metadata.json` `KPlugin.Id` and verified against KWin source.
- Enable and disable must use `kwriteconfig6` and call
  `qdbus org.kde.KWin /KWin reconfigure`; status must not reconfigure KWin.
- Scripts must expose explicit test-only destination/config-root overrides so
  shell tests never reach real user paths. The documented quickstart uses normal
  XDG paths and is run manually by the user.
- `kwriteconfig6`, `kreadconfig6`, and `qdbus` are host Plasma runtime
  prerequisites, not `devenv.nix` dependencies. The commands must detect each
  required tool at runtime and name a missing tool in an actionable error; tests
  must inject fake tool paths and remain independent of the dev shell.

## Acceptance Criteria

- [ ] An install command builds the bundle and copies the KWin package into `$XDG_DATA_HOME` or `~/.local/share/kwin/scripts/plasma-auto-tiler-kwin/`; an uninstall command removes only that installed package.
- [ ] Enable and disable commands write `[Plugins] plasma-auto-tiler-kwinEnabled` as `true` or `false`, respectively, and invoke the verified KWin `reconfigure` mechanism; a status command reports installed and enabled state without mutating either.
- [ ] A root `README.md` concisely documents prerequisites, install, enable, the keyboard shortcut catalog summary, disable, uninstall, and that enabling grants automatic session-local dwindle ownership of the managed scope.
- [ ] A shell test file prevalidates install, uninstall, enable, disable, and status against a temporary throwaway data/config root using the established `scripts/start-test.test.sh` harness style, without invoking a real KWin D-Bus method or writing host configuration.
- [ ] Each command detects each required runtime tool and fails with a clear, actionable error naming a missing tool; `README.md` lists these tools as host Plasma prerequisites; static verification passes for the changed scripts and the existing KWin package baseline.

## Unresolved Questions

- None.

## Consequential Decisions

- Use direct directory copying rather than `kpackagetool6`: it exactly targets the
  requested local script directory and keeps installation prevalidation fully
  rooted in a throwaway tree.
- Use `kwriteconfig6`, `kreadconfig6`, and `qdbus` as host Plasma runtime tools:
  they must match the running session rather than a devenv-pinned Plasma stack.
  This avoids version skew with host KWin and a session restart with no
  correctness benefit.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
