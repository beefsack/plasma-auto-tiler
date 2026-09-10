#!/usr/bin/env bash
# Focused checks for build identity: static greps plus one actual
# build:installed bundle propagation proof with ordinary-build restore.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
fail() { printf 'FAIL: %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }
pass() { PASS=$((PASS + 1)); }

flake="$REPO_ROOT/flake.nix"
kwin_pkg="$REPO_ROOT/kwin/package.json"
kwin_entry="$REPO_ROOT/kwin/src/entry.ts"
rust_identity="$REPO_ROOT/src/build_identity.rs"
follow="$REPO_ROOT/scripts/route-diag-follow.sh"

grep -Fq 'self.rev or "local-dev"' "$flake" && pass || fail "flake uses self.rev or local-dev"
! grep -Fq 'dirtyRev' "$flake" && pass || fail "no dirtyRev"
[[ "$(grep -Fc 'env.PLASMA_AUTO_TILER_SOURCE_REV = sourceRev' "$flake")" == 2 ]] && pass || fail "both packages inject identity"
grep -Fq 'npmBuildScript = "build:installed"' "$flake" && pass || fail "nix uses installed build"
grep -Fq '"source=${sourceRev}"' "$flake" && grep -Fq 'grep -Fx "source=${sourceRev}"' "$flake" && pass || fail "markers and checks"
grep -Fq '"build:installed"' "$kwin_pkg" && grep -Fq -- '--define:PLASMA_AUTO_TILER_SOURCE_REV=' "$kwin_pkg" && pass || fail "installed build injects"
! grep -F -- '"build":' "$kwin_pkg" | grep -Fq 'PLASMA_AUTO_TILER_SOURCE_REV' && pass || fail "ordinary build define-free"
grep -Fq 'option_env!("PLASMA_AUTO_TILER_SOURCE_REV")' "$rust_identity" && pass || fail "rust uses option_env"
[[ "$(grep -Fc 'buildIdentityStartupLine()' "$kwin_entry")" == 1 ]] && pass || fail "kwin emits once"
grep -Fq 'build_identity::startup_line' "$REPO_ROOT/src/planner_service.rs" && pass || fail "planner emits via startup_line"
[[ "$(grep -Fc 'emit_build_identity_startup();' "$REPO_ROOT/src/planner_service.rs")" == 2 ]] && pass || fail "both planner startup paths emit once"
grep -Fq 'formatLifecycleDiag("bridge", "started"' "$flake" && pass || fail "nix verifies bridge startup record"
grep -Fq '":version="' "$flake" || grep -Fq ':version=' "$flake" && pass || fail "nix verifies version marker"
grep -Fq 'comp=bridge:event=started:gen=' "$follow" && grep -Fq 'comp=planner:event=started:gen=' "$follow" && pass || fail "follow docs both records"
grep -Fq 'build-id' "$follow" && grep -Fq -- '--gen <id>' "$follow" && pass || fail "follow docs inspection"

# Focused propagation: an actual build:installed bundle with a representative
# valid SHA contains that injected identity and the bridge startup record.
# Restores contents/code/main.js to the ordinary define-free build afterward.
# Touches only kwin/contents/code/main.js (regenerated, unstaged) and the
# ignored kwin/dist work dir (removed by the npm builds); never dist/* nor
# kwin/dist/focused.
REP_SHA="0123456789abcdef0123456789abcdef01234567"
kwin_dir="$REPO_ROOT/kwin"
bundle="$kwin_dir/contents/code/main.js"
if PLASMA_AUTO_TILER_SOURCE_REV="$REP_SHA" npm --prefix "$kwin_dir" --silent run build:installed >/dev/null 2>&1; then
  grep -Fq "\"$REP_SHA\"" "$bundle" && pass || fail "installed bundle contains injected identity"
  grep -Fq 'formatLifecycleDiag("bridge", "started"' "$bundle" && pass || fail "installed bundle contains bridge startup record"
else
  fail "installed build runs"
fi
if npm --prefix "$kwin_dir" --silent run build >/dev/null 2>&1; then
  ! grep -Fq "$REP_SHA" "$bundle" && pass || fail "ordinary build restored define-free"
  grep -Fq 'formatLifecycleDiag("bridge", "started"' "$bundle" && pass || fail "ordinary build keeps bridge record"
else
  fail "ordinary build restores"
fi
[[ ! -e "$kwin_dir/dist/focused" ]] && pass || fail "focused output untouched"

printf 'build-identity: PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
