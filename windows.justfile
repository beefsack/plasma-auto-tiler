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
