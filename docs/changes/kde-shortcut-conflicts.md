# KDE Shortcut Conflict Model

## Goal and scope

- Add a per-binding conflict list, Keep/Disable choices, and Compatible/Authentic presets to the unified KDE Settings page.
- Mirror Windows preset terminology: Authentic explicitly stages canonical assignments; Compatible disables conflicting bindings without replacement chords. Opening KDE Settings preserves native assignments as Keep/Disable, without staging a reset.
- Reuse explicit Apply Shortcuts, confirmed/revalidated Force Apply, and Revert-to-KDE-defaults. Ordinary settings Save, startup, and installation do not perform shortcut correction.
- KDE only, developed offline from Windows. Rebind and a first-run prompt are deferred unless existing KDE facilities make them trivial. No tray expansion, dependency changes, or macOS implementation.

## Acceptance

- List the full current KDE project catalog, including arrow and shifted-symbol aliases, with canonical chord, current assignment, and known default/current-holder conflicts; report unavailable queries honestly.
- Keep/Disable and presets stage a draft. Only explicit confirmed shortcut Apply/Force writes KGlobalAccel; disabling clears the project's action, not a foreign holder.
- Compatible resets the draft to Keep and disables bindings colliding with KDE defaults or current foreign holders; Authentic resets it to enabled canonical intent. Keep preserves current custom/canonical/empty assignments. No invented replacements.
- Enabled choices constrain Apply and Force holder scans and writes; disabled focus-right must not relocate Lock Session. Existing owner pinning, stale-preview refusal, durable cleared-ID recovery, and Revert behavior remain valid.
- Regression coverage for preset selection, disabled bindings, mixed selections, Force drift, and settings-Save isolation. Hosted Rust/KWin/shell CI green; native Qt/KCM tests run in hosted CI if existing gates omit them.
- Document provisional KDE choices, discriminating reference outcomes, and user-owned live acceptance steps.

## Approach and bounded units

- M13 Keep-preserving Apply delivered offline 2026-10-09; specification, Lead readings, bounded units and evidence are in the [archived M13 record](archive/kde-keep-preserving-shortcut-apply.md). This umbrella record remains active for user-owned KDE acceptance.

1. Investigation: existing KCM is Qt Widgets, not QML; full script catalog has directional, toggle, workspace, and alias actions. Existing correction backend handles a smaller conflict table. Accepted source investigation, no live evidence.
2. Implementation: extend the existing reconciler to support the full catalog and explicit selected bindings, reuse KGlobalAccel persistence for own cleared assignments, add staged Widgets controls and meaningful hermetic coverage. Keep native transport and cleared-foreign-ID storage.
3. Independent review: inspect the shortcut mutation boundary and stale confirmation/recovery behavior; resolve concrete findings.
4. Integration: commit/push accepted units, hosted gates, decisions and live-check documentation, final record.

## Verification and outcome

- Initial tree clean at `e86e011`.
- No live KDE testing is possible on this host. Restart persistence, physical chords, and live default-holder behavior remain user-owned acceptance.
- Implemented full 66-row catalog, staged choices/presets, selection-scoped Apply/Force, and native assignment-derived reopen state. Compatible includes discovered foreign defaults after current bindings were cleared. Rebind/first-run controls deferred; decisions are provisional in `docs/decisions.md`.
- Independent mutation-boundary review found unreadable current/default chords, missing-enabled-row success claims, and reopening losing Disable choices. Corrections accepted by source inspection with targeted regression coverage; Force also binds action presence, unknown draft IDs refuse, and disabled focus excludes Lock/Meta+Esc.
- The first implementation needed a semantic correction for those review findings; no failed live/product experiment occurred. Native gate source fileset/build-directory integration was corrected before its first hosted execution.
- Hosted native CTest is now wired alongside existing Rust/KWin/shell jobs without changing `devenv.nix`. Local `git diff --check` passes.
- First hosted run on `e1bb52a` ([37188296548](https://github.com/beefsack/plasma-auto-tiler/actions/runs/37188296548)): Rust/KWin/shell/Windows/macOS passed; native production/test compilation passed under `-Werror`, but 3 of 33 CTest suites failed. One causal test repair removes duplicate workspace rows already supplied by full-catalog seeds, updates preview assertions to readable chords, and checks both the exempt lock holder and keyed-only foreign holder. Product behavior and mutation oracles unchanged.
- Accepted final implementation evidence on `cdd4ef4` ([37188768454](https://github.com/beefsack/plasma-auto-tiler/actions/runs/37188768454)): all six hosted jobs green (Rust, KWin, shell, native, Windows, macOS). Native production/test build under `-Wall -Wextra -Werror` and all 33 CTest suites passed, including both selection suites. KWin tests/typecheck include native/TypeScript catalog parity. No local Linux or live desktop evidence is claimed.
- Live acceptance remains pending: follow the conflict-list/preset section in `docs/live-shortcut-override-verification.md`. Keep this record active until user-owned KDE acceptance.
- M13 pending live check: **M13 Keep preserves custom KDE chords across Apply**. Keep now preserves actual assignments; Authentic stages canonical reset and its intent is consumed on successful Apply/Force. Failed/declined attempts retain the staged intent.

## Handover

- Delivered: readable per-binding catalog/current/default/holder list, staged Keep/Disable and Compatible/Authentic presets, selected explicit Apply/Force, native empty-assignment reopen state, and unchanged foreign-default Revert semantics. First-run prompt/in-page rebind are deferred.
- Provisional choices and discriminating scenarios: `docs/decisions.md` Cross-Platform Behavior; `docs/spec/reference-outcomes.md` R-CTL-05 through R-CTL-07. Compatible does not restore previously cleared KDE holders automatically; disabling focus-right leaves any prior lock relocation as-is.
- Risks for live acceptance: native empty assignments cannot identify why they became empty; restart/script-registration persistence and physical digit/symbol delivery require Plasma testing. Revert restores defaults rather than custom preimages.
- Proposed backlog text: "P1 | Shortcut conflict model on KDE and macOS | KDE per-binding Keep/Disable and Compatible/Authentic presets delivered, hosted CI green; KDE physical/restart acceptance pending. Integrated rebind/first-run prompt deferred; macOS when its implementation starts."
- Exact next action: on KDE, pull the accepted commit, build/stage with `just build-native-effect`, use `just dev-native-setup` and logout/login for delivery, then run the conflict-list/preset section of `docs/live-shortcut-override-verification.md` and record results here before archiving.
