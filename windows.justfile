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

# Bounded Win+Arrow spike (physical, medium, owned helper only). Not run by default.
winarrow:
    pwsh -NoProfile -File scripts/windows-winarrow.ps1

# Out-of-hook recovery for the spike; works from a separate shell with the exact printed RunDir.
winarrow-stop run_dir:
    pwsh -NoProfile -File scripts/windows-winarrow.ps1 -Stop -RunDir {{run_dir}}
