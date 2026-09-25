# Hide Shortcut Profile From Script Settings

## Goal and scope

Implement the user's 2026-09-25 settings decision: hide the redundant shortcut-profile control, preserve saved values and the single COSMIC-style catalog, and clearly mark workspace mode as session-restart-only. Correct current user-facing settings ownership statements. No live/session mutation, migrations, new profiles, or architecture changes.

## Acceptance and approach

- Native script Configure page exposes workspace mode and both gaps only; saved `shortcutProfile` is never read or written by the page. Existing startup read and identical catalog stay unchanged.
- Workspace mode and mixed gap/workspace saves state the remaining restart requirement correctly.
- Current README and decisions reflect script-page/effect-KCM ownership; dated architecture-review artifact stays intact. Orchestrator owns backlog edits.
- Verify offline with KWin tests/typecheck, native build/tests and native Nix build because the native KCM fileset changes.

## Units

- Worker: native page, save behavior, relevant tests, offline native and KWin checks.
- Lead: review source diff; correct active docs and ownership decisions; verify Nix and record evidence.

## Decisions and evidence

- User: hide the profile until distinct profiles exist post-MVP; retain saved values; workspace mode is a startup-only MVP exception.
- Lead technical choice: retain script startup read to avoid changing existing behavior, while script KCM never reads/writes the hidden key.
- Offline outcome: the native script Configure page shows workspace mode and both gaps; workspace mode is labeled as requiring a session restart. Mixed/retry statuses identify workspace mode as the only startup setting. The effect KCM and script KCM descriptions no longer advertise a shortcut-profile control. Existing schema and script startup read remain unchanged.
- Verification: `npm run typecheck` and `npm test` (816 passed, 10 skipped) under `kwin/`; host-matched KWin 6.7.5 native build and CTest (29/29 passed); `just build-native-effect`; `nix build path:.#packages.x86_64-linux.native-effect`; `git diff --check`.
- Live acceptance of page, gaps, borders remains pending in the existing backlog; the Orchestrator owns updating or removing the completed shortcut-profile-hide portion of that line.
