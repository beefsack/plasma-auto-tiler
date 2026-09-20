#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
FAKE_BIN="$WORK/fake-tools"
OUTPUT="$WORK/output.log"
ISOLATED_JUSTFILE="$WORK/justfile.isolated"
PASS=0
FAIL=0
EXIT=0

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

make_fake_tools() {
  mkdir -p "$FAKE_BIN/bin"
  cat > "$FAKE_BIN/bin/busctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
case "$*" in
  *"GetNameOwner s org.plasmaautotiler.Planner"*)
    if [[ -f "$state/planner-owned" ]]; then
      printf 's ":1.50"\n'
      exit 0
    elif grep -Fq "setsid " "${FAKE_CALL_LOG:?}" 2>/dev/null; then
      printf 's ":1.50"\n'
      exit 0
    else
      exit 1
    fi ;;
  *"GetConnectionUnixProcessID s :1.50"*)
    pid="$(cat "$state/owner-pid" 2>/dev/null || printf '4242')"
    printf '{"type":"u","data":[%s]}\n' "$pid" ;;
  *"GetNameOwner s org.kde.KWin"*)
    if [[ -f "$state/kwin-unowned" ]]; then
      exit 1
    fi
    printf '{"type":"s","data":[":1.99"]}\n'
    exit 0 ;;
  *"GetConnectionUnixProcessID s :1.99"*)
    pid="$(cat "$state/kwin-pid" 2>/dev/null || printf '5151')"
    printf '{"type":"u","data":[%s]}\n' "$pid" ;;
  *"isEffectSupported"*)
    printf 'isEffectSupported %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
    if [[ -f "$state/effect-supported-fail" ]]; then
      exit 1
    elif [[ -f "$state/effect-supported-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
      exit 0
    fi
    if [[ "$*" == *"plasma-auto-tiler-active-border"* ]]; then
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/effect-border-supported" 2>/dev/null || printf 'true')"
    else
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/effect-oracle-supported" 2>/dev/null || printf 'true')"
    fi ;;
  *"isEffectLoaded"*)
    printf 'isEffectLoaded %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
    if [[ -f "$state/effect-loaded-fail" ]]; then
      exit 1
    elif [[ -f "$state/effect-loaded-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
      exit 0
    fi
    if [[ "$*" == *"plasma-auto-tiler-active-border"* ]]; then
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/effect-border-loaded" 2>/dev/null || printf 'false')"
    else
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/effect-oracle-loaded" 2>/dev/null || printf 'false')"
    fi ;;
  *"unloadEffect"*)
    printf 'unloadEffect %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
    if [[ -f "$state/effect-unload-fail" ]]; then
      exit 1
    fi
    if [[ "$*" == *"plasma-auto-tiler-active-border"* ]]; then
      printf 'false\n' > "$state/effect-border-loaded"
    else
      printf 'false\n' > "$state/effect-oracle-loaded"
    fi
    printf '{"type":"b","data":[true]}\n'
    exit 0 ;;
  *"loadEffect"*)
    printf 'loadEffect %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
    if [[ -f "$state/effect-load-fail" ]]; then
      exit 1
    fi
    if [[ "$*" == *"plasma-auto-tiler-active-border"* ]]; then
      printf 'true\n' > "$state/effect-border-loaded"
    else
      printf 'true\n' > "$state/effect-oracle-loaded"
    fi
    printf '{"type":"b","data":[true]}\n'
    exit 0 ;;
  *"isScriptLoaded"*)
    if [[ -f "$state/loaded-call-fail" ]]; then
      exit 1
    elif [[ -f "$state/loaded-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
    elif [[ -f "$state/loaded" ]]; then
      printf '{"type":"b","data":[%s]}\n' "$(cat "$state/loaded")"
    else
      printf '{"type":"b","data":[false]}\n'
    fi ;;
  *"status org.plasmaautotiler.Planner"*)
    exit 0 ;;
  *)
    exit 1 ;;
esac
EOF
  cat > "$FAKE_BIN/bin/cargo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'cargo %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/cargo-fails" ]]; then
  echo "fake cargo: simulated build failure" >&2
  exit 1
fi
bin="${PLASMA_AUTO_TILER_BIN:?}"
mkdir -p "${bin%/*}"
[[ -x "$bin" ]] || { printf '#!/usr/bin/env bash\nexit 0\n' > "$bin"; chmod +x "$bin"; }
exit 0
EOF
  cat > "$FAKE_BIN/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/npm-fails" ]]; then
  echo "fake npm: simulated build failure" >&2
  exit 1
fi
kwin_dir="${PLASMA_AUTO_TILER_KWIN_DIR:-}"
prev=""
for a in "$@"; do
  if [[ "$prev" == "--prefix" ]]; then
    kwin_dir="$a"
  fi
  prev="$a"
done
if [[ -n "$kwin_dir" ]]; then
  mkdir -p "$kwin_dir/contents/code"
  [[ -f "$kwin_dir/contents/code/main.js" ]] || printf '// fake kwin bundle\n' > "$kwin_dir/contents/code/main.js"
fi
exit 0
EOF
  cat > "$FAKE_BIN/bin/cmake" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'cmake %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/cmake-fails" ]]; then
  echo "fake cmake: simulated build failure" >&2
  exit 1
fi
build_dir="${PLASMA_AUTO_TILER_NATIVE_BUILD:-}"
if [[ -z "$build_dir" ]]; then
  prev=""
  for a in "$@"; do
    if [[ "$prev" == "-B" ]]; then
      build_dir="$a"
    fi
    case "$a" in -B*) build_dir="${a#-B}" ;; esac
    if [[ "$prev" == "--build" ]]; then
      build_dir="$a"
    fi
    prev="$a"
  done
fi
if [[ -n "$build_dir" ]]; then
  mkdir -p "$build_dir/bin/kwin/effects/plugins" "$build_dir/bin/kwin/effects/configs"
  [[ -f "$build_dir/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so" ]] || printf 'fake-effect' > "$build_dir/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
  [[ -f "$build_dir/bin/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so" ]] || printf 'fake-drag' > "$build_dir/bin/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so"
  [[ -f "$build_dir/bin/kwin/effects/configs/plasma-auto-tiler-active-border_config.so" ]] || printf 'fake-kcm' > "$build_dir/bin/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
fi
exit 0
EOF
  cat > "$FAKE_BIN/bin/devenv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'devenv %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
cargo build
EOF
  cat > "$FAKE_BIN/bin/setsid" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'setsid %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
printf 'setsid-env TRACE=%s\n' "${PLASMA_AUTO_TILER_TRACE:-0}" >> "${FAKE_CALL_LOG:?}"
exit 0
EOF
  cat > "$FAKE_BIN/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'unknown\n'
exit 0
EOF
  cat > "$FAKE_BIN/bin/tail" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'tail %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
is_follower=0
for a in "$@"; do
  case "$a" in *dev-planner-stream*|*dev-kwin-stream*) is_follower=1 ;; esac
done
if [[ "$is_follower" -eq 1 ]]; then
  if [[ "${FAKE_TAIL_FOLLOW_BLOCK:-0}" == "1" ]]; then
    exec sleep 1000
  fi
  sleep 0.2
  for a in "$@"; do
    if [[ -f "$a" ]]; then cat -- "$a" 2>/dev/null || true; fi
  done
  exit 0
fi
for a in "$@"; do
  if [[ -f "$a" ]]; then
    echo "fake-planner-line"
    break
  fi
done
exit 0
EOF
  cat > "$FAKE_BIN/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'journalctl %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
echo "plasma-auto-tiler:plan:cmd=plan-1-p1 kind=admit windows=1 outcome=planned-applied"
echo "plasma-auto-tiler:route-diag:drag-pull action=dispatch"
exit 0
EOF
  chmod +x "$FAKE_BIN/bin/busctl" "$FAKE_BIN/bin/cargo" "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/cmake" "$FAKE_BIN/bin/devenv" "$FAKE_BIN/bin/setsid" "$FAKE_BIN/bin/systemctl" "$FAKE_BIN/bin/tail" "$FAKE_BIN/bin/journalctl"
  cat > "$FAKE_BIN/bin/nix" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'nix %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
state="${FAKE_STATE_DIR:?}"
if [[ "${1:-}" == "path-info" ]]; then
  target="${@: -1}"
  if [[ -f "$state/nix-path-info-fail" ]]; then
    echo "fake nix: simulated path-info failure" >&2
    exit 1
  fi
  printf '%s\n' "${FAKE_DRV:?}"
  exit 0
fi
if [[ "${1:-}" == "derivation" ]]; then
  printf '{"%s":{"outputs":{"out":{"path":"%s"},"dev":{"path":"%s"}}}}\n' "${FAKE_DRV:?}" "${FAKE_STORE_PATH:?}" "${FAKE_DEV_OUT:?}"
  exit 0
fi
if [[ "${1:-}" == "develop" ]]; then
  if [[ -f "$state/nix-develop-fail" ]]; then
    echo "fake nix: simulated develop failure" >&2
    exit 1
  fi
  shift
  shift || true
  [[ "${1:-}" == "--command" ]] || { echo "fake nix: expected --command" >&2; exit 2; }
  shift
  exec "$@"
fi
echo "fake nix: unexpected args: $*" >&2
exit 2
EOF
  chmod +x "$FAKE_BIN/bin/nix"
  # Host-matched store + provenance (real files so builder resolution is real).
  mkdir -p "$WORK/fake-store/hash-rustc/bin" "$WORK/fake-store/hash-cargo/bin" "$WORK/fake-store/hash-cmake/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/fake-store/hash-rustc/bin/rustc"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/fake-store/hash-cargo/bin/cargo"
  chmod +x "$WORK/fake-store/hash-rustc/bin/rustc" "$WORK/fake-store/hash-cargo/bin/cargo"
  cp "$FAKE_BIN/bin/cmake" "$WORK/fake-store/hash-cmake/bin/cmake"
  chmod +x "$WORK/fake-store/hash-cmake/bin/cmake"
  mkdir -p "$WORK/fake-store/hash-kwin-6.7.5/bin" "$WORK/fake-store/hash-kwin-dev-6.7.5/lib/cmake/KWin" "$WORK/fake-host"
  printf 'fake-kwin\n' > "$WORK/fake-store/hash-kwin-6.7.5/bin/kwin_wayland"
  printf '# fake KWinConfig\n' > "$WORK/fake-store/hash-kwin-dev-6.7.5/lib/cmake/KWin/KWinConfig.cmake"
  ln -sf "$WORK/fake-store/hash-kwin-6.7.5/bin/kwin_wayland" "$WORK/fake-host/kwin_wayland"
  export FAKE_DRV="$WORK/fake-store/abc123-kwin-6.7.5.drv"
  export FAKE_STORE_PATH="$WORK/fake-store/hash-kwin-6.7.5/bin/kwin_wayland"
  export FAKE_DEV_OUT="$WORK/fake-store/hash-kwin-dev-6.7.5"
  cat > "$WORK/fake-start-test.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE_DIR:?}"
calllog="${FAKE_CALL_LOG:?}"
if [[ "${1:-}" == "start" ]]; then
  printf 'start-test start TRACE=%s\n' "${PLASMA_AUTO_TILER_TRACE:-0}" >> "$calllog"
  if [[ -f "$state/block-start" ]]; then
    for _ in $(seq 1 100); do sleep 0.2; done
  fi
  if [[ -f "$state/start-fails" ]]; then
    echo "fake start-test: simulated start failure" >&2
    exit 1
  fi
  if [[ "$(cat "$state/loaded" 2>/dev/null || printf 'false')" == "true" ]]; then
    echo "error: plugin 'plasma-auto-tiler-kwin' is already loaded; refusing to load again" >&2
    exit 1
  fi
  receipt="${CONTROLLER_OWNERSHIP_FILE:?missing receipt}"
  [[ ! -e "$receipt" && ! -L "$receipt" ]] || { echo "fake start-test: receipt already exists" >&2; exit 1; }
  printf '{"script_id":7,"pid":4242,"start_identity":"101010"}\n' > "$receipt"
  printf 'true\n' > "$state/loaded"
  echo "fake started script 7"
  exit 0
fi
if [[ "${1:-}" == "stop" ]]; then
  printf 'start-test stop %s\n' "${2:-}" >> "$calllog"
  if [[ -f "$state/stop-fails" ]]; then
    echo "fake stop-test: simulated teardown failure" >&2
    exit 1
  fi
  receipt="${CONTROLLER_OWNERSHIP_FILE:?missing receipt}"
  [[ -f "$receipt" && ! -L "$receipt" ]] || { echo "fake start-test: receipt missing" >&2; exit 1; }
  sid="$(jq -r '.script_id // empty' "$receipt" 2>/dev/null || true)"
  [[ "$sid" == "${2:-}" ]] || { echo "fake start-test: receipt mismatch" >&2; exit 1; }
  if [[ "$(cat "$state/loaded" 2>/dev/null || printf 'false')" != "true" ]]; then
    echo "error: plugin 'plasma-auto-tiler-kwin' is not loaded; refusing to use stale script id ${2:-}" >&2
    exit 1
  fi
  printf 'false\n' > "$state/loaded"
  rm -f -- "$receipt"
  echo "fake stopped script ${2:-}"
  exit 0
fi
echo "fake start-test: unknown command" >&2
exit 1
EOF
  cat > "$WORK/fake-dogfood.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'dogfood %s\n' "$*" >> "${FAKE_CALL_LOG:?}"
if [[ -f "${FAKE_STATE_DIR:?}/dogfood-fails" ]]; then
  echo "fake dogfood: simulated failure" >&2
  exit 1
fi
if [[ "${1:-}" == "disable" && -f "${FAKE_STATE_DIR:?}/block-dogfood-disable" ]]; then
  for _ in $(seq 1 100); do sleep 0.2; done
fi
exit 0
EOF
  chmod +x "$WORK/fake-start-test.sh" "$WORK/fake-dogfood.sh"
}

build_isolated_justfile() {
  REPO_ROOT_SRC="$REPO_ROOT" ISOLATED_DST="$ISOLATED_JUSTFILE" python3 - <<'PYEOF'
import pathlib, os
repo = os.environ.get("REPO_ROOT_SRC", "")
dst = os.environ.get("ISOLATED_DST", "")
src = pathlib.Path(repo) / "justfile"
text = src.read_text()
text = text.replace('REPO_ROOT="{{ justfile_directory() }}"', f'REPO_ROOT="{repo}"')
text = text.replace('KWIN_DIR="$REPO_ROOT/kwin"', 'KWIN_DIR="${PLASMA_AUTO_TILER_KWIN_DIR:-$REPO_ROOT/kwin}"')
text = text.replace('SOURCE_DIR="$REPO_ROOT/kwin/native-effect"', 'SOURCE_DIR="${PLASMA_AUTO_TILER_NATIVE_SOURCE:-$REPO_ROOT/kwin/native-effect}"')
text = text.replace('BUILD_DIR="$REPO_ROOT/target/kwin-native-effect-build"', 'BUILD_DIR="${PLASMA_AUTO_TILER_NATIVE_BUILD:-$REPO_ROOT/target/kwin-native-effect-build}"')
text = text.replace('STAGE="$REPO_ROOT/target/kwin-native-effect-stage"', 'STAGE="${PLASMA_AUTO_TILER_NATIVE_STAGE:-$REPO_ROOT/target/kwin-native-effect-stage}"')
text = text.replace('TARGET_DIR="$REPO_ROOT/target"', 'TARGET_DIR="${PLASMA_AUTO_TILER_TARGET_DIR:-$REPO_ROOT/target}"')
text = text.replace('/proc', '$PROC_ROOT')
text = text.replace(
  'BIN="$REPO_ROOT/target/debug/plasma-auto-tiler"',
  'BIN="${PLASMA_AUTO_TILER_BIN:-$REPO_ROOT/target/debug/plasma-auto-tiler}"\n    PROC_ROOT="${PROC_ROOT:-/proc}"\n    START_TEST_BIN="${DEV_LOOP_START_TEST:-$REPO_ROOT/scripts/start-test.sh}"\n    DOGFOOD_BIN="${DEV_LOOP_DOGFOOD:-$REPO_ROOT/scripts/dogfood-install.sh}"',
)
text = text.replace('bash "$REPO_ROOT/scripts/start-test.sh"', 'bash "$START_TEST_BIN"')
text = text.replace('bash "$REPO_ROOT/scripts/dogfood-install.sh"', 'bash "$DOGFOOD_BIN"')
text = text.replace('/tmp/plasma-auto-tiler-planner-dev.XXXXXX.log', '$RUNTIME_DIR/plasma-auto-tiler-planner-dev.XXXXXX.log')
text = text.replace(
  'for _ in $(seq 1 50); do [[ -d "$PROC_ROOT/$RECORDED_PID" ]] || break; sleep 0.2; done',
  'for _ in $(seq 1 50); do kill -0 "$RECORDED_PID" 2>/dev/null || break; sleep 0.2; done',
)
text = text.replace(
  'if [[ -d "$PROC_ROOT/$RECORDED_PID" ]]; then',
  'if kill -0 "$RECORDED_PID" 2>/dev/null; then',
)
text = text.replace(
  'for _ in $(seq 1 50); do [[ -d "$PROC_ROOT/$OLD_PID" ]] || break; sleep 0.2; done',
  'for _ in $(seq 1 50); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 0.2; done',
)
text = text.replace(
  'if [[ -d "$PROC_ROOT/$OLD_PID" ]]; then',
  'if kill -0 "$OLD_PID" 2>/dev/null; then',
)
pathlib.Path(dst).write_text(text)
PYEOF
}

reset_state() {
  rm -rf "$WORK/state" "$WORK/proc" "$WORK/runtime" "$WORK/fakebin" "$WORK/fake-kwin" "$WORK/fake-native-source" "$WORK/fake-native-build" "$WORK/fake-native-stage" "$WORK/fake-target" "$WORK/fake-kwin-cmake"
  mkdir -p "$WORK/state" "$WORK/proc" "$WORK/runtime" "$WORK/fake-kwin/contents/code" "$WORK/fake-native-source" "$WORK/fake-native-build" "$WORK/fake-target" "$WORK/fake-kwin-cmake"
  : > "$WORK/calls.log"
  : > "$OUTPUT"
  printf 'false\n' > "$WORK/state/loaded"
  printf 'true\n' > "$WORK/state/effect-border-supported"
  printf 'true\n' > "$WORK/state/effect-oracle-supported"
  printf 'false\n' > "$WORK/state/effect-border-loaded"
  printf 'false\n' > "$WORK/state/effect-oracle-loaded"
  printf '5151\n' > "$WORK/state/kwin-pid"
  rm -f "$WORK/state/planner-owned" "$WORK/state/owner-pid" "$WORK/state/loaded-malformed" "$WORK/state/loaded-call-fail" "$WORK/state/start-fails" "$WORK/state/stop-fails" "$WORK/state/cargo-fails" "$WORK/state/npm-fails" "$WORK/state/cmake-fails"
  rm -f "$WORK/state/kwin-unowned" "$WORK/state/effect-supported-fail" "$WORK/state/effect-supported-malformed" "$WORK/state/effect-loaded-fail" "$WORK/state/effect-loaded-malformed" "$WORK/state/effect-load-fail" "$WORK/state/effect-unload-fail"
  printf '// fake kwin bundle\n' > "$WORK/fake-kwin/contents/code/main.js"
  printf 'cmake_minimum_required(VERSION 3.19)\nproject(fake)\n' > "$WORK/fake-native-source/CMakeLists.txt"
  export FAKE_STATE_DIR="$WORK/state"
  export FAKE_CALL_LOG="$WORK/calls.log"
  export PROC_ROOT="$WORK/proc"
  export PLASMA_AUTO_TILER_BIN="$WORK/fakebin/plasma-auto-tiler"
  export PLASMA_AUTO_TILER_KWIN_DIR="$WORK/fake-kwin"
  export PLASMA_AUTO_TILER_NATIVE_SOURCE="$WORK/fake-native-source"
  export PLASMA_AUTO_TILER_NATIVE_BUILD="$WORK/fake-native-build"
  export PLASMA_AUTO_TILER_NATIVE_STAGE="$WORK/fake-native-stage"
  export PLASMA_AUTO_TILER_TARGET_DIR="$WORK/fake-target"
  export PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR="$WORK/fake-kwin-cmake"
  export PLASMA_AUTO_TILER_HOST_KWIN_BIN="$WORK/fake-host/kwin_wayland"
  export PLASMA_AUTO_TILER_STORE_ROOT="$WORK/fake-store"
  export NIX_BIN="$FAKE_BIN/bin/nix"
  export RUSTC_BIN="$WORK/fake-store/hash-rustc/bin/rustc"
  export CARGO_BIN="$WORK/fake-store/hash-cargo/bin/cargo"
  export CMAKE_BIN="$WORK/fake-store/hash-cmake/bin/cmake"
  export XDG_RUNTIME_DIR="$WORK/runtime"
  export DEV_LOOP_START_TEST="$WORK/fake-start-test.sh"
  export DEV_LOOP_DOGFOOD="$WORK/fake-dogfood.sh"
  export PATH="$FAKE_BIN/bin:$PATH"
  mkdir -p "$WORK/fakebin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$PLASMA_AUTO_TILER_BIN"
  chmod +x "$PLASMA_AUTO_TILER_BIN"
  mkdir -p "$PROC_ROOT/4242"
  printf '4242 (fake-planner) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 101010\n' > "$PROC_ROOT/4242/stat"
  ln -sfn -- "$PLASMA_AUTO_TILER_BIN" "$PROC_ROOT/4242/exe"
  printf 'fake\0planner-service\0' > "$PROC_ROOT/4242/cmdline"
  printf '4242\n' > "$WORK/state/owner-pid"
  mkdir -p "$PROC_ROOT/5151"
  printf '5151 (kwin_wayland) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 777888\n' > "$PROC_ROOT/5151/stat"
}

make_planner_proc() {
  local pid="$1" start="$2" exe_target="${3:-$PLASMA_AUTO_TILER_BIN}" cmdline="${4:-planner-service}"
  mkdir -p "$PROC_ROOT/$pid"
  printf '%s (fake-planner) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$pid" "$start" > "$PROC_ROOT/$pid/stat"
  ln -sfn -- "$exe_target" "$PROC_ROOT/$pid/exe"
  printf 'fake\0%s\0' "$cmdline" > "$PROC_ROOT/$pid/cmdline"
}

set_planner_owned() {
  local pid="$1"
  touch "$WORK/state/planner-owned"
  printf '%s\n' "$pid" > "$WORK/state/owner-pid"
}

set_controller() {
  printf '%s\n' "$1" > "$WORK/state/loaded"
}

run_just() {
  set +e
  FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_BIN="$PLASMA_AUTO_TILER_BIN" PLASMA_AUTO_TILER_KWIN_DIR="$WORK/fake-kwin" PLASMA_AUTO_TILER_NATIVE_SOURCE="$WORK/fake-native-source" PLASMA_AUTO_TILER_NATIVE_BUILD="$WORK/fake-native-build" PLASMA_AUTO_TILER_NATIVE_STAGE="$WORK/fake-native-stage" PLASMA_AUTO_TILER_TARGET_DIR="$WORK/fake-target" PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR="$WORK/fake-kwin-cmake" PLASMA_AUTO_TILER_HOST_KWIN_BIN="$WORK/fake-host/kwin_wayland" PLASMA_AUTO_TILER_STORE_ROOT="$WORK/fake-store" NIX_BIN="$FAKE_BIN/bin/nix" RUSTC_BIN="$WORK/fake-store/hash-rustc/bin/rustc" CARGO_BIN="$WORK/fake-store/hash-cargo/bin/cargo" CMAKE_BIN="$WORK/fake-store/hash-cmake/bin/cmake" FAKE_DRV="$FAKE_DRV" FAKE_STORE_PATH="$FAKE_STORE_PATH" FAKE_DEV_OUT="$FAKE_DEV_OUT" XDG_RUNTIME_DIR="$WORK/runtime" DEV_LOOP_START_TEST="$WORK/fake-start-test.sh" DEV_LOOP_DOGFOOD="$WORK/fake-dogfood.sh" PATH="$FAKE_BIN/bin:$PATH" just --justfile "$ISOLATED_JUSTFILE" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

run_just_async() {
  set +e
  set -m
  FAKE_STATE_DIR="$WORK/state" FAKE_CALL_LOG="$WORK/calls.log" PROC_ROOT="$WORK/proc" PLASMA_AUTO_TILER_BIN="$PLASMA_AUTO_TILER_BIN" PLASMA_AUTO_TILER_KWIN_DIR="$WORK/fake-kwin" PLASMA_AUTO_TILER_NATIVE_SOURCE="$WORK/fake-native-source" PLASMA_AUTO_TILER_NATIVE_BUILD="$WORK/fake-native-build" PLASMA_AUTO_TILER_NATIVE_STAGE="$WORK/fake-native-stage" PLASMA_AUTO_TILER_TARGET_DIR="$WORK/fake-target" PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR="$WORK/fake-kwin-cmake" PLASMA_AUTO_TILER_HOST_KWIN_BIN="$WORK/fake-host/kwin_wayland" PLASMA_AUTO_TILER_STORE_ROOT="$WORK/fake-store" NIX_BIN="$FAKE_BIN/bin/nix" RUSTC_BIN="$WORK/fake-store/hash-rustc/bin/rustc" CARGO_BIN="$WORK/fake-store/hash-cargo/bin/cargo" CMAKE_BIN="$WORK/fake-store/hash-cmake/bin/cmake" FAKE_DRV="$FAKE_DRV" FAKE_STORE_PATH="$FAKE_STORE_PATH" FAKE_DEV_OUT="$FAKE_DEV_OUT" XDG_RUNTIME_DIR="$WORK/runtime" DEV_LOOP_START_TEST="$WORK/fake-start-test.sh" DEV_LOOP_DOGFOOD="$WORK/fake-dogfood.sh" FAKE_TAIL_FOLLOW_BLOCK="${FAKE_TAIL_FOLLOW_BLOCK:-0}" PATH="$FAKE_BIN/bin:$PATH" just --justfile "$ISOLATED_JUSTFILE" "$@" >"$OUTPUT" 2>&1 &
  JUST_ASYNC_PID=$!
  set +m
  set -e
}

run_just_real() {
  set +e
  just --justfile "$REPO_ROOT/justfile" "$@" >"$OUTPUT" 2>&1
  EXIT=$?
  set -e
}

check_exit() {
  local expected="$1" label="$2"
  if [[ "$EXIT" -ne "$expected" ]]; then
    echo "FAIL [$label]: expected exit $expected, got $EXIT" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_contains() {
  local needle="$1" label="$2"
  if grep -Fq "$needle" "$OUTPUT"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL [$label]: missing '$needle'" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local needle="$1" label="$2"
  if grep -Fq "$needle" "$OUTPUT"; then
    echo "FAIL [$label]: unexpected '$needle'" >&2
    cat "$OUTPUT" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

assert_calls_contain() {
  local needle="$1" label="$2"
  if grep -Fq "$needle" "$WORK/calls.log"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL [$label]: calls missing '$needle'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_calls_missing() {
  local needle="$1" label="$2"
  if grep -Fq "$needle" "$WORK/calls.log"; then
    echo "FAIL [$label]: calls unexpectedly contain '$needle'" >&2
    cat "$WORK/calls.log" >&2
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

make_fake_tools
build_isolated_justfile

# Real justfile: formatting/list/dry-run only, never functional with fakes.
run_just_real --fmt --check
check_exit 0 "real justfile fmt check"

run_just_real --list
check_exit 0 "real justfile list"
assert_contains "dev-on" "real justfile list dev-on"
assert_contains "dev-off" "real justfile list dev-off"
assert_contains "dev-status" "real justfile list dev-status"
assert_contains "reload" "real justfile list reload"
assert_contains "dev" "real justfile list dev"
assert_contains "build" "real justfile list build"
assert_contains "build-rust" "real justfile list build-rust"
assert_contains "build-kwin-script" "real justfile list build-kwin-script"
assert_contains "build-native-effect" "real justfile list build-native-effect"
assert_contains "dev-native-setup" "real justfile list dev-native-setup"
assert_contains "dev-native-remove" "real justfile list dev-native-remove"

run_just_real --dry-run dev-status
check_exit 0 "real justfile dry-run dev-status"

run_just_real --dry-run dev
check_exit 0 "real justfile dry-run dev"

run_just_real --dry-run dev verbose
check_exit 0 "real justfile dry-run dev verbose"

run_just_real --dry-run build
check_exit 0 "real justfile dry-run build"
assert_contains "cargo build" "real justfile dry-run build rust"
assert_contains "npm --prefix" "real justfile dry-run build kwin"
assert_contains "nix-host-kwin-build.sh" "real justfile dry-run build native builder"

run_just_real --dry-run build-rust
check_exit 0 "real justfile dry-run build-rust"
assert_contains "cargo build" "real justfile dry-run build-rust cargo"

run_just_real --dry-run build-kwin-script
check_exit 0 "real justfile dry-run build-kwin-script"
assert_contains "npm --prefix" "real justfile dry-run build-kwin-script npm"

run_just_real --dry-run build-native-effect
check_exit 0 "real justfile dry-run build-native-effect"
assert_contains "nix-host-kwin-build.sh" "real justfile dry-run build-native-effect builder"
assert_contains "resolve" "real justfile dry-run build-native-effect resolve"

# dev-on: both up reports already up and changes nothing.
reset_state
make_planner_proc 4242 111111
set_planner_owned 4242
set_controller true
run_just dev-on
check_exit 0 "dev-on both up exit"
assert_contains "already up" "dev-on both up msg"
assert_calls_missing "start-test start" "dev-on both up no start"
assert_calls_missing "setsid" "dev-on both up no launch"
assert_calls_missing "dogfood" "dev-on both up no dogfood"

# dev-on: both down follows normal bring-up.
reset_state
set_controller false
run_just dev-on
check_exit 0 "dev-on both down exit"
assert_contains "planner pid" "dev-on both down msg"
assert_calls_contain "dogfood disable" "dev-on both down disable"
assert_calls_contain "setsid" "dev-on both down launch"
assert_calls_contain "start-test start" "dev-on both down start"
[[ -f "$WORK/runtime/plasma-auto-tiler-dev/planner-pid" ]] && PASS=$((PASS + 1)) || { echo "FAIL [dev-on both down state]" >&2; FAIL=$((FAIL + 1)); }
[[ -f "$WORK/runtime/plasma-auto-tiler-dev/controller-receipt-path" ]] && PASS=$((PASS + 1)) || { echo "FAIL [dev-on both down receipt ptr]" >&2; FAIL=$((FAIL + 1)); }

# dev-on: Planner up/controller down recovers without launching/killing.
reset_state
make_planner_proc 4243 222222
set_planner_owned 4243
set_controller false
mkdir -p "$WORK/runtime/plasma-auto-tiler-dev"
STALE_DIR="$(mktemp -d "$WORK/runtime/plasma-auto-tiler-controller.XXXXXX")"
printf '{"script_id":3}\n' > "$STALE_DIR/ownership"
STALE_CONTENT="$(cat "$STALE_DIR/ownership")"
printf '%s\n' "$STALE_DIR/ownership" > "$WORK/runtime/plasma-auto-tiler-dev/controller-receipt-path"
run_just dev-on
check_exit 0 "dev-on recovery exit"
assert_contains "recover" "dev-on recovery msg"
assert_calls_contain "start-test start" "dev-on recovery start once"
assert_calls_missing "setsid" "dev-on recovery no launch"
assert_calls_missing "dogfood disable" "dev-on recovery no disable"
assert_calls_missing "dogfood enable" "dev-on recovery no re-enable"
[[ "$(cat "$STALE_DIR/ownership")" == "$STALE_CONTENT" ]] && PASS=$((PASS + 1)) || { echo "FAIL [recovery overwrote immutable receipt]" >&2; FAIL=$((FAIL + 1)); }
NEW_PTR="$(cat "$WORK/runtime/plasma-auto-tiler-dev/controller-receipt-path")"
[[ "$NEW_PTR" != "$STALE_DIR/ownership" && -f "$NEW_PTR" ]] && PASS=$((PASS + 1)) || { echo "FAIL [recovery pointer not updated to new receipt]" >&2; FAIL=$((FAIL + 1)); }
[[ "$(cat "$WORK/runtime/plasma-auto-tiler-dev/planner-pid")" == "4243" ]] && PASS=$((PASS + 1)) || { echo "FAIL [recovery planner state]" >&2; FAIL=$((FAIL + 1)); }

# dev-on: recovery failure leaves pre-existing Planner alone.
reset_state
sleep 300 &
RECOVERY_PID=$!
make_planner_proc "$RECOVERY_PID" 333333
set_planner_owned "$RECOVERY_PID"
set_controller false
touch "$WORK/state/start-fails"
run_just dev-on
check_exit 1 "dev-on recovery fail exit"
assert_contains "left running" "dev-on recovery fail msg"
assert_calls_missing "dogfood enable" "dev-on recovery fail no re-enable"
if kill -0 "$RECOVERY_PID" 2>/dev/null; then PASS=$((PASS + 1)); else echo "FAIL [recovery killed pre-existing planner]" >&2; FAIL=$((FAIL + 1)); fi
kill "$RECOVERY_PID" 2>/dev/null || true
wait "$RECOVERY_PID" 2>/dev/null || true

# dev-on: Planner down/controller up fails closed without duplicate.
reset_state
set_controller true
run_just dev-on
check_exit 1 "dev-on split down/up exit"
assert_contains "refusing to start a duplicate" "dev-on split down/up msg"
assert_calls_missing "start-test start" "dev-on split down/up no start"
assert_calls_missing "setsid" "dev-on split down/up no launch"
assert_calls_missing "dogfood disable" "dev-on split down/up no disable"

# dev-on: malformed isScriptLoaded fails closed before mutation.
reset_state
touch "$WORK/state/loaded-malformed"
run_just dev-on
check_exit 1 "dev-on malformed exit"
assert_contains "unexpected isScriptLoaded reply" "dev-on malformed msg"
assert_calls_missing "start-test start" "dev-on malformed no start"
assert_calls_missing "setsid" "dev-on malformed no launch"
assert_calls_missing "dogfood disable" "dev-on malformed no disable"

# dev-off: Planner up/controller down skips stop, stops planner.
reset_state
sleep 300 &
OFF_PID=$!
make_planner_proc "$OFF_PID" 444444
mkdir -p "$WORK/runtime/plasma-auto-tiler-dev"
printf '%s\n' "$OFF_PID" > "$WORK/runtime/plasma-auto-tiler-dev/planner-pid"
printf '%s\n' "$PLASMA_AUTO_TILER_BIN" > "$WORK/runtime/plasma-auto-tiler-dev/planner-exe"
printf '444444\n' > "$WORK/runtime/plasma-auto-tiler-dev/planner-start"
set_controller false
run_just dev-off
check_exit 0 "dev-off split up/down exit"
assert_contains "already unloaded" "dev-off split up/down skip stop"
assert_contains "stopped" "dev-off split up/down stopped"
assert_calls_missing "start-test stop" "dev-off split up/down no stop"
assert_calls_contain "dogfood enable" "dev-off split up/down enable"
if kill -0 "$OFF_PID" 2>/dev/null; then echo "FAIL [dev-off did not stop planner]" >&2; FAIL=$((FAIL + 1)); kill "$OFF_PID" 2>/dev/null || true; wait "$OFF_PID" 2>/dev/null || true; else PASS=$((PASS + 1)); fi

# dev-off: Planner down/controller up unloads controller without killing.
reset_state
set_controller true
mkdir -p "$WORK/runtime/plasma-auto-tiler-dev"
RDIR="$(mktemp -d "$WORK/runtime/plasma-auto-tiler-controller.XXXXXX")"
printf '{"script_id":7}\n' > "$RDIR/ownership"
printf '%s\n' "$RDIR/ownership" > "$WORK/runtime/plasma-auto-tiler-dev/controller-receipt-path"
run_just dev-off
check_exit 0 "dev-off split down/up exit"
assert_contains "no verified planner" "dev-off split down/up skip kill"
assert_calls_contain "start-test stop 7" "dev-off split down/up stop"
assert_calls_contain "dogfood enable" "dev-off split down/up enable"

# dev-off: never kills an unverified process.
reset_state
sleep 300 &
BAD_PID=$!
mkdir -p "$PROC_ROOT/$BAD_PID"
printf '%s (fake) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 555555\n' "$BAD_PID" > "$PROC_ROOT/$BAD_PID/stat"
ln -sfn -- "/nix/store/fake/plasma-auto-tiler" "$PROC_ROOT/$BAD_PID/exe"
printf 'x\0planner-service\0' > "$PROC_ROOT/$BAD_PID/cmdline"
mkdir -p "$WORK/runtime/plasma-auto-tiler-dev"
printf '%s\n' "$BAD_PID" > "$WORK/runtime/plasma-auto-tiler-dev/planner-pid"
printf '%s\n' "$PLASMA_AUTO_TILER_BIN" > "$WORK/runtime/plasma-auto-tiler-dev/planner-exe"
printf '555555\n' > "$WORK/runtime/plasma-auto-tiler-dev/planner-start"
set_controller false
run_just dev-off
assert_calls_missing "start-test stop" "dev-off unverified no stop"
if kill -0 "$BAD_PID" 2>/dev/null; then PASS=$((PASS + 1)); else echo "FAIL [dev-off killed unverified process]" >&2; FAIL=$((FAIL + 1)); fi
kill "$BAD_PID" 2>/dev/null || true
wait "$BAD_PID" 2>/dev/null || true

# dev-off: malformed isScriptLoaded fails closed without mutation.
reset_state
sleep 300 &
MAL_PID=$!
make_planner_proc "$MAL_PID" 666666
mkdir -p "$WORK/runtime/plasma-auto-tiler-dev"
printf '%s\n' "$MAL_PID" > "$WORK/runtime/plasma-auto-tiler-dev/planner-pid"
printf '%s\n' "$PLASMA_AUTO_TILER_BIN" > "$WORK/runtime/plasma-auto-tiler-dev/planner-exe"
printf '666666\n' > "$WORK/runtime/plasma-auto-tiler-dev/planner-start"
touch "$WORK/state/loaded-malformed"
run_just dev-off
check_exit 1 "dev-off malformed exit"
assert_contains "unexpected isScriptLoaded reply" "dev-off malformed msg"
assert_calls_missing "start-test stop" "dev-off malformed no stop"
if kill -0 "$MAL_PID" 2>/dev/null; then PASS=$((PASS + 1)); else echo "FAIL [dev-off malformed killed planner]" >&2; FAIL=$((FAIL + 1)); fi
kill "$MAL_PID" 2>/dev/null || true
wait "$MAL_PID" 2>/dev/null || true

# dev-status: SPLIT when verified planner but controller unloaded.
reset_state
make_planner_proc 4244 777777
set_planner_owned 4244
set_controller false
run_just dev-status
check_exit 0 "dev-status split exit"
assert_contains "dev mode: SPLIT" "dev-status split line"
assert_contains "controller unloaded" "dev-status split controller"
assert_not_contains "dev mode: UP" "dev-status split not up"

# dev-status: SPLIT when controller loaded but planner unowned.
reset_state
set_controller true
run_just dev-status
check_exit 0 "dev-status down/up exit"
assert_contains "dev mode: SPLIT" "dev-status down/up split"
assert_contains "controller loaded" "dev-status down/up loaded"

# dev-status: UP only when both verified and loaded; DOWN when both absent.
reset_state
make_planner_proc 4245 888888
set_planner_owned 4245
set_controller true
run_just dev-status
check_exit 0 "dev-status up exit"
assert_contains "dev mode: UP" "dev-status up line"

reset_state
set_controller false
run_just dev-status
check_exit 0 "dev-status down exit"
assert_contains "dev mode: DOWN" "dev-status down line"

# dev-status: UNKNOWN on malformed controller reply, never claims healthy owner.
reset_state
make_planner_proc 4246 999999
set_planner_owned 4246
touch "$WORK/state/loaded-malformed"
run_just dev-status
check_exit 0 "dev-status unknown exit"
assert_contains "dev mode: UNKNOWN" "dev-status unknown line"
assert_not_contains "dev mode: UP" "dev-status unknown not up"

# D5: stale (deleted) owner exe is refused by dev-on and never reported UP.
reset_state
make_planner_proc 4247 101010 "$PLASMA_AUTO_TILER_BIN (deleted)"
set_planner_owned 4247
set_controller true
run_just dev-on
check_exit 1 "dev-on stale deleted exit"
assert_contains "stale" "dev-on stale deleted msg"
assert_calls_missing "start-test start" "dev-on stale no start"
assert_calls_missing "setsid" "dev-on stale no launch"
assert_calls_missing "dogfood" "dev-on stale no dogfood"

reset_state
make_planner_proc 4248 202020 "$PLASMA_AUTO_TILER_BIN (deleted)"
set_planner_owned 4248
set_controller false
run_just dev-on
check_exit 1 "dev-on stale recovery exit"
assert_contains "stale" "dev-on stale recovery msg"
assert_calls_missing "start-test start" "dev-on stale recovery no start"
assert_calls_missing "setsid" "dev-on stale recovery no launch"

reset_state
make_planner_proc 4249 303030 "$PLASMA_AUTO_TILER_BIN (deleted)"
set_planner_owned 4249
set_controller true
run_just dev-status
check_exit 0 "dev-status stale exit"
assert_contains "dev mode: SPLIT" "dev-status stale split"
assert_not_contains "dev mode: UP" "dev-status stale not up"

# dev (foreground): refuses when UP without mutating.
reset_state
make_planner_proc 4242 111111
set_planner_owned 4242
set_controller true
run_just dev
check_exit 1 "dev up refuse exit"
assert_contains "refusing" "dev up refuse msg"
assert_contains "never adopts UP/SPLIT" "dev up refuse adoption"
assert_calls_missing "start-test start" "dev up no start"
assert_calls_missing "setsid" "dev up no launch"
assert_calls_missing "dogfood" "dev up no dogfood"
assert_calls_missing "tail " "dev up no tail"
assert_calls_missing "journalctl " "dev up no journal"
assert_calls_missing "cargo " "dev up no cargo"
assert_calls_missing "npm " "dev up no npm"
assert_calls_missing "cmake " "dev up no cmake"

# dev: refuses SPLIT planner-up/controller-down without launching.
reset_state
make_planner_proc 4243 222222
set_planner_owned 4243
set_controller false
run_just dev
check_exit 1 "dev split up/down refuse exit"
assert_contains "refusing" "dev split up/down refuse msg"
assert_calls_missing "start-test start" "dev split up/down no start"
assert_calls_missing "setsid" "dev split up/down no launch"
assert_calls_missing "dogfood" "dev split up/down no dogfood"
assert_calls_missing "tail " "dev split up/down no tail"
assert_calls_missing "cargo " "dev split up/down no cargo"
assert_calls_missing "npm " "dev split up/down no npm"
assert_calls_missing "cmake " "dev split up/down no cmake"

# dev: refuses SPLIT planner-down/controller-up without duplicate.
reset_state
set_controller true
run_just dev
check_exit 1 "dev split down/up refuse exit"
assert_contains "refusing" "dev split down/up refuse msg"
assert_calls_missing "start-test start" "dev split down/up no start"
assert_calls_missing "setsid" "dev split down/up no launch"
assert_calls_missing "dogfood" "dev split down/up no dogfood"
assert_calls_missing "cargo " "dev split down/up no cargo"
assert_calls_missing "npm " "dev split down/up no npm"
assert_calls_missing "cmake " "dev split down/up no cmake"

# dev: refuses stale (deleted) owner without mutating.
reset_state
make_planner_proc 4247 101010 "$PLASMA_AUTO_TILER_BIN (deleted)"
set_planner_owned 4247
set_controller false
run_just dev
check_exit 1 "dev stale refuse exit"
assert_contains "stale" "dev stale refuse msg"
assert_calls_missing "start-test start" "dev stale no start"
assert_calls_missing "setsid" "dev stale no launch"
assert_calls_missing "dogfood" "dev stale no dogfood"
assert_calls_missing "cargo " "dev stale no cargo"
assert_calls_missing "npm " "dev stale no npm"
assert_calls_missing "cmake " "dev stale no cmake"

# dev: malformed isScriptLoaded fails closed before mutation.
reset_state
touch "$WORK/state/loaded-malformed"
run_just dev
check_exit 1 "dev malformed exit"
assert_contains "dev mode: UNKNOWN" "dev malformed status"
assert_calls_missing "start-test start" "dev malformed no start"
assert_calls_missing "setsid" "dev malformed no launch"
assert_calls_missing "dogfood" "dev malformed no dogfood"
assert_calls_missing "cargo " "dev malformed no cargo"
assert_calls_missing "npm " "dev malformed no npm"
assert_calls_missing "cmake " "dev malformed no cmake"

# dev: bring-up failure propagates without silent success and without tailing.
reset_state
set_controller false
touch "$WORK/state/start-fails"
run_just dev
check_exit 1 "dev bring-up fail exit"
assert_contains "bring-up via dev-on failed" "dev bring-up fail msg"
assert_not_contains "[planner]" "dev bring-up fail no planner tail"
assert_not_contains "[kwin]" "dev bring-up fail no kwin tail"
assert_calls_missing "tail " "dev bring-up fail no tail call"
assert_calls_missing "journalctl " "dev bring-up fail no journal call"

# dev: early INT after owned native loads but before dev-on success unloads
# only owned effects via the minimal early trap and never calls dev-off.
# Border is preloaded (never owned); only the oracle load is owned. dev-on is
# blocked inside dogfood disable (before ROLLBACK_ARMED) so the window is
# deterministic and inner rollback cannot emit dev-off markers.
reset_state
set_controller false
printf 'true\n' > "$WORK/state/effect-border-loaded"
printf 'false\n' > "$WORK/state/effect-oracle-loaded"
touch "$WORK/state/block-dogfood-disable"
: > "$OUTPUT"
run_just_async dev
JUST_PID="$JUST_ASYNC_PID"
READY=0
for _ in $(seq 1 50); do
  if grep -Fq "loadEffect" "$WORK/calls.log" 2>/dev/null && grep -Fq "dogfood disable" "$WORK/calls.log" 2>/dev/null; then READY=1; break; fi
  if ! kill -0 "$JUST_PID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [[ "$READY" -ne 1 ]]; then
  echo "FAIL [dev early INT setup missing owned load + blocked dev-on]" >&2
  cat "$OUTPUT" >&2
  cat "$WORK/calls.log" >&2
  FAIL=$((FAIL + 1))
  kill "$JUST_PID" 2>/dev/null || true
  kill -KILL "$JUST_PID" 2>/dev/null || true
  kill -KILL -- "-$JUST_PID" 2>/dev/null || true
  set +e; wait "$JUST_PID" 2>/dev/null; set -e
  EXIT=1
else
  kill -INT "$JUST_PID" 2>/dev/null || true
  kill -INT -- "-$JUST_PID" 2>/dev/null || true
  set +e
  N=0
  while kill -0 "$JUST_PID" 2>/dev/null; do
    N=$((N + 1))
    if [[ "$N" -gt 50 ]]; then kill -KILL "$JUST_PID" 2>/dev/null || true; kill -KILL -- "-$JUST_PID" 2>/dev/null || true; break; fi
    sleep 0.2
  done
  wait "$JUST_PID" 2>/dev/null
  EXIT=$?
  set -e
  check_exit 130 "dev early INT exit"
  assert_calls_contain "loadEffect" "dev early INT owned load happened"
  if grep -Eq "unloadEffect.*drag-oracle" "$WORK/calls.log"; then PASS=$((PASS + 1)); else echo "FAIL [dev early INT owned oracle unloaded]" >&2; cat "$WORK/calls.log" >&2; FAIL=$((FAIL + 1)); fi
  if grep -Eq "unloadEffect.*active-border" "$WORK/calls.log"; then echo "FAIL [dev early INT preloaded border never unloaded]" >&2; cat "$WORK/calls.log" >&2; FAIL=$((FAIL + 1)); else PASS=$((PASS + 1)); fi
  assert_calls_missing "start-test stop" "dev early INT never dev-off stop"
  assert_calls_missing "dogfood enable" "dev early INT never dev-off enable"
  assert_not_contains "bring-up via dev-on failed" "dev early INT trap path not failure branch"
  assert_calls_missing "tail " "dev early INT no tail"
  assert_calls_missing "journalctl " "dev early INT no journal"
fi
kill -KILL -- "-$JUST_PID" 2>/dev/null || true
rm -f "$WORK/state/block-dogfood-disable" "$WORK/state/block-start"

# dev: DOWN bring-up tails labeled logs then tears down via dev-off.
reset_state
set_controller false
sleep 300 &
DEV_CYCLE_PID=$!
make_planner_proc "$DEV_CYCLE_PID" 777000
printf '%s\n' "$DEV_CYCLE_PID" > "$WORK/state/owner-pid"
run_just dev
DEV_CYCLE_EXIT="$EXIT"
kill "$DEV_CYCLE_PID" 2>/dev/null || true
wait "$DEV_CYCLE_PID" 2>/dev/null || true
EXIT="$DEV_CYCLE_EXIT"
check_exit 0 "dev down cycle exit"
assert_contains "[planner]" "dev down planner label"
assert_contains "[kwin]" "dev down kwin label"
assert_contains "plasma-auto-tiler:plan" "dev down kwin plugin line"
assert_contains "[kwin] plasma-auto-tiler:route-diag:drag-pull action=dispatch" "dev down kwin route diagnostic line"
assert_contains "warning: native effects staged under target/kwin-native-effect-stage are not live in this already-running KWin until logout/login delivers them; transient loadEffect below never hot-reloads a rebuilt binary. plasma-auto-tiler-active-border.so and plasma-auto-tiler-drag-oracle.so remain stale until logout/login." "dev down native warning"
assert_calls_contain "cargo " "dev down cargo build"
assert_calls_contain "npm " "dev down npm build"
assert_calls_contain "cmake " "dev down cmake build"
assert_calls_contain "dogfood disable" "dev down disable"
assert_calls_contain "setsid" "dev down launch"
assert_calls_contain "start-test start" "dev down start"
assert_calls_contain "tail " "dev down tail"
assert_calls_contain "journalctl " "dev down journal"
assert_calls_contain "start-test stop 7" "dev down teardown stop"
assert_calls_contain "dogfood enable" "dev down teardown enable"
assert_calls_contain "loadEffect" "dev down native load"
assert_calls_contain "unloadEffect" "dev down native unload"
assert_contains "transient" "dev down native transient"
assert_contains "never hot-reloads a rebuilt binary" "dev down no hot reload promise"
assert_contains "does not prove the library is unmapped" "dev down no unmapped claim"
assert_contains "combined log:" "dev down combined log printed"
# Build steps must precede any dev-on lifecycle mutation.
CARGO_LINE="$(grep -n -F "cargo " "$WORK/calls.log" | head -n 1 | cut -d: -f1)"
NPM_LINE="$(grep -n -F "npm " "$WORK/calls.log" | head -n 1 | cut -d: -f1)"
CMAKE_LINE="$(grep -n -F "cmake " "$WORK/calls.log" | head -n 1 | cut -d: -f1)"
DOGFOOD_LINE="$(grep -n -F "dogfood disable" "$WORK/calls.log" | head -n 1 | cut -d: -f1)"
SETSID_LINE="$(grep -n -F "setsid " "$WORK/calls.log" | head -n 1 | cut -d: -f1)"
START_LINE="$(grep -n -F "start-test start" "$WORK/calls.log" | head -n 1 | cut -d: -f1)"
if [[ -n "$CARGO_LINE" && -n "$NPM_LINE" && -n "$CMAKE_LINE" && -n "$DOGFOOD_LINE" && -n "$SETSID_LINE" && -n "$START_LINE" && "$CARGO_LINE" -lt "$DOGFOOD_LINE" && "$NPM_LINE" -lt "$DOGFOOD_LINE" && "$CMAKE_LINE" -lt "$DOGFOOD_LINE" && "$CARGO_LINE" -lt "$SETSID_LINE" && "$NPM_LINE" -lt "$SETSID_LINE" && "$CMAKE_LINE" -lt "$SETSID_LINE" && "$CARGO_LINE" -lt "$START_LINE" && "$NPM_LINE" -lt "$START_LINE" && "$CMAKE_LINE" -lt "$START_LINE" ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev down build before lifecycle]" >&2; cat "$WORK/calls.log" >&2; FAIL=$((FAIL + 1)); fi
DEV_LOG_PATH="$(grep -F "combined log:" "$OUTPUT" | head -n 1 | sed 's/.*combined log: //;s/[[:space:]]*$//')"
if [[ -n "${DEV_LOG_PATH:-}" && -f "$DEV_LOG_PATH" ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev down durable log retained]" >&2; FAIL=$((FAIL + 1)); fi
if [[ -n "${DEV_LOG_PATH:-}" ]] && grep -Fq "[planner]" "$DEV_LOG_PATH" && grep -Fq "[kwin]" "$DEV_LOG_PATH"; then PASS=$((PASS + 1)); else echo "FAIL [dev down durable log labeled content]" >&2; FAIL=$((FAIL + 1)); fi
if [[ "$(grep -c -F "combined log:" "$OUTPUT" || true)" -ge 2 ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev down combined log teardown reprint]" >&2; FAIL=$((FAIL + 1)); fi
if [[ ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-log" && ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-stream" && ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-planner-stream" && ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-kwin-stream" ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev down stream state removed]" >&2; FAIL=$((FAIL + 1)); fi

# Isolated justfile: list and dry-run include all four builds.
reset_state
run_just --list
check_exit 0 "isolated list exit"
assert_contains "build" "isolated list build"
assert_contains "build-rust" "isolated list build-rust"
assert_contains "build-kwin-script" "isolated list build-kwin-script"
assert_contains "build-native-effect" "isolated list build-native-effect"

run_just --dry-run build
check_exit 0 "isolated dry-run build exit"
assert_contains "cargo build" "isolated dry-run build rust"
assert_contains "npm --prefix" "isolated dry-run build kwin"
assert_contains "nix-host-kwin-build.sh" "isolated dry-run build native builder"

run_just --dry-run build-rust
check_exit 0 "isolated dry-run build-rust"
run_just --dry-run build-kwin-script
check_exit 0 "isolated dry-run build-kwin-script"
run_just --dry-run build-native-effect
check_exit 0 "isolated dry-run build-native-effect"

# Isolated build aggregate stages all three native artifacts without live calls.
reset_state
run_just build
check_exit 0 "isolated build exit"
assert_calls_contain "cargo " "isolated build cargo"
assert_calls_contain "npm " "isolated build npm"
assert_calls_contain "cmake " "isolated build cmake"
if [[ -f "$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-active-border.so" && -f "$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so" && -f "$WORK/fake-native-stage/kwin/effects/configs/plasma-auto-tiler-active-border_config.so" ]]; then PASS=$((PASS + 1)); else echo "FAIL [isolated build 3 staged artifacts]" >&2; FAIL=$((FAIL + 1)); fi
assert_calls_missing "dogfood" "isolated build no dogfood"
assert_calls_missing "start-test" "isolated build no start-test"
assert_calls_missing "setsid" "isolated build no setsid"
assert_calls_missing "busctl " "isolated build no busctl"

# Native build alone stages all three artifacts, static only.
reset_state
run_just build-native-effect
check_exit 0 "native build exit"
assert_contains "plasma-auto-tiler-active-border.so" "native build effect msg"
assert_contains "plasma-auto-tiler-drag-oracle.so" "native build drag msg"
assert_contains "plasma-auto-tiler-active-border_config.so" "native build kcm msg"
if [[ -f "$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-active-border.so" ]]; then PASS=$((PASS + 1)); else echo "FAIL [native staged effect]" >&2; FAIL=$((FAIL + 1)); fi
if [[ -f "$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so" ]]; then PASS=$((PASS + 1)); else echo "FAIL [native staged drag]" >&2; FAIL=$((FAIL + 1)); fi
if [[ -f "$WORK/fake-native-stage/kwin/effects/configs/plasma-auto-tiler-active-border_config.so" ]]; then PASS=$((PASS + 1)); else echo "FAIL [native staged kcm]" >&2; FAIL=$((FAIL + 1)); fi
assert_calls_contain "cmake " "native build cmake"
assert_calls_missing "dogfood" "native build no dogfood"
assert_calls_missing "start-test" "native build no start-test"
assert_calls_missing "setsid" "native build no setsid"
assert_calls_missing "busctl " "native build no busctl"
assert_calls_missing "journalctl " "native build no journal"
assert_calls_missing "tail " "native build no tail"

# Native staging replacement publishes a new inode via payload rm/mv and never
# truncates the previously staged file: an already-open descriptor keeps the
# old bytes (Linux unlink semantics) while the path exposes the new build.
reset_state
run_just build-native-effect
check_exit 0 "native restage first exit"
STAGE_BORDER="$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
if [[ -f "$STAGE_BORDER" ]]; then PASS=$((PASS + 1)); else echo "FAIL [restage first staged]" >&2; FAIL=$((FAIL + 1)); fi
OLD_INODE="$(stat -c %i "$STAGE_BORDER")"
OLD_CONTENT="$(cat "$STAGE_BORDER")"
exec 9< "$STAGE_BORDER" || { echo "FAIL [restage open old fd]" >&2; FAIL=$((FAIL + 1)); }
printf 'fake-effect-v2' > "$WORK/fake-native-build/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
run_just build-native-effect
RESTAGE_EXIT="$EXIT"
check_exit 0 "native restage second exit"
EXIT="$RESTAGE_EXIT"
NEW_INODE="$(stat -c %i "$STAGE_BORDER")"
NEW_CONTENT="$(cat "$STAGE_BORDER")"
FD_CONTENT="$(cat <&9)"
exec 9<&- || true
if [[ "$OLD_INODE" != "$NEW_INODE" ]]; then PASS=$((PASS + 1)); else echo "FAIL [restage new inode old=$OLD_INODE new=$NEW_INODE]" >&2; FAIL=$((FAIL + 1)); fi
if [[ "$NEW_CONTENT" == "fake-effect-v2" ]]; then PASS=$((PASS + 1)); else echo "FAIL [restage new content got '$NEW_CONTENT']" >&2; FAIL=$((FAIL + 1)); fi
if [[ "$FD_CONTENT" == "$OLD_CONTENT" ]]; then PASS=$((PASS + 1)); else echo "FAIL [restage open fd preserved old='$OLD_CONTENT' fd='$FD_CONTENT' new='$NEW_CONTENT']" >&2; FAIL=$((FAIL + 1)); fi
if [[ "$FD_CONTENT" != "$NEW_CONTENT" ]]; then PASS=$((PASS + 1)); else echo "FAIL [restage open fd isolated from replacement]" >&2; FAIL=$((FAIL + 1)); fi

# dev-native-setup reuses the same build-native-effect staging root: with an
# isolated config it stages all three artifacts and writes the env script.
reset_state
export XDG_CONFIG_HOME="$WORK/fake-config"
mkdir -p "$XDG_CONFIG_HOME"
run_just dev-native-setup
SETUP_EXIT="$EXIT"
EXIT="$SETUP_EXIT"
check_exit 0 "dev-native-setup exit"
assert_calls_contain "cmake " "dev-native-setup runs native build"
if [[ -f "$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-active-border.so" && -f "$WORK/fake-native-stage/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so" && -f "$WORK/fake-native-stage/kwin/effects/configs/plasma-auto-tiler-active-border_config.so" ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev-native-setup 3 staged artifacts]" >&2; FAIL=$((FAIL + 1)); fi
SETUP_ENV="$XDG_CONFIG_HOME/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh"
if [[ -f "$SETUP_ENV" ]] && grep -Fq "$WORK/fake-native-stage" "$SETUP_ENV"; then PASS=$((PASS + 1)); else echo "FAIL [dev-native-setup env script]" >&2; cat "$OUTPUT" >&2; FAIL=$((FAIL + 1)); fi
assert_calls_missing "dogfood" "dev-native-setup no dogfood"
assert_calls_missing "start-test" "dev-native-setup no start-test"
assert_calls_missing "setsid" "dev-native-setup no setsid"
unset XDG_CONFIG_HOME

# dev DOWN with Rust build failure exits before dev-on lifecycle.
reset_state
set_controller false
touch "$WORK/state/cargo-fails"
run_just dev
check_exit 1 "dev rust fail exit"
assert_contains "build failed" "dev rust fail msg"
assert_not_contains "warning: native effects staged under target/kwin-native-effect-stage are not live in this already-running KWin until logout/login delivers them; transient loadEffect below never hot-reloads a rebuilt binary. plasma-auto-tiler-active-border.so and plasma-auto-tiler-drag-oracle.so remain stale until logout/login." "dev rust fail no warning"
assert_calls_contain "cargo " "dev rust fail cargo attempted"
assert_calls_missing "dogfood disable" "dev rust fail no disable"
assert_calls_missing "setsid" "dev rust fail no launch"
assert_calls_missing "start-test start" "dev rust fail no start"
assert_calls_missing "loadEffect" "dev rust fail no native load"
assert_calls_missing "unloadEffect" "dev rust fail no native unload"
assert_calls_missing "tail " "dev rust fail no tail"
assert_calls_missing "journalctl " "dev rust fail no journal"

# dev DOWN with TS build failure exits before dev-on lifecycle.
reset_state
set_controller false
touch "$WORK/state/npm-fails"
run_just dev
check_exit 1 "dev ts fail exit"
assert_contains "build failed" "dev ts fail msg"
assert_not_contains "warning: native effects staged under target/kwin-native-effect-stage are not live in this already-running KWin until logout/login delivers them; transient loadEffect below never hot-reloads a rebuilt binary. plasma-auto-tiler-active-border.so and plasma-auto-tiler-drag-oracle.so remain stale until logout/login." "dev ts fail no warning"
assert_calls_contain "npm " "dev ts fail npm attempted"
assert_calls_missing "dogfood disable" "dev ts fail no disable"
assert_calls_missing "setsid" "dev ts fail no launch"
assert_calls_missing "start-test start" "dev ts fail no start"
assert_calls_missing "loadEffect" "dev ts fail no native load"
assert_calls_missing "unloadEffect" "dev ts fail no native unload"
assert_calls_missing "tail " "dev ts fail no tail"
assert_calls_missing "journalctl " "dev ts fail no journal"

# dev DOWN with native build failure exits before dev-on lifecycle.
reset_state
set_controller false
touch "$WORK/state/cmake-fails"
run_just dev
check_exit 1 "dev native fail exit"
assert_contains "build failed" "dev native fail msg"
assert_not_contains "warning: native effects staged under target/kwin-native-effect-stage are not live in this already-running KWin until logout/login delivers them; transient loadEffect below never hot-reloads a rebuilt binary. plasma-auto-tiler-active-border.so and plasma-auto-tiler-drag-oracle.so remain stale until logout/login." "dev native fail no warning"
assert_calls_contain "cmake " "dev native fail cmake attempted"
assert_calls_missing "dogfood disable" "dev native fail no disable"
assert_calls_missing "setsid" "dev native fail no launch"
assert_calls_missing "start-test start" "dev native fail no start"
assert_calls_missing "loadEffect" "dev native fail no native load"
assert_calls_missing "unloadEffect" "dev native fail no native unload"
assert_calls_missing "tail " "dev native fail no tail"
assert_calls_missing "journalctl " "dev native fail no journal"

# dev: Ctrl-C during streaming tears down via dev-off with exit 0.
reset_state
set_controller false
sleep 300 &
DEV_INT_PID=$!
make_planner_proc "$DEV_INT_PID" 777002
printf '%s\n' "$DEV_INT_PID" > "$WORK/state/owner-pid"
export FAKE_TAIL_FOLLOW_BLOCK=1
: > "$OUTPUT"
run_just_async dev
JUST_PID="$JUST_ASYNC_PID"
READY=0
for _ in $(seq 1 50); do
  if grep -Fq "combined log:" "$OUTPUT" 2>/dev/null; then READY=1; break; fi
  if ! kill -0 "$JUST_PID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [[ "$READY" -ne 1 ]]; then
  echo "FAIL [dev SIGINT setup missing combined log]" >&2
  cat "$OUTPUT" >&2
  FAIL=$((FAIL + 1))
  kill "$JUST_PID" 2>/dev/null || true
  kill -KILL "$JUST_PID" 2>/dev/null || true
  set +e; wait "$JUST_PID" 2>/dev/null; set -e
  EXIT=1
else
  kill -INT "$JUST_PID" 2>/dev/null || true
  kill -INT -- "-$JUST_PID" 2>/dev/null || true
  set +e
  N=0
  while kill -0 "$JUST_PID" 2>/dev/null; do
    N=$((N + 1))
    if [[ "$N" -gt 50 ]]; then kill -KILL "$JUST_PID" 2>/dev/null || true; break; fi
    sleep 0.2
  done
  wait "$JUST_PID" 2>/dev/null
  EXIT=$?
  set -e
  check_exit 0 "dev SIGINT exit"
  assert_calls_contain "start-test stop 7" "dev SIGINT teardown stop"
  assert_calls_contain "dogfood enable" "dev SIGINT teardown enable"
  assert_calls_contain "unloadEffect" "dev SIGINT teardown native unload"
  if [[ ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-log" && ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-stream" && ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-planner-stream" && ! -e "$WORK/runtime/plasma-auto-tiler-dev/dev-kwin-stream" ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev SIGINT stream state removed]" >&2; FAIL=$((FAIL + 1)); fi
fi
unset FAKE_TAIL_FOLLOW_BLOCK
kill "$DEV_INT_PID" 2>/dev/null || true
wait "$DEV_INT_PID" 2>/dev/null || true

# dev: Ctrl-C plus dev-off failure stays nonzero and skips re-enable.
reset_state
set_controller false
touch "$WORK/state/stop-fails"
sleep 300 &
DEV_INT_FAIL_PID=$!
make_planner_proc "$DEV_INT_FAIL_PID" 777003
printf '%s\n' "$DEV_INT_FAIL_PID" > "$WORK/state/owner-pid"
export FAKE_TAIL_FOLLOW_BLOCK=1
: > "$OUTPUT"
run_just_async dev
JUST_PID="$JUST_ASYNC_PID"
READY=0
for _ in $(seq 1 50); do
  if grep -Fq "combined log:" "$OUTPUT" 2>/dev/null; then READY=1; break; fi
  if ! kill -0 "$JUST_PID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [[ "$READY" -ne 1 ]]; then
  echo "FAIL [dev SIGINT fail setup missing combined log]" >&2
  cat "$OUTPUT" >&2
  FAIL=$((FAIL + 1))
  kill "$JUST_PID" 2>/dev/null || true
  kill -KILL "$JUST_PID" 2>/dev/null || true
  set +e; wait "$JUST_PID" 2>/dev/null; set -e
  EXIT=1
else
  kill -INT "$JUST_PID" 2>/dev/null || true
  kill -INT -- "-$JUST_PID" 2>/dev/null || true
  set +e
  N=0
  while kill -0 "$JUST_PID" 2>/dev/null; do
    N=$((N + 1))
    if [[ "$N" -gt 50 ]]; then kill -KILL "$JUST_PID" 2>/dev/null || true; break; fi
    sleep 0.2
  done
  wait "$JUST_PID" 2>/dev/null
  EXIT=$?
  set -e
  check_exit 1 "dev SIGINT teardown-fail exit"
  assert_calls_contain "start-test stop 7" "dev SIGINT teardown-fail stop"
  assert_calls_missing "dogfood enable" "dev SIGINT teardown-fail no enable"
  assert_calls_contain "unloadEffect" "dev SIGINT teardown-fail native unload attempted"
fi
unset FAKE_TAIL_FOLLOW_BLOCK
kill "$DEV_INT_FAIL_PID" 2>/dev/null || true
wait "$DEV_INT_FAIL_PID" 2>/dev/null || true

# dev: an unverifiable teardown stops after the exact receipt-bound attempt.
reset_state
set_controller false
touch "$WORK/state/stop-fails"
sleep 300 &
DEV_TEARDOWN_PID=$!
make_planner_proc "$DEV_TEARDOWN_PID" 888000
printf '%s\n' "$DEV_TEARDOWN_PID" > "$WORK/state/owner-pid"
run_just dev
DEV_TEARDOWN_EXIT="$EXIT"
kill "$DEV_TEARDOWN_PID" 2>/dev/null || true
wait "$DEV_TEARDOWN_PID" 2>/dev/null || true
EXIT="$DEV_TEARDOWN_EXIT"
check_exit 1 "dev teardown failure exit"
assert_contains "teardown is unverified" "dev teardown failure explicit"
assert_contains "logout/login" "dev teardown failure recovery"
assert_calls_contain "start-test stop 7" "dev teardown exact stop once"
assert_calls_missing "dogfood enable" "dev teardown failure no further teardown"

# dev modes: unknown mode refuses before mutation.
reset_state
set_controller false
run_just dev bogus
check_exit 1 "dev bogus mode exit"
assert_contains "unknown mode" "dev bogus mode msg"
assert_calls_missing "start-test start" "dev bogus no start"
assert_calls_missing "setsid " "dev bogus no launch"
assert_calls_missing "dogfood" "dev bogus no dogfood"
assert_calls_missing "cargo " "dev bogus no cargo"
assert_calls_missing "npm " "dev bogus no npm"
assert_calls_missing "cmake " "dev bogus no cmake"

# dev trace: DOWN bring-up exports exactly 1 to the Planner and KWin builds.
reset_state
set_controller false
unset PLASMA_AUTO_TILER_TRACE 2>/dev/null || true
sleep 300 &
DEV_VERBOSE_PID=$!
make_planner_proc "$DEV_VERBOSE_PID" 999001
printf '%s\n' "$DEV_VERBOSE_PID" > "$WORK/state/owner-pid"
run_just dev trace
DEV_VERBOSE_EXIT="$EXIT"
kill "$DEV_VERBOSE_PID" 2>/dev/null || true
wait "$DEV_VERBOSE_PID" 2>/dev/null || true
EXIT="$DEV_VERBOSE_EXIT"
check_exit 0 "dev trace cycle exit"
assert_calls_contain "setsid-env TRACE=1" "dev trace exports planner opt-in"
assert_calls_contain "start-test start TRACE=1" "dev trace exports KWin opt-in"
assert_calls_contain "start-test stop 7" "dev trace teardown stop"
unset PLASMA_AUTO_TILER_TRACE 2>/dev/null || true

# dev verbose: explicit troubleshooting mode stays bounded and non-trace.
reset_state
set_controller false
unset PLASMA_AUTO_TILER_TRACE 2>/dev/null || true
sleep 300 &
DEV_VERBOSE_PID=$!
make_planner_proc "$DEV_VERBOSE_PID" 999003
printf '%s\n' "$DEV_VERBOSE_PID" > "$WORK/state/owner-pid"
run_just dev verbose
DEV_VERBOSE_EXIT="$EXIT"
kill "$DEV_VERBOSE_PID" 2>/dev/null || true
wait "$DEV_VERBOSE_PID" 2>/dev/null || true
EXIT="$DEV_VERBOSE_EXIT"
check_exit 0 "dev verbose cycle exit"
assert_calls_contain "setsid-env TRACE=0" "dev verbose stays non-trace"
assert_calls_contain "start-test start TRACE=0" "dev verbose keeps ordinary KWin build"
assert_calls_contain "start-test stop 7" "dev verbose teardown stop"

# dev default: no mode arg leaves trace disabled.
reset_state
set_controller false
unset PLASMA_AUTO_TILER_TRACE 2>/dev/null || true
sleep 300 &
DEV_QUIET_PID=$!
make_planner_proc "$DEV_QUIET_PID" 999004
printf '%s\n' "$DEV_QUIET_PID" > "$WORK/state/owner-pid"
run_just dev
DEV_QUIET_EXIT="$EXIT"
kill "$DEV_QUIET_PID" 2>/dev/null || true
wait "$DEV_QUIET_PID" 2>/dev/null || true
EXIT="$DEV_QUIET_EXIT"
check_exit 0 "dev default cycle exit"
assert_calls_contain "setsid-env TRACE=0" "dev default stays non-trace"
assert_calls_contain "start-test stop 7" "dev default teardown stop"
unset PLASMA_AUTO_TILER_TRACE 2>/dev/null || true

# dev env passthrough: exported 1 without the arg still reaches both builds.
reset_state
set_controller false
export PLASMA_AUTO_TILER_TRACE=1
sleep 300 &
DEV_PASS_PID=$!
make_planner_proc "$DEV_PASS_PID" 999005
printf '%s\n' "$DEV_PASS_PID" > "$WORK/state/owner-pid"
run_just dev
DEV_PASS_EXIT="$EXIT"
kill "$DEV_PASS_PID" 2>/dev/null || true
wait "$DEV_PASS_PID" 2>/dev/null || true
EXIT="$DEV_PASS_EXIT"
check_exit 0 "dev passthrough cycle exit"
assert_calls_contain "setsid-env TRACE=1" "dev passthrough exports opt-in"
assert_calls_contain "start-test start TRACE=1" "dev passthrough exports KWin opt-in"
assert_calls_contain "start-test stop 7" "dev passthrough teardown stop"
unset PLASMA_AUTO_TILER_TRACE 2>/dev/null || true

# start-test.sh: unloadScript=false verifies only with strict post false + receipt identity.
START_STATE="$WORK/start-false-state"
START_PROC="$WORK/start-false-proc"
START_FAKE="$WORK/start-false-fake"
START_CALLS="$WORK/start-false-calls.log"
rm -rf "$START_STATE" "$START_PROC" "$START_FAKE"
mkdir -p "$START_STATE" "$START_PROC" "$START_FAKE/bin"
: > "$START_CALLS"
START_KWIN_PID=5151
START_KWIN_START=777888
printf '%s\n' "$START_KWIN_PID" > "$START_STATE/kwin-pid"
mkdir -p "$START_PROC/$START_KWIN_PID"
printf '%s (kwin_wayland) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 %s\n' "$START_KWIN_PID" "$START_KWIN_START" > "$START_PROC/$START_KWIN_PID/stat"
cat > "$START_FAKE/bin/busctl" <<'FAKEEOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_START_STATE:?}"
calls="${FAKE_START_CALLS:?}"
case "$*" in
  *"GetNameOwner s org.kde.KWin"*)
    printf '{"type":"s","data":[":1.99"]}\n' ;;
  *"GetConnectionUnixProcessID s :1.99"*)
    pid="$(cat "$state/kwin-pid")"
    printf '{"type":"u","data":[%s]}\n' "$pid" ;;
  *"isScriptLoaded"*)
    printf 'isScriptLoaded\n' >> "$calls"
    if [[ ! -f "$state/post-unload" ]]; then
      printf '{"type":"b","data":[true]}\n'
    elif [[ -f "$state/post-malformed" ]]; then
      printf '{"type":"b","data":[true,false]}\n'
    elif [[ -f "$state/post-fail" ]]; then
      exit 1
    else
      printf '{"type":"b","data":[false]}\n'
    fi ;;
  *"introspect org.kde.KWin /Scripting/Script"*)
    printf 'introspect\n' >> "$calls"
    printf '[{"type":"interface","name":"org.kde.kwin.Script"}]\n' ;;
  *"org.kde.kwin.Script stop"*)
    printf 'stop\n' >> "$calls"
    touch "$state/post-unload"
    exit 0 ;;
  *"unloadScript s plasma-auto-tiler-kwin"*)
    printf 'unloadScript\n' >> "$calls"
    printf '{"type":"b","data":[false]}\n' ;;
  *"allComponents"*)
    printf '{"type":"ao","data":[[]]}\n' ;;
  *)
    echo "fake busctl: unhandled: $*" >&2
    exit 1 ;;
esac
FAKEEOF
chmod +x "$START_FAKE/bin/busctl"
START_RDIR="$WORK/start-false-receipt"
rm -rf "$START_RDIR"
mkdir -p "$START_RDIR"
START_BUILD="controller-v1-$(printf 'a%.0s' $(seq 1 64))"
START_RECEIPT="$START_RDIR/ownership"
jq -cn --arg nonce "testnonce-12345678" --arg build "$START_BUILD" --arg plugin "plasma-auto-tiler-kwin" --argjson sid 9 --argjson pid "$START_KWIN_PID" --arg start "$START_KWIN_START" '{kind:"controller",nonce:$nonce,build:$build,plugin:$plugin,script_id:$sid,pid:$pid,start_identity:$start}' > "$START_RECEIPT"
set +e
FAKE_START_STATE="$START_STATE" FAKE_START_CALLS="$START_CALLS" PROC_ROOT="$START_PROC" CONTROLLER_OWNERSHIP_FILE="$START_RECEIPT" PATH="$START_FAKE/bin:$PATH" bash "$REPO_ROOT/scripts/start-test.sh" stop 9 >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 0 "start-test false-verified exit"
assert_contains "unloaded" "start-test false-verified msg"
if [[ ! -e "$START_RECEIPT" ]]; then PASS=$((PASS + 1)); else echo "FAIL [start-test false-verified receipt not removed]" >&2; cat "$OUTPUT" >&2; FAIL=$((FAIL + 1)); fi
START_UNLOAD_COUNT="$(grep -c '^unloadScript$' "$START_CALLS" || true)"
if [[ "$START_UNLOAD_COUNT" -eq 1 ]]; then PASS=$((PASS + 1)); else echo "FAIL [start-test false-verified single unload, got $START_UNLOAD_COUNT]" >&2; cat "$START_CALLS" >&2; FAIL=$((FAIL + 1)); fi
if grep -Fq "isScriptLoaded" "$START_CALLS"; then PASS=$((PASS + 1)); else echo "FAIL [start-test false-verified postcondition checked]" >&2; FAIL=$((FAIL + 1)); fi
# Failed/malformed postcondition must remain unverified: same setup but malformed post.
rm -f "$START_STATE/post-unload"
touch "$START_STATE/post-malformed"
jq -cn --arg nonce "testnonce-12345678" --arg build "$START_BUILD" --arg plugin "plasma-auto-tiler-kwin" --argjson sid 9 --argjson pid "$START_KWIN_PID" --arg start "$START_KWIN_START" '{kind:"controller",nonce:$nonce,build:$build,plugin:$plugin,script_id:$sid,pid:$pid,start_identity:$start}' > "$START_RECEIPT"
: > "$START_CALLS"
set +e
FAKE_START_STATE="$START_STATE" FAKE_START_CALLS="$START_CALLS" PROC_ROOT="$START_PROC" CONTROLLER_OWNERSHIP_FILE="$START_RECEIPT" PATH="$START_FAKE/bin:$PATH" bash "$REPO_ROOT/scripts/start-test.sh" stop 9 >"$OUTPUT" 2>&1
EXIT=$?
set -e
check_exit 1 "start-test false-malformed-post exit"
assert_contains "remains unverified" "start-test false-malformed-post unverified"
if [[ -f "$START_RECEIPT" ]]; then PASS=$((PASS + 1)); else echo "FAIL [start-test false-malformed-post receipt must be retained]" >&2; FAIL=$((FAIL + 1)); fi
rm -f "$START_STATE/post-malformed" "$START_STATE/post-fail" "$START_STATE/post-unload"

# dev-off: controller failure still terminates a verified Planner, then fails without re-enable.
reset_state
set_controller true
mkdir -p "$WORK/runtime/plasma-auto-tiler-dev"
CTRL_FAIL_RDIR="$(mktemp -d "$WORK/runtime/plasma-auto-tiler-controller.XXXXXX")"
printf '{"script_id":7}\n' > "$CTRL_FAIL_RDIR/ownership"
printf '%s\n' "$CTRL_FAIL_RDIR/ownership" > "$WORK/runtime/plasma-auto-tiler-dev/controller-receipt-path"
sleep 300 &
CTRL_FAIL_PID=$!
make_planner_proc "$CTRL_FAIL_PID" 999888
printf '%s\n' "$CTRL_FAIL_PID" > "$WORK/runtime/plasma-auto-tiler-dev/planner-pid"
printf '%s\n' "$PLASMA_AUTO_TILER_BIN" > "$WORK/runtime/plasma-auto-tiler-dev/planner-exe"
printf '999888\n' > "$WORK/runtime/plasma-auto-tiler-dev/planner-start"
touch "$WORK/state/stop-fails"
run_just dev-off
check_exit 1 "dev-off controller-fail exit"
assert_contains "teardown remains unverified" "dev-off controller-fail unverified"
assert_contains "planner $CTRL_FAIL_PID stopped" "dev-off controller-fail planner stopped"
assert_calls_contain "start-test stop 7" "dev-off controller-fail stop attempted"
assert_calls_missing "dogfood enable" "dev-off controller-fail no enable"
assert_not_contains "re-enabled" "dev-off controller-fail no re-enable claim"
if kill -0 "$CTRL_FAIL_PID" 2>/dev/null; then echo "FAIL [dev-off controller-fail planner still running]" >&2; FAIL=$((FAIL + 1)); kill "$CTRL_FAIL_PID" 2>/dev/null || true; wait "$CTRL_FAIL_PID" 2>/dev/null || true; else PASS=$((PASS + 1)); fi
if [[ -f "$WORK/runtime/plasma-auto-tiler-dev/planner-pid" ]]; then PASS=$((PASS + 1)); else echo "FAIL [dev-off controller-fail state retained]" >&2; FAIL=$((FAIL + 1)); fi
kill "$CTRL_FAIL_PID" 2>/dev/null || true
wait "$CTRL_FAIL_PID" 2>/dev/null || true
rm -f "$WORK/state/stop-fails"

echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
