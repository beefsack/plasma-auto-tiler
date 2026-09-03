# Native Active Border Hot Apply

## Goal

Make native active-border KCM changes reconfigure the loaded KWin effect without
an effect or session restart, and leave an Apply failure retryable.

## Scope And Non-Goals

- Preserve the existing `kwinrc` group, keys, and defaults.
- Correct only native KCM reconfigure delivery and its regression coverage.
- Do not claim live KCM, ABI, package-delivery, or visual acceptance.

## Acceptance

- The KCM targets KWin's case-exact `/Effects` reconfigure interface.
- A failed reconfigure remains visibly pending and retries on another Apply.
- Config serialization, defaults, reload behavior, and render invalidation
  remain covered by native tests.

## Outcome And Evidence

- Source and current KWin introspection established that the old
  `org.kde.KWin.Effects` interface does not exist; KWin exports
  `org.kde.kwin.Effects`.
- The correction uses the exact target, treats every non-reply D-Bus result as
  failure, and retains pending reconfiguration until a successful reply.
- Fresh native CTest, native KCM static checks, and `nix build .#native-effect`
  passed.
- No live KCM Apply or candidate load ran: safely isolating a one-key KCM Apply
  was not possible, and a user-local candidate would duplicate the Nix-managed
  plugin ID. The baseline was untouched.

## Next Action

Deploy a rebuilt native-effect package through the normal Nix path, complete a
user session boundary, then change one active-border value in Desktop Effects,
Apply, and confirm the active border updates immediately.
