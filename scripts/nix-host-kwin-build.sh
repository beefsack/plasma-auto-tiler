#!/usr/bin/env bash
set -euo pipefail

# Host-matched native development builder (NixOS-first, no fallbacks).
#
# Authority: the actual host Nix KWin package at
#   /run/current-system/sw/bin/kwin_wayland
# (override for hermetic tests only via PLASMA_AUTO_TILER_HOST_KWIN_BIN).
# Resolution is read-only and provenance-bound:
#   host bin -> realpath under /nix/store -> exact derivation via
#   `nix path-info --derivation` -> exact `dev` output path from the SAME
#   derivation metadata via `nix derivation show` + jq.
# `resolve` proves derivation metadata only; it does NOT assert KWinConfig
# file availability because an unrealized dev output must remain buildable
# (no `nix path-info` on dev, no filesystem require on KWinConfig.cmake).
# No nixpkgs version guessing, no store-name version parsing, no fallback
# to a pinned package set.
#
# Build runs in the original host derivation dev shell:
#   nix develop <host-drv> --command bash -c 'cmake configure + build'
# with only validated portable rustc injected by explicit /nix/store bin
# dir and explicit -DKWin_DIR=<dev>/lib/cmake/KWin. Outer cmake/cargo are
# never required and never injected: cmake must resolve within the original
# host `nix develop <drv>` environment. The inner shell requires the exact
# KWinConfig.cmake from the selected dev output (where Nix has realized it)
# before configure, and asserts the inner cmake is host-native (not an
# injected pinned cmake) while rustc resolves from the explicit injected path.
# The legacy PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR (and DOGFOOD_KWIN_DEV_CMAKE_DIR)
# can neither drive nor leak into the native build: it is unset on entry,
# stripped from the `nix develop` environment, and unset again inside the
# dev shell; cmake receives only the resolved dev output.
#
# Cost model (documented, no hidden extra Nix command):
#   `resolve` is read-only: filesystem checks plus
#   `nix path-info --derivation` and `nix derivation show` only. It never
#   realizes a store path and is safe to run for inspection.
#   `build` runs exactly one realizing command,
#   `nix develop <drv> --command ...`, which may realize the host dev
#   closure on first use (download/store cost, potentially minutes).
#   The builder deliberately does NOT run an extra
#   `nix build --dry-run` automatically on every compile: that would be a
#   second Nix command with different semantics and additional cost on
#   every build. Run `resolve` first to inspect provenance without cost;
#   then `build` to pay the one-time dev-closure cost via `nix develop`
#   itself.
#
# Identity keying: build directories embed a safe host package identity
# derived opaquely from the derivation basename (sanitized, no version
# parsing). Callers construct:
#   justfile staging: target/kwin-native-host-<identity>-build (stage stays
#     at target/kwin-native-effect-stage to preserve session delivery)
#   dogfood payload: <transaction>/host-<identity>-build
# `resolve` prints `identity`, `default_build_dir`, and `default_stage_dir`
# so both callers share one implementation. Callers resolve read-only, then
# pass `--expected-identity <identity>` to `build`; build fails closed if
# the host changed between the two resolves (no staging lifecycle redesign).

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DEFAULT_HOST_BIN="/run/current-system/sw/bin/kwin_wayland"
DEFAULT_STORE_ROOT="/nix/store"

# The legacy pinned CMake dir must neither drive nor leak. Unset on entry.
# Outer cmake/cargo are never used: unset so they cannot leak into the host
# dev shell either (cmake must come from `nix develop <drv>` itself).
unset PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
unset DOGFOOD_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
unset CMAKE_BIN 2>/dev/null || true
unset CARGO_BIN 2>/dev/null || true

TOOL=""

usage() {
  cat <<'EOF'
usage: nix-host-kwin-build.sh <command> [options]

NixOS-first host-matched native builder. Resolves the actual host KWin
derivation and builds the native effect source inside that derivation's
dev shell. No fallbacks, no guessed nixpkgs version.

Commands:
  resolve [--host-bin PATH] [--store-root DIR] [--repo-root DIR]
    Read-only provenance resolution. Proves derivation metadata only; does
    not assert KWinConfig file availability (dev output may be unrealized).
    Prints key=value lines:
      host_bin, store_path, derivation, dev_output, kwin_cmake_dir,
      kwin_config, identity, default_build_dir, default_stage_dir.
    kwin_cmake_dir/kwin_config are metadata-selected paths, not validated
    files at resolve time. Uses only filesystem checks plus
    `nix path-info --derivation` (host path only) and `nix derivation show`;
    never realizes a store path. Safe for inspection. Exits non-zero with
    `error:` on missing/malformed provenance.

  build --source DIR --build-dir DIR [--host-bin PATH]
        [--store-root DIR] [--repo-root DIR]
        [--expected-identity ID]
    Resolve (as above), fail if --expected-identity disagrees with the
    freshly resolved host identity (host changed; no fallback), then run
    exactly:
      nix develop <host-drv> --command bash -c 'cmake -S ... -B ... \
        -DKWin_DIR=<resolved-dev>/lib/cmake/KWin -DBUILD_TESTING=OFF; \
        cmake --build ...'
    with only validated current-shell rustc injected by explicit /nix/store
    bin dir. Outer cmake/cargo are never required and never injected; cmake
    must resolve within the original host `nix develop <drv>` environment
    (asserted host-native, not an injected pinned cmake). Inside that
    environment, the exact KWinConfig.cmake from the selected dev output is
    required before configure, where Nix has realized it. The legacy
    PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR / DOGFOOD_KWIN_DEV_CMAKE_DIR are
    stripped and never passed to cmake. First use may realize the host dev
    closure (network/store cost).

  --help  show this help and exit

Environment (test-only overrides; production defaults are NixOS paths):
  PLASMA_AUTO_TILER_HOST_KWIN_BIN  host kwin_wayland path
  PLASMA_AUTO_TILER_STORE_ROOT     store prefix (default /nix/store)
  PLASMA_AUTO_TILER_REPO_ROOT      repo root for default dirs
  NIX_BIN, JQ_BIN, RUSTC_BIN
    explicit tool paths (must be executable); otherwise PATH lookup.
    Only rustc is injected (CMake native sources use bare rustc; cargo is
    not needed). There is no CMAKE_BIN/CARGO_BIN: outer cmake/cargo are
    unsupported and ignored.

Cost: `resolve` never realizes; `build` pays the `nix develop` closure
cost once. No automatic `nix build --dry-run` is run on any path.
EOF
}

require_tool() {
  local var_name="$1" default_name="$2"
  local value="${!var_name:-}"
  if [[ -n "$value" ]]; then
    if [[ ! -x "$value" ]]; then
      echo "error: $var_name is set but is not an executable: $value" >&2
      exit 1
    fi
    TOOL="$value"
    return 0
  fi
  if ! command -v "$default_name" >/dev/null 2>&1; then
    echo "error: required tool '$default_name' not found in PATH; install it or set $var_name to its absolute path" >&2
    exit 1
  fi
  TOOL="$(command -v "$default_name")"
}

canonicalize() {
  local path="$1"
  local out=""
  if ! out="$(readlink -f -- "$path" 2>/dev/null)"; then
    echo "error: could not canonicalize path: $path" >&2
    return 1
  fi
  if [[ -z "$out" ]]; then
    echo "error: could not canonicalize path (empty result): $path" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

# Resolve provenance and print key=value lines. Sets globals:
# RES_HOST_BIN RES_STORE_PATH RES_DRV RES_DEV_OUT RES_KWIN_CMAKE_DIR
# RES_KWIN_CONFIG RES_IDENTITY RES_DEFAULT_BUILD_DIR RES_DEFAULT_STAGE_DIR
# NOTE: kwin_cmake_dir/kwin_config are metadata-selected only; resolve does
# not require the files to exist (unrealized dev output must remain
# buildable). Build validates KWinConfig inside `nix develop` where Nix has
# realized it.
do_resolve() {
  local host_bin="$1" store_root="$2" repo_root="$3"
  local nix_bin="$4" jq_bin="$5"

  if [[ -z "$host_bin" ]]; then
    echo "error: host KWin binary path is empty; this builder is NixOS-first and requires /run/current-system/sw/bin/kwin_wayland (no fallback)" >&2
    return 1
  fi
  if [[ ! -e "$host_bin" && ! -L "$host_bin" ]]; then
    echo "error: host KWin binary not found: $host_bin; this builder is NixOS-first and requires /run/current-system/sw/bin/kwin_wayland (no fallback)" >&2
    return 1
  fi
  local store_path=""
  store_path="$(canonicalize "$host_bin")" || return 1
  case "$store_path" in
    "$store_root"/*) ;;
    *)
      echo "error: host KWin binary does not resolve under $store_root: $host_bin -> $store_path; refusing (not a NixOS current-system package, no fallback)" >&2
      return 1
      ;;
  esac
  if [[ "$store_path" == *$'\n'* ]]; then
    echo "error: resolved host store path is malformed (newline): $store_path" >&2
    return 1
  fi

  local drv=""
  if ! drv="$("$nix_bin" path-info --derivation -- "$store_path" 2>/dev/null)"; then
    echo "error: could not identify exact derivation for host store path: $store_path (nix path-info --derivation failed); refusing" >&2
    return 1
  fi
  # Single line, trimmed of surrounding whitespace.
  drv="$(printf '%s\n' "$drv" | head -n 1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ -z "$drv" ]]; then
    echo "error: empty derivation for host store path: $store_path; refusing" >&2
    return 1
  fi
  case "$drv" in
    "$store_root"/*.drv) ;;
    *)
      echo "error: malformed derivation for host store path $store_path: '$drv' (expected $store_root/*.drv); refusing" >&2
      return 1
      ;;
  esac
  if [[ "$drv" == *$'\n'* || "$drv" == *" "* ]]; then
    echo "error: malformed derivation (whitespace/newline): '$drv'; refusing" >&2
    return 1
  fi

  local drv_json=""
  if ! drv_json="$("$nix_bin" derivation show -- "$drv" 2>/dev/null)"; then
    echo "error: could not read derivation metadata for: $drv (nix derivation show failed); refusing" >&2
    return 1
  fi
  # Current Nix derivation JSON schema nests under top-level `derivations`
  # keyed by derivation basename (`.derivations[$drv_base].env.dev` absolute
  # and `.derivations[$drv_base].outputs.dev.path` relative, as observed on
  # the live host); legacy schema maps the drv directly
  # (`.[$drv].outputs.dev.path`). Prefer current absolute env.dev, then
  # current outputs path prefixed with the store root only when relative,
  # fall back to legacy only if straightforward. The selected path is
  # metadata only, never realized here, so no `nix path-info` on dev (an
  # unrealized dev output must remain buildable).
  local dev_out=""
  local drv_key="${drv##*/}"
  if ! dev_out="$(printf '%s' "$drv_json" | "$jq_bin" -r --arg drv "$drv" --arg drv_base "$drv_key" --arg store_root "$store_root" '
    (.derivations[$drv_base].env.dev // .derivations[$drv].env.dev // "") as $b
    | (.derivations[$drv_base].outputs.dev.path // .derivations[$drv].outputs.dev.path // "") as $raw_a
    | (if $raw_a == "" then "" elif ($raw_a | startswith("/")) then $raw_a else "\($store_root)/\($raw_a)" end) as $a
    | (.[$drv].outputs.dev.path // "") as $c
    | (.[$drv].env.dev // "") as $d
    | ([$b, $a, $c, $d] | map(select(. != "")) | first // empty)
  ' 2>/dev/null)"; then
    echo "error: could not parse derivation metadata for dev output: $drv; refusing" >&2
    return 1
  fi
  dev_out="$(printf '%s\n' "$dev_out" | head -n 1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ -z "$dev_out" ]]; then
    echo "error: derivation has no exact 'dev' output: $drv; refusing (no fallback to another package set)" >&2
    return 1
  fi
  case "$dev_out" in
    "$store_root"/*) ;;
    *)
      echo "error: malformed dev output for derivation $drv: '$dev_out' (expected under $store_root); refusing" >&2
      return 1
      ;;
  esac
  if [[ "$dev_out" == *$'\n'* || "$dev_out" == *" "* ]]; then
    echo "error: malformed dev output (whitespace/newline): '$dev_out'; refusing" >&2
    return 1
  fi

  local kwin_cmake_dir="$dev_out/lib/cmake/KWin"
  local kwin_config="$kwin_cmake_dir/KWinConfig.cmake"

  local drv_base="${drv##*/}"
  local drv_noext="${drv_base%.drv}"
  if [[ -z "$drv_noext" || "$drv_noext" == "$drv_base" ]]; then
    echo "error: malformed derivation basename: $drv; refusing" >&2
    return 1
  fi
  local identity=""
  identity="$(printf '%s' "$drv_noext" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-128)"
  if [[ -z "$identity" ]]; then
    echo "error: empty host package identity from derivation: $drv; refusing" >&2
    return 1
  fi
  if [[ ! "$identity" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "error: unsafe host package identity from derivation: '$identity'; refusing" >&2
    return 1
  fi

  RES_HOST_BIN="$host_bin"
  RES_STORE_PATH="$store_path"
  RES_DRV="$drv"
  RES_DEV_OUT="$dev_out"
  RES_KWIN_CMAKE_DIR="$kwin_cmake_dir"
  RES_KWIN_CONFIG="$kwin_config"
  RES_IDENTITY="$identity"
  RES_DEFAULT_BUILD_DIR="$repo_root/target/kwin-native-host-$identity-build"
  RES_DEFAULT_STAGE_DIR="$repo_root/target/kwin-native-effect-stage"
  return 0
}

print_resolve() {
  printf 'host_bin=%s\n' "$RES_HOST_BIN"
  printf 'store_path=%s\n' "$RES_STORE_PATH"
  printf 'derivation=%s\n' "$RES_DRV"
  printf 'dev_output=%s\n' "$RES_DEV_OUT"
  printf 'kwin_cmake_dir=%s\n' "$RES_KWIN_CMAKE_DIR"
  printf 'kwin_config=%s\n' "$RES_KWIN_CONFIG"
  printf 'identity=%s\n' "$RES_IDENTITY"
  printf 'default_build_dir=%s\n' "$RES_DEFAULT_BUILD_DIR"
  printf 'default_stage_dir=%s\n' "$RES_DEFAULT_STAGE_DIR"
}

cmd_resolve() {
  local host_bin="${PLASMA_AUTO_TILER_HOST_KWIN_BIN:-$DEFAULT_HOST_BIN}"
  local store_root="${PLASMA_AUTO_TILER_STORE_ROOT:-$DEFAULT_STORE_ROOT}"
  local repo_root="${PLASMA_AUTO_TILER_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host-bin)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --host-bin requires a value" >&2; exit 1; }
        host_bin="$2"; shift 2 ;;
      --store-root)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --store-root requires a value" >&2; exit 1; }
        store_root="$2"; shift 2 ;;
      --repo-root)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --repo-root requires a value" >&2; exit 1; }
        repo_root="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) echo "error: unknown resolve argument '$1'" >&2; exit 1 ;;
    esac
  done
  # Strip legacy pinned env even if exported after script entry (paranoia).
  # Outer cmake/cargo are unsupported: strip so they cannot leak.
  unset PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
  unset DOGFOOD_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
  unset CMAKE_BIN 2>/dev/null || true
  unset CARGO_BIN 2>/dev/null || true
  require_tool NIX_BIN nix
  local nix_bin="$TOOL"
  require_tool JQ_BIN jq
  local jq_bin="$TOOL"
  do_resolve "$host_bin" "$store_root" "$repo_root" "$nix_bin" "$jq_bin" || exit 1
  print_resolve
}

cmd_build() {
  local host_bin="${PLASMA_AUTO_TILER_HOST_KWIN_BIN:-$DEFAULT_HOST_BIN}"
  local store_root="${PLASMA_AUTO_TILER_STORE_ROOT:-$DEFAULT_STORE_ROOT}"
  local repo_root="${PLASMA_AUTO_TILER_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
  local source_dir="" build_dir="" expected_identity=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --source requires a value" >&2; exit 1; }
        source_dir="$2"; shift 2 ;;
      --build-dir)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --build-dir requires a value" >&2; exit 1; }
        build_dir="$2"; shift 2 ;;
      --host-bin)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --host-bin requires a value" >&2; exit 1; }
        host_bin="$2"; shift 2 ;;
      --store-root)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --store-root requires a value" >&2; exit 1; }
        store_root="$2"; shift 2 ;;
      --repo-root)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --repo-root requires a value" >&2; exit 1; }
        repo_root="$2"; shift 2 ;;
      --expected-identity)
        [[ $# -ge 2 && -n "${2:-}" ]] || { echo "error: --expected-identity requires a value" >&2; exit 1; }
        expected_identity="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) echo "error: unknown build argument '$1'" >&2; exit 1 ;;
    esac
  done
  [[ -n "$source_dir" ]] || { echo "error: build requires --source DIR" >&2; exit 1; }
  [[ -n "$build_dir" ]] || { echo "error: build requires --build-dir DIR" >&2; exit 1; }
  [[ -d "$source_dir" ]] || { echo "error: source directory not found: $source_dir" >&2; exit 1; }
  [[ -f "$source_dir/CMakeLists.txt" ]] || { echo "error: source directory has no CMakeLists.txt: $source_dir" >&2; exit 1; }
  if [[ -n "$expected_identity" && ! "$expected_identity" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "error: malformed --expected-identity: '$expected_identity'; refusing" >&2
    exit 1
  fi
  unset PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
  unset DOGFOOD_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
  unset CMAKE_BIN 2>/dev/null || true
  unset CARGO_BIN 2>/dev/null || true
  require_tool NIX_BIN nix
  local nix_bin="$TOOL"
  require_tool JQ_BIN jq
  local jq_bin="$TOOL"
  do_resolve "$host_bin" "$store_root" "$repo_root" "$nix_bin" "$jq_bin" || exit 1
  if [[ -n "$expected_identity" && "$RES_IDENTITY" != "$expected_identity" ]]; then
    echo "error: host identity changed (expected '$expected_identity', got '$RES_IDENTITY' from $RES_DRV); refusing (re-resolve and retry, no fallback)" >&2
    exit 1
  fi

  # Validate portable current-shell rustc only (CMake native sources use bare
  # rustc; cargo is not needed) and inject by explicit store bin dir.
  require_tool RUSTC_BIN rustc
  local rustc_bin="$TOOL"
  local rustc_real=""
  rustc_real="$(canonicalize "$rustc_bin")" || exit 1
  case "$rustc_real" in
    "$store_root"/*) ;;
    *)
      echo "error: portable tool is not under $store_root: $rustc_real; enter the project dev shell so rustc resolves to an explicit /nix/store path (no impure fallback)" >&2
      exit 1
      ;;
  esac
  local rustc_dir=""
  rustc_dir="$(dirname -- "$rustc_real")"
  [[ -d "$rustc_dir" ]] || { echo "error: tool bin dir not found: $rustc_dir" >&2; exit 1; }
  local injected_path="$rustc_dir"

  mkdir -p -- "$build_dir" || { echo "error: could not create build directory: $build_dir" >&2; exit 1; }

  # Keying note for diagnostics (identity already validated safe).
  echo "host package: $RES_IDENTITY ($RES_DRV)" >&2
  echo "dev output (metadata-selected): $RES_DEV_OUT" >&2

  # Build inside the ORIGINAL host derivation dev shell. Valid Nix CLI:
  # `nix develop <drv> --command <cmd> <args...>`. Strip the legacy pinned
  # env (and any outer CMAKE_BIN/CARGO_BIN) from the outer environment and
  # again inside the shell; cmake resolves from the host dev shell itself
  # and receives only the resolved -DKWin_DIR. KWinConfig is required inside
  # where Nix has realized the dev output.
  if ! env -u PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR -u DOGFOOD_KWIN_DEV_CMAKE_DIR -u CMAKE_BIN -u CARGO_BIN \
    "$nix_bin" develop "$RES_DRV" --command bash -c '
      set -euo pipefail
      injected="$1"; src="$2"; bdir="$3"; kwin_dir="$4"
      export PATH="$injected:${PATH:-}"
      unset PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
      unset DOGFOOD_KWIN_DEV_CMAKE_DIR 2>/dev/null || true
      unset CMAKE_BIN 2>/dev/null || true
      unset CARGO_BIN 2>/dev/null || true
      if [[ -n "${PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR:-}" ]]; then
        echo "error: pinned PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR leaked into host dev shell; refusing" >&2
        exit 1
      fi
      if [[ -n "${DOGFOOD_KWIN_DEV_CMAKE_DIR:-}" ]]; then
        echo "error: pinned DOGFOOD_KWIN_DEV_CMAKE_DIR leaked into host dev shell; refusing" >&2
        exit 1
      fi
      if [[ -n "${CMAKE_BIN:-}" ]]; then
        echo "error: pinned CMAKE_BIN leaked into host dev shell; refusing (cmake must come from nix develop)" >&2
        exit 1
      fi
      if [[ -n "${CARGO_BIN:-}" ]]; then
        echo "error: pinned CARGO_BIN leaked into host dev shell; refusing (cargo is not used; only explicit rustc is injected)" >&2
        exit 1
      fi
      if [[ ! -f "$kwin_dir/KWinConfig.cmake" ]]; then
        echo "error: KWinConfig.cmake not found in exact dev output inside host dev shell: $kwin_dir/KWinConfig.cmake; refusing" >&2
        exit 1
      fi
      cmake_path="$(command -v cmake 2>/dev/null || true)"
      if [[ -z "$cmake_path" ]]; then
        echo "error: cmake not found in host dev shell (nix develop $kwin_dir); refusing (no outer cmake fallback)" >&2
        exit 1
      fi
      cmake_real="$(readlink -f -- "$cmake_path" 2>/dev/null || printf "%s" "$cmake_path")"
      case "$cmake_real" in
        "$injected"/*)
          echo "error: inner cmake resolves to injected path ($cmake_real); refusing (cmake must be host-native from nix develop)" >&2
          exit 1
          ;;
      esac
      rustc_path="$(command -v rustc 2>/dev/null || true)"
      if [[ -z "$rustc_path" ]]; then
        echo "error: rustc not found even with explicit injected path; refusing" >&2
        exit 1
      fi
      rustc_real="$(readlink -f -- "$rustc_path" 2>/dev/null || printf "%s" "$rustc_path")"
      case "$rustc_real" in
        "$injected"/*) ;;
        *)
          echo "error: rustc does not resolve from explicit injected path ($rustc_real not under $injected); refusing" >&2
          exit 1
          ;;
      esac
      cmake -S "$src" -B "$bdir" -DKWin_DIR="$kwin_dir" -DBUILD_TESTING=OFF
      cmake --build "$bdir"
    ' _ "$injected_path" "$source_dir" "$build_dir" "$RES_KWIN_CMAKE_DIR"; then
    echo "error: host-matched native build failed (nix develop $RES_DRV); no fallback attempted" >&2
    exit 1
  fi
  echo "built: $build_dir (KWin_DIR=$RES_KWIN_CMAKE_DIR)"
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (resolve, build)" >&2
  usage >&2
  exit 1
fi

case "${1:-}" in
  --help|-h)
    [[ $# -eq 1 ]] || { echo "error: '--help' takes no arguments" >&2; exit 1; }
    usage
    exit 0
    ;;
  resolve) cmd_resolve "${@:2}" ;;
  build) cmd_build "${@:2}" ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
