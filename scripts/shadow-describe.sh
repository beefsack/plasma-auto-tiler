#!/usr/bin/env bash
# Thin shadow-describe host wrapper (internal mode selector only).
#
# Sets the strictly internal SHADOW_DESCRIBE_HOST_MODE=shadow (plus the
# matching SHADOW_DESCRIBE_BUILD_MODE=shadow for the loader's deterministic
# rebuild verify path) and delegates to the shared exact lifecycle in
# scripts/advisory-describe-host.sh with the caller's argv. No other
# production/KPackage/tray/KCM/shortcut/autostart/controller route may set
# this mode; default loader invocations remain advisory with byte-identical
# outputs. Production is never unloaded or reloaded here; the shared loader
# proves shadow-only shape, KWin identity, production loaded, shadow absent,
# and Planner absent-or-exact-owner before any transport.
#
# Usage:
#   shadow-describe.sh <preflight|start|status|diagnostics|stop> [flags] [--help]
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export SHADOW_DESCRIBE_HOST_MODE="shadow"
export SHADOW_DESCRIBE_BUILD_MODE="shadow"
exec "$REPO_ROOT/scripts/advisory-describe-host.sh" "$@"
