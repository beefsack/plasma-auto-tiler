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
if [[ -z "$REAL_NPM" ]]; then
  echo "FAIL: npm not found in PATH; the install build tests delegate to it" >&2
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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) file="${2:?}"; shift 2 ;;
    --group) group="${2:?}"; shift 2 ;;
    --key) key="${2:?}"; shift 2 ;;
    --type) shift 2 ;;
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
      printf '%s=%s\n' "$key" "$value"
      key_replaced=1
      continue
    fi
    printf '%s\n' "$line"
  done < "$file"
  if [[ "$group_found" -eq 0 ]]; then
    printf '\n[%s]\n%s=%s\n' "$group" "$key" "$value"
  elif [[ "$key_replaced" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value"
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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) file="${2:?}"; shift 2 ;;
    --group) group="${2:?}"; shift 2 ;;
    --key) key="${2:?}"; shift 2 ;;
    --type) shift 2 ;;
    *) exit 2 ;;
  esac
done
[[ -n "$file" && -n "$group" && -n "$key" ]] || exit 2
[[ -f "$file" ]] || { printf '\n'; exit 0; }
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
printf '\n'
EOF

  cat > "$FAKE_BIN/bin/qdbus" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'qdbus %s\n' "$*" >> "${FAKE_TOOL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/qdbus-fail" ]]; then
  exit 1
fi
exit 0
EOF

  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/kwriteconfig6" "$FAKE_BIN/bin/kreadconfig6" "$FAKE_BIN/bin/qdbus"

  for tool in dirname pwd rm mkdir cp cat mktemp mv; do
    ln -sf "$(command -v "$tool")" "$FAKE_BIN/core/$tool"
  done
}

# Per-test overrides; an empty TEST_*_BIN omits the variable (forces the PATH
# fallback) and TEST_PATH limits PATH to a coreutils-only dir for the
# missing-tool probes so they are independent of any host Plasma tools.
reset_state() {
  rm -rf "$WORK/state" "$WORK/data" "$WORK/config" "$WORK/home"
  mkdir -p "$WORK/state" "$WORK/home"
  : > "$WORK/npm.log"
  : > "$WORK/tools.log"
  TEST_NPM_BIN="$FAKE_BIN/bin/npm"
  TEST_KWRITECONFIG6_BIN="$FAKE_BIN/bin/kwriteconfig6"
  TEST_KREADCONFIG6_BIN="$FAKE_BIN/bin/kreadconfig6"
  TEST_QDBUS_BIN="$FAKE_BIN/bin/qdbus"
  TEST_PATH="$PATH"
}

run_script() {
  set +e
  local cmd=(env -u NPM_BIN -u KWRITECONFIG6_BIN -u KREADCONFIG6_BIN -u QDBUS_BIN -u XDG_DATA_HOME -u XDG_CONFIG_HOME \
    "DOGFOOD_DATA_ROOT=$DATA" "DOGFOOD_CONFIG_ROOT=$CONFIG" "HOME=$FAKE_HOME" "PATH=$TEST_PATH")
  [[ -z "$TEST_NPM_BIN" ]] || cmd+=("NPM_BIN=$TEST_NPM_BIN")
  [[ -z "$TEST_KWRITECONFIG6_BIN" ]] || cmd+=("KWRITECONFIG6_BIN=$TEST_KWRITECONFIG6_BIN")
  [[ -z "$TEST_KREADCONFIG6_BIN" ]] || cmd+=("KREADCONFIG6_BIN=$TEST_KREADCONFIG6_BIN")
  [[ -z "$TEST_QDBUS_BIN" ]] || cmd+=("QDBUS_BIN=$TEST_QDBUS_BIN")
  cmd+=( "FAKE_NPM_LOG=$WORK/npm.log" "FAKE_TOOL_LOG=$WORK/tools.log" "FAKE_STATE_DIR=$WORK/state" "FAKE_REAL_NPM=$REAL_NPM" )
  cmd+=( "$BASH_PATH" "$SCRIPT" "$@" )
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
  if grep -Fq "$needle" "$OUTPUT"; then
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
  if grep -Fq "$needle" "$OUTPUT"; then
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
  if grep -Fq "$needle" "$file"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: '$file' does not contain '$needle'" >&2
    cat "$file" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_grep_file() {
  local needle="$1" file="$2"
  if grep -Fq "$needle" "$file"; then
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
assert_contains "Runtime tool-path overrides"

# parsing: --help rejects extra arguments
run_script --help extra
check_exit 1
assert_contains "error: '--help' takes no arguments"

# parsing: every subcommand rejects extra arguments
for command in install uninstall enable disable status; do
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
assert_count 1 "$(find "$DATA/kwin/scripts" -mindepth 1 -maxdepth 1 | wc -l)" "entries under data root kwin/scripts"
assert_count 4 "$(find "$DATA/kwin/scripts/plasma-auto-tiler-kwin" -type f | wc -l)" "files in installed package"
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
assert_count 0 "$(find "$DATA" -type f | wc -l)" "files left under the data root after uninstall"

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

echo "passes: $PASS failures: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
