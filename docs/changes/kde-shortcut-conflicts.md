# KDE Shortcut Conflict Model

## Goal and scope

- Add a per-binding conflict list, Keep/Disable choices, and Compatible/Authentic presets to the unified KDE Settings page.
- Mirror Windows terminology: Authentic is the default; Compatible disables conflicting bindings without replacement chords.
- Reuse explicit Apply Shortcuts, confirmed/revalidated Force Apply, and Revert-to-KDE-defaults. Ordinary settings Save, startup, and installation do not perform shortcut correction.
- KDE only, developed offline from Windows. Rebind and a first-run prompt are deferred unless existing KDE facilities make them trivial. No tray expansion, dependency changes, or macOS implementation.

## Acceptance

- List the full current KDE project catalog, including arrow and shifted-symbol aliases, with canonical chord, current assignment, and known default/current-holder conflicts; report unavailable queries honestly.
- Keep/Disable and presets stage a draft. Only explicit confirmed shortcut Apply/Force writes KGlobalAccel; disabling clears the project's action, not a foreign holder.
- Compatible resets the draft and disables bindings colliding with KDE defaults or current foreign holders; Authentic resets it to Keep. No invented replacements.
- Enabled choices constrain Apply and Force holder scans and writes; disabled focus-right must not relocate Lock Session. Existing owner pinning, stale-preview refusal, durable cleared-ID recovery, and Revert behavior remain valid.
- Regression coverage for preset selection, disabled bindings, mixed selections, Force drift, and settings-Save isolation. Hosted Rust/KWin/shell CI green; native Qt/KCM tests run in hosted CI if existing gates omit them.
- Document provisional KDE choices, discriminating reference outcomes, and user-owned live acceptance steps.

## Approach and bounded units

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
- Hosted native CTest is now wired alongside existing Rust/KWin/shell jobs without changing `devenv.nix`. Local `git diff --check` passes; Linux compilation/tests and final evidence pending hosted CI.
- First hosted run on `e1bb52a` ([37188296548](https://github.com/beefsack/plasma-auto-tiler/actions/runs/37188296548)): Rust/KWin/shell/Windows/macOS passed; native production/test compilation passed under `-Werror`, but 3 of 33 CTest suites failed. One causal test repair removes duplicate workspace rows already supplied by full-catalog seeds, updates preview assertions to readable chords, and checks both the exempt lock holder and keyed-only foreign holder. Product behavior and mutation oracles unchanged; rerun pending.
- Live acceptance remains pending: follow the conflict-list/preset section in `docs/live-shortcut-override-verification.md`. Keep this record active until user-owned KDE acceptance.
