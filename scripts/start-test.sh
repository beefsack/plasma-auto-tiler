#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KWIN_DIR="$REPO_ROOT/kwin"
BUNDLE="$KWIN_DIR/contents/code/main.js"
PROVENANCE_BUNDLE=""
META="$KWIN_DIR/metadata.json"
PROC_ROOT="${PROC_ROOT:-/proc}"

BUS_SCOPE="--user"
BUS_DEST="org.kde.KWin"
BUS_PATH="/Scripting"
BUS_SCRIPTING_IFACE="org.kde.kwin.Scripting"
BUS_SCRIPT_IFACE="org.kde.kwin.Script"
PROVENANCE_PLUGIN_PREFIX="plasma-auto-tiler-checkout-provenance-"
PROVENANCE_PLUGIN_ID="${PROVENANCE_PLUGIN_ID:-}"
CONTROLLER_READY_MESSAGE=""
OWNED_RECEIPT=""
OWNED_NONCE=""
OWNED_BUILD=""
EXACT_CLEANUP_AFTER=""

VDSK_PATH="/VirtualDesktopManager"
VDSK_IFACE="org.kde.KWin.VirtualDesktopManager"

KG_DEST="org.kde.kglobalaccel"
KG_PATH="/kglobalaccel"
KG_IFACE="org.kde.KGlobalAccel"
KG_COMP_IFACE="org.kde.kglobalaccel.Component"

PLUGIN_ID=""
SCRIPT_ID=""
PROVENANCE_SCRIPT_ID=""
KWIN_PID=""
KWIN_START_IDENTITY=""
# Immutable identity captured before a lifecycle operation. Rechecks compare
# against this value without replacing it with a reused-PID identity.
KWIN_PREOP_PID=""
KWIN_PREOP_START_IDENTITY=""
KWIN_IDENTITY_MISMATCH=0
JOURNAL_CURSOR=""
# Attempt-owned temporary file holding the retained raw current-attempt
# after-cursor same-KWin-PID evidence (project diagnostics plus kwin_scripting
# messages only; never window captions). Lives until post-cleanup reporting
# completes, then is removed.
EVIDENCE_FILE=""
PROVENANCE_TMP_DIR=""
PROVENANCE_OWNERSHIP_FILE="${PROVENANCE_OWNERSHIP_FILE:-}"
CONTROLLER_OWNERSHIP_FILE="${CONTROLLER_OWNERSHIP_FILE:-}"
PROVENANCE_LOAD_ATTEMPTED=0
PROVENANCE_SIGNAL_PENDING=""
START_NONCE="${START_NONCE:-}"

# The exact project action IDs this lifecycle interface owns.
PROJECT_ACTIONS=(
  plasma-auto-tiler-insert-right
  plasma-auto-tiler-insert-left
  plasma-auto-tiler-insert-up
  plasma-auto-tiler-insert-down
  plasma-auto-tiler-focus-left
  plasma-auto-tiler-focus-down
  plasma-auto-tiler-focus-up
  plasma-auto-tiler-focus-right
  plasma-auto-tiler-focus-left-arrow
  plasma-auto-tiler-focus-down-arrow
  plasma-auto-tiler-focus-up-arrow
  plasma-auto-tiler-focus-right-arrow
  plasma-auto-tiler-move-left
  plasma-auto-tiler-move-down
  plasma-auto-tiler-move-up
  plasma-auto-tiler-move-right
  plasma-auto-tiler-move-left-arrow
  plasma-auto-tiler-move-down-arrow
  plasma-auto-tiler-move-up-arrow
  plasma-auto-tiler-move-right-arrow
  plasma-auto-tiler-detach
  plasma-auto-tiler-attach
  plasma-auto-tiler-fill-scope
  plasma-auto-tiler-apply-columns
  plasma-auto-tiler-apply-rows
  plasma-auto-tiler-apply-balanced-grid
  plasma-auto-tiler-apply-dwindle
)
PROJECT_ACTIONS_JSON=""

# Expected source-default active sequence per project action, in the Qt
# integer encoding KGlobalAccel exposes through the allShortcutInfos active
# field and accepts through setShortcutKeys (modifier bits OR key code).
# Provenance: TileController.start() registerShortcut defaults in
# kwin/src/controller.ts, encoded with the pinned Qt 6 KeyboardModifier bits
# (Shift 0x02000000, Control 0x04000000, Alt 0x08000000, Meta 0x10000000) and
# verified against the live collector on 2026-08-12.
declare -A EXPECTED_SEQUENCES=(
  [plasma-auto-tiler-insert-right]="419430420"
  [plasma-auto-tiler-insert-left]="419430418"
  [plasma-auto-tiler-insert-up]="419430419"
  [plasma-auto-tiler-insert-down]="419430421"
  [plasma-auto-tiler-focus-left]="268435528"
  [plasma-auto-tiler-focus-down]="268435530"
  [plasma-auto-tiler-focus-up]="268435531"
  [plasma-auto-tiler-focus-right]="268435532"
  [plasma-auto-tiler-focus-left-arrow]="285212690"
  [plasma-auto-tiler-focus-down-arrow]="285212693"
  [plasma-auto-tiler-focus-up-arrow]="285212691"
  [plasma-auto-tiler-focus-right-arrow]="285212692"
  [plasma-auto-tiler-move-left]="301989960"
  [plasma-auto-tiler-move-down]="301989962"
  [plasma-auto-tiler-move-up]="301989963"
  [plasma-auto-tiler-move-right]="301989964"
  [plasma-auto-tiler-move-left-arrow]="318767122"
  [plasma-auto-tiler-move-down-arrow]="318767125"
  [plasma-auto-tiler-move-up-arrow]="318767123"
  [plasma-auto-tiler-move-right-arrow]="318767124"
  [plasma-auto-tiler-detach]="301989920"
  [plasma-auto-tiler-attach]="436207648"
  [plasma-auto-tiler-fill-scope]="419430404"
  [plasma-auto-tiler-apply-columns]="402653233"
  [plasma-auto-tiler-apply-rows]="402653234"
  [plasma-auto-tiler-apply-balanced-grid]="402653235"
  [plasma-auto-tiler-apply-dwindle]="402653236"
)

# KGlobalAccelD::SetShortcutFlag values (pinned kglobalacceld 6.7.3 source):
# SetPresent=2, NoAutoloading=4, IsDefault=8. A user-style active assignment
# on an existing record forces the change with SetPresent|NoAutoloading = 6.
KG_SET_SHORTCUT_FLAGS=6

# Strict JSON envelope predicates (jq).
isloaded_valid='((keys | sort) == ["data","type"]) and (.type == "b") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "boolean")'
load_valid='((keys | sort) == ["data","type"]) and (.type == "i") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] >= 0) and (.data[0] <= 2147483647))'
script_iface_valid='type == "array" and any(.[]; ((.type == "interface") and (.name == "org.kde.kwin.Script")))'
unload_valid="$isloaded_valid"
ownership_valid='((keys | sort) == ["build","kind","nonce","pid","plugin","script_id","start_identity"]) and (.kind == $kind) and (.nonce | type) == "string" and (.nonce | test("^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$")) and (.build | type) == "string" and (.build | test($build_pattern)) and (.plugin | type) == "string" and (.plugin | test("^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$")) and (.script_id | type) == "number" and (.script_id | floor) == .script_id and (.script_id >= 0) and (.script_id <= 2147483647) and (.pid | type) == "number" and (.pid | floor) == .pid and (.pid > 0) and (.start_identity | type) == "string" and (.start_identity | test("^[1-9][0-9]*$"))'
components_valid='((keys | sort) == ["data","type"]) and (.type == "ao") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "array") and (all(.data[0][]; (. | type) == "string"))'
shortcut_infos_valid='((keys | sort) == ["data","type"]) and (.type == "a(ssssssaiai)") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "array") and (all(.data[0][]; ((. | length) == 8) and ((.[0] | type) == "string") and ((.[1] | type) == "string") and ((.[2] | type) == "string") and ((.[3] | type) == "string") and ((.[4] | type) == "string") and ((.[5] | type) == "string") and ((.[6] | type) == "array") and (all(.[6][]; (. | type) == "number")) and ((.[7] | type) == "array") and (all(.[7][]; (. | type) == "number"))))'
dbus_string_valid='((keys | sort) == ["data","type"]) and (.type == "s") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "string") and ((.data[0] | length) > 0)'
dbus_uint_valid='((keys | sort) == ["data","type"]) and (.type == "u") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] | tostring | test("^(0|[1-9][0-9]*)$"))) and (.data[0] >= 0) and (.data[0] <= 4294967295)'
dbus_pid_valid='((keys | sort) == ["data","type"]) and (.type == "u") and ((.data | type) == "array") and ((.data | length) == 1) and ((.data[0] | type) == "number") and ((.data[0] | floor) == .data[0]) and ((.data[0] | tostring | test("^[1-9][0-9]*$"))) and (.data[0] > 0) and (.data[0] <= 4294967295)'
desktops_valid='((keys | sort) == ["data","type"]) and (.type == "a(uss)") and ((.data | type) == "array") and (all(.data[]; ((. | type) == "array") and ((. | length) == 3) and ((.[0] | type) == "number") and ((.[0] | floor) == .[0]) and (.[0] >= 0) and ((.[1] | type) == "string") and ((.[1] | length) > 0) and ((.[2] | type) == "string") and ((.[2] | length) > 0))) and ((.data | map(.[0])) as $positions | ($positions | unique | length) == ($positions | length)) and ((.data | map(.[1])) as $ids | ($ids | unique | length) == ($ids | length))'
# Slurp-mode predicates (jq -s) over journalctl JSON-lines output.
journal_lines_valid='all(.[]; type == "object")'
readiness_valid='[.[] | select((.MESSAGE? | type) == "string") | .MESSAGE] as $messages | ($messages | index("plasma-auto-tiler:shortcut-registered")) as $registered | ($messages | index("plasma-auto-tiler:startup-handlers-ready")) as $ready | ($messages | any(startswith("plasma-auto-tiler:disabled:"))) as $disabled | ($registered != null and $ready != null and $registered < $ready and ($disabled | not))'
readiness_evidence_valid='[.[] | select((.MESSAGE? | type) == "string") | .MESSAGE] as $messages | (($messages | any(. == "plasma-auto-tiler:shortcut-registered")) and ($messages | any(. == "plasma-auto-tiler:startup-handlers-ready")))'
provenance_ready_valid='any(.[]; ((._PID? // "") == $pid) and ((.MESSAGE? | type) == "string") and .MESSAGE == $message)'
controller_ready_valid="$provenance_ready_valid"
disabled_seen_valid='[.[] | select((.MESSAGE? | type) == "string") | .MESSAGE] | any(startswith("plasma-auto-tiler:disabled:"))'
# Slurp-mode diagnostics summary over journalctl JSON-lines (already validated
# as objects). Keeps only records whose _PID equals the current KWin pid,
# extracts the ordered project messages, and locates the ordered
# controller-startup tokens. Output is one JSON object with matching-record
# presence, messages, and the final indexes of each startup/disabled token.
diagnostics_summary='(map(select(((._PID? // "") == $pid) and ((.MESSAGE? | type) == "string"))) | map(.MESSAGE) | map(select(startswith("plasma-auto-tiler:")))) as $messages | {kept: (map(select((._PID? // "") == $pid)) | length), messages: $messages, lastShortcut: (($messages | indices("plasma-auto-tiler:shortcut-registered")) | .[-1]?), lastReady: (($messages | indices("plasma-auto-tiler:startup-handlers-ready")) | .[-1]?), lastDisabledStart: (($messages | to_entries | map(select(.value == "plasma-auto-tiler:disabled:shortcut-registration-failed")) | .[-1]?.key)), lastDisabledAny: (($messages | to_entries | map(select(.value | startswith("plasma-auto-tiler:disabled:"))) | .[-1]?.key))}'
# Classifies the ordered project messages of one epoch window (from $start)
# into exact proof tokens: -invoked (callback delivery), -rejected:/-failed:
# (callback reached a rejecting/failing guard), and success tokens (preset
# applied, completed, armed, managed, or a no-op reflow).
diagnostics_classify='def isinvoked: test("^plasma-auto-tiler:(keyboard|focus|move|detach|attach|fill)-invoked$") or startswith("plasma-auto-tiler:preset-invoked:"); def isrejected: contains("-rejected:") or contains("-failed:"); def issuccess: startswith("plasma-auto-tiler:preset-applied:") or test("^plasma-auto-tiler:(keyboard|move|detach|attach|reflow|fill)-completed$") or . == "plasma-auto-tiler:automatic-placement-managed" or . == "plasma-auto-tiler:keyboard-armed" or . == "plasma-auto-tiler:reflow-noop" or . == "plasma-auto-tiler:reflow-no-capacity"; {epoch: .messages[$start:], invoked: [.messages[$start:][] | select(isinvoked)], rejected: [.messages[$start:][] | select(isrejected)], success: [.messages[$start:][] | select(issuccess)]}'

# Current-attempt (after-cursor, same-KWin-PID) failure-report extraction
# predicates over slurped journalctl JSON-lines. The disabled reasons and
# shortcut-register-failed reasons are reported exactly; kwin_scripting
# warnings/errors are reported separately from the project diagnostics.
start_attempt_project='[.[] | select((._PID? // "") == $pid) | select((.MESSAGE? | type) == "string") | .MESSAGE | select(startswith("plasma-auto-tiler:"))]'
start_attempt_disabled='[.[] | select((._PID? // "") == $pid) | select((.MESSAGE? | type) == "string") | .MESSAGE | select(startswith("plasma-auto-tiler:disabled:"))]'
start_attempt_register_failed='[.[] | select((._PID? // "") == $pid) | select((.MESSAGE? | type) == "string") | .MESSAGE | select(startswith("plasma-auto-tiler:shortcut-register-failed:"))]'
start_attempt_kwin_scripting='[.[] | select((._PID? // "") == $pid) | select((((.QT_CATEGORY? // "") == "kwin_scripting") or ((.SYSLOG_IDENTIFIER? // "") == "kwin_scripting"))) | select((.MESSAGE? | type) == "string") | .MESSAGE]'

# Bounded deterministic readiness wait: fixed attempt count and fixed delay.
READINESS_ATTEMPTS=30
READINESS_DELAY=0.1

usage() {
  cat <<'EOF'
usage: start-test.sh <command> [--help]

Manual lifecycle interface for the plasma-auto-tiler-kwin KWin script.

Commands:
  start    build the kwin bundle, load and run plasma-auto-tiler through
            KWin's /Scripting D-Bus interface, and confirm controller
            readiness from ordered diagnostics bound to the captured KWin PID/start identity
  status   report the exact plugin load state, controller readiness
           evidence, and persisted KGlobalAccel action records
  stop <script-id>
            unload only the exact controller script ID returned by start and
            report any persisted action records
  diagnostics
            report the latest KWin-PID/start-identity-bound controller-startup epoch's
           ordered project diagnostics, labeled current or historical by
           the current load state; read-only, never mutates
  desktops
           read the exact VirtualDesktopManager desktops envelope through
           busctl and report the strictly decoded position/id/name rows;
           read-only, never mutates
  reconcile-shortcuts
           report persisted project shortcut records whose active
           sequence differs from the source-default expected sequence;
           read-only, never mutates
  reconcile-shortcuts --apply
            write the expected active sequence to each mismatched project
            record through org.kde.KGlobalAccel.setShortcutKeys, but only
            after a read-only preflight proves the exact setter contract,
            target ownership, and absence of unrelated conflicts

  provenance <nonce>
            build and load the inert checkout carrier under a fresh unguessable
            plugin identity, run only its exact returned Script<ID>, and
            require its plugin/nonce/build diagnostic from the captured full
            KWin identity. This never loads the controller
  provenance-stop <script-id>
             stop and unload only the exact provenance script ID retained from
             provenance, then verify that the carrier is not loaded
  snapshot-shortcuts
            print the exact project-owned KGlobalAccel tuples as JSON;
            read-only, never mutates
  snapshot-kglobalaccel
            print the exact current KGlobalAccel service owner identity;
            read-only, never mutates

  --help   show this help and exit

start mutates live KWin state and still requires explicit authorization.
start never mutates shortcut records; only reconcile-shortcuts --apply does.
  stop <script-id> requires the nonce-owned receipt created by start and does
  not roll back Custom Tile changes the script already made.
  start without CONTROLLER_OWNERSHIP_FILE creates a private random receipt and
  prints its exact stop command.
KGlobalAccel records persist after unload and do not prove live callbacks.
status, diagnostics, desktops, and reconcile-shortcuts are read-only.
EOF
}

require_tools() {
  local tool
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "error: required tool '$tool' not found in PATH" >&2
      exit 1
    fi
  done
}

strict_json_matches() {
  local predicate="$1" value="$2"
  jq -s -e "length == 1 and (.[0] | $predicate)" <<<"$value" >/dev/null 2>&1
}

read_plugin_id() {
  PLUGIN_ID="$(jq -r '.KPlugin.Id' "$META")" || {
    echo "error: could not read KPlugin.Id from $META" >&2
    exit 1
  }
  if [[ -z "$PLUGIN_ID" || "$PLUGIN_ID" == "null" ]]; then
    echo "error: missing KPlugin.Id in $META" >&2
    exit 1
  fi
  if [[ "$PLUGIN_ID" != "plasma-auto-tiler-kwin" ]]; then
    echo "error: refusing to operate on unexpected plugin id '$PLUGIN_ID' (expected plasma-auto-tiler-kwin)" >&2
    exit 1
  fi
}

safe_output_path() {
  local path="$1" parent current component
  [[ "$path" == /* && "$path" != *'//'* && "$path" != *'/../'* && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  parent="${path%/*}"
  [[ -n "$parent" ]] || parent=/
  current=/
  IFS=/ read -r -a components <<<"${parent#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ -d "$current" && ! -L "$current" ]] || return 1
  done
  [[ ! -L "$path" ]]
}

ownership_json() {
  local kind="$1" nonce="$2" build="$3" plugin="$4" script_id="$5"
  jq -cn --arg kind "$kind" --arg nonce "$nonce" --arg build "$build" \
    --arg plugin "$plugin" --arg script_id "$script_id" --arg pid "$KWIN_PID" \
    --arg start "$KWIN_START_IDENTITY" \
    '{kind:$kind,nonce:$nonce,build:$build,plugin:$plugin,script_id:($script_id|tonumber),pid:($pid|tonumber),start_identity:$start}'
}

write_ownership() {
  local file="$1" kind="$2" nonce="$3" build="$4" plugin="$5" script_id="$6" tmp
  [[ -n "$file" ]] || return 0
  safe_output_path "$file" || return 1
  [[ ! -e "$file" && ! -L "$file" ]] || return 1
  tmp="$(mktemp "${file%/*}/.ownership.XXXXXX")" || return 1
  safe_output_path "$tmp" || { remove_owned_file "$tmp" || true; return 1; }
  ownership_json "$kind" "$nonce" "$build" "$plugin" "$script_id" > "$tmp" \
    && safe_output_path "$file" \
    && mv -n -- "$tmp" "$file" || { remove_owned_file "$tmp" || true; return 1; }
  safe_output_path "$file" || return 1
  [[ ! -e "$tmp" && -f "$file" && ! -L "$file" ]] || { remove_owned_file "$tmp" || true; return 1; }
  OWNED_RECEIPT="$(<"$file")"
}

ensure_controller_receipt() {
  [[ -z "$CONTROLLER_OWNERSHIP_FILE" ]] || return 0
  local runtime_dir="${XDG_RUNTIME_DIR:-/tmp}"
  safe_output_path "$runtime_dir/.plasma-auto-tiler-controller-receipt" || return 1
  local receipt_dir
  receipt_dir="$(mktemp -d -- "$runtime_dir/plasma-auto-tiler-controller.XXXXXX")" || return 1
  chmod 700 "$receipt_dir" || { rmdir -- "$receipt_dir"; return 1; }
  CONTROLLER_OWNERSHIP_FILE="$receipt_dir/ownership"
}

ensure_provenance_receipt() {
  if [[ -n "$PROVENANCE_OWNERSHIP_FILE" ]]; then
    validate_provenance_receipt_target
    return
  fi
  local runtime_dir="${XDG_RUNTIME_DIR:-/tmp}"
  safe_output_path "$runtime_dir/.plasma-auto-tiler-provenance-receipt" || return 1
  local receipt_dir
  receipt_dir="$(mktemp -d -- "$runtime_dir/plasma-auto-tiler-provenance.XXXXXX")" || return 1
  chmod 700 "$receipt_dir" || { rmdir -- "$receipt_dir"; return 1; }
  PROVENANCE_OWNERSHIP_FILE="$receipt_dir/ownership"
}

validate_controller_receipt_target() {
  [[ -n "$CONTROLLER_OWNERSHIP_FILE" ]] || return 0
  safe_output_path "$CONTROLLER_OWNERSHIP_FILE" || return 1
  [[ ! -e "$CONTROLLER_OWNERSHIP_FILE" && ! -L "$CONTROLLER_OWNERSHIP_FILE" ]]
}

validate_provenance_receipt_target() {
  [[ -n "$PROVENANCE_OWNERSHIP_FILE" ]] || return 0
  safe_output_path "$PROVENANCE_OWNERSHIP_FILE" || return 1
  [[ ! -e "$PROVENANCE_OWNERSHIP_FILE" && ! -L "$PROVENANCE_OWNERSHIP_FILE" ]]
}

remove_owned_file() {
  local file="$1" expected="${2:-}" parent name identity inode
  safe_output_path "$file" || return 1
  [[ -f "$file" && ! -L "$file" ]] || return 0
  if [[ -n "$expected" && "$(<"$file")" != "$expected" ]]; then
    return 1
  fi
  identity="$(stat -c '%d:%i' -- "$file")" || return 1
  inode="${identity#*:}"
  parent="${file%/*}"
  name="${file##*/}"
  safe_output_path "$file" || return 1
  [[ "$(stat -c '%d:%i' -- "$file")" == "$identity" ]] || return 1
  find -P -- "$parent" -xdev -maxdepth 1 -type f -name "$name" -inum "$inode" -delete || return 1
  [[ ! -e "$file" && ! -L "$file" ]]
}

remove_ownership() {
  [[ -n "$1" ]] || return 0
  remove_owned_file "$@"
}

load_ownership() {
  local file="$1" kind="$2" expected_id="$3" expected_plugin="$4" value
  [[ -n "$file" && -f "$file" && ! -L "$file" ]] || return 1
  value="$(<"$file")" || return 1
  local build_pattern='^controller-v1-[0-9a-f]{64}$'
  [[ "$kind" == provenance ]] && build_pattern='^checkout-carrier-v1-[0-9a-f]{64}$'
  jq -s -e --arg kind "$kind" --arg build_pattern "$build_pattern" "length == 1 and (.[0] | $ownership_valid)" <<<"$value" >/dev/null 2>&1 || return 1
  jq -s -e --argjson expected_id "$expected_id" 'length == 1 and (.[0].script_id == $expected_id)' <<<"$value" >/dev/null 2>&1 || return 1
  [[ -z "$expected_plugin" || "$(jq -r '.plugin' <<<"$value")" == "$expected_plugin" ]] || return 1
  KWIN_PID="$(jq -r '.pid' <<<"$value")"
  KWIN_START_IDENTITY="$(jq -r '.start_identity' <<<"$value")"
  KWIN_PREOP_PID="$KWIN_PID"
  KWIN_PREOP_START_IDENTITY="$KWIN_START_IDENTITY"
  KWIN_IDENTITY_MISMATCH=0
  OWNED_RECEIPT="$value"
  OWNED_NONCE="$(jq -r '.nonce' <<<"$value")"
  OWNED_BUILD="$(jq -r '.build' <<<"$value")"
  if [[ "$kind" == provenance ]]; then
    PROVENANCE_PLUGIN_ID="$(jq -r '.plugin' <<<"$value")"
  fi
  printf '%s\n' "$value"
}

capture_kwin_identity() {
  [[ "$KWIN_PID" =~ ^[1-9][0-9]*$ ]] || return 1
  local stat_line stat_pid rest
  local -a fields=()
  stat_line="$(<"$PROC_ROOT/$KWIN_PID/stat")" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  stat_pid="${stat_line%% *}"
  [[ "$stat_pid" == "$KWIN_PID" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  read -r -a fields <<<"$rest"
  [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  KWIN_START_IDENTITY="${fields[19]}"
}

kwin_identity_unchanged() {
  local expected_pid="${KWIN_PREOP_PID:-$KWIN_PID}" expected_start="${KWIN_PREOP_START_IDENTITY:-$KWIN_START_IDENTITY}"
  local current_pid
  current_pid="$(find_kwin_pid 2>/dev/null || true)"
  [[ "$current_pid" == "$expected_pid" ]] || return 1
  local current_start
  KWIN_PID="$current_pid"
  capture_kwin_identity || return 1
  current_start="$KWIN_START_IDENTITY"
  KWIN_PID="$expected_pid"
  KWIN_START_IDENTITY="$expected_start"
  if [[ "$current_start" != "$expected_start" ]]; then
    KWIN_IDENTITY_MISMATCH=1
    return 1
  fi
}

verify_exact_script() {
  local id="$1" plugin="$2" introspect loaded
  [[ "$id" =~ ^[0-9]+$ && "$id" -le 2147483647 ]] || return 1
  local receipt_file receipt_kind receipt
  if [[ "$plugin" == "$PROVENANCE_PLUGIN_ID" ]]; then
    receipt_file="$PROVENANCE_OWNERSHIP_FILE"
    receipt_kind=provenance
  else
    receipt_file="$CONTROLLER_OWNERSHIP_FILE"
    receipt_kind=controller
  fi
  [[ -n "$receipt_file" && -f "$receipt_file" && ! -L "$receipt_file" ]] || return 1
  receipt="$(load_ownership "$receipt_file" "$receipt_kind" "$id" "$plugin")" || return 1
  [[ "$receipt" == "$OWNED_RECEIPT" ]] || return 1
  kwin_identity_unchanged || return 1
  introspect="$(busctl $BUS_SCOPE --json=short introspect "$BUS_DEST" "/Scripting/Script$id" 2>/dev/null)" || return 1
  strict_json_matches "$script_iface_valid" "$introspect" || return 1
  if [[ "$plugin" == "$PROVENANCE_PLUGIN_ID" ]]; then
    loaded="$(provenance_loaded_word 2>/dev/null || true)"
  else
    loaded="$(plugin_loaded_word 2>/dev/null || true)"
  fi
  [[ "$loaded" == loaded ]] || return 1
  kwin_identity_unchanged || return 1
}

kwin_identity_matches_receipt() {
  local receipt="$1" expected_pid expected_start current_pid current_start
  expected_pid="$(jq -r '.pid' <<<"$receipt")" || return 1
  expected_start="$(jq -r '.start_identity' <<<"$receipt")" || return 1
  [[ "$expected_pid" =~ ^[1-9][0-9]*$ && "$expected_start" =~ ^[1-9][0-9]*$ ]] || return 1
  current_pid="$(find_kwin_pid 2>/dev/null || true)"
  [[ "$current_pid" == "$expected_pid" ]] || return 1
  local previous_pid="$KWIN_PID" previous_start="$KWIN_START_IDENTITY"
  KWIN_PID="$current_pid"
  if ! capture_kwin_identity; then
    KWIN_PID="$previous_pid"
    KWIN_START_IDENTITY="$previous_start"
    return 1
  fi
  current_start="$KWIN_START_IDENTITY"
  KWIN_PID="$previous_pid"
  KWIN_START_IDENTITY="$previous_start"
  if [[ "$current_start" != "$expected_start" ]]; then
    KWIN_IDENTITY_MISMATCH=1
    return 1
  fi
}

exact_cleanup() {
  local id="$1" plugin="$2" rc=0 out after receipt="${OWNED_RECEIPT:-}"
  EXACT_CLEANUP_AFTER=""
  verify_exact_script "$id" "$plugin" || return 1
  # Unloading the carrier destroys its Script<ID> object. Calling stop first
  # therefore makes unloadScript report false for the exact carrier.
  if [[ "$plugin" != "$PROVENANCE_PLUGIN_ID" ]]; then
    busctl $BUS_SCOPE call "$BUS_DEST" "/Scripting/Script$id" $BUS_SCRIPT_IFACE stop >/dev/null 2>&1 || rc=1
  fi
  out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE unloadScript s "$plugin" 2>/dev/null)" || rc=1
  if ! strict_json_matches "$unload_valid" "$out"; then
    echo "error: unloadScript reply was malformed; teardown remains unverified" >&2
    rc=1
  elif [[ "$(jq -r '.data[0]' <<<"$out")" != true ]]; then
    echo "error: unloadScript returned false; teardown remains unverified" >&2
    rc=1
  fi
  # A malformed/false unload reply is not success by itself. Only the strict
  # postcondition can turn it into verified teardown.
  if [[ "$plugin" == "$PROVENANCE_PLUGIN_ID" ]]; then
    after="$(provenance_loaded_word 2>/dev/null || true)"
  else
    after="$(plugin_loaded_word 2>/dev/null || true)"
  fi
  EXACT_CLEANUP_AFTER="$after"
  [[ "$after" == not-loaded ]] || rc=1
  if [[ "$rc" -eq 0 ]] && ! kwin_identity_matches_receipt "$receipt"; then
    echo "error: KWin PID/start identity after unloadScript did not match the immutable ownership receipt; teardown remains unverified" >&2
    rc=1
  fi
  return "$rc"
}

# Exact idempotent stop/unload of a directly loaded script. No script ID means
# no teardown: the public API cannot safely identify a partially loaded script.
cleanup_loaded() {
  [[ -n "$SCRIPT_ID" ]] || return 1
  if exact_cleanup "$SCRIPT_ID" "$PLUGIN_ID"; then
    remove_ownership "$CONTROLLER_OWNERSHIP_FILE" "$OWNED_RECEIPT"
  else
    return 1
  fi
}

cleanup_provenance_loaded() {
  [[ -n "$PROVENANCE_SCRIPT_ID" ]] || return 1
  exact_cleanup "$PROVENANCE_SCRIPT_ID" "$PROVENANCE_PLUGIN_ID"
}

provenance_failure() {
  local msg="$1" cleanup_state=unverified loaded_after=""
  if [[ -n "$PROVENANCE_SCRIPT_ID" && "$KWIN_IDENTITY_MISMATCH" -eq 0 ]]; then
    write_ownership "$PROVENANCE_OWNERSHIP_FILE" provenance "$nonce" "$build_id" "$PROVENANCE_PLUGIN_ID" "$PROVENANCE_SCRIPT_ID" || true
  fi
  if [[ -n "$PROVENANCE_SCRIPT_ID" && "$KWIN_IDENTITY_MISMATCH" -eq 0 ]] && cleanup_provenance_loaded; then
    loaded_after="$EXACT_CLEANUP_AFTER"
    if remove_ownership "$PROVENANCE_OWNERSHIP_FILE" "$OWNED_RECEIPT"; then
      cleanup_state=verified
    fi
  fi
  printf 'provenance: partial nonce=%s build=%s pid=%s script-id=%s plugin=%s cleanup=%s' \
    "$nonce" "$build_id" "$KWIN_PID" "$PROVENANCE_SCRIPT_ID" "$PROVENANCE_PLUGIN_ID" "$cleanup_state"
  [[ -n "$loaded_after" ]] && printf ' loaded-after=%s' "$loaded_after"
  printf '\n'
  echo "error: $msg" >&2
  remove_provenance_temp
  exit 1
}

provenance_unverified_failure() {
  local msg="$1"
  printf 'provenance: partial nonce=%s build=%s pid=%s script-id=%s plugin=%s cleanup=unverified\n' \
    "$nonce" "$build_id" "$KWIN_PID" "${PROVENANCE_SCRIPT_ID:-unknown}" "$PROVENANCE_PLUGIN_ID"
  echo "error: $msg" >&2
  remove_provenance_temp
  exit 1
}

remove_provenance_temp() {
  if [[ -n "$PROVENANCE_TMP_DIR" && -d "$PROVENANCE_TMP_DIR" && ! -L "$PROVENANCE_TMP_DIR" ]]; then
    rm -f -- "$PROVENANCE_TMP_DIR/main.js"
    rm -f -- "$PROVENANCE_TMP_DIR/main.js.tmp"
    rm -f -- "$PROVENANCE_TMP_DIR/load-reply"
    rmdir -- "$PROVENANCE_TMP_DIR" 2>/dev/null || true
  fi
}

signal_during_provenance() {
  local sig="$1" cleanup_state=unverified
  trap '' INT TERM
  if [[ -n "$PROVENANCE_SCRIPT_ID" ]] && cleanup_provenance_loaded && remove_ownership "$PROVENANCE_OWNERSHIP_FILE" "$OWNED_RECEIPT"; then
    cleanup_state=verified
  fi
  printf 'provenance: partial nonce=%s build=%s pid=%s script-id=%s plugin=%s cleanup=%s\n' \
    "$nonce" "$build_id" "$KWIN_PID" "${PROVENANCE_SCRIPT_ID:-unknown}" "$PROVENANCE_PLUGIN_ID" "$cleanup_state" >&2
  remove_provenance_temp
  trap - INT TERM
  kill -"$sig" "$$"
}

defer_provenance_signal() {
  PROVENANCE_SIGNAL_PENDING="$1"
}

restore_provenance_traps() {
  trap 'signal_during_provenance INT' INT
  trap 'signal_during_provenance TERM' TERM
}

cleanup_after_load() {
  local msg="$1"
  local cleanup_state=unverified
  if cleanup_loaded; then cleanup_state=verified; fi
  printf 'start: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$cleanup_state"
  [[ -n "${EVIDENCE_FILE:-}" ]] && rm -f "$EVIDENCE_FILE"
  echo "error: $msg" >&2
  echo "note: exact controller teardown was $cleanup_state; no plugin-name fallback was attempted" >&2
  exit 1
}

# Reports the retained attempt-owned after-cursor same-KWin-PID evidence for a
# failed start: the raw project messages, the exact disabled:* and
# shortcut-register-failed:* reasons, and separate kwin_scripting
# warnings/errors. Reads from the attempt-owned evidence file, scopes strictly
# to the current attempt (never the historical pre-cursor epoch), and prints no
# window caption or payload.
report_start_failure() {
  local pid="$1"
  echo "controller diagnostics (current attempt, after-cursor, same-KWin-PID):" >&2
  jq -s -r --arg pid "$pid" "$start_attempt_project | .[]" "$EVIDENCE_FILE" 2>/dev/null | sed 's/^/  /' >&2 || true
  echo "disabled reasons (current attempt):" >&2
  jq -s -r --arg pid "$pid" "$start_attempt_disabled | .[]" "$EVIDENCE_FILE" 2>/dev/null | sed 's/^/  /' >&2 || true
  echo "shortcut-register-failed reasons (current attempt):" >&2
  jq -s -r --arg pid "$pid" "$start_attempt_register_failed | .[]" "$EVIDENCE_FILE" 2>/dev/null | sed 's/^/  /' >&2 || true
  echo "kwin_scripting warnings/errors (current attempt):" >&2
  jq -s -r --arg pid "$pid" "$start_attempt_kwin_scripting | .[]" "$EVIDENCE_FILE" 2>/dev/null | sed 's/^/  /' >&2 || true
}

# Readiness failure: report the retained evidence, perform the exact idempotent
# cleanup, then report the same retained evidence again before removing it.
fail_start_readiness() {
  local msg="$1"
  report_start_failure "$KWIN_PID"
  local cleanup_state=unverified
  if cleanup_loaded; then cleanup_state=verified; fi
  printf 'start: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$cleanup_state"
  echo "error: $msg" >&2
  echo "note: exact controller teardown was $cleanup_state; no plugin-name fallback was attempted" >&2
  report_start_failure "$KWIN_PID"
  rm -f "$EVIDENCE_FILE"
  exit 1
}

# A signal during start leaves the attempt-owned evidence temp file
# un-reported and the start outcome unknown. Remove the temp file so it does
# not leak in /tmp and no historical or partial diagnostics are ever
# presented as current, then re-raise the signal. No supervisor is added;
# the runner owns interruption reporting and cleanup.
signal_during_start() {
  local sig="$1"
  local cleanup_state=unverified
  if [[ -n "$SCRIPT_ID" ]] && cleanup_loaded; then cleanup_state=verified; fi
  printf 'start: partial script-id=%s cleanup=%s\n' "${SCRIPT_ID:-unknown}" "$cleanup_state" >&2
  [[ -n "${EVIDENCE_FILE:-}" ]] && rm -f "$EVIDENCE_FILE"
  trap - INT TERM
  kill -"$sig" "$$"
}

find_kwin_pid() {
  local owner_out owner pid_out pid
  owner_out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$BUS_DEST")" || return 1
  strict_json_matches "$dbus_string_valid" "$owner_out" || return 1
  owner="$(jq -r '.data[0]' <<<"$owner_out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || return 1
  pid_out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner")" || return 1
  strict_json_matches "$dbus_uint_valid" "$pid_out" || return 1
  pid="$(jq -r '.data[0]' <<<"$pid_out")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$pid"
}

# Prints "loaded" or "not-loaded"; fails the script on transport or shape errors.
plugin_loaded_word() {
  local out
  out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$PLUGIN_ID")" || {
    echo "error: isScriptLoaded call failed: $out" >&2
    exit 1
  }
  if ! strict_json_matches "$isloaded_valid" "$out"; then
    echo "error: unexpected isScriptLoaded reply: $out" >&2
    exit 1
  fi
  if [[ "$(jq -r '.data[0]' <<<"$out")" == "true" ]]; then
    printf 'loaded\n'
  else
    printf 'not-loaded\n'
  fi
}

ensure_actions_json() {
  if [[ -z "$PROJECT_ACTIONS_JSON" ]]; then
    PROJECT_ACTIONS_JSON="$(printf '%s\n' "${PROJECT_ACTIONS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
  fi
}

# Prints one TSV line per persisted project action record:
# component<TAB>action<TAB>label<TAB>active<TAB>default.
# Fail-closed: malformed envelopes are an error, never zero matches.
collect_project_action_records() {
  local comps comp infos
  ensure_actions_json
  comps="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$KG_PATH" "$KG_IFACE" allComponents)" || {
    echo "error: KGlobalAccel allComponents call failed: $comps" >&2
    return 1
  }
  if ! strict_json_matches "$components_valid" "$comps"; then
    echo "error: unexpected allComponents reply: $comps" >&2
    return 1
  fi
  while IFS= read -r comp; do
    infos="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$comp" "$KG_COMP_IFACE" allShortcutInfos s default)" || {
      echo "error: allShortcutInfos call failed for $comp: $infos" >&2
      return 1
    }
    if ! strict_json_matches "$shortcut_infos_valid" "$infos"; then
      echo "error: unexpected allShortcutInfos reply for $comp" >&2
      return 1
    fi
    jq -r --argjson actions "$PROJECT_ACTIONS_JSON" \
      '.data[0][] | select((.[0] as $id | $actions | index($id)) != null) | [.[2], .[0], .[1], (.[6] | join(",")), (.[7] | join(","))] | @tsv' \
      <<<"$infos" || {
      echo "error: could not filter project action records for $comp" >&2
      return 1
    }
  done < <(jq -r '.data[0][]' <<<"$comps")
}

collect_project_action_tuples() {
  local comps comp infos rows tuples='[]'
  ensure_actions_json
  comps="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$KG_PATH" "$KG_IFACE" allComponents)" || {
    echo "error: KGlobalAccel allComponents call failed: $comps" >&2
    return 1
  }
  if ! strict_json_matches "$components_valid" "$comps"; then
    echo "error: unexpected allComponents reply: $comps" >&2
    return 1
  fi
  while IFS= read -r comp; do
    infos="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$comp" "$KG_COMP_IFACE" allShortcutInfos s default)" || {
      echo "error: allShortcutInfos call failed for $comp: $infos" >&2
      return 1
    }
    if ! strict_json_matches "$shortcut_infos_valid" "$infos"; then
      echo "error: unexpected allShortcutInfos reply for $comp" >&2
      return 1
    fi
    rows="$(jq -c --argjson actions "$PROJECT_ACTIONS_JSON" '.data[0] | map(select((.[0] as $id | $actions | index($id)) != null))' <<<"$infos")" || return 1
    tuples="$(jq -c --argjson rows "$rows" '. + $rows' <<<"$tuples")" || return 1
  done < <(jq -r '.data[0][]' <<<"$comps")
  printf '%s\n' "$tuples"
}

print_records() {
  local records="$1"
  local comp action label active default
  if [[ -z "$records" ]]; then
    return 0
  fi
  while IFS=$'\t' read -r comp action label active default; do
    printf '  component "%s" action "%s" label "%s" active "%s" default "%s"\n' "$comp" "$action" "$label" "$active" "$default"
  done <<<"$records"
}

count_records() {
  local records="$1"
  printf '%s\n' "$records" | awk 'NF { n++ } END { print n+0 }'
}

report_shortcut_drift() {
  local records="$1"
  local comp action label active default expected
  local -A active_by_action=()
  while IFS=$'\t' read -r comp action label active default; do
    [[ -z "$action" ]] && continue
    active_by_action["$action"]="$active"
  done <<<"$records"

  local matched=0 mismatched=0 missing=0
  for action in "${PROJECT_ACTIONS[@]}"; do
    expected="${EXPECTED_SEQUENCES[$action]}"
    if [[ ! "${active_by_action[$action]+x}" ]]; then
      missing=$((missing + 1))
    elif [[ "${active_by_action[$action]}" == "$expected" ]]; then
      matched=$((matched + 1))
    else
      mismatched=$((mismatched + 1))
      echo "  drift: action \"$action\" active \"${active_by_action[$action]}\" expected \"$expected\""
    fi
  done
  echo "shortcut assignments: matched $matched, drift $mismatched, missing $missing"
  if [[ "$mismatched" -gt 0 || "$missing" -gt 0 ]]; then
    echo "note: persisted shortcut assignments drift from controller source; run '$0 reconcile-shortcuts' to inspect."
  fi
}

provenance_loaded_word() {
  local out
  out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$PROVENANCE_PLUGIN_ID")" || {
    echo "error: provenance isScriptLoaded call failed: $out" >&2
    return 1
  }
  if ! strict_json_matches "$isloaded_valid" "$out"; then
    echo "error: unexpected provenance isScriptLoaded reply: $out" >&2
    return 1
  fi
  if [[ "$(jq -r '.data[0]' <<<"$out")" == true ]]; then
    printf 'loaded\n'
  else
    printf 'not-loaded\n'
  fi
}

cmd_provenance() {
  require_tools npm busctl jq journalctl sha256sum od tr stat
  if [[ $# -ne 1 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$ ]]; then
    echo "error: provenance requires one nonce matching [A-Za-z0-9][A-Za-z0-9._-]{7,63}" >&2
    exit 1
  fi
  local nonce="$1" build_id source_digest is_loaded_out journal_cursor_out random_suffix requested_plugin
  trap 'signal_during_provenance INT' INT
  trap 'signal_during_provenance TERM' TERM
  PROVENANCE_LOAD_ATTEMPTED=0
  source_digest="$(sha256sum "$KWIN_DIR/src/provenance-entry.ts" | awk '{print $1}')" || {
    echo "error: could not calculate provenance source identity" >&2
    exit 1
  }
  [[ "$source_digest" =~ ^[[:xdigit:]]{64}$ ]] || {
    echo "error: provenance source identity is invalid" >&2
    exit 1
  }
  build_id="checkout-carrier-v1-$source_digest"
  requested_plugin="$PROVENANCE_PLUGIN_ID"
  if [[ "${PLASMA_AUTO_TILER_HERMETIC_TEST:-}" == 1 && -n "$requested_plugin" ]]; then
    [[ "$requested_plugin" =~ ^${PROVENANCE_PLUGIN_PREFIX}[[:xdigit:]]{32}$ ]] || {
      echo "error: hermetic provenance plugin identity is invalid" >&2
      exit 1
    }
  else
    random_suffix="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" || {
      echo "error: could not generate an unguessable provenance plugin identity" >&2
      exit 1
    }
    [[ "$random_suffix" =~ ^[[:xdigit:]]{32}$ ]] || {
      echo "error: generated provenance plugin identity is invalid" >&2
      exit 1
    }
    PROVENANCE_PLUGIN_ID="${PROVENANCE_PLUGIN_PREFIX}${random_suffix}"
  fi
  [[ "$PROVENANCE_PLUGIN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || {
    echo "error: provenance plugin identity is invalid" >&2
    exit 1
  }
  safe_output_path "${TMPDIR:-/tmp}/.plasma-auto-tiler-provenance-output" || {
    echo "error: provenance temporary output parent is unsafe" >&2
    exit 1
  }
  ensure_provenance_receipt || {
    echo "error: provenance ownership receipt path is unsafe, already exists, or has an unsafe parent" >&2
    exit 1
  }
  is_loaded_out="$(provenance_loaded_word)" || exit 1
  if [[ "$is_loaded_out" == loaded ]]; then
    echo "error: provenance carrier is already loaded; refusing to load another instance" >&2
    exit 1
  fi
  printf 'provenance-baseline: plugin=%s loaded=%s\n' "$PROVENANCE_PLUGIN_ID" "$is_loaded_out"
  PROVENANCE_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/plasma-auto-tiler-provenance.XXXXXX")" || {
    echo "error: could not create a private provenance output directory" >&2
    exit 1
  }
  chmod 700 "$PROVENANCE_TMP_DIR"
  PROVENANCE_BUNDLE="$PROVENANCE_TMP_DIR/main.js"
  PROVENANCE_NONCE="$nonce" PROVENANCE_BUILD_ID="$build_id" PROVENANCE_PLUGIN_ID="$PROVENANCE_PLUGIN_ID" PROVENANCE_OUTFILE="$PROVENANCE_BUNDLE" npm --prefix "$KWIN_DIR" run build-provenance >/dev/null || {
    remove_provenance_temp
    echo "error: npm run build-provenance failed in $KWIN_DIR" >&2
    exit 1
  }
  [[ -f "$PROVENANCE_BUNDLE" && ! -L "$PROVENANCE_BUNDLE" ]] || {
    remove_provenance_temp
    echo "error: provenance bundle was not created at a private temporary path" >&2
    exit 1
  }
  KWIN_PID="$(find_kwin_pid)" || {
    remove_provenance_temp
    echo "error: could not identify one KWin process for provenance diagnostics" >&2
    exit 1
  }
  capture_kwin_identity || { remove_provenance_temp; echo "error: could not capture KWin PID/start identity" >&2; exit 1; }
  KWIN_PREOP_PID="$KWIN_PID"
  KWIN_PREOP_START_IDENTITY="$KWIN_START_IDENTITY"
  KWIN_IDENTITY_MISMATCH=0
  journal_cursor_out="$(journalctl --user --quiet --show-cursor -n 1)" || {
    remove_provenance_temp
    echo "error: could not capture the pre-provenance journal cursor" >&2
    exit 1
  }
  JOURNAL_CURSOR="${journal_cursor_out##*-- cursor: }"
  if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$journal_cursor_out" ]]; then
    remove_provenance_temp
    echo "error: journal cursor output did not contain an opaque cursor token" >&2
    exit 1
  fi
  local load_out script_obj introspect_out journal_out ready_message load_reply_file load_pid
  PROVENANCE_LOAD_ATTEMPTED=1
  PROVENANCE_SIGNAL_PENDING=""
  trap 'defer_provenance_signal INT' INT
  trap 'defer_provenance_signal TERM' TERM
  local load_rc=0
  load_reply_file="$PROVENANCE_TMP_DIR/load-reply"
  if busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$PROVENANCE_BUNDLE" "$PROVENANCE_PLUGIN_ID" >"$load_reply_file" & then
    load_pid=$!
    if wait "$load_pid"; then load_rc=0; else load_rc=$?; fi
  else
    load_rc=$?
  fi
  if [[ "$load_rc" -ne 0 && -n "$load_pid" ]] && kill -0 "$load_pid" 2>/dev/null; then
    if wait "$load_pid"; then load_rc=0; else load_rc=$?; fi
  fi
  load_out="$(<"$load_reply_file")" || load_out=""
  if [[ "$load_rc" -ne 0 ]]; then
    restore_provenance_traps
    provenance_unverified_failure "provenance loadScript reply was lost${PROVENANCE_SIGNAL_PENDING:+ during $PROVENANCE_SIGNAL_PENDING}; no public API identifies a partially loaded script by exact ID"
  fi
  if ! strict_json_matches "$load_valid" "$load_out"; then
    restore_provenance_traps
    provenance_unverified_failure "provenance loadScript reply is not a strict {\"type\":\"i\",\"data\":[ID]}; exact teardown is unverified"
  fi
  PROVENANCE_SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
  write_ownership "$PROVENANCE_OWNERSHIP_FILE" provenance "$nonce" "$build_id" "$PROVENANCE_PLUGIN_ID" "$PROVENANCE_SCRIPT_ID" || {
    restore_provenance_traps
    provenance_failure "could not atomically retain provenance ownership"
  }
  restore_provenance_traps
  if [[ -n "$PROVENANCE_SIGNAL_PENDING" ]]; then
    signal_during_provenance "$PROVENANCE_SIGNAL_PENDING"
  fi
  kwin_identity_unchanged || provenance_failure "KWin process identity changed immediately after provenance load"
  script_obj="/Scripting/Script$PROVENANCE_SCRIPT_ID"
  introspect_out="$(busctl $BUS_SCOPE --json=short introspect "$BUS_DEST" "$script_obj")" || {
    provenance_failure "provenance introspect failed for $script_obj"
  }
  if ! strict_json_matches "$script_iface_valid" "$introspect_out"; then
    provenance_failure "$script_obj does not expose the org.kde.kwin.Script interface"
  fi
  if [[ "$(provenance_loaded_word)" != loaded ]]; then
    provenance_failure "provenance plugin '$PROVENANCE_PLUGIN_ID' was not reported loaded after exact object introspection"
  fi
  if ! busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
    provenance_failure "provenance run() failed on $script_obj"
  fi
  ready_message="plasma-auto-tiler:provenance-ready:plugin=$PROVENANCE_PLUGIN_ID:nonce=$nonce:build=$build_id"
  journal_out="$(journalctl --user --quiet --no-pager --after-cursor="$JOURNAL_CURSOR" "_PID=$KWIN_PID" -o json)" || {
    provenance_failure "could not read provenance readiness diagnostics"
  }
  if ! jq -s -e --arg pid "$KWIN_PID" --arg message "$ready_message" "$provenance_ready_valid" <<<"$journal_out" >/dev/null 2>&1; then
    provenance_failure "provenance nonce/build diagnostic was not confirmed for current KWin PID"
  fi
  kwin_identity_unchanged || provenance_failure "KWin process identity changed during provenance setup"
  remove_provenance_temp
  trap - INT TERM
  printf 'provenance: ready nonce=%s build=%s pid=%s script-id=%s plugin=%s receipt=%s\n' \
    "$nonce" "$build_id" "$KWIN_PID" "$PROVENANCE_SCRIPT_ID" "$PROVENANCE_PLUGIN_ID" \
    "$(ownership_json provenance "$nonce" "$build_id" "$PROVENANCE_PLUGIN_ID" "$PROVENANCE_SCRIPT_ID")"
  echo "provenance receipt path: $PROVENANCE_OWNERSHIP_FILE"
  printf 'provenance-stop command: PROVENANCE_OWNERSHIP_FILE=%q bash %q provenance-stop %s\n' \
    "$PROVENANCE_OWNERSHIP_FILE" "$0" "$PROVENANCE_SCRIPT_ID"
  echo "note: current public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
}

cmd_provenance_stop() {
  require_tools busctl jq stat
  if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ || "$1" -gt 2147483647 ]]; then
    echo "error: provenance-stop requires one non-negative 32-bit script ID" >&2
    exit 1
  fi
  local script_id="$1" script_obj loaded out
  script_obj="/Scripting/Script$script_id"
  [[ -n "$PROVENANCE_OWNERSHIP_FILE" ]] || {
    echo "error: provenance-stop requires the nonce-owned provenance receipt; refusing stale script teardown" >&2
    exit 1
  }
  load_ownership "$PROVENANCE_OWNERSHIP_FILE" provenance "$script_id" "" >/dev/null || {
    echo "error: provenance ownership receipt does not match script id $script_id; refusing teardown" >&2
    exit 1
  }
  [[ "$PROVENANCE_PLUGIN_ID" =~ ^${PROVENANCE_PLUGIN_PREFIX}[[:xdigit:]]{32}$ ]] || {
    echo "error: provenance ownership receipt has an invalid plugin identity; refusing teardown" >&2
    exit 1
  }
  loaded="$(provenance_loaded_word)" || exit 1
  if [[ "$loaded" == not-loaded ]]; then
    echo "error: provenance carrier is not loaded; refusing to use stale script id $script_id" >&2
    exit 1
  fi
  exact_cleanup "$script_id" "$PROVENANCE_PLUGIN_ID" || {
    echo "error: exact provenance teardown was not verified; refusing to touch another script" >&2
    exit 1
  }
  remove_ownership "$PROVENANCE_OWNERSHIP_FILE" "$OWNED_RECEIPT" || {
    echo "error: provenance ownership receipt cleanup was not verified; refusing to claim teardown complete" >&2
    exit 1
  }
  printf 'provenance-stop: script-id=%s plugin=%s unloaded and verified loaded-after=not-loaded\n' "$script_id" "$PROVENANCE_PLUGIN_ID"
}

cmd_snapshot_shortcuts() {
  require_tools busctl jq stat
  collect_project_action_tuples
}

cmd_snapshot_kglobalaccel() {
  require_tools busctl jq
  local owner pid uid out uid_compact uid_canonical
  out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s "$KG_DEST")" || exit 1
  strict_json_matches "$dbus_string_valid" "$out" || { echo "error: malformed KGlobalAccel service owner reply" >&2; exit 1; }
  owner="$(jq -r '.data[0]' <<<"$out")"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || { echo "error: KGlobalAccel owner is not a unique name" >&2; exit 1; }
  out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$owner")" || exit 1
  strict_json_matches "$dbus_pid_valid" "$out" || { echo "error: malformed KGlobalAccel owner PID reply" >&2; exit 1; }
  pid="$(jq -r '.data[0]' <<<"$out")"
  out="$(busctl $BUS_SCOPE --json=short call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixUser s "$owner")" || exit 1
  strict_json_matches "$dbus_uint_valid" "$out" || { echo "error: malformed KGlobalAccel owner UID reply" >&2; exit 1; }
  uid_compact="${out//[[:space:]]/}"
  uid_canonical="$(jq -c '.' <<<"$out")" || { echo "error: malformed KGlobalAccel owner UID reply" >&2; exit 1; }
  [[ "$uid_compact" == "$uid_canonical" ]] || { echo "error: malformed KGlobalAccel owner UID reply" >&2; exit 1; }
  uid="$(jq -r '.data[0]' <<<"$out")"
  jq -cn --arg owner "$owner" --argjson pid "$pid" --argjson uid "$uid" \
    '{service:"org.kde.kglobalaccel",owner:$owner,pid:$pid,uid:$uid}'
}

cmd_start() {
  require_tools npm busctl jq journalctl sha256sum stat
  read_plugin_id
  safe_output_path "$BUNDLE" || { echo "error: controller bundle path is unsafe" >&2; exit 1; }
  local start_nonce controller_build source_digest
  start_nonce="${START_NONCE:-start-$(date +%Y%m%dT%H%M%S)-$$}"
  [[ "$start_nonce" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$ ]] || {
    echo "error: start nonce is invalid" >&2
    exit 1
  }
  source_digest="$(sha256sum "$KWIN_DIR"/src/*.ts | sha256sum | awk '{print $1}')" || {
    echo "error: could not calculate controller source identity" >&2
    exit 1
  }
  [[ "$source_digest" =~ ^[[:xdigit:]]{64}$ ]] || {
    echo "error: controller source identity is invalid" >&2
    exit 1
  }
  controller_build="controller-v1-$source_digest"

  trap 'signal_during_start INT' INT
  trap 'signal_during_start TERM' TERM

  if ! ( cd "$KWIN_DIR" && CONTROLLER_NONCE="$start_nonce" CONTROLLER_BUILD_ID="$controller_build" CONTROLLER_PLUGIN_ID="$PLUGIN_ID" npm run build-start ); then
    echo "error: npm run build-start failed in $KWIN_DIR" >&2
    exit 1
  fi
  if [[ ! -f "$BUNDLE" ]]; then
    echo "error: bundle not found after build: $BUNDLE" >&2
    exit 1
  fi

  local is_loaded_out
  is_loaded_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE isScriptLoaded s "$PLUGIN_ID")" || {
    echo "error: isScriptLoaded call failed: $is_loaded_out" >&2
    exit 1
  }
  if ! strict_json_matches "$isloaded_valid" "$is_loaded_out"; then
    echo "error: unexpected isScriptLoaded reply: $is_loaded_out" >&2
    exit 1
  fi
  if [[ "$(jq -r '.data[0]' <<<"$is_loaded_out")" == "true" ]]; then
    echo "error: plugin '$PLUGIN_ID' is already loaded; refusing to load again" >&2
    echo "unload it first:" >&2
    echo "  $0 stop" >&2
    exit 1
  fi
  validate_controller_receipt_target || {
    echo "error: controller ownership receipt path is unsafe, already exists, or has an unsafe parent" >&2
    exit 1
  }

  KWIN_PID="$(find_kwin_pid)" || {
    echo "error: could not identify one KWin process for readiness diagnostics" >&2
    exit 1
  }
  capture_kwin_identity || {
    echo "error: could not capture KWin PID/start identity" >&2
    exit 1
  }
  KWIN_PREOP_PID="$KWIN_PID"
  KWIN_PREOP_START_IDENTITY="$KWIN_START_IDENTITY"
  KWIN_IDENTITY_MISMATCH=0

  local journal_cursor_out
  journal_cursor_out="$(journalctl --user --quiet --show-cursor -n 1)" || {
    echo "error: could not capture the pre-load journal cursor" >&2
    exit 1
  }
  JOURNAL_CURSOR="${journal_cursor_out##*-- cursor: }"
  if [[ -z "$JOURNAL_CURSOR" || "$JOURNAL_CURSOR" == "$journal_cursor_out" ]]; then
    echo "error: journal cursor output did not contain an opaque cursor token" >&2
    exit 1
  fi

  local load_out
  load_out="$(busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$BUS_PATH" $BUS_SCRIPTING_IFACE loadScript ss "$BUNDLE" "$PLUGIN_ID")" || {
    cleanup_after_load "loadScript reply was lost; no public API identifies a partially loaded controller by exact ID"
  }
  if ! strict_json_matches "$load_valid" "$load_out"; then
    cleanup_after_load "loadScript reply is not a strict {\"type\":\"i\",\"data\":[ID]}: $load_out"
  fi

  SCRIPT_ID="$(jq -r '.data[0]' <<<"$load_out")"
  kwin_identity_unchanged || cleanup_after_load "KWin process identity changed immediately after controller load"
  CONTROLLER_READY_MESSAGE="plasma-auto-tiler:controller-ready:plugin=$PLUGIN_ID:nonce=$start_nonce:build=$controller_build"
  ensure_controller_receipt || cleanup_after_load "could not create a private controller ownership receipt path"
  write_ownership "$CONTROLLER_OWNERSHIP_FILE" controller "$start_nonce" "$controller_build" "$PLUGIN_ID" "$SCRIPT_ID" || cleanup_after_load "could not atomically retain controller ownership"
  local script_obj="/Scripting/Script$SCRIPT_ID"

  local introspect_out
  introspect_out="$(busctl $BUS_SCOPE --json=short introspect "$BUS_DEST" "$script_obj")" || {
    cleanup_after_load "introspect failed for $script_obj"
  }
  if ! strict_json_matches "$script_iface_valid" "$introspect_out"; then
    cleanup_after_load "$script_obj does not expose the org.kde.kwin.Script interface"
  fi

  if ! busctl $BUS_SCOPE --json=short call "$BUS_DEST" "$script_obj" $BUS_SCRIPT_IFACE run >/dev/null 2>&1; then
    cleanup_after_load "run() failed on $script_obj"
  fi

  # KWin's console output can reach the user journal just after run() returns.
  # Wait for ordered same-KWin-PID readiness diagnostics within a bounded
  # deterministic window. The pre-load cursor prevents old/unrelated messages
  # being accepted, and a disabled diagnostic fails immediately.
  local attempt journal_out
  EVIDENCE_FILE="$(mktemp "${TMPDIR:-/tmp}/plasma-auto-tiler-start.XXXXXX")" || {
    cleanup_after_load "could not create the attempt evidence file"
  }
  for ((attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1)); do
    journal_out="$(journalctl --user --quiet --no-pager --after-cursor="$JOURNAL_CURSOR" "_PID=$KWIN_PID" -o json)" || {
      cleanup_after_load "could not read KWin readiness diagnostics"
    }
    if ! jq -s -e "$journal_lines_valid" <<<"$journal_out" >/dev/null 2>&1; then
      cleanup_after_load "could not parse KWin readiness diagnostics"
    fi
    kwin_identity_unchanged || cleanup_after_load "KWin process identity changed during controller readiness"
    # Retain only the attempt-owned project diagnostics and kwin_scripting
    # messages (never window captions or unrelated records).
    jq -s -c --arg pid "$KWIN_PID" \
      '.[] | select((._PID? // "") == $pid) | select((.MESSAGE? | type) == "string") | select(((.MESSAGE | startswith("plasma-auto-tiler:")) or ((.QT_CATEGORY? // .SYSLOG_IDENTIFIER? // "") == "kwin_scripting")))' \
      <<<"$journal_out" > "$EVIDENCE_FILE" || {
      cleanup_after_load "could not retain KWin readiness evidence"
    }
    if jq -s -e "$readiness_valid" <<<"$journal_out" >/dev/null 2>&1 && \
      jq -s -e --arg pid "$KWIN_PID" --arg message "$CONTROLLER_READY_MESSAGE" "$controller_ready_valid" <<<"$journal_out" >/dev/null 2>&1; then
      rm -f "$EVIDENCE_FILE"
      trap - INT TERM
      echo "started: plugin '$PLUGIN_ID' loaded as script id $SCRIPT_ID; controller readiness confirmed; script-id=$SCRIPT_ID plugin=$PLUGIN_ID nonce=$start_nonce build=$controller_build kwin-pid=$KWIN_PID start-identity=$KWIN_START_IDENTITY receipt=$(ownership_json controller "$start_nonce" "$controller_build" "$PLUGIN_ID" "$SCRIPT_ID")"
      echo
      echo "stop it:"
      printf '  CONTROLLER_OWNERSHIP_FILE=%q bash %q stop %s\n' "$CONTROLLER_OWNERSHIP_FILE" "$0" "$SCRIPT_ID"
      echo
      echo "inspect it:"
      echo "  $0 status"
      echo
      echo "note: current public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
      echo "shortcut assignments: not checked; controller readiness does not prove requested keys are active."
      echo "note: stopping/unloading does not roll back Custom Tile changes the script already made."
      return 0
    fi
    if jq -s -e "$readiness_valid" <<<"$journal_out" >/dev/null 2>&1; then
      fail_start_readiness "controller nonce/build diagnostic was not confirmed for the current KWin PID"
    fi
    if jq -s -e "$disabled_seen_valid" <<<"$journal_out" >/dev/null 2>&1; then
      fail_start_readiness "controller disabled itself during startup"
    fi
    sleep "$READINESS_DELAY" || cleanup_after_load "could not wait for KWin readiness diagnostics"
  done
  fail_start_readiness "controller readiness was not confirmed by KWin diagnostics within the bounded window"
}

cmd_status() {
  require_tools busctl jq journalctl
  read_plugin_id

  local loaded pid journal_out records count identity_bound=0
  loaded="$(plugin_loaded_word)"
  echo "plugin: $PLUGIN_ID"
  echo "loaded: $loaded"
  echo "controller running/callbacks: not proven by loaded state, journal evidence, or KGlobalAccel records"

  pid="$(find_kwin_pid 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    echo "controller readiness diagnostics (captured KWin PID/start identity + journal): unknown/not-ready (no single KWin process identified)"
  else
    KWIN_PID="$pid"
    if ! capture_kwin_identity; then
      echo "controller readiness diagnostics (captured KWin PID/start identity + journal): unknown/not-ready (KWin PID/start identity unavailable)"
    else
      identity_bound=1
      echo "KWin identity: PID/start identity captured"
    fi
    if [[ "$identity_bound" -eq 1 ]]; then
      journal_out="$(journalctl --user --quiet --no-pager "_PID=$pid" -o json)" || {
      echo "error: could not read KWin readiness diagnostics" >&2
      exit 1
      }
      if ! kwin_identity_unchanged; then
        echo "controller readiness diagnostics (captured KWin PID/start identity + journal): unknown/not-ready (KWin PID/start identity changed during journal read)"
      elif [[ -z "$journal_out" ]]; then
        echo "controller readiness diagnostics (captured KWin PID/start identity + journal): not observed"
      elif ! jq -s -e "$journal_lines_valid" <<<"$journal_out" >/dev/null 2>&1; then
        echo "error: could not parse KWin readiness diagnostics" >&2
        exit 1
      elif jq -s -e "$disabled_seen_valid" <<<"$journal_out" >/dev/null 2>&1; then
        echo "controller readiness diagnostics (captured KWin PID/start identity + journal): disabled diagnostic observed"
      elif jq -s -e "$readiness_evidence_valid" <<<"$journal_out" >/dev/null 2>&1; then
        echo "controller readiness diagnostics (captured KWin PID/start identity + journal): observed"
      else
        echo "controller readiness diagnostics (captured KWin PID/start identity + journal): not observed"
      fi
    fi
  fi

  records="$(collect_project_action_records)" || exit 1
  count="$(count_records "$records")"
  echo "project action records (KGlobalAccel): $count"
  print_records "$records"
  report_shortcut_drift "$records"
  echo "note: KGlobalAccel records persist after unload and do not prove live callbacks."
  echo "note: public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
  echo "note: journal diagnostics are historical evidence bound to this captured KWin identity, not a current-liveness proof."
    echo "diagnostics: run '$0 diagnostics' for the latest KWin-PID/start-identity-bound controller-startup diagnostic evidence."
}

cmd_diagnostics() {
  require_tools busctl jq journalctl
  read_plugin_id

  local loaded
  loaded="$(plugin_loaded_word)"

  local pid
  pid="$(find_kwin_pid 2>/dev/null || true)"

  echo "plugin: $PLUGIN_ID"
  echo "loaded: $loaded"
  if [[ -z "$pid" ]]; then
    echo "kwin pid: unavailable (no single KWin process identified)"
    echo "controller running/callbacks: not proven"
    echo "diagnostics epoch (latest KWin-PID/start-identity-bound startup): unknown/not-ready (no single KWin process identified)"
    echo "note: persisted shortcut records do not prove callbacks; only an exact '-invoked' or '-rejected:'/'preset-failed:' diagnostic token proves callback delivery."
    echo "note: public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
    return 0
  fi
  echo "kwin pid: $pid"

  KWIN_PID="$pid"
  if ! capture_kwin_identity; then
    echo "controller running/callbacks: not proven"
    echo "diagnostics epoch (latest KWin-PID/start-identity-bound startup): unknown/not-ready (KWin PID/start identity unavailable)"
    echo "note: persisted shortcut records do not prove callbacks; only an exact '-invoked' or '-rejected:'/'preset-failed:' diagnostic token proves callback delivery."
    echo "note: public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
    return 0
  fi
  echo "KWin identity: PID/start identity captured"

  local journal_out
  journal_out="$(journalctl --user --quiet --no-pager "_PID=$pid" -o json)" || {
    echo "error: could not read the KWin diagnostics journal" >&2
    exit 1
  }
  local after_pid
  after_pid="$(find_kwin_pid 2>/dev/null || true)"
  if [[ "$after_pid" != "$pid" ]] || ! kwin_identity_unchanged; then
    echo "controller running/callbacks: not proven"
    echo "diagnostics epoch (latest KWin-PID/start-identity-bound startup): unknown/not-ready (KWin PID/start identity changed during journal read)"
    echo "note: persisted shortcut records do not prove callbacks; only an exact '-invoked' or '-rejected:'/'preset-failed:' diagnostic token proves callback delivery."
    echo "note: public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
    return 0
  fi
  if [[ -z "$journal_out" ]]; then
    echo "controller running/callbacks: not proven"
    echo "diagnostics epoch (latest KWin-PID/start-identity-bound startup): unknown/not-ready (no journal records for this KWin identity)"
    echo "note: persisted shortcut records do not prove callbacks; only an exact '-invoked' or '-rejected:'/'preset-failed:' diagnostic token proves callback delivery."
    echo "note: public KWin APIs provide operational lifecycle binding, not direct evaluated-memory source proof."
    return 0
  fi
  if ! jq -s -e "$journal_lines_valid" <<<"$journal_out" >/dev/null 2>&1; then
    echo "error: could not parse the KWin diagnostics journal" >&2
    exit 1
  fi

  local summary
  summary="$(jq -s -c --arg pid "$pid" "$diagnostics_summary" <<<"$journal_out")" || {
    echo "error: could not summarize the KWin diagnostics journal" >&2
    exit 1
  }

  local kept count last_shortcut last_ready last_disabled_start last_disabled_any
  kept="$(jq -r '.kept' <<<"$summary")"
  count="$(jq -r '.messages | length' <<<"$summary")"
  last_shortcut="$(jq -r '.lastShortcut // -1' <<<"$summary")"
  last_ready="$(jq -r '.lastReady // -1' <<<"$summary")"
  last_disabled_start="$(jq -r '.lastDisabledStart // -1' <<<"$summary")"
  last_disabled_any="$(jq -r '.lastDisabledAny // -1' <<<"$summary")"

  # The latest startup token is the later of the last successful-start token
  # (shortcut-registered) and the last disabled-start token
  # (disabled:shortcut-registration-failed); the epoch window begins there.
  local latest_start latest_start_msg start_index
  latest_start="$last_shortcut"
  latest_start_msg="shortcut-registered"
  if [[ "$last_disabled_start" -gt "$latest_start" ]]; then
    latest_start="$last_disabled_start"
    latest_start_msg="disabled:shortcut-registration-failed"
  fi
  start_index=-1

  local epoch_label readiness_label disabled_label
  epoch_label="unknown"
  readiness_label="unknown"
  disabled_label="unknown"

  if [[ "$count" -eq 0 ]]; then
    if [[ "$kept" -eq 0 ]]; then
      epoch_label="unknown (no journal records match captured KWin identity; PID-mismatched records excluded)"
    else
      epoch_label="unknown (no project diagnostics for captured KWin identity)"
    fi
  elif [[ "$latest_start" -lt 0 ]]; then
    if [[ "$last_disabled_any" -ge 0 ]]; then
      epoch_label="disabled"
      readiness_label="unknown"
      disabled_label="yes"
      start_index="$last_disabled_any"
    else
      epoch_label="unknown (no controller-startup epoch observed)"
    fi
  elif [[ "$latest_start_msg" == "disabled:shortcut-registration-failed" ]]; then
    epoch_label="disabled (latest startup disabled)"
    readiness_label="not-reached"
    disabled_label="yes"
    start_index="$latest_start"
  elif [[ "$last_ready" -gt "$latest_start" ]]; then
    if [[ "$loaded" == "not-loaded" ]]; then
      epoch_label="historical (plugin unloaded)"
    else
      epoch_label="current (plugin loaded)"
    fi
    readiness_label="reached"
    if [[ "$last_disabled_any" -gt "$latest_start" ]]; then
      disabled_label="yes"
    else
      disabled_label="no"
    fi
    start_index="$latest_start"
  else
    epoch_label="incomplete (startup-handlers-ready not observed)"
    readiness_label="unknown"
    disabled_label="no"
    start_index="$latest_start"
  fi

  echo "controller running/callbacks: not proven by journal evidence alone"
  echo "diagnostics epoch (latest KWin-PID/start-identity-bound controller startup): $epoch_label"
  echo "  readiness: $readiness_label"
  echo "  controller disabled: $disabled_label"

  if [[ "$start_index" -ge 0 ]]; then
    local classified
    classified="$(jq -c --argjson start "$start_index" "$diagnostics_classify" <<<"$summary")" || {
      echo "error: could not classify the KWin diagnostics journal" >&2
      exit 1
    }
    echo "  callback invocation tokens (prove callback delivery):"
    jq -r '.invoked[]' <<<"$classified" | sed 's/^/    /'
    echo "  rejection tokens (prove callback reached a rejecting guard):"
    jq -r '.rejected[]' <<<"$classified" | sed 's/^/    /'
    echo "  success tokens (prove the completed/successful stage):"
    jq -r '.success[]' <<<"$classified" | sed 's/^/    /'
    echo "  ordered diagnostics:"
    jq -r '.epoch[]' <<<"$classified" | sed 's/^/    /'
  fi

  echo "note: callback invocation/rejection is proven only by the exact diagnostic tokens listed above."
  echo "note: persisted shortcut records do not prove callbacks; only a matching diagnostic token proves callback delivery."
  echo "note: journal diagnostics are historical evidence bound to this captured KWin identity, not a current-liveness proof."
}

cmd_desktops() {
  require_tools busctl jq stat
  local out
  out="$(busctl $BUS_SCOPE --json=short get-property "$BUS_DEST" "$VDSK_PATH" "$VDSK_IFACE" desktops)" || {
    echo "error: VirtualDesktopManager desktops call failed: $out" >&2
    exit 1
  }
  if ! strict_json_matches "$desktops_valid" "$out"; then
    echo "error: unexpected desktops reply (expected a strict {\"type\":\"a(uss)\",\"data\":[[position,id,name],...]} envelope): $out" >&2
    exit 1
  fi
  echo "virtual desktops: $(jq -r '.data | length' <<<"$out")"
  jq -r '.data[] | [.[0], .[1], .[2]] | @tsv' <<<"$out" | sed 's/^/  /'
  echo "note: desktops is a read-only strict decode of the live VirtualDesktopManager envelope; it never mutates."
}

cmd_stop() {
  require_tools busctl jq
  read_plugin_id

  if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ || "$1" -gt 2147483647 ]]; then
    echo "error: stop requires the exact non-negative 32-bit script ID returned by start" >&2
    exit 1
  fi
  local script_id="$1" loaded out records count
  [[ -n "$CONTROLLER_OWNERSHIP_FILE" ]] || {
    echo "error: stop requires the nonce-owned controller receipt; refusing stale script teardown" >&2
    exit 1
  }
  load_ownership "$CONTROLLER_OWNERSHIP_FILE" controller "$script_id" "$PLUGIN_ID" >/dev/null || {
    echo "error: controller ownership receipt does not match script id $script_id; refusing teardown" >&2
    exit 1
  }
  loaded="$(plugin_loaded_word)"
  if [[ "$loaded" == "not-loaded" ]]; then
    echo "error: plugin '$PLUGIN_ID' is not loaded; refusing to use stale script id $script_id" >&2
    exit 1
  else
    CONTROLLER_READY_MESSAGE="plasma-auto-tiler:controller-ready:plugin=$PLUGIN_ID:nonce=$OWNED_NONCE:build=$OWNED_BUILD"
    if ! exact_cleanup "$script_id" "$PLUGIN_ID"; then
      echo "error: exact controller teardown was not verified; refusing to touch another script" >&2
      exit 1
    fi
    remove_ownership "$CONTROLLER_OWNERSHIP_FILE" "$OWNED_RECEIPT"
    echo "stop: plugin '$PLUGIN_ID' unloaded"
  fi

  records="$(collect_project_action_records)" || exit 1
  count="$(count_records "$records")"
  echo "project action records still registered in KGlobalAccel: $count (stale; left untouched)"
  print_records "$records"
  echo "note: KGlobalAccel records do not prove live callbacks and are not unregistered by this command."
  echo "note: stopping/unloading does not roll back Custom Tile topology changes the script already made."
}

# Prints one TSV line per unrelated KGlobalAccel record (any component) whose
# active sequence matches any of the given actions' expected sequences.
# Fail-closed exactly like the collector: malformed envelopes are an error,
# never zero matches.
collect_unrelated_target_conflicts() {
  local -a targets=()
  local action
  for action in "$@"; do
    targets+=("${EXPECTED_SEQUENCES[$action]}")
  done
  if [[ "${#targets[@]}" -eq 0 ]]; then
    return 0
  fi
  local targets_json
  targets_json="$(printf '%s\n' "${targets[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0)) | map(tonumber)')" || return 1
  local comps
  comps="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$KG_PATH" "$KG_IFACE" allComponents)" || {
    echo "error: KGlobalAccel allComponents call failed: $comps" >&2
    return 1
  }
  if ! strict_json_matches "$components_valid" "$comps"; then
    echo "error: unexpected allComponents reply: $comps" >&2
    return 1
  fi
  local comp infos
  while IFS= read -r comp; do
    infos="$(busctl $BUS_SCOPE --json=short call "$KG_DEST" "$comp" "$KG_COMP_IFACE" allShortcutInfos s default)" || {
      echo "error: allShortcutInfos call failed for $comp: $infos" >&2
      return 1
    }
    if ! strict_json_matches "$shortcut_infos_valid" "$infos"; then
      echo "error: unexpected allShortcutInfos reply for $comp" >&2
      return 1
    fi
    jq -r --argjson targets "$targets_json" --argjson actions "$PROJECT_ACTIONS_JSON" \
      '.data[0][] | select((.[0] as $id | $actions | index($id)) == null) | select(any(.[6][]; . as $active | ($targets | index($active)) != null)) | [.[2], .[0], .[1], (.[6] | join(","))] | @tsv' \
      <<<"$infos" || return 1
  done < <(jq -r '.data[0][]' <<<"$comps")
}

# Calls the exact setter contract. keys_json is the QSet<QKeySequence> D-Bus
# value, represented as an array of integer arrays.
set_shortcut_keys() {
  local comp="$1" action="$2" label="$3" keys_json="$4" flags="$5"
  if ! jq -e 'type == "array" and all(.[]; type == "array" and all(.[]; type == "number" and floor == .))' <<<"$keys_json" >/dev/null 2>&1; then
    return 1
  fi
  local -a key_args=()
  mapfile -t key_args < <(jq -r '([length] + (map([length] + .) | add // []))[]' <<<"$keys_json")
  busctl $BUS_SCOPE --json=short call "$KG_DEST" "$KG_PATH" "$KG_IFACE" setShortcutKeys "asa(ai)u" \
    4 "$comp" "$action" "KWin" "$label" "${key_args[@]}" "$flags"
}

# allShortcutInfos exposes one active integer sequence per project action.
# Re-wrap that exact captured sequence as the setter's QSet<QKeySequence>.
captured_sequence_to_keys_json() {
  local sequence="$1"
  if [[ -z "$sequence" ]]; then
    printf '[]\n'
    return 0
  fi
  jq -cn --arg sequence "$sequence" '[$sequence | split(",") | map(tonumber)]'
}

setter_reply_confirms() {
  local reply="$1" expected="$2"
  jq -s -e --argjson expected "$expected" \
    'length == 1 and (.[0] | (((keys | sort) == ["data","type"]) and (.type == "a(ai)") and ((.data | type) == "array") and ((.data | flatten | index($expected)) != null)))' \
    <<<"$reply" >/dev/null 2>&1
}

# Narrow explicit shortcut reconciliation. Read-only by default; --apply
# writes the expected source-default active sequence to each mismatched
# project record through the exact setter contract after read-only gates.
cmd_reconcile_shortcuts() {
  require_tools busctl jq
  local mode="${1:-}"
  if [[ -n "$mode" && "$mode" != "--apply" ]]; then
    echo "error: unknown reconcile-shortcuts argument '$mode' (expected --apply or nothing)" >&2
    exit 1
  fi

  # Read-only preflight: the running KGlobalAccel must expose the exact
  # setter contract (method name, D-Bus signature, and result type).
  local introspect_out
  introspect_out="$(busctl $BUS_SCOPE --json=short introspect "$KG_DEST" "$KG_PATH")" || {
    echo "error: could not introspect $KG_DEST $KG_PATH" >&2
    exit 1
  }
  if ! strict_json_matches 'type == "array" and any(.[]; ((.type == "method") and (.name == ".setShortcutKeys") and (.signature == "asa(ai)u") and (.result_value == "a(ai)")))' "$introspect_out"; then
    echo "error: KGlobalAccel setShortcutKeys is absent or does not expose exactly asa(ai)u -> a(ai)" >&2
    exit 1
  fi

  ensure_actions_json

  local records comp action label active default
  records="$(collect_project_action_records)" || exit 1
  declare -A RECORD_COMP=() RECORD_LABEL=() RECORD_ACTIVE=() RECORD_COUNT=()
  local ownership_errors=0
  while IFS=$'\t' read -r comp action label active default; do
    [[ -z "$action" ]] && continue
    RECORD_COUNT["$action"]=$(( ${RECORD_COUNT[$action]:-0} + 1 ))
    if [[ "$comp" != "kwin" ]]; then
      ownership_errors=$((ownership_errors + 1))
      echo "  ownership error: action \"$action\" is under component \"$comp\", expected \"kwin\""
    fi
    RECORD_COMP["$action"]="$comp"
    RECORD_LABEL["$action"]="$label"
    RECORD_ACTIVE["$action"]="$active"
  done <<<"$records"

  local -a mismatch_actions=()
  local matched=0 mismatched=0 missing=0 expected
  for action in "${PROJECT_ACTIONS[@]}"; do
    expected="${EXPECTED_SEQUENCES[$action]}"
    if [[ ! "${RECORD_ACTIVE[$action]+x}" ]]; then
      missing=$((missing + 1))
      echo "  missing: action \"$action\" has no persisted record"
      continue
    fi
    if [[ "${RECORD_ACTIVE[$action]}" == "$expected" ]]; then
      matched=$((matched + 1))
    else
      mismatched=$((mismatched + 1))
      mismatch_actions+=("$action")
    fi
    if [[ "${RECORD_COUNT[$action]}" -ne 1 ]]; then
      ownership_errors=$((ownership_errors + 1))
      echo "  ownership error: action \"$action\" has ${RECORD_COUNT[$action]} project records, expected exactly one under \"kwin\""
    fi
  done

  local conflicts
  conflicts="$(collect_unrelated_target_conflicts "${PROJECT_ACTIONS[@]}")" || exit 1

  if [[ -z "$mode" ]]; then
    echo "reconcile-shortcuts: read-only report (no mutation)"
    echo "  setter contract: org.kde.KGlobalAccel.setShortcutKeys asa(ai)u -> a(ai) (introspection-proven)"
    echo "  matched: $matched"
    echo "  mismatched: $mismatched"
    for action in "${mismatch_actions[@]}"; do
      echo "    action \"$action\" active \"${RECORD_ACTIVE[$action]}\" expected \"${EXPECTED_SEQUENCES[$action]}\""
    done
    echo "  missing: $missing"
    echo "  ownership errors: $ownership_errors"
    echo "  unrelated target conflicts: $(count_records "$conflicts")"
    print_records "$conflicts"
    echo "  note: run 'reconcile-shortcuts --apply' to write the expected active sequences."
    echo "  note: normal 'start' never mutates shortcut records."
    return 0
  fi

  # --apply gates: target ownership and unrelated-conflict absence.
  if [[ "$missing" -gt 0 ]]; then
    echo "error: refusing to apply with $missing missing project action record(s); cannot reconcile unregistered actions" >&2
    exit 1
  fi
  if [[ "$ownership_errors" -gt 0 ]]; then
    echo "error: refusing to apply with $ownership_errors project ownership error(s); expected exactly one kwin record per action" >&2
    exit 1
  fi
  if [[ -n "$conflicts" ]]; then
    echo "error: refusing to apply; expected target sequences are claimed by unrelated records:" >&2
    print_records "$conflicts" >&2
    exit 1
  fi
  if [[ "$mismatched" -eq 0 ]]; then
    echo "reconcile-shortcuts --apply: all project action records already match expected source defaults; nothing to write"
    return 0
  fi

  echo "reconcile-shortcuts --apply: preflight passed (exact setter contract, target ownership, no unrelated conflicts)"
  echo "  before:"
  for action in "${mismatch_actions[@]}"; do
    echo "    action \"$action\" active \"${RECORD_ACTIVE[$action]}\" expected \"${EXPECTED_SEQUENCES[$action]}\""
  done

  local -a touched_actions=()
  local touched=0 reply keys_json failure=""
  echo "  writing:"
  for action in "${mismatch_actions[@]}"; do
    expected="${EXPECTED_SEQUENCES[$action]}"
    comp="${RECORD_COMP[$action]}"
    label="${RECORD_LABEL[$action]}"
    keys_json="[[${expected},0,0,0]]"
    # Record before the call because a transport or reply failure can still
    # leave the daemon changed.
    touched_actions+=("$action")
    touched=$((touched + 1))
    if ! reply="$(set_shortcut_keys "$comp" "$action" "$label" "$keys_json" "$KG_SET_SHORTCUT_FLAGS")"; then
      failure="setShortcutKeys call failed for action \"$action\": $reply"
      break
    fi
    if ! setter_reply_confirms "$reply" "$expected"; then
      failure="setShortcutKeys reply for action \"$action\" did not confirm expected key: $reply"
      break
    fi
    echo "    action \"$action\" -> \"$expected\""
  done

  local after after_active ok_count=0 bad_count=0
  if [[ -z "$failure" ]]; then
    after="$(collect_project_action_records)" || failure="could not collect project records for post-write verification"
  fi
  declare -A AFTER_ACTIVE=()
  if [[ -z "$failure" ]]; then
    while IFS=$'\t' read -r comp action label active default; do
      [[ -z "$action" ]] && continue
      AFTER_ACTIVE["$action"]="$active"
    done <<<"$after"
    echo "  after:"
    for action in "${mismatch_actions[@]}"; do
      after_active="${AFTER_ACTIVE[$action]:-}"
      expected="${EXPECTED_SEQUENCES[$action]}"
      if [[ "$after_active" == "$expected" ]]; then
        ok_count=$((ok_count + 1))
        echo "    action \"$action\" active \"$after_active\" (verified)"
      else
        bad_count=$((bad_count + 1))
        echo "    action \"$action\" active \"$after_active\" (expected \"$expected\"; not verified)" >&2
      fi
    done
    if [[ "$bad_count" -gt 0 ]]; then
      failure="$bad_count post-write project assignment(s) did not verify"
    fi
  fi

  if [[ -n "$failure" ]]; then
    echo "error: reconciliation failed: $failure" >&2
    echo "rollback: restoring $touched touched project assignment(s)" >&2
    local restore_failed=0 restore_reply restore_keys restored
    for action in "${touched_actions[@]}"; do
      if ! restore_keys="$(captured_sequence_to_keys_json "${RECORD_ACTIVE[$action]}")"; then
        restore_failed=1
        echo "  rollback failed: could not encode captured assignment for action \"$action\"" >&2
        continue
      fi
      if ! restore_reply="$(set_shortcut_keys "${RECORD_COMP[$action]}" "$action" "${RECORD_LABEL[$action]}" "$restore_keys" "$KG_SET_SHORTCUT_FLAGS")"; then
        restore_failed=1
        echo "  rollback failed: setShortcutKeys call for action \"$action\": $restore_reply" >&2
      fi
    done
    if restored="$(collect_project_action_records)"; then
      declare -A RESTORED_ACTIVE=()
      while IFS=$'\t' read -r comp action label active default; do
        [[ -z "$action" ]] && continue
        RESTORED_ACTIVE["$action"]="$active"
      done <<<"$restored"
      for action in "${touched_actions[@]}"; do
        if [[ "${RESTORED_ACTIVE[$action]:-}" != "${RECORD_ACTIVE[$action]}" ]]; then
          restore_failed=1
          echo "  rollback unverified: action \"$action\" active \"${RESTORED_ACTIVE[$action]:-}\" expected captured \"${RECORD_ACTIVE[$action]}\"" >&2
        fi
      done
    else
      restore_failed=1
      echo "  rollback unverified: could not re-read project assignments" >&2
    fi
    if [[ "$restore_failed" -eq 0 ]]; then
      echo "rollback: verified exact restoration of $touched touched project assignment(s)" >&2
    else
      echo "rollback: restoration was not fully verified" >&2
    fi
    exit 1
  fi
  echo "reconcile-shortcuts --apply: touched $touched, verified $ok_count, unverified $bad_count"
}

if [[ $# -eq 0 ]]; then
  echo "error: missing command (start, status, stop, diagnostics, desktops, reconcile-shortcuts, provenance, provenance-stop, snapshot-shortcuts, or snapshot-kglobalaccel)" >&2
  usage >&2
  exit 1
fi

case "${1:-}" in
  --help|-h)
    if [[ $# -ne 1 ]]; then
      echo "error: '--help' takes no arguments" >&2
      exit 1
    fi
    usage
    exit 0
    ;;
  start)
    if [[ $# -ne 1 ]]; then
      echo "error: 'start' takes no arguments" >&2
      exit 1
    fi
    cmd_start
    ;;
  status)
    if [[ $# -ne 1 ]]; then
      echo "error: 'status' takes no arguments" >&2
      exit 1
    fi
    cmd_status
    ;;
  stop)
    cmd_stop "${@:2}"
    ;;
  diagnostics)
    if [[ $# -ne 1 ]]; then
      echo "error: 'diagnostics' takes no arguments" >&2
      exit 1
    fi
    cmd_diagnostics
    ;;
  desktops)
    if [[ $# -ne 1 ]]; then
      echo "error: 'desktops' takes no arguments" >&2
      exit 1
    fi
    cmd_desktops
    ;;
  reconcile-shortcuts)
    if [[ $# -gt 2 ]]; then
      echo "error: 'reconcile-shortcuts' takes at most one argument (--apply)" >&2
      exit 1
    fi
    cmd_reconcile_shortcuts "${2:-}"
    ;;
  provenance)
    cmd_provenance "${@:2}"
    ;;
  provenance-stop)
    cmd_provenance_stop "${@:2}"
    ;;
  snapshot-shortcuts)
    if [[ $# -ne 1 ]]; then
      echo "error: 'snapshot-shortcuts' takes no arguments" >&2
      exit 1
    fi
    cmd_snapshot_shortcuts
    ;;
  snapshot-kglobalaccel)
    if [[ $# -ne 1 ]]; then
      echo "error: 'snapshot-kglobalaccel' takes no arguments" >&2
      exit 1
    fi
    cmd_snapshot_kglobalaccel
    ;;
  *)
    echo "error: unknown command '$1'" >&2
    usage >&2
    exit 1
    ;;
esac
