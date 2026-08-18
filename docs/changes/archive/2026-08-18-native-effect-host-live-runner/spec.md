# Specification: Native Effect Host Validation

Ownership and approval:
- Owner: Lead
- Status: Simplified to a one-off checklist, 2026-08-18.
- Approved outcome: one safe, user-supervised validation of the exact native
  effect on this exact currently pinned host, using a short current-machine-
  only checklist of explicit user-run commands instead of a generalized
  protocol program.

## Intent and Scope

Validate the exact `plasma-auto-tiler-active-border` native effect once
against the currently running host KWin. This is a one-off checklist for the
current machine only: not a script, not a reusable or distributable runner,
and not a multi-host abstraction. The nested runner remains separate and
unchanged.

The accepted host ABI/development pin evidence is:

- `out=/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`
- `dev=/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev`
- both exact outputs derive from
  `/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv`

The two user-run session boundaries are retained. The trusted single user
runs every command in this checklist serially and alone, performs all host
mutation, and performs both session boundaries. Agents do not execute host
mutation or session boundaries; nothing in this checklist executes
automatically or persists state between steps.

## Checklist

Run these steps in order, on this exact machine only. Each command is typed
and run directly by the trusted user.

1. **Read-only pin verification.** Confirm the exact host runtime and
   development derivations match the accepted pin before any change:
   - `readlink -f "$(command -v kwin_wayland)"` must equal
     `/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/bin/kwin_wayland`.
   - `kwin_wayland --version` must report `6.7.3`.
   - `nix-store -q --deriver /nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`
     and
     `nix-store -q --deriver /nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev`
     must both equal
     `/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv`.
   - Stop and report if any value differs. Make no host changes in this step.

2. **Exact plugin and temporary `environment.d` staging.** Choose a fresh
   nonce and build only the exact plugin into a nonce-owned user-local
   prefix, then create only its temporary nonce-owned discovery entry:
   - `NONCE=host-$(date +%Y%m%d%H%M%S)`
   - `STAGE="$HOME/.local/share/plasma-auto-tiler-native-effect/$NONCE"`
   - `cmake -S kwin/native-effect -B "$STAGE/build" -DKWin_DIR=/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev/lib/cmake/KWin -DBUILD_TESTING=OFF`
   - `cmake --build "$STAGE/build"`
   - `install -Dm0644 "$STAGE/build/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so" "$STAGE/kwin/effects/plugins/plasma-auto-tiler-active-border.so"`
   - `printf '# nonce=%s\nQT_PLUGIN_PATH=%s\n' "$NONCE" "$STAGE" > "$HOME/.config/environment.d/$NONCE.conf"`
   - Record the two owned paths for later removal: `$STAGE` and
     `$HOME/.config/environment.d/$NONCE.conf`. Nothing else is created or
     changed.

3. **User boundary 1.** The trusted user alone enters the bounded session
   boundary (secondary Wayland session preferred; primary logout/login only
   a separately authorized fallback) so the temporary discovery entry takes
   effect, before effect discovery or loading.

4. **Exact `/Effects` validation.** In the bounded session, run each call
   with `gdbus call --session --dest org.kde.KWin --object-path /Effects
   --method org.kde.kwin.Effects.<method> plasma-auto-tiler-active-border`,
   including for `supportInformation` (archival correction, 2026-08-18: this
   step originally read "omit the plugin argument for `supportInformation`",
   which was wrong - per `org.kde.kwin.Effects.xml`, `supportInformation`
   takes exactly one string argument, the effect name, same as every other
   method listed here):
   - `supportInformation` output must identify the exact plugin.
   - `isEffectSupported` must print `(true,)`.
   - `isEffectLoaded` must print `(false,)` before loading.
   - `loadEffect` must print `(true,)`.
   - `isEffectLoaded` must print `(true,)`.
   - The user alone manually observes the active-window border and confirms
     it visually before continuing.
   - `unloadEffect`, then `isEffectLoaded` must print `(false,)`.
   - On any unexpected or ambiguous reply, stop. Retain the owned paths,
     query the exact plugin state, and discuss and manually recover before
     removal; never broad-clean.

5. **Exact restoration, user boundary 2, and postflight verification.**
   - Remove exactly the two paths recorded in step 2 (and only directories
     created solely to hold them): the `environment.d` entry, then the
     staged plugin tree.
   - `test ! -e "$HOME/.config/environment.d/$NONCE.conf"` and
     `test ! -e "$STAGE"` must both pass.
   - User boundary 2: the trusted user alone ends the bounded session (or
     returns to the normal session).
   - In the normal session, `gdbus call --session --dest org.kde.KWin
     --object-path /Effects --method org.kde.kwin.Effects.isEffectLoaded
     plasma-auto-tiler-active-border` must print `(false,)`.

## Safety Constraints

- The trusted single user runs every command serially and alone. Only that
  user performs host mutation, visual observation, and both session
  boundaries.
- On an unexpected or ambiguous result, stop. Retain evidence and all
  nonce-owned paths, query the exact plugin state, discuss and manually
  recover before removal, and never broad-clean.
- Automatic crash or power-loss rollback is not claimed. This checklist does
  not defend against hostile same-user races or arbitrary filesystem
  corruption; those are explicitly out of scope.
- This is a one-off checklist for the current machine, not a generalized
  persistent state machine, evidence-validation program, or reusable
  multi-host abstraction.
- No `sudo`, system plugin paths, `/Compositor`, `/Scripting`, automatic
  primary-session mutation, routine in-place KWin termination, broad
  cleanup, unrelated state changes, or agent-executed host mutation.

## Acceptance Checklist

| # | Acceptance item |
|---|---|
| 1 | Exact host runtime/development derivation match (step 1). |
| 2 | `supportInformation` identifies the exact plugin and `isEffectSupported` is true, after boundary 1. |
| 3 | `loadEffect` returns true and `isEffectLoaded` becomes true. |
| 4 | User-observed border behavior passes. |
| 5 | `unloadEffect` succeeds and `isEffectLoaded` becomes false. |
| 6 | Only the nonce-owned plugin tree and `environment.d` entry were created, and both are removed exactly. |
| 7 | After boundary 2, `isEffectLoaded` is false in the normal session. |
| 8 | No prohibited interfaces, paths, or actions are used. |

No implementation, live run, host mutation, or acceptance evidence is created
by this simplification transaction.
