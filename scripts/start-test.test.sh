#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FAKE_BIN="$(mktemp -d)"
OUTPUT="$(mktemp)"

cleanup() {
  rm -rf "$FAKE_BIN"
  rm -f "$OUTPUT"
}
trap cleanup EXIT

make_fake_tools() {
  local journal_entries="$1"
  mkdir -p "$FAKE_BIN/bin"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$FAKE_BIN/bin/npm"
  printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "812 /fake/kwin_wayland --wayland-fd 7"' > "$FAKE_BIN/bin/pgrep"
  printf '%s\n' '#!/usr/bin/env bash' 'case "$*" in' '*isScriptLoaded*) printf "%s\\n" "{\"type\":\"b\",\"data\":[false]}" ;;' '*loadScript*) printf "%s\\n" "{\"type\":\"i\",\"data\":[7]}" ;;' '*introspect*) printf "%s\\n" "[{\"type\":\"interface\",\"name\":\"org.kde.kwin.Script\"}]" ;;' '*) exit 0 ;;' 'esac' > "$FAKE_BIN/bin/busctl"
  printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$*" == *"--show-cursor"* ]]; then' '  printf "%s\\n" "-- cursor: fake-cursor"' 'else' "  printf '%s\\n' '$journal_entries'" 'fi' > "$FAKE_BIN/bin/journalctl"
  chmod +x "$FAKE_BIN/bin/npm" "$FAKE_BIN/bin/pgrep" "$FAKE_BIN/bin/busctl" "$FAKE_BIN/bin/journalctl"
}

make_fake_tools '{"MESSAGE":"plasma-auto-tiler:shortcut-registered"}
{"MESSAGE":"plasma-auto-tiler:startup-handlers-ready"}'
PATH="$FAKE_BIN/bin:$PATH" "$REPO_ROOT/scripts/start-test.sh" >"$OUTPUT" 2>&1
grep -Fq "controller readiness confirmed" "$OUTPUT"

make_fake_tools '{"MESSAGE":"plasma-auto-tiler:disabled:shortcut-registration-failed"}'
if PATH="$FAKE_BIN/bin:$PATH" "$REPO_ROOT/scripts/start-test.sh" >"$OUTPUT" 2>&1; then
  exit 1
fi
grep -Fq "controller readiness was not confirmed" "$OUTPUT"
if grep -Fq "started:" "$OUTPUT"; then
  exit 1
fi
