#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="plasma-auto-tiler-active-border"
KWIN_OUT="/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3"
KWIN_DEV="/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev"
KWIN_DRV="/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv"
SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SELF_DIR/.." && pwd)"
PLUGIN_SOURCE="$REPO_ROOT/kwin/native-effect"

usage() {
  cat <<EOF
Usage:
  $(basename -- "$0") preflight --evidence-root PATH --nonce NONCE
  $(basename -- "$0") stage --evidence-root PATH
  $(basename -- "$0") boundary-1 prepare|confirm --evidence-root PATH
  $(basename -- "$0") validate --evidence-root PATH
  $(basename -- "$0") restore --evidence-root PATH
  $(basename -- "$0") boundary-2 prepare|confirm --evidence-root PATH
  $(basename -- "$0") postflight --evidence-root PATH

Run the commands serially in that order. The prepare/confirm boundary commands
only instruct and record the user-run session boundaries; they never perform one.
EOF
}

die() {
  local message="$1"
  if [[ -n "${EVIDENCE_ROOT:-}" && -d "$EVIDENCE_ROOT" ]]; then
    printf 'result=stopped reason=%s\n' "$message" >> "$EVIDENCE_ROOT/manifest.log"
  fi
  printf '%s\n' "$message" >&2
  exit 1
}

record() {
  printf '%s\n' "$*" >> "$EVIDENCE_ROOT/manifest.log"
}

tool() {
  local variable="$1" command_name="$2" path
  path="${!variable:-}"
  if [[ -z "$path" ]]; then
    path="$(type -P "$command_name" 2>/dev/null || true)"
  fi
  [[ "$path" == /* && -x "$path" ]] || die "missing required tool: $variable"
  printf '%s' "$path"
}

sha256() {
  local output
  output="$($SHA256_BIN "$1")" || die "could not hash $1"
  printf '%s\n' "${output%% *}"
}

verify_exact_host_pin() {
  local kwin_bin runtime_path version out_deriver dev_deriver
  kwin_bin="${KWIN_WAYLAND_BIN:-$(type -P kwin_wayland 2>/dev/null || true)}"
  [[ "$kwin_bin" == /* && -x "$kwin_bin" ]] || die "missing required tool: KWIN_WAYLAND_BIN"
  runtime_path="$($READLINK_BIN -f "$kwin_bin")" || die "could not resolve kwin_wayland"
  [[ "$runtime_path" == "$KWIN_OUT/bin/kwin_wayland" ]] || die "kwin_wayland is not the accepted exact runtime"
  version="$($kwin_bin --version 2>&1)" || die "kwin_wayland --version failed"
  [[ "$version" =~ (^|[[:space:]])6\.7\.3($|[[:space:]]) ]] || die "kwin_wayland version is not 6.7.3"
  out_deriver="$($KWIN_STORE_BIN -q --deriver "$KWIN_OUT")" || die "could not query the runtime deriver"
  dev_deriver="$($KWIN_STORE_BIN -q --deriver "$KWIN_DEV")" || die "could not query the development deriver"
  [[ "$out_deriver" == "$KWIN_DRV" && "$dev_deriver" == "$KWIN_DRV" ]] || die "runtime and development derivations do not match the accepted pin"
  printf 'runtime=%s\nversion=%s\nderivation=%s\ndevelopment=%s\n' "$runtime_path" "$version" "$KWIN_DRV" "$KWIN_DEV"
}

context_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$EVIDENCE_ROOT/context.env" | sed -n '1p'
}

load_context() {
  [[ -d "$EVIDENCE_ROOT" ]] || die "evidence root does not exist: $EVIDENCE_ROOT"
  [[ -f "$EVIDENCE_ROOT/context.env" ]] || die "preflight context is missing"
  NONCE="$(context_value nonce)"
  HOME_AT_PREFLIGHT="$(context_value home)"
  NAMESPACE_ROOT="$(context_value namespace_root)"
  NAMESPACE_EXISTED="$(context_value namespace_existed)"
  STAGE_ROOT="$(context_value stage_root)"
  ENV_DIR="$(context_value environment_dir)"
  ENTRY_PATH="$(context_value entry_path)"
  [[ "$NONCE" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid retained nonce"
  [[ "$HOME" == "$HOME_AT_PREFLIGHT" ]] || die "HOME differs from the preflight host"
  [[ "$NAMESPACE_ROOT" == "$HOME/.local/share/plasma-auto-tiler-native-effect" && "$STAGE_ROOT" == "$NAMESPACE_ROOT/$NONCE" && "$ENTRY_PATH" == "$ENV_DIR/${NONCE}.conf" ]] || die "retained paths are not user-local and nonce-owned"
  [[ "$NAMESPACE_EXISTED" == 0 || "$NAMESPACE_EXISTED" == 1 ]] || die "retained namespace pre-state is invalid"
  SHA256_BIN="$(tool SHA256_BIN sha256sum)"
}

write_snapshot() {
  local destination="$1" config env_dir path name
  : > "$destination"
  for config in kwinrc kdeglobals; do
    path="$HOME/.config/$config"
    if [[ -f "$path" ]]; then
      printf 'config:%s=%s\n' "$config" "$(sha256 "$path")" >> "$destination"
    else
      printf 'config:%s=absent\n' "$config" >> "$destination"
    fi
  done
  env_dir="$HOME/.config/environment.d"
  if [[ ! -d "$env_dir" ]]; then
    printf 'environment.d=absent\n' >> "$destination"
    return
  fi
  printf 'environment.d=present\n' >> "$destination"
  while IFS= read -r path; do
    name="${path##*/}"
    printf 'environment.d:%s=%s\n' "$name" "$(sha256 "$path")" >> "$destination"
  done < <(find "$env_dir" -mindepth 1 -maxdepth 1 -type f -print | sort)
}

require_context_option() {
  [[ "$1" == "--evidence-root" && -n "${2:-}" ]] || die "expected --evidence-root PATH"
  EVIDENCE_ROOT="$2"
  [[ "$EVIDENCE_ROOT" == /* ]] || die "evidence root must be an absolute path"
}

preflight() {
  local evidence_root="$1" nonce="$2" runtime_pin source_manifest
  local metadata_hash source_hash env_dir source_file namespace_root stage_root entry_path
  local prior_stage prior_entry namespace_existed
  EVIDENCE_ROOT="$evidence_root"
  [[ "$EVIDENCE_ROOT" == /* ]] || die "evidence root must be an absolute path"
  [[ ! -e "$EVIDENCE_ROOT" ]] || die "evidence root already exists; stop and retain it"
  [[ "$nonce" =~ ^[A-Za-z0-9._-]+$ ]] || die "nonce must contain only ASCII letters, digits, dot, underscore, or hyphen"
  mkdir -p "$EVIDENCE_ROOT"
  SHA256_BIN="$(tool SHA256_BIN sha256sum)"
  READLINK_BIN="$(tool READLINK_BIN readlink)"
  KWIN_STORE_BIN="$(tool KWIN_STORE_BIN nix-store)"
  runtime_pin="$(verify_exact_host_pin)"
  [[ -d "$PLUGIN_SOURCE" && -f "$PLUGIN_SOURCE/CMakeLists.txt" && -f "$PLUGIN_SOURCE/metadata.json" && -f "$PLUGIN_SOURCE/activewindowborder.cpp" ]] || die "native plugin source is incomplete"
  grep -Fq '"Id": "plasma-auto-tiler-active-border"' "$PLUGIN_SOURCE/metadata.json" || die "native plugin metadata identity is not exact"
  metadata_hash="$(sha256 "$PLUGIN_SOURCE/metadata.json")"
  source_hash="$(sha256 "$PLUGIN_SOURCE/activewindowborder.cpp")"
  source_manifest="$EVIDENCE_ROOT/source-files.before"
  while IFS= read -r source_file; do
    printf '%s  %s\n' "$(sha256 "$source_file")" "${source_file#"$PLUGIN_SOURCE/"}" >> "$source_manifest"
  done < <(find "$PLUGIN_SOURCE" -type f -print | sort)
  env_dir="$HOME/.config/environment.d"
  [[ ! -L "$env_dir" ]] || die "environment.d is symlinked; stop before staging"
  stage_root="$HOME/.local/share/plasma-auto-tiler-native-effect/$nonce"
  namespace_root="$HOME/.local/share/plasma-auto-tiler-native-effect"
  entry_path="$env_dir/$nonce.conf"
  if [[ -e "$namespace_root" || -L "$namespace_root" ]]; then
    [[ ! -L "$namespace_root" && -d "$namespace_root" ]] || die "nonce namespace parent is symlinked or not a directory"
    namespace_existed=1
  else
    namespace_existed=0
  fi
  prior_stage=absent
  prior_entry=absent
  [[ -e "$stage_root" || -L "$stage_root" ]] && prior_stage=present
  [[ -e "$entry_path" || -L "$entry_path" ]] && prior_entry=present
  {
    printf 'nonce=%s\n' "$nonce"
    printf 'home=%s\n' "$HOME"
    printf 'namespace_root=%s\n' "$namespace_root"
    printf 'namespace_existed=%s\n' "$namespace_existed"
    printf 'stage_root=%s\n' "$stage_root"
    printf 'environment_dir=%s\n' "$env_dir"
    printf 'entry_path=%s\n' "$entry_path"
  } > "$EVIDENCE_ROOT/context.env"
  : > "$EVIDENCE_ROOT/manifest.log"
  {
    printf 'phase=1 read-only-preflight\n'
    printf 'plugin_id=%s\n' "$PLUGIN_ID"
    printf '%s\n' "$runtime_pin"
    printf 'metadata_sha256=%s\n' "$metadata_hash"
    printf 'source_sha256=%s\n' "$source_hash"
  } > "$EVIDENCE_ROOT/host-pin.txt"
  write_snapshot "$EVIDENCE_ROOT/snapshot.before"
  printf 'prior_stage=%s\n' "$prior_stage" > "$EVIDENCE_ROOT/prior-state.txt"
  printf 'prior_entry=%s\n' "$prior_entry" >> "$EVIDENCE_ROOT/prior-state.txt"
  printf 'prior_namespace=%s\n' "$([[ "$namespace_existed" == 1 ]] && printf present || printf absent)" >> "$EVIDENCE_ROOT/prior-state.txt"
  if [[ -d "$env_dir" ]]; then
    printf 'prior_environment_dir=present\n' >> "$EVIDENCE_ROOT/prior-state.txt"
  else
    printf 'prior_environment_dir=absent\n' >> "$EVIDENCE_ROOT/prior-state.txt"
  fi
  [[ "$prior_stage" == absent && "$prior_entry" == absent ]] || die "nonce-owned path already exists; stop and retain prior state"
  record "phase=1 result=verified read-only=true"
  printf 'Evidence: %s\n' "$EVIDENCE_ROOT"
  printf 'Next: %s stage --evidence-root %s\n' "$0" "$EVIDENCE_ROOT"
}

stage() {
  local cmake_bin build_root plugin_so plugin_suffix plugin_hash entry_hash env_dir existed source_file
  local source_manifest
  local -a plugin_paths
  load_context
  [[ "$(sha256 "$PLUGIN_SOURCE/metadata.json")" == "$(host_pin_value metadata_sha256)" ]] || die "plugin metadata changed after preflight"
  [[ "$(sha256 "$PLUGIN_SOURCE/activewindowborder.cpp")" == "$(host_pin_value source_sha256)" ]] || die "plugin source changed after preflight"
  source_manifest="$EVIDENCE_ROOT/source-files.current"
  : > "$source_manifest"
  while IFS= read -r source_file; do
    printf '%s  %s\n' "$(sha256 "$source_file")" "${source_file#"$PLUGIN_SOURCE/"}" >> "$source_manifest"
  done < <(find "$PLUGIN_SOURCE" -type f -print | sort)
  cmp -s "$EVIDENCE_ROOT/source-files.before" "$source_manifest" || die "native plugin source set changed after preflight"
  cmake_bin="$(tool CMAKE_BIN cmake)"
  [[ ! -e "$STAGE_ROOT" && ! -L "$STAGE_ROOT" ]] || die "nonce-owned stage path already exists"
  [[ ! -e "$ENTRY_PATH" && ! -L "$ENTRY_PATH" ]] || die "nonce-owned environment entry already exists"
  env_dir="$ENV_DIR"
  if [[ -e "$env_dir" && ! -d "$env_dir" ]]; then
    die "environment.d path is not a directory"
  fi
  if [[ -e "$NAMESPACE_ROOT" || -L "$NAMESPACE_ROOT" ]]; then
    [[ ! -L "$NAMESPACE_ROOT" && -d "$NAMESPACE_ROOT" ]] || die "nonce namespace parent is symlinked or not a directory"
  fi
  [[ -d "$HOME/.config" && ! -L "$HOME/.config" ]] || die "user config directory is missing or symlinked"
  [[ -d "$HOME/.local/share" && ! -L "$HOME/.local/share" ]] || die "user local data directory is missing or symlinked"
  [[ ! -L "$env_dir" ]] || die "environment.d is symlinked; stop and retain prior state"
  existed=0
  [[ -d "$env_dir" ]] && existed=1
  build_root="$EVIDENCE_ROOT/build"
  mkdir -p "$build_root"
  if ! CMAKE_PREFIX_PATH="$KWIN_DEV${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}" \
    "$cmake_bin" -S "$PLUGIN_SOURCE" -B "$build_root" -DKWin_DIR="$KWIN_DEV/lib/cmake/KWin" -DBUILD_TESTING=OFF > "$EVIDENCE_ROOT/cmake-configure.log" 2>&1; then
    die "exact-pinned plugin configure failed"
  fi
  if ! "$cmake_bin" --build "$build_root" > "$EVIDENCE_ROOT/cmake-build.log" 2>&1; then
    die "exact-pinned plugin build failed"
  fi
  mapfile -t plugin_paths < <(find "$build_root" -type f -name "$PLUGIN_ID.so" -print | sort)
  [[ "${#plugin_paths[@]}" -eq 1 ]] || die "built exact plugin is not uniquely located"
  plugin_so="${plugin_paths[0]}"
  plugin_suffix="/kwin/effects/plugins/$PLUGIN_ID.so"
  [[ "$plugin_so" == *"$plugin_suffix" ]] || die "built plugin has the wrong discovery layout"
  plugin_hash="$(sha256 "$plugin_so")"
  mkdir -p "$STAGE_ROOT/kwin/effects/plugins"
  install -m 0644 "$plugin_so" "$STAGE_ROOT/kwin/effects/plugins/$PLUGIN_ID.so"
  mkdir -p "$env_dir"
  printf '# nonce=%s\nQT_PLUGIN_PATH=%s\n' "$NONCE" "$STAGE_ROOT" > "$EVIDENCE_ROOT/environment-entry.expected"
  install -m 0644 "$EVIDENCE_ROOT/environment-entry.expected" "$ENTRY_PATH"
  entry_hash="$(sha256 "$ENTRY_PATH")"
  {
    printf 'plugin_source=%s\n' "$plugin_so"
    printf 'plugin_path=%s\n' "$STAGE_ROOT/kwin/effects/plugins/$PLUGIN_ID.so"
    printf 'plugin_sha256=%s\n' "$plugin_hash"
    printf 'entry_path=%s\n' "$ENTRY_PATH"
    printf 'entry_sha256=%s\n' "$entry_hash"
    printf 'environment_dir_existed=%s\n' "$existed"
    printf 'namespace_existed=%s\n' "$NAMESPACE_EXISTED"
  } > "$EVIDENCE_ROOT/stage-record.txt"
  printf '%s\n' "$STAGE_ROOT/kwin" "$STAGE_ROOT/kwin/effects" "$STAGE_ROOT/kwin/effects/plugins" "$STAGE_ROOT/kwin/effects/plugins/$PLUGIN_ID.so" > "$EVIDENCE_ROOT/owned-tree.txt"
  record "phase=2 result=verified plugin=$STAGE_ROOT/kwin/effects/plugins/$PLUGIN_ID.so entry=$ENTRY_PATH"
  printf 'Staged exact plugin and nonce-owned environment entry.\n'
  printf 'Next: %s boundary-1 prepare --evidence-root %s\n' "$0" "$EVIDENCE_ROOT"
}

boundary() {
  local number="$1" action="$2" marker pending token token_input
  load_context
  marker="$EVIDENCE_ROOT/boundary-$number.confirmed"
  pending="$EVIDENCE_ROOT/boundary-$number.pending"
  if [[ "$action" == "prepare" ]]; then
    if [[ "$number" == 1 ]]; then
      [[ -f "$EVIDENCE_ROOT/stage-record.txt" ]] || die "staging is incomplete"
    else
      [[ -f "$EVIDENCE_ROOT/restored" ]] || die "restoration is incomplete"
    fi
    cat > "$EVIDENCE_ROOT/boundary-$number.instructions" <<EOF
Boundary $number is user-run only.
Use the bounded secondary Wayland session preferred by the approved protocol.
Do not use a routine in-place KWin termination or automatic primary-session mutation.
After entering the required session, run:
  $0 boundary-$number confirm --evidence-root $EVIDENCE_ROOT
EOF
    : > "$pending"
    record "boundary=$number result=prepared user-action-required=true"
    cat "$EVIDENCE_ROOT/boundary-$number.instructions"
    return
  fi
  [[ -f "$pending" ]] || die "boundary $number was not prepared"
  if [[ "$number" == 1 ]]; then
    READLINK_BIN="$(tool READLINK_BIN readlink)"
    KWIN_STORE_BIN="$(tool KWIN_STORE_BIN nix-store)"
    verify_exact_host_pin > "$EVIDENCE_ROOT/post-boundary-1-pin.txt"
    [[ "${QT_PLUGIN_PATH:-}" == "$STAGE_ROOT" ]] || die "boundary 1 did not expose the exact nonce-owned plugin path"
    token=BOUNDARY1
  else
    case "${QT_PLUGIN_PATH:-}" in *"$STAGE_ROOT"*) die "boundary 2 still exposes the nonce-owned plugin path" ;; esac
    token=BOUNDARY2
  fi
  printf 'Type %s after personally completing the session boundary: ' "$token" >&2
  IFS= read -r token_input || die "user boundary confirmation was not supplied"
  [[ "$token_input" == "$token" ]] || die "user boundary confirmation token was incorrect"
  : > "$marker"
  record "boundary=$number result=confirmed user-run=true"
  printf 'Boundary %s retained as user-run evidence.\n' "$number"
}

effect_call() {
  local method="$1" output_file="$2" output_error="$3"
  if ! "$GDBUS_BIN" call --session --dest org.kde.KWin --object-path /Effects \
    --method "org.kde.kwin.Effects.$method" "$PLUGIN_ID" > "$output_file" 2> "$output_error"; then
    die "/Effects $method failed; retain evidence and query exact plugin state before recovery"
  fi
}

effect_output() {
  sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$1"
}

validate() {
  local value
  load_context
  GDBUS_BIN="$(tool GDBUS_BIN gdbus)"
  [[ -f "$EVIDENCE_ROOT/boundary-1.confirmed" ]] || die "boundary 1 confirmation is missing"
  [[ "${QT_PLUGIN_PATH:-}" == "$STAGE_ROOT" ]] || die "current session does not expose the exact staged plugin path"
  effect_call supportInformation "$EVIDENCE_ROOT/effects-support-information.out" "$EVIDENCE_ROOT/effects-support-information.err"
  grep -Fq "$PLUGIN_ID" "$EVIDENCE_ROOT/effects-support-information.out" || die "support information did not identify the exact plugin"
  effect_call isEffectSupported "$EVIDENCE_ROOT/effect-supported.out" "$EVIDENCE_ROOT/effect-supported.err"
  value="$(effect_output "$EVIDENCE_ROOT/effect-supported.out")"
  [[ "$value" == "(true,)" ]] || die "exact plugin support was not true"
  effect_call isEffectLoaded "$EVIDENCE_ROOT/effect-initial-loaded.out" "$EVIDENCE_ROOT/effect-initial-loaded.err"
  value="$(effect_output "$EVIDENCE_ROOT/effect-initial-loaded.out")"
  [[ "$value" == "(false,)" ]] || die "exact plugin was already loaded or its state was ambiguous"
  effect_call loadEffect "$EVIDENCE_ROOT/effect-load.out" "$EVIDENCE_ROOT/effect-load.err"
  value="$(effect_output "$EVIDENCE_ROOT/effect-load.out")"
  [[ "$value" == "(true,)" ]] || die "exact plugin load did not return true"
  effect_call isEffectLoaded "$EVIDENCE_ROOT/effect-loaded.out" "$EVIDENCE_ROOT/effect-loaded.err"
  value="$(effect_output "$EVIDENCE_ROOT/effect-loaded.out")"
  [[ "$value" == "(true,)" ]] || die "exact plugin loaded state did not become true"
  printf 'Observe the exact active-window border manually, then type ACCEPT: ' >&2
  IFS= read -r value || die "manual visual acceptance was not supplied"
  [[ "$value" == ACCEPT ]] || die "manual visual acceptance was not recorded"
  printf 'ACCEPT\n' > "$EVIDENCE_ROOT/manual-visual-acceptance.txt"
  effect_call unloadEffect "$EVIDENCE_ROOT/effect-unload.out" "$EVIDENCE_ROOT/effect-unload.err"
  effect_call isEffectLoaded "$EVIDENCE_ROOT/effect-unloaded.out" "$EVIDENCE_ROOT/effect-unloaded.err"
  value="$(effect_output "$EVIDENCE_ROOT/effect-unloaded.out")"
  [[ "$value" == "(false,)" ]] || die "exact plugin loaded state did not become false after unload"
  : > "$EVIDENCE_ROOT/validated"
  record "phase=4 result=verified support=true load=true loaded=true visual=ACCEPT unload=true unloaded=true"
  printf 'Exact /Effects lifecycle and manual acceptance retained.\n'
  printf 'Next: %s restore --evidence-root %s\n' "$0" "$EVIDENCE_ROOT"
}

stage_record_value() {
  sed -n "s/^$1=//p" "$EVIDENCE_ROOT/stage-record.txt" | sed -n '1p'
}

host_pin_value() {
  sed -n "s/^$1=//p" "$EVIDENCE_ROOT/host-pin.txt" | sed -n '1p'
}

restore() {
  local plugin_path plugin_hash entry_hash env_created actual_tree expected_tree
  load_context
  [[ -f "$EVIDENCE_ROOT/validated" ]] || die "validation is incomplete"
  plugin_path="$(stage_record_value plugin_path)"
  plugin_hash="$(stage_record_value plugin_sha256)"
  entry_hash="$(stage_record_value entry_sha256)"
  env_created="$(stage_record_value environment_dir_existed)"
  [[ -f "$plugin_path" && "$(sha256 "$plugin_path")" == "$plugin_hash" ]] || die "owned plugin is missing or changed; retain paths"
  [[ -f "$ENTRY_PATH" && "$(sha256 "$ENTRY_PATH")" == "$entry_hash" ]] || die "owned environment entry is missing or changed; retain paths"
  cmp -s "$ENTRY_PATH" "$EVIDENCE_ROOT/environment-entry.expected" || die "owned environment entry content is not exact; retain paths"
  expected_tree="$(sort "$EVIDENCE_ROOT/owned-tree.txt")"
  actual_tree="$(find "$STAGE_ROOT" -mindepth 1 -print | sort)"
  [[ "$actual_tree" == "$expected_tree" ]] || die "owned stage contains unexpected paths; retain paths"
  if [[ "$env_created" == 0 ]]; then
    [[ "$(find "$ENV_DIR" -mindepth 1 -maxdepth 1 -type f -print | sort)" == "$ENTRY_PATH" ]] || die "environment.d contains unexpected state; retain paths"
  fi
  if [[ "$NAMESPACE_EXISTED" == 0 ]]; then
    [[ "$(find "$NAMESPACE_ROOT" -mindepth 1 -maxdepth 1 -print | sort)" == "$STAGE_ROOT" ]] || die "created nonce namespace contains unexpected state; retain paths"
  fi
  rm -f -- "$ENTRY_PATH"
  rm -f -- "$plugin_path"
  rmdir -- "$STAGE_ROOT/kwin/effects/plugins" "$STAGE_ROOT/kwin/effects" "$STAGE_ROOT/kwin" "$STAGE_ROOT"
  if [[ "$NAMESPACE_EXISTED" == 0 ]]; then
    rmdir -- "$NAMESPACE_ROOT"
  fi
  if [[ "$env_created" == 0 ]]; then
    rmdir -- "$ENV_DIR"
  fi
  : > "$EVIDENCE_ROOT/restored"
  record "phase=5 restoration result=verified exact=true owned_paths_removed=true"
  printf 'Exact normal-path restoration completed.\n'
  printf 'Next: %s boundary-2 prepare --evidence-root %s\n' "$0" "$EVIDENCE_ROOT"
}

postflight() {
  local value
  load_context
  GDBUS_BIN="$(tool GDBUS_BIN gdbus)"
  [[ -f "$EVIDENCE_ROOT/restored" && -f "$EVIDENCE_ROOT/boundary-2.confirmed" ]] || die "restoration and boundary 2 confirmation are incomplete"
  [[ ! -e "$STAGE_ROOT" && ! -L "$STAGE_ROOT" && ! -e "$ENTRY_PATH" && ! -L "$ENTRY_PATH" ]] || die "nonce-owned paths remain after restoration"
  case "${QT_PLUGIN_PATH:-}" in *"$STAGE_ROOT"*) die "normal session still exposes the nonce-owned plugin path" ;; esac
  effect_call isEffectLoaded "$EVIDENCE_ROOT/postflight-loaded.out" "$EVIDENCE_ROOT/postflight-loaded.err"
  value="$(effect_output "$EVIDENCE_ROOT/postflight-loaded.out")"
  [[ "$value" == "(false,)" ]] || die "postflight exact plugin state is not unloaded"
  write_snapshot "$EVIDENCE_ROOT/snapshot.after"
  cmp -s "$EVIDENCE_ROOT/snapshot.before" "$EVIDENCE_ROOT/snapshot.after" || die "host configuration snapshot changed"
  record "phase=5 postflight result=verified unloaded=true discovery_absent=true snapshot_match=true"
  printf 'Postflight passed. Evidence retained at %s\n' "$EVIDENCE_ROOT"
}

command_name="${1:-}"
shift || true
case "$command_name" in
  --help|-h|help)
    usage
    ;;
  preflight)
    [[ "${1:-}" == "--evidence-root" && -n "${2:-}" && "${3:-}" == "--nonce" && -n "${4:-}" && -z "${5:-}" ]] || die "preflight requires --evidence-root PATH --nonce NONCE"
    preflight "$2" "$4"
    ;;
  stage|validate|restore|postflight)
    [[ "${1:-}" == "--evidence-root" && -n "${2:-}" && -z "${3:-}" ]] || die "$command_name requires --evidence-root PATH"
    require_context_option "$1" "$2"
    "$command_name"
    ;;
  boundary-1|boundary-2)
    [[ "${1:-}" == "prepare" || "${1:-}" == "confirm" ]] || die "$command_name requires prepare or confirm"
    [[ "${2:-}" == "--evidence-root" && -n "${3:-}" && -z "${4:-}" ]] || die "$command_name requires --evidence-root PATH"
    require_context_option "$2" "$3"
    boundary "${command_name#boundary-}" "$1"
    ;;
  *)
    die "unknown command: ${command_name:-missing}"
    ;;
esac
