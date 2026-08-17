#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/live-native-effect-test.sh"
PLUGIN_ID="plasma-auto-tiler-active-border"
WORK="$(mktemp -d)"
FAKE_BIN="$WORK/bin"
HOME_DIR="$WORK/home"
EVIDENCE_ROOT="$WORK/evidence"
CALLS="$WORK/calls.log"
STATE="$WORK/state"
PASS=0
BASH_BIN="$(command -v bash)"

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() {
  PASS=$((PASS + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || fail "missing file: $1"
  pass
}

assert_contains() {
  grep -Fq -- "$2" "$1" || fail "$1 does not contain $2"
  pass
}

assert_not_exists() {
  [[ ! -e "$1" && ! -L "$1" ]] || fail "unexpected path: $1"
  pass
}

mkdir -p "$FAKE_BIN" "$HOME_DIR/.config/environment.d" "$HOME_DIR/.local/share" "$STATE"
printf 'unchanged=true\n' > "$HOME_DIR/.config/kwinrc"
printf 'prior=true\n' > "$HOME_DIR/.config/environment.d/prior.conf"

cat > "$FAKE_BIN/kwin_wayland" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == "--version" ]] && printf 'kwin 6.7.3\n' && exit 0
exit 99
EOF
cat > "$FAKE_BIN/readlink" <<'EOF'
#!/usr/bin/env bash
printf '/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/bin/kwin_wayland\n'
EOF
cat > "$FAKE_BIN/nix-store" <<'EOF'
#!/usr/bin/env bash
printf '/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv\n'
EOF
cat > "$FAKE_BIN/cmake" <<'EOF'
#!/usr/bin/env bash
build=''
previous=''
for arg in "$@"; do
  [[ "$previous" == '-B' ]] && build="$arg"
  previous="$arg"
done
if [[ " $* " == *' --build '* ]]; then
  build="${2:-$build}"
  mkdir -p "$build/bin/kwin/effects/plugins"
  printf 'fake plugin\n' > "$build/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
else
  mkdir -p "$build"
fi
EOF
cat > "$FAKE_BIN/gdbus" <<'EOF'
#!/usr/bin/env bash
method=''
previous=''
for arg in "$@"; do
  [[ "$previous" == '--method' ]] && method="$arg"
  previous="$arg"
done
printf '%s\n' "$*" >> "${FAKE_CALLS:?}"
case "$method" in
  org.kde.kwin.Effects.supportInformation) printf '%s\n' 'plasma-auto-tiler-active-border' ;;
  org.kde.kwin.Effects.isEffectSupported) printf '(true,)\n' ;;
  org.kde.kwin.Effects.isEffectLoaded)
    [[ -f "$FAKE_STATE/loaded" ]] && printf '(true,)\n' || printf '(false,)\n'
    ;;
  org.kde.kwin.Effects.loadEffect) : > "$FAKE_STATE/loaded"; printf '(true,)\n' ;;
  org.kde.kwin.Effects.unloadEffect) rm -f "$FAKE_STATE/loaded"; printf '()\n' ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$FAKE_BIN"/*

if ! bash -n "$SCRIPT" || ! bash -n "${BASH_SOURCE[0]}"; then
  fail 'Bash syntax check failed'
fi
pass

for prohibited in '/Compositor' '/Scripting' 'sudo' 'pkill' 'killall' 'rm -rf' '--virtual' 'busctl --user'; do
  if grep -Fq -- "$prohibited" "$SCRIPT"; then
    fail "production script contains prohibited text: $prohibited"
  fi
  pass
done

for pin in \
  'kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3' \
  '483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev' \
  'ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv'; do
  assert_contains "$SCRIPT" "$pin"
done

run_phase() {
  env HOME="$HOME_DIR" PATH="$FAKE_BIN:$PATH" \
    KWIN_WAYLAND_BIN="$FAKE_BIN/kwin_wayland" READLINK_BIN="$FAKE_BIN/readlink" \
    KWIN_STORE_BIN="$FAKE_BIN/nix-store" CMAKE_BIN="$FAKE_BIN/cmake" \
    GDBUS_BIN="$FAKE_BIN/gdbus" FAKE_CALLS="$CALLS" FAKE_STATE="$STATE" \
    "$BASH_BIN" "$SCRIPT" "$@"
}

run_phase preflight --evidence-root "$EVIDENCE_ROOT" --nonce fake-20260818
assert_file "$EVIDENCE_ROOT/snapshot.before"
assert_contains "$EVIDENCE_ROOT/host-pin.txt" 'runtime=/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/bin/kwin_wayland'
assert_contains "$EVIDENCE_ROOT/prior-state.txt" 'prior_environment_dir=present'
assert_contains "$EVIDENCE_ROOT/prior-state.txt" 'prior_namespace=absent'

run_phase stage --evidence-root "$EVIDENCE_ROOT"
STAGE_ROOT="$HOME_DIR/.local/share/plasma-auto-tiler-native-effect/fake-20260818"
NAMESPACE_ROOT="$HOME_DIR/.local/share/plasma-auto-tiler-native-effect"
ENTRY_PATH="$HOME_DIR/.config/environment.d/fake-20260818.conf"
assert_file "$STAGE_ROOT/kwin/effects/plugins/$PLUGIN_ID.so"
assert_file "$ENTRY_PATH"
assert_contains "$ENTRY_PATH" "QT_PLUGIN_PATH=$STAGE_ROOT"
assert_contains "$EVIDENCE_ROOT/stage-record.txt" 'environment_dir_existed=1'

run_phase boundary-1 prepare --evidence-root "$EVIDENCE_ROOT"
printf 'BOUNDARY1\n' | env HOME="$HOME_DIR" QT_PLUGIN_PATH="$STAGE_ROOT" PATH="$FAKE_BIN:$PATH" \
  "$BASH_BIN" "$SCRIPT" boundary-1 confirm --evidence-root "$EVIDENCE_ROOT"
assert_file "$EVIDENCE_ROOT/boundary-1.confirmed"
assert_file "$EVIDENCE_ROOT/post-boundary-1-pin.txt"

printf 'ACCEPT\n' | env HOME="$HOME_DIR" QT_PLUGIN_PATH="$STAGE_ROOT" PATH="$FAKE_BIN:$PATH" \
  GDBUS_BIN="$FAKE_BIN/gdbus" FAKE_CALLS="$CALLS" FAKE_STATE="$STATE" \
  "$BASH_BIN" "$SCRIPT" validate --evidence-root "$EVIDENCE_ROOT"
assert_file "$EVIDENCE_ROOT/manual-visual-acceptance.txt"
assert_file "$EVIDENCE_ROOT/validated"
assert_contains "$EVIDENCE_ROOT/effect-loaded.out" '(true,)'
assert_contains "$EVIDENCE_ROOT/effect-unloaded.out" '(false,)'

run_phase restore --evidence-root "$EVIDENCE_ROOT"
assert_not_exists "$STAGE_ROOT"
assert_not_exists "$NAMESPACE_ROOT"
assert_not_exists "$ENTRY_PATH"
assert_file "$HOME_DIR/.config/environment.d/prior.conf"
assert_file "$EVIDENCE_ROOT/restored"

run_phase boundary-2 prepare --evidence-root "$EVIDENCE_ROOT"
printf 'BOUNDARY2\n' | env HOME="$HOME_DIR" QT_PLUGIN_PATH='' PATH="$FAKE_BIN:$PATH" \
  "$BASH_BIN" "$SCRIPT" boundary-2 confirm --evidence-root "$EVIDENCE_ROOT"
assert_file "$EVIDENCE_ROOT/boundary-2.confirmed"

env HOME="$HOME_DIR" QT_PLUGIN_PATH='' PATH="$FAKE_BIN:$PATH" \
  GDBUS_BIN="$FAKE_BIN/gdbus" FAKE_CALLS="$CALLS" FAKE_STATE="$STATE" \
  "$BASH_BIN" "$SCRIPT" postflight --evidence-root "$EVIDENCE_ROOT"
assert_file "$EVIDENCE_ROOT/snapshot.after"
assert_contains "$EVIDENCE_ROOT/manifest.log" 'postflight result=verified'

if grep -Fq -- '/Compositor' "$CALLS" || grep -Fq -- '/Scripting' "$CALLS"; then
  fail 'fake lifecycle used a prohibited interface'
fi
pass
if ! grep -Fq -- '--object-path /Effects' "$CALLS"; then
  fail 'fake lifecycle did not use /Effects'
fi
pass
if grep -Fv -- '--object-path /Effects' "$CALLS" | grep -q .; then
  fail 'fake lifecycle used a non-/Effects object path'
fi
pass
for method in supportInformation isEffectSupported isEffectLoaded loadEffect unloadEffect; do
  if ! grep -Fq -- "org.kde.kwin.Effects.$method" "$CALLS"; then
    fail "fake lifecycle omitted $method"
  fi
  pass
done

# A pre-existing namespace symlink must be refused before staging can redirect
# the nonce-owned plugin outside the user's local data namespace.
CASE_HOME="$WORK/symlink-home"
CASE_EVIDENCE="$WORK/symlink-evidence"
CASE_REDIRECT="$WORK/symlink-redirect"
mkdir -p "$CASE_HOME/.config" "$CASE_HOME/.local/share" "$CASE_REDIRECT"
ln -s "$CASE_REDIRECT" "$CASE_HOME/.local/share/plasma-auto-tiler-native-effect"
if env HOME="$CASE_HOME" PATH="$FAKE_BIN:$PATH" \
  KWIN_WAYLAND_BIN="$FAKE_BIN/kwin_wayland" READLINK_BIN="$FAKE_BIN/readlink" \
  KWIN_STORE_BIN="$FAKE_BIN/nix-store" CMAKE_BIN="$FAKE_BIN/cmake" \
  "$BASH_BIN" "$SCRIPT" preflight --evidence-root "$CASE_EVIDENCE" --nonce symlink-case >/dev/null 2>&1; then
  fail 'symlinked namespace parent was accepted'
fi
assert_not_exists "$CASE_REDIRECT/kwin"

printf 'PASS: %s focused static/fake checks\n' "$PASS"
