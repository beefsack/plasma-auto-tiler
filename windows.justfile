set windows-shell := ["pwsh", "-NoProfile", "-Command"]

default:
    @just --list

# Windows GUI-subsystem dev loop: build first, stop old payload copy, launch owner via Explorer, poll ready.
dev *mode:
    pwsh -NoProfile -File scripts/windows-dev.ps1 -Action dev {{mode}}

stop:
    pwsh -NoProfile -File scripts/windows-dev.ps1 -Action stop

# Bounded owned proof (physical, medium, no hooks). Not run by default.
proof:
    pwsh -NoProfile -File scripts/windows-dev.ps1 -Action proof

# Normal user tiling/workspaces (physical, medium, default-on shortcut/Snap takeover). Requires
# explicit --user-start, e.g. `just tile --user-start --trace`. Agents never
# run this path; proof uses tiling-proof-owned (tile-proof, never normal).
tile *args:
    pwsh -NoProfile -File scripts/windows-dev.ps1 -Action tile -TileArgs "{{args}}"

tile-stop:
    pwsh -NoProfile -File scripts/windows-dev.ps1 -Action stop

# Scoped Phase 2 owned-helpers-only tiling proof (physical, medium, no
# hooks/hide/activate). Never runs by default; never touches non-owned windows.
tiling-proof-owned:
    pwsh -NoProfile -File scripts/windows-tiling.ps1

# Bounded Win+Arrow spike (physical, medium, owned helper only). Not run by default.
winarrow:
    pwsh -NoProfile -File scripts/windows-winarrow.ps1

# Bounded shortcut-proof verification (physical, medium, owned helpers).
# Stages: OwnedFocusMove, OwnedMove (moves only, honestly skips focus rows), SpiGraceful, SpiCrash, NormalSmoke, All. Mock first:
# `just shortcuts-mock`. Live needs explicit `-Live`, e.g.
# `just shortcuts -Stage OwnedFocusMove -Live`. Never runs by default.
shortcuts *args:
    pwsh -NoProfile -File scripts/windows-shortcuts.ps1 {{args}}

shortcuts-mock:
    pwsh -NoProfile -File scripts/windows-shortcuts.ps1 -Mock

# Out-of-hook exact-owner cleanup from a persisted run dir.
shortcuts-stop run_dir:
    pwsh -NoProfile -File scripts/windows-shortcuts.ps1 -Stop -RunDir {{run_dir}}

# Bounded owned-helper visibility proof over the product nonce mechanism
# (physical, medium, no hooks/policy). Never runs by default; never touches
# non-owned windows. Callable by the next worker:
# `pwsh -NoProfile -File scripts/windows-hide-proof.ps1`.
hide-proof:
    pwsh -NoProfile -File scripts/windows-hide-proof.ps1

# Bounded owned-helper workspace proof (physical, medium, workspace digits
# with hide/reveal for exactly the frozen allowlist). Never runs by default;
# never touches non-owned windows. Mock first:
# `just workspace-proof-mock`. Live needs explicit `-Live`:
# `just workspace-proof -Live`. Out-of-hook cleanup:
# `just workspace-proof-stop <run_dir>`.
workspace-proof *args:
    pwsh -NoProfile -File scripts/windows-workspace-proof.ps1 {{args}}

workspace-proof-mock:
    pwsh -NoProfile -File scripts/windows-workspace-proof.ps1 -Mock

# Out-of-hook exact-owner cleanup from a persisted run dir.
workspace-proof-stop run_dir:
    pwsh -NoProfile -File scripts/windows-workspace-proof.ps1 -Stop -RunDir {{run_dir}}

# Bounded ordinary-app workspace verification over the normal `tile` loop
# (physical, medium, exact-owner `workspace --select` CLI only, no synthetic
# digit input). Never runs by default; only approved Notepad/Calculator/Paint
# are managed by explicit test scope, other apps are excluded. Mock first:
# `just workspace-normal-mock`. Live needs explicit `-Live`:
# `just workspace-normal -Live`. Out-of-hook cleanup:
# `just workspace-normal-stop <run_dir>`.
workspace-normal *args:
    pwsh -NoProfile -File scripts/windows-workspace-normal.ps1 {{args}}

workspace-normal-mock:
    pwsh -NoProfile -File scripts/windows-workspace-normal.ps1 -Mock

# Out-of-hook exact-owner cleanup from a persisted run dir.
workspace-normal-stop run_dir:
    pwsh -NoProfile -File scripts/windows-workspace-normal.ps1 -Stop -RunDir {{run_dir}}

# Out-of-hook recovery for the spike; works from a separate shell with the exact printed RunDir.
winarrow-stop run_dir:
    pwsh -NoProfile -File scripts/windows-winarrow.ps1 -Stop -RunDir {{run_dir}}
