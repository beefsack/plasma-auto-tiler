#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/dogfood-install.sh"
KWIN_DIR="$REPO_ROOT/kwin"
META="$KWIN_DIR/metadata.json"
BUNDLE="$KWIN_DIR/contents/code/main.js"
FAKE_BIN="$(mktemp -d)"
WORK="$(mktemp -d)"
OUTPUT="$(mktemp)"
DATA="$WORK/data"
CONFIG="$WORK/config"
FAKE_HOME="$WORK/home"
PASS=0
FAIL=0
EXIT=0

cleanup() {
  rm -rf "$FAKE_BIN"
  rm -rf "$WORK"
  rm -f "$OUTPUT"
}
trap cleanup EXIT

REAL_NPM="$(command -v npm || true)"
REAL_MV="$(command -v mv || true)"
if [[ -z "$REAL_NPM" ]]; then
  echo "FAIL: npm not found in PATH; the install build tests delegate to it" >&2
  exit 1
fi
if [[ -z "$REAL_MV" ]]; then
  echo "FAIL: mv not found in PATH; interruption fixtures require it" >&2
  exit 1
fi
BASH_PATH="$(command -v bash)"

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin" "$FAKE_BIN/core"

  cat > "$FAKE_BIN/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "${FAKE_NPM_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/npm-fail" ]]; then
  echo "fake npm: simulated build failure" >&2
  exit 1
fi
exec "${FAKE_REAL_NPM:?}" "$@"
EOF

  cat > "$FAKE_BIN/bin/kwriteconfig6" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'kwriteconfig6 %s\n' "$*" >> "${FAKE_TOOL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/kwrite-fail" ]]; then
  exit 1
fi
file=""
group=""
key=""
value=""
delete=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) file="${2:?}"; shift 2 ;;
    --group) group="${2:?}"; shift 2 ;;
    --key) key="${2:?}"; shift 2 ;;
    --type) shift 2 ;;
    --delete) delete=1; shift ;;
    *) value="$1"; shift ;;
  esac
done
[[ -n "$file" && -n "$group" && -n "$key" ]] || exit 2
mkdir -p "$(dirname "$file")"
[[ -f "$file" ]] || : > "$file"
tmp="$(mktemp)"
group_found=0
key_replaced=0
current=""
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "[$group]" ]]; then
      group_found=1
      current="$group"
    elif [[ "$line" == "["* ]]; then
      current=""
    fi
    if [[ "$current" == "$group" && "$line" == "$key="* ]]; then
      if [[ "$delete" -eq 1 ]]; then
        key_replaced=1
        continue
      fi
      printf '%s=%s\n' "$key" "$value"
      key_replaced=1
      continue
    fi
    printf '%s\n' "$line"
  done < "$file"
  if [[ "$delete" -eq 0 ]]; then
    if [[ "$group_found" -eq 0 ]]; then
      printf '\n[%s]\n%s=%s\n' "$group" "$key" "$value"
    elif [[ "$key_replaced" -eq 0 ]]; then
      printf '%s=%s\n' "$key" "$value"
    fi
  fi
} > "$tmp" && mv "$tmp" "$file"
EOF

  cat > "$FAKE_BIN/bin/kreadconfig6" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'kreadconfig6 %s\n' "$*" >> "${FAKE_TOOL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/kread-fail" ]]; then
  exit 1
fi
file=""
group=""
key=""
default=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) file="${2:?}"; shift 2 ;;
    --group) group="${2:?}"; shift 2 ;;
    --key) key="${2:?}"; shift 2 ;;
    --default) default="${2:?}"; shift 2 ;;
    --type) shift 2 ;;
    *) exit 2 ;;
  esac
done
[[ -n "$file" && -n "$group" && -n "$key" ]] || exit 2
[[ -f "$file" ]] || { printf '%s\n' "$default"; exit 0; }
current=""
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == "["* ]]; then
    current="${line#[}"
    current="${current%]}"
    continue
  fi
  if [[ "$current" == "$group" && "$line" == "$key="* ]]; then
    printf '%s\n' "${line#*=}"
    exit 0
  fi
done < "$file"
printf '%s\n' "$default"
EOF

  cat > "$FAKE_BIN/bin/qdbus" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'qdbus %s\n' "$*" >> "${FAKE_TOOL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/qdbus-fail" ]]; then
  exit 1
fi
case "$*" in
  *isEffectSupported*)
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-supported-fail" ]]; then
      exit 1
    fi
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-malformed-supported" ]]; then
      printf 'not-a-boolean\n'
      exit 0
    fi
    printf '%s\n' "${FAKE_QDBUS_SUPPORTED:-false}"
    exit 0
    ;;
  *isEffectLoaded*)
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-empty-loaded" ]]; then
      exit 0
    fi
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-loaded-fail" ]]; then
      exit 1
    fi
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-malformed-loaded" ]]; then
      printf 'not-a-boolean\n'
      exit 0
    fi
    printf '%s\n' "${FAKE_QDBUS_LOADED:-false}"
    exit 0
    ;;
  *unloadEffect*)
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-unload-fail" ]]; then
      exit 1
    fi
    exit 0
    ;;
  *loadEffect*)
    if [[ -f "${FAKE_STATE_DIR:?}/qdbus-load-fail" ]]; then
      exit 1
    fi
    exit 0
    ;;
esac
exit 0
EOF

  cat > "$FAKE_BIN/bin/cmake" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'cmake %s\n' "$*" >> "${FAKE_CMAKE_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/cmake-fail" ]]; then
  echo "fake cmake: simulated failure" >&2
  exit 1
fi
build_dir=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "-B" ]]; then
    build_dir="${args[$((i+1))]:?}"
  elif [[ "${args[$i]}" == "--build" ]]; then
    build_dir="${args[$((i+1))]:?}"
    mkdir -p "$build_dir/bin/kwin/effects/plugins" "$build_dir/bin/kwin/effects/configs"
    printf 'fake-so\n' > "$build_dir/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
    if [[ ! -f "${FAKE_STATE_DIR:?}/cmake-missing-kcm" ]]; then
      printf 'fake-kcm\n' > "$build_dir/bin/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
    fi
  fi
done
exit 0
EOF

  cat > "$FAKE_BIN/bin/mv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
source="${args[$(( ${#args[@]} - 2 ))]}"
destination="${args[$(( ${#args[@]} - 1 ))]}"
if [[ -n "${FAKE_MOVE_FAIL_SOURCE_SUFFIX:-}" && "$source" == *"${FAKE_MOVE_FAIL_SOURCE_SUFFIX}" ]]; then
  exit 1
fi
"${FAKE_REAL_MV:?}" "$@"
if [[ -f "${FAKE_STATE_DIR:?}/signal-on-move" && -n "${FAKE_MOVE_SIGNAL_MATCH:-}" ]]; then
  match=0
  case "${FAKE_MOVE_SIGNAL_WHAT:-destination}" in
    destination) [[ "$destination" == "$FAKE_MOVE_SIGNAL_MATCH" ]] && match=1 ;;
    source) [[ "$source" == "$FAKE_MOVE_SIGNAL_MATCH" ]] && match=1 ;;
  esac
  if [[ "$match" -eq 1 ]]; then
    rm -f "${FAKE_STATE_DIR:?}/signal-on-move"
    kill -"${FAKE_MOVE_SIGNAL:-TERM}" "$PPID"
  fi
fi
EOF

  cat > "$FAKE_BIN/bin/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'jq %s\n' "$*" >> "${FAKE_TOOL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/jq-fail" ]]; then
  echo "fake jq: simulated JSON parse failure" >&2
  exit 1
fi
if [[ -n "${JQ_FAKE_OUTPUT:-}" ]]; then
  printf '%s\n' "$JQ_FAKE_OUTPUT"
  exit 0
fi
file=""
for arg in "$@"; do
  [[ -f "$arg" ]] && file="$arg"
done
[[ -n "$file" ]] || exit 2
id=""
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == *'"Id"'* ]]; then
    id="${line#*\"Id\"}"
    id="${id#*:}"
    id="${id#*\"}"
    id="${id%%\"*}"
    break
  fi
done < "$file"
printf '%s\n' "$id"
EOF

  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/kwriteconfig6" "$FAKE_BIN/bin/kreadconfig6" "$FAKE_BIN/bin/qdbus" "$FAKE_BIN/bin/jq" "$FAKE_BIN/bin/cmake" "$FAKE_BIN/bin/mv"

  for tool in dirname pwd rm mkdir cp cat mktemp mv; do
    ln -sf "$(command -v "$tool")" "$FAKE_BIN/core/$tool"
  done
}

# Per-test overrides; an empty TEST_*_BIN omits the variable (forces the PATH
# fallback) and TEST_PATH limits PATH to a coreutils-only dir for the
# missing-tool probes so they are independent of any host Plasma tools.
# TEST_SCRIPT points at a throwaway copy of the script whose REPO_ROOT/kwin is
# a temporary tree, so dry-run source-data probes never touch the real package.
reset_state() {
  rm -rf "$WORK/state" "$WORK/data" "$WORK/config" "$WORK/home"
  mkdir -p "$WORK/state" "$WORK/data" "$WORK/home"
  : > "$WORK/npm.log"
  : > "$WORK/tools.log"
  : > "$WORK/cmake.log"
  TEST_NPM_BIN="$FAKE_BIN/bin/npm"
  TEST_KWRITECONFIG6_BIN="$FAKE_BIN/bin/kwriteconfig6"
  TEST_KREADCONFIG6_BIN="$FAKE_BIN/bin/kreadconfig6"
  TEST_QDBUS_BIN="$FAKE_BIN/bin/qdbus"
  TEST_JQ_BIN="$FAKE_BIN/bin/jq"
  TEST_CMAKE_BIN="$FAKE_BIN/bin/cmake"
  TEST_SCRIPT=""
  TEST_PATH="$PATH"
  unset JQ_FAKE_OUTPUT
  unset FAKE_QDBUS_SUPPORTED
  unset FAKE_QDBUS_LOADED
  unset TEST_KWIN_ENVIRON_FILE
  unset TEST_KWIN_DEV_CMAKE_DIR
  unset FAKE_MOVE_SIGNAL_MATCH FAKE_MOVE_SIGNAL FAKE_MOVE_SIGNAL_WHAT FAKE_MOVE_FAIL_SOURCE_SUFFIX
  # Default to "not running" so effect-status tests never fall through to
  # scanning the real host /proc; individual tests override
  # TEST_KWIN_ENVIRON_FILE to exercise the found/readable/unreadable branches.
  TEST_KWIN_NOT_RUNNING=1
}

run_script() {
  set +e
  local script="${TEST_SCRIPT:-$SCRIPT}"
  local cmd=(env -u NPM_BIN -u KWRITECONFIG6_BIN -u KREADCONFIG6_BIN -u QDBUS_BIN -u JQ_BIN -u CMAKE_BIN -u XDG_DATA_HOME -u XDG_CONFIG_HOME \
    -u DOGFOOD_KWIN_ENVIRON_FILE -u DOGFOOD_KWIN_NOT_RUNNING -u DOGFOOD_KWIN_DEV_CMAKE_DIR \
    "DOGFOOD_DATA_ROOT=$DATA" "DOGFOOD_CONFIG_ROOT=$CONFIG" "HOME=$FAKE_HOME" "PATH=$TEST_PATH")
  [[ -z "$TEST_NPM_BIN" ]] || cmd+=("NPM_BIN=$TEST_NPM_BIN")
  [[ -z "$TEST_KWRITECONFIG6_BIN" ]] || cmd+=("KWRITECONFIG6_BIN=$TEST_KWRITECONFIG6_BIN")
  [[ -z "$TEST_KREADCONFIG6_BIN" ]] || cmd+=("KREADCONFIG6_BIN=$TEST_KREADCONFIG6_BIN")
  [[ -z "$TEST_QDBUS_BIN" ]] || cmd+=("QDBUS_BIN=$TEST_QDBUS_BIN")
  [[ -z "$TEST_JQ_BIN" ]] || cmd+=("JQ_BIN=$TEST_JQ_BIN")
  [[ -z "$TEST_CMAKE_BIN" ]] || cmd+=("CMAKE_BIN=$TEST_CMAKE_BIN")
  [[ -z "${JQ_FAKE_OUTPUT:-}" ]] || cmd+=("JQ_FAKE_OUTPUT=$JQ_FAKE_OUTPUT")
  [[ -z "${FAKE_QDBUS_SUPPORTED:-}" ]] || cmd+=("FAKE_QDBUS_SUPPORTED=$FAKE_QDBUS_SUPPORTED")
  [[ -z "${FAKE_QDBUS_LOADED:-}" ]] || cmd+=("FAKE_QDBUS_LOADED=$FAKE_QDBUS_LOADED")
  [[ -z "${TEST_KWIN_ENVIRON_FILE:-}" ]] || cmd+=("DOGFOOD_KWIN_ENVIRON_FILE=$TEST_KWIN_ENVIRON_FILE")
  [[ -z "${TEST_KWIN_NOT_RUNNING:-}" ]] || cmd+=("DOGFOOD_KWIN_NOT_RUNNING=$TEST_KWIN_NOT_RUNNING")
  [[ -z "${TEST_KWIN_DEV_CMAKE_DIR:-}" ]] || cmd+=("DOGFOOD_KWIN_DEV_CMAKE_DIR=$TEST_KWIN_DEV_CMAKE_DIR")
  [[ -z "${FAKE_MOVE_SIGNAL_MATCH:-}" ]] || cmd+=("FAKE_MOVE_SIGNAL_MATCH=$FAKE_MOVE_SIGNAL_MATCH")
  [[ -z "${FAKE_MOVE_SIGNAL:-}" ]] || cmd+=("FAKE_MOVE_SIGNAL=$FAKE_MOVE_SIGNAL")
  [[ -z "${FAKE_MOVE_SIGNAL_WHAT:-}" ]] || cmd+=("FAKE_MOVE_SIGNAL_WHAT=$FAKE_MOVE_SIGNAL_WHAT")
  [[ -z "${FAKE_MOVE_FAIL_SOURCE_SUFFIX:-}" ]] || cmd+=("FAKE_MOVE_FAIL_SOURCE_SUFFIX=$FAKE_MOVE_FAIL_SOURCE_SUFFIX")
  cmd+=( "FAKE_NPM_LOG=$WORK/npm.log" "FAKE_TOOL_LOG=$WORK/tools.log" "FAKE_STATE_DIR=$WORK/state" "FAKE_REAL_NPM=$REAL_NPM" "FAKE_REAL_MV=$REAL_MV" "FAKE_CMAKE_LOG=$WORK/cmake.log" )
  cmd+=( "$BASH_PATH" "$script" "$@" )
  "${cmd[@]}" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

check_exit() {
  local expected="$1"
  if [[ "$EXIT" -ne "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $EXIT" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_contains() {
  local needle="$1"
  if grep -Fq -- "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: output does not contain '$needle'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local needle="$1"
  if grep -Fq -- "$needle" "$OUTPUT"; then
    echo "FAIL: output unexpectedly contains '$needle'" >&2
    echo "--- output ---" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_file() {
  if [[ -e "$1" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected file '$1'" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_exists() {
  if [[ ! -e "$1" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: unexpected path '$1'" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_cmp() {
  if cmp -s "$1" "$2"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: '$1' differs from '$2'" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_grep_file() {
  local needle="$1" file="$2"
  if grep -Fq -- "$needle" "$file"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: '$file' does not contain '$needle'" >&2
    cat "$file" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_grep_file() {
  local needle="$1" file="$2"
  if grep -Fq -- "$needle" "$file"; then
    echo "FAIL: '$file' unexpectedly contains '$needle'" >&2
    cat "$file" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_count() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$actual" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $label: expected $expected, got $actual" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_find_count() {
  local expected="$1" root="$2" label="$3"
  shift 3
  if [[ ! -d "$root" ]]; then
    echo "FAIL: $label: find root does not exist: $root" >&2
    FAIL=$((FAIL + 1))
    return
  fi
  local actual
  if ! actual="$(find "$root" "$@" -print | wc -l)"; then
    echo "FAIL: $label: find failed under $root" >&2
    FAIL=$((FAIL + 1))
    return
  fi
  assert_count "$expected" "$actual" "$label"
}

assert_qdbus_calls() {
  local expected="$1" line n=0 ok=1
  while IFS= read -r line; do
    n=$((n + 1))
    [[ "$line" == "qdbus org.kde.KWin /KWin reconfigure" ]] || ok=0
  done < <(grep '^qdbus ' "$WORK/tools.log")
  if [[ "$ok" -eq 1 && "$n" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected exactly $expected 'qdbus org.kde.KWin /KWin reconfigure' call(s), got $n" >&2
    cat "$WORK/tools.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Builds a throwaway kwin source tree plus a copy of the script under test so
# dry-run source-data probes are fully hermetic. The copy resolves its own
# KWIN_DIR to $WORK/kwin because REPO_ROOT derives from the script location.
setup_dry_source() {
  rm -rf "$WORK/kwin" "$WORK/scripts"
  mkdir -p "$WORK/kwin/contents/code" "$WORK/kwin/contents/config" "$WORK/kwin/contents/ui" "$WORK/scripts"
  printf '{"KPackageStructure":"KWin/Script","KPlugin":{"Id":"plasma-auto-tiler-kwin"}}\n' > "$WORK/kwin/metadata.json"
  printf 'bundle\n' > "$WORK/kwin/contents/code/main.js"
  printf '<xml/>\n' > "$WORK/kwin/contents/config/main.xml"
  printf '<ui/>\n' > "$WORK/kwin/contents/ui/config.ui"
  cp "$SCRIPT" "$WORK/scripts/dogfood-install.sh"
  TEST_SCRIPT="$WORK/scripts/dogfood-install.sh"
}

make_fake_tools
reset_state

# parsing: no command fails with a clear message
run_script
check_exit 1
assert_contains "error: missing command"

# parsing: unknown command fails closed
run_script bogus
check_exit 1
assert_contains "error: unknown command 'bogus'"

# parsing: --help exits 0 and documents the interface
run_script --help
check_exit 0
assert_contains "usage: dogfood-install.sh <command> [--help]"
assert_contains "generic scripted KCM is retired"
assert_contains "reload"
assert_contains "Runtime tool-path overrides"

# parsing: --help rejects extra arguments
run_script --help extra
check_exit 1
assert_contains "error: '--help' takes no arguments"

# parsing: --help documents the new effect subcommands
run_script --help
check_exit 0
assert_contains "effect-install"
assert_contains "effect-reload"
assert_contains "effect-status"
assert_contains "effect-remove"
assert_contains "setup"

# parsing: every subcommand rejects extra arguments
for command in install uninstall enable disable reload status dry-run effect-install effect-reload effect-status effect-remove setup; do
  run_script "$command" extra
  check_exit 1
  assert_contains "error: '$command' takes no arguments"
done

# missing-tool probes use a coreutils-only PATH and omitted *_BIN variables
reset_state
TEST_NPM_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script install
check_exit 1
assert_contains "required tool 'npm' not found in PATH"
assert_contains "set NPM_BIN to its absolute path"

reset_state
TEST_KWRITECONFIG6_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script enable
check_exit 1
assert_contains "required tool 'kwriteconfig6' not found in PATH"
assert_contains "set KWRITECONFIG6_BIN to its absolute path"

reset_state
TEST_QDBUS_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script enable
check_exit 1
assert_contains "required tool 'qdbus' not found in PATH"
assert_contains "set QDBUS_BIN to its absolute path"

reset_state
TEST_KREADCONFIG6_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script status
check_exit 1
assert_contains "required tool 'kreadconfig6' not found in PATH"
assert_contains "set KREADCONFIG6_BIN to its absolute path"

reset_state
TEST_CMAKE_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script effect-install
check_exit 1
assert_contains "required tool 'cmake' not found in PATH"
assert_contains "set CMAKE_BIN to its absolute path"

reset_state
TEST_KWRITECONFIG6_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script effect-install
check_exit 1
assert_contains "required tool 'kwriteconfig6' not found in PATH"
assert_contains "set KWRITECONFIG6_BIN to its absolute path"

reset_state
TEST_QDBUS_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script effect-reload
check_exit 1
assert_contains "required tool 'qdbus' not found in PATH"
assert_contains "set QDBUS_BIN to its absolute path"

reset_state
TEST_QDBUS_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script effect-status
check_exit 1
assert_contains "required tool 'qdbus' not found in PATH"
assert_contains "set QDBUS_BIN to its absolute path"

# a *_BIN override that is not executable fails with the tool name
reset_state
printf 'x\n' > "$WORK/notexec"
TEST_NPM_BIN="$WORK/notexec"
run_script install
check_exit 1
assert_contains "error: NPM_BIN is set but is not an executable: $WORK/notexec"

# install: builds first, then copies the exact package into the test root
reset_state
run_script install
check_exit 0
assert_contains "installed: plasma-auto-tiler-kwin -> $DATA/kwin/scripts/plasma-auto-tiler-kwin"
assert_contains "install does not enable the plugin"
assert_grep_file "npm --prefix $KWIN_DIR run build" "$WORK/npm.log"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/contents/code/main.js"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/contents/config/main.xml"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/contents/ui/config.ui"
assert_cmp "$META" "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"
assert_cmp "$BUNDLE" "$DATA/kwin/scripts/plasma-auto-tiler-kwin/contents/code/main.js"
assert_cmp "$KWIN_DIR/contents/config/main.xml" "$DATA/kwin/scripts/plasma-auto-tiler-kwin/contents/config/main.xml"
assert_cmp "$KWIN_DIR/contents/ui/config.ui" "$DATA/kwin/scripts/plasma-auto-tiler-kwin/contents/ui/config.ui"
assert_find_count 1 "$DATA/kwin/scripts" "entries under data root kwin/scripts" -mindepth 1 -maxdepth 1
assert_find_count 4 "$DATA/kwin/scripts/plasma-auto-tiler-kwin" "files in installed package" -type f
assert_not_grep_file "kwriteconfig6" "$WORK/tools.log"
assert_not_grep_file "qdbus" "$WORK/tools.log"
assert_qdbus_calls 0
assert_not_exists "$CONFIG/kwinrc"

# install: replaces any existing plugin directory
echo "stale" > "$DATA/kwin/scripts/plasma-auto-tiler-kwin/stale.txt"
run_script install
check_exit 0
assert_not_exists "$DATA/kwin/scripts/plasma-auto-tiler-kwin/stale.txt"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"

# install: a failed build aborts before any copy
reset_state
touch "$WORK/state/npm-fail"
run_script install
check_exit 1
assert_contains "error: npm --prefix kwin run build failed in $KWIN_DIR"
assert_not_exists "$DATA/kwin/scripts/plasma-auto-tiler-kwin"
assert_grep_file "npm --prefix $KWIN_DIR run build" "$WORK/npm.log"

# uninstall: removes only the installed package and nothing else
reset_state
run_script install
check_exit 0
run_script uninstall
check_exit 0
assert_contains "uninstalled: removed $DATA/kwin/scripts/plasma-auto-tiler-kwin"
assert_not_exists "$DATA/kwin/scripts/plasma-auto-tiler-kwin"
assert_find_count 0 "$DATA" "files left under the data root after uninstall" -type f

# uninstall: idempotent when nothing is installed
reset_state
run_script uninstall
check_exit 0
assert_contains "uninstall: nothing installed at $DATA/kwin/scripts/plasma-auto-tiler-kwin"

# enable: writes the exact plugin key and reconfigures via fake qdbus
reset_state
run_script enable
check_exit 0
assert_contains "enabled: plasma-auto-tiler-kwinEnabled set to true and KWin reconfigured"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled true" "$WORK/tools.log"
assert_qdbus_calls 1
assert_grep_file "[Plugins]" "$CONFIG/kwinrc"
assert_grep_file "plasma-auto-tiler-kwinEnabled=true" "$CONFIG/kwinrc"

# disable: writes false and reconfigures
reset_state
run_script disable
check_exit 0
assert_contains "disabled: plasma-auto-tiler-kwinEnabled set to false and KWin reconfigured"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled false" "$WORK/tools.log"
assert_qdbus_calls 1
assert_grep_file "plasma-auto-tiler-kwinEnabled=false" "$CONFIG/kwinrc"

# enable then disable: exact reconfigure calls each time, final value false
reset_state
run_script enable
check_exit 0
assert_qdbus_calls 1
run_script disable
check_exit 0
assert_qdbus_calls 2
assert_grep_file "plasma-auto-tiler-kwinEnabled=false" "$CONFIG/kwinrc"

# reload: disables then re-enables so KWin replaces the in-memory script
# instance, leaving the plugin enabled.
reset_state
run_script reload
check_exit 0
assert_contains "disabled: plasma-auto-tiler-kwinEnabled set to false and KWin reconfigured"
assert_contains "enabled: plasma-auto-tiler-kwinEnabled set to true and KWin reconfigured"
assert_contains "reloaded: plasma-auto-tiler-kwin is enabled with a fresh KWin script instance"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled false" "$WORK/tools.log"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled true" "$WORK/tools.log"
assert_qdbus_calls 2
assert_grep_file "plasma-auto-tiler-kwinEnabled=true" "$CONFIG/kwinrc"

# enable: kwriteconfig6 failure fails closed before any reconfigure
reset_state
touch "$WORK/state/kwrite-fail"
run_script enable
check_exit 1
assert_contains "error: kwriteconfig6 failed to set plasma-auto-tiler-kwinEnabled=true in $CONFIG/kwinrc"
assert_qdbus_calls 0

# enable: qdbus failure fails closed after the key was written
reset_state
touch "$WORK/state/qdbus-fail"
run_script enable
check_exit 1
assert_contains "error: qdbus failed to reconfigure KWin (org.kde.KWin /KWin reconfigure)"
assert_grep_file "plasma-auto-tiler-kwinEnabled=true" "$CONFIG/kwinrc"
assert_qdbus_calls 1

# status: kreadconfig6 failure fails closed
reset_state
touch "$WORK/state/kread-fail"
run_script status
check_exit 1
assert_contains "error: kreadconfig6 failed to read plasma-auto-tiler-kwinEnabled from $CONFIG/kwinrc"

# status: fresh root is not installed and not enabled, read-only, no reconfigure
reset_state
run_script status
check_exit 0
assert_contains "installed: no"
assert_contains "enabled: no"
assert_contains "status is read-only and never reconfigures KWin"
assert_grep_file "kreadconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled" "$WORK/tools.log"
assert_not_grep_file "kwriteconfig6" "$WORK/tools.log"
assert_not_grep_file "qdbus" "$WORK/tools.log"
assert_qdbus_calls 0

# status: installed but not enabled
reset_state
run_script install
check_exit 0
run_script status
check_exit 0
assert_contains "installed: yes ($DATA/kwin/scripts/plasma-auto-tiler-kwin)"
assert_contains "enabled: no"
assert_qdbus_calls 0

# status: installed and enabled, and status never adds reconfigure calls
reset_state
run_script install
check_exit 0
run_script enable
check_exit 0
assert_qdbus_calls 1
run_script status
check_exit 0
assert_contains "installed: yes ($DATA/kwin/scripts/plasma-auto-tiler-kwin)"
assert_contains "enabled: yes"
assert_qdbus_calls 1

# status: a plugin directory without metadata.json reports not installed
reset_state
mkdir -p "$DATA/kwin/scripts/plasma-auto-tiler-kwin"
run_script status
check_exit 0
assert_contains "installed: no"

# dry-run: fresh root reports valid source, absent destination, no mutation
reset_state
setup_dry_source
run_script dry-run
check_exit 0
assert_contains "source metadata: valid (KPlugin.Id=plasma-auto-tiler-kwin)"
assert_contains "source bundle: present ($WORK/kwin/contents/code/main.js)"
assert_contains "KCM schema: present ($WORK/kwin/contents/config/main.xml)"
assert_contains "KCM UI: present ($WORK/kwin/contents/ui/config.ui)"
assert_contains "installed: no"
assert_contains "enabled: no"
assert_contains "intended actions:"
assert_contains "- build the kwin bundle (npm --prefix $WORK/kwin run build)"
assert_contains "- replace any existing plugin directory at $DATA/kwin/scripts/plasma-auto-tiler-kwin"
assert_contains "dry-run is read-only and never builds, copies, writes configuration, reconfigures KWin, or reconciles shortcuts"
assert_grep_file "jq -r .KPlugin.Id" "$WORK/tools.log"
assert_grep_file "kreadconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled" "$WORK/tools.log"
assert_not_grep_file "kwriteconfig6" "$WORK/tools.log"
assert_not_grep_file "qdbus" "$WORK/tools.log"
assert_not_grep_file "npm" "$WORK/tools.log"
assert_qdbus_calls 0
assert_not_exists "$CONFIG/kwinrc"
assert_find_count 0 "$DATA" "files under data root after dry-run" -type f

# dry-run: installed and enabled state is reported through the kreadconfig6 convention
reset_state
setup_dry_source
mkdir -p "$DATA/kwin/scripts/plasma-auto-tiler-kwin"
cp "$WORK/kwin/metadata.json" "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"
mkdir -p "$CONFIG"
printf '[Plugins]\nplasma-auto-tiler-kwinEnabled=true\n' > "$CONFIG/kwinrc"
run_script dry-run
check_exit 0
assert_contains "installed: yes ($DATA/kwin/scripts/plasma-auto-tiler-kwin)"
assert_contains "enabled: yes"
assert_grep_file "kreadconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-kwinEnabled" "$WORK/tools.log"
assert_not_grep_file "kwriteconfig6" "$WORK/tools.log"
assert_not_grep_file "qdbus" "$WORK/tools.log"
assert_qdbus_calls 0

# dry-run: missing read tool fails closed (jq)
reset_state
setup_dry_source
TEST_JQ_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script dry-run
check_exit 1
assert_contains "required tool 'jq' not found in PATH"
assert_contains "set JQ_BIN to its absolute path"

# dry-run: missing read tool fails closed (kreadconfig6)
reset_state
setup_dry_source
TEST_KREADCONFIG6_BIN=""
TEST_PATH="$FAKE_BIN/core"
run_script dry-run
check_exit 1
assert_contains "required tool 'kreadconfig6' not found in PATH"
assert_contains "set KREADCONFIG6_BIN to its absolute path"

# dry-run: missing source data fails closed before any report
reset_state
setup_dry_source
rm "$WORK/kwin/contents/ui/config.ui"
run_script dry-run
check_exit 1
assert_contains "error: dry-run requires source data that is missing:"
assert_contains "- $WORK/kwin/contents/ui/config.ui"
assert_not_contains "intended actions:"

# dry-run: invalid metadata JSON fails closed
reset_state
setup_dry_source
touch "$WORK/state/jq-fail"
run_script dry-run
check_exit 1
assert_contains "error: metadata.json is not valid JSON: $WORK/kwin/metadata.json"

# dry-run: metadata KPlugin.Id mismatch fails closed
reset_state
setup_dry_source
JQ_FAKE_OUTPUT="not-the-plugin"
run_script dry-run
check_exit 1
assert_contains "error: metadata.json KPlugin.Id is 'not-the-plugin'; expected 'plasma-auto-tiler-kwin'"

# dry-run: kreadconfig6 failure fails closed
reset_state
setup_dry_source
touch "$WORK/state/kread-fail"
run_script dry-run
check_exit 1
assert_contains "error: kreadconfig6 failed to read plasma-auto-tiler-kwinEnabled from $CONFIG/kwinrc"

# effect-install: fresh run builds via cmake and stages the fake .so
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_STAGED_KCM="$EFFECT_ROOT/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
LEGACY_EFFECT_ENV_FILE="$CONFIG/environment.d/60-plasma-auto-tiler-native-effect.conf"
run_script effect-install
check_exit 0
assert_contains "staged: $EFFECT_STAGED_SO"
assert_contains "env script: $EFFECT_ENV_FILE"
assert_contains "a logout/login (or new session) is required"
assert_grep_file "-B $DATA/.plasma-auto-tiler-native-effect." "$WORK/cmake.log"
assert_grep_file "--build $DATA/.plasma-auto-tiler-native-effect." "$WORK/cmake.log"
assert_file "$EFFECT_STAGED_SO"
assert_grep_file "fake-so" "$EFFECT_STAGED_SO"
assert_file "$EFFECT_STAGED_KCM"
assert_grep_file "fake-kcm" "$EFFECT_STAGED_KCM"
assert_find_count 1 "$EFFECT_ROOT/kwin/effects/plugins" "files in the staged native plugin namespace" -mindepth 1 -maxdepth 1 -type f
assert_find_count 1 "$EFFECT_ROOT/kwin/effects/configs" "files in the staged native KCM namespace" -mindepth 1 -maxdepth 1 -type f
assert_find_count 2 "$EFFECT_ROOT/kwin/effects" "files in the complete staged native namespace" -type f
assert_file "$EFFECT_ENV_FILE"
assert_grep_file 'export QT_PLUGIN_PATH="'"$EFFECT_ROOT"'${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}"' "$EFFECT_ENV_FILE"
assert_count 1 "$(grep -c QT_PLUGIN_PATH "$EFFECT_ENV_FILE")" "QT_PLUGIN_PATH lines in fresh env script"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-active-borderEnabled true" "$WORK/tools.log"
assert_contains "kwinrc: plasma-auto-tiler-active-borderEnabled set to true"
if sh -n "$EFFECT_ENV_FILE" 2>/dev/null; then
  PASS=$((PASS + 1))
else
  echo "FAIL: env script at $EFFECT_ENV_FILE is not valid POSIX sh (sh -n failed)" >&2
  FAIL=$((FAIL + 1))
fi

# effect-install: cmake configure failure fails closed
reset_state
touch "$WORK/state/cmake-fail"
run_script effect-install
check_exit 1
assert_contains "error: cmake configure failed for"
assert_not_exists "$EFFECT_STAGED_SO"
assert_not_exists "$EFFECT_ENV_FILE"

# effect-install: a missing KCM output fails closed before either native output
# is staged or any environment/configuration state is written
reset_state
touch "$WORK/state/cmake-missing-kcm"
run_script effect-install
check_exit 1
assert_contains "error: config module not found after build:"
assert_not_exists "$EFFECT_ROOT/kwin"
assert_not_exists "$EFFECT_STAGED_SO"
assert_not_exists "$EFFECT_STAGED_KCM"
assert_not_exists "$EFFECT_ENV_FILE"
assert_not_exists "$CONFIG/kwinrc"
assert_not_grep_file "kwriteconfig6" "$WORK/tools.log"

# effect-install: kwinrc write failure is checked before publishing any new
# binary or environment state
reset_state
touch "$WORK/state/kwrite-fail"
run_script effect-install
check_exit 1
assert_contains "error: kwriteconfig6 failed to set plasma-auto-tiler-active-borderEnabled=true"
assert_not_exists "$EFFECT_ROOT"
assert_not_exists "$EFFECT_ENV_FILE"
assert_not_exists "$CONFIG/kwinrc"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-active-borderEnabled true" "$WORK/tools.log"

# effect-install: idempotent re-run does not duplicate or corrupt the env script
reset_state
run_script effect-install
check_exit 0
cp "$EFFECT_ENV_FILE" "$WORK/env-first.sh"
run_script effect-install
check_exit 0
assert_cmp "$WORK/env-first.sh" "$EFFECT_ENV_FILE"
assert_count 1 "$(grep -c QT_PLUGIN_PATH "$EFFECT_ENV_FILE")" "QT_PLUGIN_PATH lines in env script after re-run"
assert_count 1 "$(grep -c '^plasma-auto-tiler-active-borderEnabled=' "$CONFIG/kwinrc")" "plasma-auto-tiler-active-borderEnabled lines in kwinrc after re-run"
assert_not_contains "logout/login"

# effect-install: SIGTERM during replacement publication restores the exact
# pre-existing root, environment script, and kwinrc state
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
mkdir -p "$(dirname "$EFFECT_STAGED_SO")" "$(dirname "$EFFECT_ENV_FILE")"
printf 'previous-so\n' > "$EFFECT_STAGED_SO"
printf 'previous-extra\n' > "$EFFECT_ROOT/previous-extra"
printf 'previous-env\n' > "$EFFECT_ENV_FILE"
printf '[Plugins]\nplasma-auto-tiler-active-borderEnabled=false\nunrelated=true\n' > "$CONFIG/kwinrc"
cp -R "$EFFECT_ROOT" "$WORK/install-old-root"
cp "$EFFECT_ENV_FILE" "$WORK/install-old-env"
cp "$CONFIG/kwinrc" "$WORK/install-old-kwinrc"
touch "$WORK/state/signal-on-move"
FAKE_MOVE_SIGNAL_MATCH="$EFFECT_ROOT"
FAKE_MOVE_SIGNAL=TERM
FAKE_MOVE_SIGNAL_WHAT=destination
TEST_PATH="$FAKE_BIN/bin:$PATH"
run_script effect-install
check_exit 143
assert_contains "error: interrupted by SIGTERM"
assert_not_contains "rollback failed"
assert_cmp "$WORK/install-old-root/kwin/effects/plugins/plasma-auto-tiler-active-border.so" "$EFFECT_STAGED_SO"
assert_cmp "$WORK/install-old-root/previous-extra" "$EFFECT_ROOT/previous-extra"
assert_cmp "$WORK/install-old-env" "$EFFECT_ENV_FILE"
assert_cmp "$WORK/install-old-kwinrc" "$CONFIG/kwinrc"
assert_not_exists "$DATA/.plasma-auto-tiler-native-effect"

# effect-install: catchable-signal rollback preserves an exact pre-existing
# empty native enablement key rather than treating it as absent
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
mkdir -p "$(dirname "$EFFECT_STAGED_SO")" "$(dirname "$EFFECT_ENV_FILE")"
printf 'previous-so\n' > "$EFFECT_STAGED_SO"
printf 'previous-env\n' > "$EFFECT_ENV_FILE"
printf '[Plugins]\nplasma-auto-tiler-active-borderEnabled=\nunrelated=true\n' > "$CONFIG/kwinrc"
cp "$CONFIG/kwinrc" "$WORK/install-empty-key-old-kwinrc"
touch "$WORK/state/signal-on-move"
FAKE_MOVE_SIGNAL_MATCH="$EFFECT_ROOT"
FAKE_MOVE_SIGNAL=TERM
FAKE_MOVE_SIGNAL_WHAT=destination
TEST_PATH="$FAKE_BIN/bin:$PATH"
run_script effect-install
check_exit 143
assert_contains "error: interrupted by SIGTERM"
assert_not_contains "rollback failed"
assert_cmp "$WORK/install-empty-key-old-kwinrc" "$CONFIG/kwinrc"
assert_count 1 "$(grep -Fx -c 'plasma-auto-tiler-active-borderEnabled=' "$CONFIG/kwinrc")" "empty native enablement key after rollback"
assert_grep_file "unrelated=true" "$CONFIG/kwinrc"
assert_find_count 0 "$DATA" "native-effect transaction directories after empty-key rollback" -mindepth 1 -maxdepth 1 -type d -name '.plasma-auto-tiler-native-effect.*'

# effect-install: SIGHUP during first publication rolls back a fresh install
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
touch "$WORK/state/signal-on-move"
FAKE_MOVE_SIGNAL_MATCH="$EFFECT_ROOT"
FAKE_MOVE_SIGNAL=HUP
FAKE_MOVE_SIGNAL_WHAT=destination
TEST_PATH="$FAKE_BIN/bin:$PATH"
run_script effect-install
check_exit 129
assert_contains "error: interrupted by SIGHUP"
assert_not_contains "rollback failed"
assert_not_exists "$EFFECT_ROOT"
assert_not_exists "$EFFECT_ENV_FILE"
assert_not_exists "$CONFIG/kwinrc"

# effect-remove: SIGINT after staging the environment entry restores the exact
# pre-existing native state rather than leaving a partial removal
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
run_script effect-install
check_exit 0
cp -R "$EFFECT_ROOT" "$WORK/remove-old-root"
cp "$EFFECT_ENV_FILE" "$WORK/remove-old-env"
cp "$CONFIG/kwinrc" "$WORK/remove-old-kwinrc"
touch "$WORK/state/signal-on-move"
FAKE_MOVE_SIGNAL_MATCH="$EFFECT_ENV_FILE"
FAKE_MOVE_SIGNAL=INT
FAKE_MOVE_SIGNAL_WHAT=source
TEST_PATH="$FAKE_BIN/bin:$PATH"
run_script effect-remove
check_exit 130
assert_contains "error: interrupted by SIGINT"
assert_not_contains "rollback failed"
assert_cmp "$WORK/remove-old-root/kwin/effects/plugins/plasma-auto-tiler-active-border.so" "$EFFECT_STAGED_SO"
assert_cmp "$WORK/remove-old-env" "$EFFECT_ENV_FILE"
assert_cmp "$WORK/remove-old-kwinrc" "$CONFIG/kwinrc"
assert_file "$EFFECT_STAGED_KCM"

# effect-install: a failed rollback operation is reported as rollback failure
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
mkdir -p "$(dirname "$EFFECT_STAGED_SO")" "$(dirname "$EFFECT_ENV_FILE")"
printf 'previous-so\n' > "$EFFECT_STAGED_SO"
printf 'previous-env\n' > "$EFFECT_ENV_FILE"
printf '[Plugins]\nplasma-auto-tiler-active-borderEnabled=false\n' > "$CONFIG/kwinrc"
touch "$WORK/state/signal-on-move"
FAKE_MOVE_SIGNAL_MATCH="$EFFECT_ROOT"
FAKE_MOVE_SIGNAL=TERM
FAKE_MOVE_SIGNAL_WHAT=destination
FAKE_MOVE_FAIL_SOURCE_SUFFIX=previous-root
TEST_PATH="$FAKE_BIN/bin:$PATH"
run_script effect-install
check_exit 143
assert_contains "error: interrupted by SIGTERM; rollback failed"

# effect-remove: a failed rollback operation is reported as rollback failure
reset_state
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
EFFECT_STAGED_SO="$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
EFFECT_ENV_FILE="$CONFIG/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
run_script effect-install
check_exit 0
touch "$WORK/state/signal-on-move"
FAKE_MOVE_SIGNAL_MATCH="$EFFECT_ENV_FILE"
FAKE_MOVE_SIGNAL=INT
FAKE_MOVE_SIGNAL_WHAT=source
FAKE_MOVE_FAIL_SOURCE_SUFFIX=root
TEST_PATH="$FAKE_BIN/bin:$PATH"
run_script effect-remove
check_exit 130
assert_contains "error: interrupted by SIGINT; rollback failed"

# effect-install: pinned KWin_DIR path exists -> passed to cmake
reset_state
mkdir -p "$WORK/fake-kwin-dev-dir"
TEST_KWIN_DEV_CMAKE_DIR="$WORK/fake-kwin-dev-dir"
run_script effect-install
check_exit 0
assert_grep_file "-DKWin_DIR=$WORK/fake-kwin-dev-dir" "$WORK/cmake.log"

# effect-install: pinned KWin_DIR path does not exist -> omitted, build still succeeds
reset_state
TEST_KWIN_DEV_CMAKE_DIR="$WORK/does-not-exist-kwin-dev-dir"
run_script effect-install
check_exit 0
assert_not_grep_file "-DKWin_DIR=" "$WORK/cmake.log"
EFFECT_ROOT="$DATA/plasma-auto-tiler-native-effect"
assert_file "$EFFECT_ROOT/kwin/effects/plugins/plasma-auto-tiler-active-border.so"

# effect-status: nothing staged, no env script, kwin_wayland not running (the
# reset_state default) - all five stages fail/unknown with guidance, and it
# never touches cmake
reset_state
run_script effect-status
check_exit 0
assert_contains "[a] staging: no - plugin .so not found at $EFFECT_STAGED_SO"
assert_contains "-> run 'effect-install' to build and stage it."
assert_contains "[b] env script: no - $EFFECT_ENV_FILE not found"
assert_contains "-> run 'effect-install' to create it."
assert_contains "[c] session delivery: could not determine - the running kwin_wayland process could not be found"
assert_contains "[d] discovery: no - isEffectSupported reports false"
assert_contains "-> stage c could not be determined; investigate session delivery manually"
assert_contains "[e] loaded: no - isEffectLoaded reports false"
assert_contains "-> stage d (discovery) already failed; loading cannot succeed"
assert_not_grep_file "cmake" "$WORK/cmake.log"

# effect-status: after effect-install, staging and env script pass; session
# delivery still unknown (kwin_wayland not running in this test), read-only
reset_state
run_script effect-install
check_exit 0
: > "$WORK/cmake.log"
run_script effect-status
check_exit 0
assert_contains "[a] staging: yes - plugin .so present at $EFFECT_STAGED_SO"
assert_contains "[a] config module: yes - KCM .so present at $EFFECT_STAGED_KCM"
assert_contains "[b] env script: yes - $EFFECT_ENV_FILE exists and its content is current"
assert_contains "[c] session delivery: could not determine - the running kwin_wayland process could not be found"
assert_count 0 "$(wc -l < "$WORK/cmake.log")" "cmake invocations during effect-status"

# effect-status: env script exists but its content is stale
reset_state
run_script effect-install
check_exit 0
printf 'export QT_PLUGIN_PATH="/something/else"\n' > "$EFFECT_ENV_FILE"
run_script effect-status
check_exit 0
assert_contains "[b] env script: stale - $EFFECT_ENV_FILE exists but its content is out of date"
assert_contains "-> run 'effect-install' to rewrite it."

# effect-status: session delivery FAIL (kwin_wayland "running", QT_PLUGIN_PATH
# does not include the staging root) with a current env script -> points at a
# pending logout/login or a broken env-script route, not a plugin problem
reset_state
run_script effect-install
check_exit 0
printf 'OTHER=1\0QT_PLUGIN_PATH=/some/other/path\0' > "$WORK/fake-environ"
TEST_KWIN_ENVIRON_FILE="$WORK/fake-environ"
TEST_KWIN_NOT_RUNNING=""
run_script effect-status
check_exit 0
assert_contains "[c] session delivery: no - the running kwin_wayland process's QT_PLUGIN_PATH does not include $EFFECT_ROOT ($WORK/fake-environ)"
assert_contains "-> the env script is current but has not reached the running KWin session: a logout/login is still pending, or the env-script route did not work."

# effect-status: session delivery FAIL and env script NOT current -> points at
# fixing stage b first instead of blaming a logout/login
reset_state
printf 'OTHER=1\0QT_PLUGIN_PATH=/some/other/path\0' > "$WORK/fake-environ"
TEST_KWIN_ENVIRON_FILE="$WORK/fake-environ"
TEST_KWIN_NOT_RUNNING=""
run_script effect-status
check_exit 0
assert_contains "[c] session delivery: no - the running kwin_wayland process's QT_PLUGIN_PATH does not include $EFFECT_ROOT ($WORK/fake-environ)"
assert_contains "-> stage b (env script) is not correct yet; fix that first (see above)"
assert_not_contains "a logout/login is still pending, or the env-script route did not work."

# effect-status: session delivery unreadable (process "found" but its environ
# cannot be read) reports could-not-determine with the specific reason and
# never silently assumes pass or fail
reset_state
run_script effect-install
check_exit 0
TEST_KWIN_ENVIRON_FILE="$WORK/does-not-exist-environ"
TEST_KWIN_NOT_RUNNING=""
run_script effect-status
check_exit 0
assert_contains "[c] session delivery: could not determine - $WORK/does-not-exist-environ is not readable (permission denied)"
assert_not_contains "session delivery: yes"
assert_not_contains "session delivery: no -"

# effect-status: session delivery PASS but discovery FAIL -> points at the
# journal (not a session boundary), since stage c already proved delivery
reset_state
run_script effect-install
check_exit 0
printf 'OTHER=1\0QT_PLUGIN_PATH=%s:/nix/store/example/lib/qt-6/plugins\0' "$EFFECT_ROOT" > "$WORK/fake-environ"
TEST_KWIN_ENVIRON_FILE="$WORK/fake-environ"
TEST_KWIN_NOT_RUNNING=""
FAKE_QDBUS_SUPPORTED=false
run_script effect-status
check_exit 0
assert_contains "[c] session delivery: yes - the running kwin_wayland process's QT_PLUGIN_PATH includes $EFFECT_ROOT ($WORK/fake-environ)"
assert_contains "[d] discovery: no - isEffectSupported reports false"
assert_contains "-> QT_PLUGIN_PATH reached the running KWin session (stage c passed) but the plugin still was not loadable."
assert_contains "journalctl --user -b"
assert_not_contains "logout/login"

# effect-status: a D-Bus discovery query failure is reported as an error, not
# as unsupported and not as a session-boundary diagnosis
reset_state
touch "$WORK/state/qdbus-supported-fail"
run_script effect-status
check_exit 0
assert_contains "[d] discovery: error - qdbus failed to query isEffectSupported"
assert_not_contains "[d] discovery: no - isEffectSupported reports false"
assert_not_contains "logout/login"

# effect-status: a D-Bus loaded-state query failure is reported as an error,
# preserving fail-closed uncertainty about whether the effect is loaded
reset_state
FAKE_QDBUS_SUPPORTED=true
touch "$WORK/state/qdbus-loaded-fail"
run_script effect-status
check_exit 0
assert_contains "[d] discovery: yes - isEffectSupported reports true"
assert_contains "[e] loaded: error - qdbus failed to query isEffectLoaded"
assert_not_contains "[e] loaded: no - isEffectLoaded reports false"
assert_not_contains "effect is supported but not currently loaded"

# effect-status: discovery PASS but loaded FAIL -> points at effect-reload
reset_state
run_script effect-install
check_exit 0
FAKE_QDBUS_SUPPORTED=true
FAKE_QDBUS_LOADED=false
run_script effect-status
check_exit 0
assert_contains "[d] discovery: yes - isEffectSupported reports true for plasma-auto-tiler-active-border"
assert_contains "[e] loaded: no - isEffectLoaded reports false"
assert_contains "-> effect is supported but not currently loaded; run 'effect-reload' to load it."

# effect-status: all five stages pass and no failure guidance leaks through
reset_state
run_script effect-install
check_exit 0
printf 'OTHER=1\0QT_PLUGIN_PATH=%s:/nix/store/example/lib/qt-6/plugins\0' "$EFFECT_ROOT" > "$WORK/fake-environ"
TEST_KWIN_ENVIRON_FILE="$WORK/fake-environ"
TEST_KWIN_NOT_RUNNING=""
FAKE_QDBUS_SUPPORTED=true
FAKE_QDBUS_LOADED=true
run_script effect-status
check_exit 0
assert_contains "[a] staging: yes"
assert_contains "[b] env script: yes"
assert_contains "[c] session delivery: yes"
assert_contains "[d] discovery: yes"
assert_contains "[e] loaded: yes"
assert_not_contains "->"

# effect-reload: isEffectSupported=false is ambiguous and never calls
# load/unloadEffect or invents a session-boundary diagnosis
reset_state
run_script effect-install
check_exit 0
FAKE_QDBUS_SUPPORTED=false
run_script effect-reload
check_exit 2
assert_contains "error: plasma-auto-tiler-active-border is unavailable to KWin (isEffectSupported=false)"
assert_contains "plugin load, factory, or ABI failure"
assert_contains "Run 'effect-status'"
assert_not_contains "logout/login"
assert_not_grep_file "loadEffect" "$WORK/tools.log"
assert_not_grep_file "unloadEffect" "$WORK/tools.log"

# effect-reload: D-Bus discovery failure is a non-boundary failure
reset_state
touch "$WORK/state/qdbus-supported-fail"
run_script effect-reload
check_exit 2
assert_contains "error: qdbus failed to query isEffectSupported"
assert_not_contains "logout/login"
assert_not_grep_file "loadEffect" "$WORK/tools.log"

# effect-reload: malformed discovery reply is a non-boundary failure
reset_state
touch "$WORK/state/qdbus-malformed-supported"
run_script effect-reload
check_exit 2
assert_contains "error: qdbus returned an invalid isEffectSupported reply"
assert_not_contains "logout/login"
assert_not_grep_file "loadEffect" "$WORK/tools.log"

# effect-reload: load failure is a non-boundary failure
reset_state
FAKE_QDBUS_SUPPORTED=true
touch "$WORK/state/qdbus-load-fail"
run_script effect-reload
check_exit 2
assert_contains "error: qdbus failed to loadEffect"
assert_not_contains "logout/login"

# effect-reload: unload failure is a non-boundary failure
reset_state
FAKE_QDBUS_SUPPORTED=true
touch "$WORK/state/qdbus-unload-fail"
run_script effect-reload
check_exit 2
assert_contains "error: qdbus failed to unloadEffect"
assert_not_contains "logout/login"

# effect-reload: supported and loaded succeeds via unload then load then check
reset_state
FAKE_QDBUS_SUPPORTED=true
FAKE_QDBUS_LOADED=true
run_script effect-reload
check_exit 0
assert_contains "reloaded: plasma-auto-tiler-active-border is loaded"
grep '^qdbus ' "$WORK/tools.log" > "$WORK/qdbus-calls.log"
assert_grep_file "isEffectSupported plasma-auto-tiler-active-border" "$WORK/qdbus-calls.log"
assert_grep_file "unloadEffect plasma-auto-tiler-active-border" "$WORK/qdbus-calls.log"
assert_grep_file "loadEffect plasma-auto-tiler-active-border" "$WORK/qdbus-calls.log"
assert_grep_file "isEffectLoaded plasma-auto-tiler-active-border" "$WORK/qdbus-calls.log"
unload_line="$(grep -n unloadEffect "$WORK/qdbus-calls.log" | cut -d: -f1)"
load_line="$(grep -n 'loadEffect plasma-auto-tiler-active-border' "$WORK/qdbus-calls.log" | grep -v unloadEffect | cut -d: -f1)"
loaded_check_line="$(grep -n isEffectLoaded "$WORK/qdbus-calls.log" | cut -d: -f1)"
if [[ "$unload_line" -lt "$load_line" && "$load_line" -lt "$loaded_check_line" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: expected qdbus call order unloadEffect < loadEffect < isEffectLoaded" >&2
  cat "$WORK/qdbus-calls.log" >&2
  FAIL=$((FAIL + 1))
fi

# effect-remove: malformed and empty loaded-state replies fail closed
reset_state
run_script effect-install
check_exit 0
touch "$WORK/state/qdbus-malformed-loaded"
run_script effect-remove
check_exit 1
assert_contains "error: qdbus returned an invalid isEffectLoaded reply"
assert_file "$EFFECT_STAGED_SO"
assert_file "$EFFECT_ENV_FILE"
assert_grep_file "plasma-auto-tiler-active-borderEnabled=true" "$CONFIG/kwinrc"

reset_state
run_script effect-install
check_exit 0
touch "$WORK/state/qdbus-empty-loaded"
run_script effect-remove
check_exit 1
assert_contains "error: qdbus returned an invalid isEffectLoaded reply"
assert_file "$EFFECT_STAGED_SO"
assert_file "$EFFECT_ENV_FILE"
assert_grep_file "plasma-auto-tiler-active-borderEnabled=true" "$CONFIG/kwinrc"

# effect-remove: after effect-install, removes both the staged tree and the env script
reset_state
run_script effect-install
check_exit 0
run_script effect-remove
check_exit 0
assert_contains "removed: $EFFECT_ROOT"
assert_contains "removed: $EFFECT_ENV_FILE"
assert_not_exists "$EFFECT_ROOT"
assert_not_exists "$EFFECT_ENV_FILE"
assert_contains "removed (kwinrc key): plasma-auto-tiler-active-borderEnabled"
assert_not_grep_file "^plasma-auto-tiler-active-borderEnabled=" "$CONFIG/kwinrc"

# effect-remove: clears the complete namespaced native root and only removes
# this project's native enablement key from shared KWin configuration
reset_state
run_script effect-install
check_exit 0
mkdir -p "$EFFECT_ROOT/extra/deep"
printf 'stale native namespace content\n' > "$EFFECT_ROOT/extra/deep/stale.so"
printf '[Plugins]\nplasma-auto-tiler-active-borderEnabled=true\nplasma-auto-tiler-kwinEnabled=true\nunrelatedPluginEnabled=true\n' > "$CONFIG/kwinrc"
run_script effect-remove
check_exit 0
assert_not_exists "$EFFECT_ROOT"
assert_not_exists "$EFFECT_ROOT/extra/deep/stale.so"
assert_not_grep_file "^plasma-auto-tiler-active-borderEnabled=" "$CONFIG/kwinrc"
assert_grep_file "plasma-auto-tiler-kwinEnabled=true" "$CONFIG/kwinrc"
assert_grep_file "unrelatedPluginEnabled=true" "$CONFIG/kwinrc"

# effect-remove: a loaded effect is left completely intact rather than
# deleting a library that KWin still has mapped
reset_state
run_script effect-install
check_exit 0
FAKE_QDBUS_LOADED=true
run_script effect-remove
check_exit 1
assert_contains "is currently loaded; refusing to delete its files"
assert_file "$EFFECT_STAGED_SO"
assert_file "$EFFECT_STAGED_KCM"
assert_file "$EFFECT_ENV_FILE"
assert_grep_file "plasma-auto-tiler-active-borderEnabled=true" "$CONFIG/kwinrc"
assert_not_grep_file "loadEffect" "$WORK/tools.log"
assert_not_grep_file "unloadEffect" "$WORK/tools.log"

# effect-remove: kwinrc deletion failure rolls back staged file moves
reset_state
run_script effect-install
check_exit 0
touch "$WORK/state/kwrite-fail"
run_script effect-remove
check_exit 1
assert_contains "error: kwriteconfig6 failed to delete plasma-auto-tiler-active-borderEnabled"
assert_file "$EFFECT_STAGED_SO"
assert_file "$EFFECT_STAGED_KCM"
assert_file "$EFFECT_ENV_FILE"
assert_grep_file "plasma-auto-tiler-active-borderEnabled=true" "$CONFIG/kwinrc"

# effect-remove: migration - also removes the legacy environment.d entry this
# project used to write, without touching any other file under environment.d/
reset_state
run_script effect-install
check_exit 0
mkdir -p "$CONFIG/environment.d"
printf 'QT_PLUGIN_PATH=%s${QT_PLUGIN_PATH:+:${QT_PLUGIN_PATH}}\n' "$EFFECT_ROOT" > "$LEGACY_EFFECT_ENV_FILE"
printf '[Manager]\nDefaultEnvironment=FOO=bar\n' > "$CONFIG/environment.d/10-home-manager.conf"
run_script effect-remove
check_exit 0
assert_contains "removed (legacy): $LEGACY_EFFECT_ENV_FILE"
assert_not_exists "$LEGACY_EFFECT_ENV_FILE"
assert_file "$CONFIG/environment.d/10-home-manager.conf"
assert_grep_file "DefaultEnvironment=FOO=bar" "$CONFIG/environment.d/10-home-manager.conf"

# effect-remove: legacy-only state is migrated away even when nothing was
# ever staged under the new scheme
reset_state
mkdir -p "$CONFIG/environment.d"
printf 'QT_PLUGIN_PATH=%s${QT_PLUGIN_PATH:+:${QT_PLUGIN_PATH}}\n' "$EFFECT_ROOT" > "$LEGACY_EFFECT_ENV_FILE"
run_script effect-remove
check_exit 0
assert_contains "removed (legacy): $LEGACY_EFFECT_ENV_FILE"
assert_not_exists "$LEGACY_EFFECT_ENV_FILE"
assert_not_contains "nothing to do"

# effect-remove: idempotent when nothing was installed
reset_state
run_script effect-remove
check_exit 0
assert_contains "effect-remove: nothing to do ($EFFECT_ROOT, $EFFECT_ENV_FILE, and $LEGACY_EFFECT_ENV_FILE not present)"
assert_grep_file "kreadconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-active-borderEnabled" "$WORK/tools.log"
assert_not_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-active-borderEnabled --delete" "$WORK/tools.log"

# effect-remove: a present empty project key is distinguished from an absent key
reset_state
mkdir -p "$CONFIG"
printf '[Plugins]\nplasma-auto-tiler-active-borderEnabled=\nunrelated=true\n' > "$CONFIG/kwinrc"
run_script effect-remove
check_exit 0
assert_contains "removed (kwinrc key): plasma-auto-tiler-active-borderEnabled"
assert_not_grep_file "^plasma-auto-tiler-active-borderEnabled=" "$CONFIG/kwinrc"
assert_grep_file "unrelated=true" "$CONFIG/kwinrc"
assert_grep_file "kwriteconfig6 --file $CONFIG/kwinrc --group Plugins --key plasma-auto-tiler-active-borderEnabled --delete" "$WORK/tools.log"

# setup: full success path (all four stages succeed)
reset_state
FAKE_QDBUS_SUPPORTED=true
FAKE_QDBUS_LOADED=true
run_script setup
check_exit 0
assert_contains "install: ok"
assert_contains "enable: ok"
assert_contains "effect-install: ok"
assert_contains "effect-reload: ok"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"
assert_grep_file "[Plugins]" "$CONFIG/kwinrc"
assert_grep_file "plasma-auto-tiler-kwinEnabled=true" "$CONFIG/kwinrc"
assert_file "$EFFECT_STAGED_SO"
assert_grep_file "loadEffect plasma-auto-tiler-active-border" "$WORK/tools.log"

# setup: cmake unavailable -> effect stage gracefully skipped, whole command
# still succeeds
reset_state
TEST_CMAKE_BIN=""
TEST_PATH="$FAKE_BIN/core:$(dirname "$BASH_PATH")"
run_script setup
check_exit 0
assert_contains "install: ok"
assert_contains "enable: ok"
assert_contains "effect-install: skipped"
assert_contains "effect-reload: skipped"
assert_contains "the KWin-script half above still completed"
assert_contains "devenv shell --impure"
assert_file "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"
assert_grep_file "plasma-auto-tiler-kwinEnabled=true" "$CONFIG/kwinrc"
assert_not_exists "$EFFECT_STAGED_SO"

# setup: effect-install succeeds but an unsupported effect is reported as a
# failed reload, not as a pending session boundary; whole command still succeeds
reset_state
FAKE_QDBUS_SUPPORTED=false
run_script setup
check_exit 0
assert_contains "install: ok"
assert_contains "enable: ok"
assert_contains "effect-install: ok"
assert_contains "error: plasma-auto-tiler-active-border is unavailable to KWin (isEffectSupported=false)"
assert_contains "effect-reload: failed"
assert_contains "effect-reload failed for a non-boundary reason"
assert_not_contains "effect-reload: pending-boundary"
assert_not_contains "pending the expected first-run logout/login boundary"
assert_file "$EFFECT_STAGED_SO"
assert_not_grep_file "loadEffect" "$WORK/tools.log"
assert_not_grep_file "unloadEffect" "$WORK/tools.log"

# setup: effect-reload D-Bus failure is reported as failed, not pending-boundary
reset_state
touch "$WORK/state/qdbus-supported-fail"
run_script setup
check_exit 0
assert_contains "effect-install: ok"
assert_contains "effect-reload: failed"
assert_contains "effect-reload failed for a non-boundary reason"
assert_not_contains "effect-reload: pending-boundary"
assert_not_contains "pending the expected first-run logout/login boundary"

# setup: a real failure in the required install/enable half still fails the
# whole command
reset_state
touch "$WORK/state/npm-fail"
run_script setup
check_exit 1
assert_not_exists "$DATA/kwin/scripts/plasma-auto-tiler-kwin"
assert_not_exists "$DATA/kwin/scripts/plasma-auto-tiler-kwin/metadata.json"
assert_not_grep_file "cmake" "$WORK/cmake.log"
assert_not_exists "$CONFIG/kwinrc"

# static: native-effect plugin ID consistency across metadata.json,
# CMakeLists.txt's kcoreaddons_add_plugin target name, and
# dogfood-install.sh's EFFECT_PLUGIN_ID literal must all agree, and
# EFFECT_CONFIG_KEY must be derived from EFFECT_PLUGIN_ID rather than a second
# independent literal. Reads real repo files directly with grep/sed.
EXPECTED_EFFECT_PLUGIN_ID="plasma-auto-tiler-active-border"
NATIVE_EFFECT_METADATA="$KWIN_DIR/native-effect/metadata.json"
NATIVE_EFFECT_CMAKELISTS="$KWIN_DIR/native-effect/CMakeLists.txt"

metadata_id="$(grep -m1 '"Id"' "$NATIVE_EFFECT_METADATA" | sed -E 's/.*"Id"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
if [[ "$metadata_id" == "$EXPECTED_EFFECT_PLUGIN_ID" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: kwin/native-effect/metadata.json KPlugin.Id ('$metadata_id') disagrees with expected native-effect plugin ID ('$EXPECTED_EFFECT_PLUGIN_ID')" >&2
  FAIL=$((FAIL + 1))
fi

cmake_target="$(grep -m1 'kcoreaddons_add_plugin(' "$NATIVE_EFFECT_CMAKELISTS" | sed -E 's/.*kcoreaddons_add_plugin\(([^[:space:])]*).*/\1/')"
if [[ "$cmake_target" == "$EXPECTED_EFFECT_PLUGIN_ID" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: kwin/native-effect/CMakeLists.txt kcoreaddons_add_plugin target name ('$cmake_target') disagrees with expected native-effect plugin ID ('$EXPECTED_EFFECT_PLUGIN_ID')" >&2
  FAIL=$((FAIL + 1))
fi

script_plugin_id="$(grep -m1 '^EFFECT_PLUGIN_ID=' "$SCRIPT" | sed -E 's/^EFFECT_PLUGIN_ID="([^"]*)".*/\1/')"
if [[ "$script_plugin_id" == "$EXPECTED_EFFECT_PLUGIN_ID" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: scripts/dogfood-install.sh EFFECT_PLUGIN_ID ('$script_plugin_id') disagrees with expected native-effect plugin ID ('$EXPECTED_EFFECT_PLUGIN_ID')" >&2
  FAIL=$((FAIL + 1))
fi

if [[ "$metadata_id" == "$cmake_target" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: kwin/native-effect/metadata.json KPlugin.Id ('$metadata_id') disagrees with kwin/native-effect/CMakeLists.txt kcoreaddons_add_plugin target name ('$cmake_target')" >&2
  FAIL=$((FAIL + 1))
fi

if [[ "$metadata_id" == "$script_plugin_id" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: kwin/native-effect/metadata.json KPlugin.Id ('$metadata_id') disagrees with scripts/dogfood-install.sh EFFECT_PLUGIN_ID ('$script_plugin_id')" >&2
  FAIL=$((FAIL + 1))
fi

if grep -Fq 'EFFECT_CONFIG_KEY="${EFFECT_PLUGIN_ID}Enabled"' "$SCRIPT"; then
  PASS=$((PASS + 1))
else
  echo "FAIL: scripts/dogfood-install.sh does not derive EFFECT_CONFIG_KEY from EFFECT_PLUGIN_ID (expected literal: EFFECT_CONFIG_KEY=\"\${EFFECT_PLUGIN_ID}Enabled\")" >&2
  FAIL=$((FAIL + 1))
fi

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
