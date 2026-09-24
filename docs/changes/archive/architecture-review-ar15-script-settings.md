# AR15: Script-page tiling settings

## Goal and scope

Own `workspaceMode`, `shortcutProfile`, `innerGap`, and `outerGap` on the KWin script's Configure page. Preserve their `Script-plasma-auto-tiler-kwin` storage, defaults and gap bounds. A page Save requests KWin reconfigure so changed gaps reach the running controller's validated, debounced retained `update-gaps` route without a second user action. State truthfully that workspace and shortcut profile changes require a session restart. Leave border and explicit shortcut overrides in the native effect KCM. Do not revive the removed ineffective controls or change startup-only behavior.

## Approach and evidence

Orchestrator direction, 2026-09-24: select the save-hook route as a technical detail of the approved AR15 outcome. Host KWin 6.7.5 `genericscriptedconfig.cpp` has an empty `ScriptingConfig::reload()` after Save; its `Options` watcher handles only KDE animation and Xwayland settings. Use a project-owned native script KCM, independent of whether the effect is enabled, installed alongside the existing native components. Save to the existing kwinrc group and request `/KWin reconfigure` after changed gaps are saved. The existing JS `Options.configChanged` subscription validates and resyncs gaps; startup-only values remain startup-only. A generic KCM cannot auto-reconfigure; an effect-resident watcher requires the effect to be loaded and depends on notification semantics. The script-only KPackage needs the native KCM installed for its configure page; document this delivery dependency.

The project-owned native script KCM is referenced by `X-KDE-ConfigModule`, saves the four existing script-group keys and sends one `/KWin reconfigure` request after changed gaps. The effect KCM now owns only border and explicit shortcut overrides. The script-only KDE Store KPackage retains its metadata, config schema/UI, and needs the host-built native companion to expose Configure. Dev, dogfood and Nix delivery include the new `kwin/scripts/configs` plugin. Neither script page discovery nor visible gap application has live acceptance yet.

Offline evidence: Rust 662 tests, format, and portable check pass; KWin typecheck, 816 tests and build pass; fresh KWin 6.7.5 host-matched native build and 29/29 CTest pass. KPackage shell contract passes; dogfood 572/0, dev-native 163/0, host-builder 93/0. Strict Clippy reports four pre-existing lints in untouched `tiler-core` files (no Rust files changed). Independent review found inaccurate pure-retry UI/persistence and startup-key logging and a missing effect-KCM dev-stage guard; all three were corrected, followed by native/KWin/shell verification. No live KWin/Plasma mutation, host install or session change occurred.

User-owned live acceptance: install the script plus host-matched native companion and start a new session for module discovery; with the effect disabled, open KWin Scripts -> Plasma Auto Tiler -> Configure, save inner/outer gap changes and verify visible retained gaps without another action; check unchanged save makes no request, mixed startup+gap save states restart-required while gaps converge, and a fresh session picks up `workspaceMode`/`shortcutProfile`. Distinguish queued D-Bus request from observed applied result; inspect `plasmaautotiler.script-config` and `plasma-auto-tiler:plan:config-reloaded` diagnostics. No live claim is made.

## Units and acceptance

1. Implement script KCM, metadata, removal of moved settings and reload UI from effect KCM; update relevant offline native/KWin tests.
2. Verify dev, dogfood, KPackage, and Nix packaging includes or clearly accompanies the native script KCM, and update packaging checks.
3. Add bounded settings-read/applied-vs-restart-required diagnostics; test gap resync and parity (0..64, default 8).
4. Verify Rust workspace offline tests, formatting and clippy, portable check, KWin typecheck/test/build, host-matched native build/tests, touched shell suites. Independently review diff. Update decisions and settings-related backlog text and archive this note.

## Constraints

No live KWin/Plasma mutation, install, host changes, devenv.nix changes, session staging, commit, or push. Do not edit the architecture review document. Physical/session acceptance is user-owned.
