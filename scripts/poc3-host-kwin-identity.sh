#!/usr/bin/env bash
# Canonical shared Bash helper for authorized systemd-backed KWin identity.
#
# Purpose: fail-closed fallback when same-UID /proc/<kwin-pid>/exe is
# unreadable (EACCES) despite pinned D-Bus owner/PID. The caller must already
# hold the D-Bus org.kde.KWin unique owner, PID, and /proc start tick; this
# helper re-pins tick, boot ID, the exact plasma-kwin_wayland.service unit
# state (Id/ActiveState/SubState/MainPID plus Type=dbus and
# BusName=org.kde.KWinWrapper), and the immutable Nix-store executable
# identity (canonical path hash/device/inode/mode) independently of mutable
# unit text. If /proc/<pid>/exe is readable it must agree with the canonical
# store identity in canonical path, device/inode, hash, and mode;
# disagreement fails closed.
#
# Read-only: one `systemctl --user show` with an explicit --property list,
# plus /proc reads and stat/hash of the canonical store file. No broad
# process-table scans, no PATH lookups for the KWin executable, no shell
# startup paths, no command-line authority, no user assertion.
# Supported unit fields: Id, ActiveState, SubState, MainPID, ExecStart,
# FragmentPath, SourcePath (SourcePath may be empty) plus Type and BusName
# as identity gates. Current observed unit is Type=dbus,
# BusName=org.kde.KWinWrapper.
#
# Sourcing only: `. scripts/poc3-host-kwin-identity.sh` then call
#   poc3_kwin_systemd_fallback <owner> <pid> <tick>
# Prints 21 lines on success: wrapped_canon, boot_id, wrapped_sha256,
# wrapped_dev, wrapped_ino, wrapped_mode, launcher_canon, launcher_sha256,
# launcher_dev, launcher_ino, launcher_mode, package_root, unit, active, sub,
# mainpid, type, busname, execstart_path, fragment, source (source may be
# empty). Any failure prints to stderr and returns nonzero with no partial
# identity.
#
# Authorized host-pilot direct-parent mode:
#   poc3_kwin_direct_parent_fallback <owner> <pid> <tick>
# Same gates, except the D-Bus owner PID is not the unit MainPID: the
# owner's direct PPid must exactly equal the unit MainPID (one level only;
# deeper descendants, broad child scans, same-name, and command-line trust
# are refused). Pins the MainPID start tick before and after, and accepts the
# owner cgroup root "0::/" for this mode only, recorded as a platform fact
# without claiming same-unit cgroup containment. Readable MainPID /proc exe
# must match only the wrapped pin in canonical path, device/inode, hash, and
# mode; readable owner exe must match the same wrapped pin too
# (readable-owner disagreement fails closed).
# Prints 25 lines: wrapped_canon, boot_id, wrapped_sha256, wrapped_dev,
# wrapped_ino, wrapped_mode, launcher_canon, launcher_sha256, launcher_dev,
# launcher_ino, launcher_mode, package_root, unit, active, sub, mainpid,
# main_tick, ppid, owner_cgroup, type, busname, execstart_path, fragment,
# source, mode (literal "direct-parent").
#
# Env inputs (hermetic tests):
#   SYSTEMCTL_BIN STAT_BIN READLINK_BIN SHA256SUM_BIN PROC_ROOT
#   POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC=1   permits PROC_ROOT != /proc
#   POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1  permits non-/nix/store
#     ExecStart/canonical paths in fixtures only. Production (both unset/0)
#     requires PROC_ROOT=/proc and exact /nix/store executable identity.
# Direct execution is refused; source only.
if [[ "${BASH_SOURCE[0]:-}" == "${0:-}" ]]; then
  echo "error: poc3-host-kwin-identity.sh is a shared helper; source it, do not execute" >&2
  exit 1
fi

# Fixed return status for the only valid parsed MainPID-mismatch condition in
# poc3_kwin_systemd_fallback (D-Bus owner PID valid, unit MainPID validly
# parsed, MainPID != owner PID). Returned only for that exact case; every
# other helper failure returns 1. Advisory preflight routes to the
# direct-parent fallback solely on this status, never by matching stderr.
# All wrapper-pair captures stay in memory (command substitution plus
# mapfile); this helper creates no temp files and is safe under a guarded
# TMPDIR. Status 42 is an internal literal, not caller-configurable state.

poc3_kwin_identity_safe_abs() {
  local path="$1"
  [[ "$path" == /* && "$path" != *'//' && "$path" != *'/../'* \
    && "$path" != */.. && "$path" != */./* && "$path" != */. ]] || return 1
  [[ "$path" != "/" ]] || return 1
}

# Paren-safe /proc start tick (field 22). Splits after the last ") ".
poc3_kwin_identity_proc_tick() {
  local pid="$1" proc_root="${PROC_ROOT:-/proc}" stat_line stat_pid rest
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  stat_line="$(<"$proc_root/$pid/stat")" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  stat_pid="${stat_line%% *}"
  [[ "$stat_pid" == "$pid" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  local -a fields=()
  read -r -a fields <<<"$rest" || return 1
  [[ "${#fields[@]}" -ge 20 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[0]}" != "Z" ]] || return 1
  [[ "${fields[19]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${fields[19]}"
}

# Kernel boot ID, strict lowercase UUID, single line, no fallback path.
poc3_kwin_identity_boot_id() {
  local proc_root="${PROC_ROOT:-/proc}" v
  local file="$proc_root/sys/kernel/random/boot_id"
  poc3_kwin_identity_safe_abs "$file" || return 1
  [[ -f "$file" && ! -L "$file" ]] || return 1
  v="$(<"$file")" || return 1
  [[ "$v" != *$'\n'* && "$v" != *$'\r'* ]] || return 1
  [[ "$v" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || return 1
  printf '%s' "$v"
}

# Paren-safe direct parent PID (field 4). Splits after the last ") ".
poc3_kwin_identity_proc_ppid() {
  local pid="$1" proc_root="${PROC_ROOT:-/proc}" stat_line stat_pid rest
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  stat_line="$(<"$proc_root/$pid/stat")" || return 1
  [[ "$stat_line" != *$'\n'* ]] || return 1
  stat_pid="${stat_line%% *}"
  [[ "$stat_pid" == "$pid" ]] || return 1
  rest="${stat_line##*) }"
  [[ "$rest" != "$stat_line" ]] || return 1
  local -a fields=()
  read -r -a fields <<<"$rest" || return 1
  [[ "${#fields[@]}" -ge 2 && "${fields[0]:-}" =~ ^[A-Za-z]$ ]] || return 1
  [[ "${fields[0]}" != "Z" ]] || return 1
  [[ "${fields[1]:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${fields[1]}"
}

# Owner cgroup identity for the direct-parent host-pilot mode only.
# Production accepts exactly the platform-fact root "0::/" (cgroup v2 host
# root); anything else fails closed. Prints "0::/".
poc3_kwin_identity_owner_cgroup() {
  local pid="$1" proc_root="${PROC_ROOT:-/proc}" v
  local file="$proc_root/$pid/cgroup"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  poc3_kwin_identity_safe_abs "$file" || return 1
  [[ -f "$file" && ! -L "$file" ]] || return 1
  v="$(<"$file")" || return 1
  [[ "$v" != *$'\n'* && "$v" != *$'\r'* ]] || return 1
  [[ "$v" == "0::/" ]] || return 1
  printf '%s' "$v"
}

# Nix-store executable shape. Production requires exact
# /nix/store/<32-lower-alnum>-<name>(/<comp>)*. Test gate permits any safe
# absolute path but still rejects deleted markers.
poc3_kwin_identity_store_ok() {
  local p="$1"
  [[ "$p" != *' (deleted)'* ]] || return 1
  if [[ "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE:-0}" == 1 ]]; then
    poc3_kwin_identity_safe_abs "$p" || return 1
    return 0
  fi
  [[ "$p" == /nix/store/* ]] || return 1
  [[ "$p" =~ ^/nix/store/[a-z0-9]{32}-[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || return 1
  local rest="${p#/nix/store/}"
  local hash="${rest%%-*}"
  [[ "$hash" =~ ^[a-z0-9]{32}$ ]] || return 1
  poc3_kwin_identity_safe_abs "$p" || return 1
  return 0
}

# Immutable-store executable mode gate. Takes a stat %a mode string.
# Requires octal 3-4 digits, no writable bits (0222), and at least one
# executable bit (0111). A sole numeric equality (for example mode == 555)
# is not used; the writable-bit mask and executable mask are checked
# independently via stat mode.
poc3_kwin_identity_mode_ok() {
  local mode="${1:-}"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  local m=$((8#$mode))
  (( (m & 8#222) == 0 )) || return 1
  (( (m & 8#111) != 0 )) || return 1
}

# Authorized wrapper-pair pinning. ExecStart must itself be the exact
# canonical non-symlink launcher
#   <package root>/bin/kwin_wayland_wrapper
# where the package root is /nix/store/<32 lowercase alnum>-<package> in
# production. The wrapped binary is derived as exactly
#   <package root>/bin/.kwin_wayland_wrapper-wrapped
# and must share the same package root with the exact expected basename. Both
# files must canonicalize to themselves and be regular executable non-symlink
# files with stat mode showing no writable bits and at least one executable
# bit (regular type via stat %F plus mode mask check, not a sole numeric
# equality). For each file, canonical self path, regular no-write executable
# mode, device/inode, and hash are captured, then mode/device/inode are
# re-statted and the hash recomputed immediately and required to be equal
# before accepting (same-path/replacement protection; no PATH or command-line
# trust, no fd-atomicity claim).
# Test gate POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE=1 permits non-/nix/store
# fixture roots but still requires the exact /bin/kwin_wayland_wrapper and
# /bin/.kwin_wayland_wrapper-wrapped names plus safe absolute paths.
# Prints 11 lines: launcher_canon, launcher_sha, launcher_dev, launcher_ino,
# launcher_mode, wrapped_canon, wrapped_sha, wrapped_dev, wrapped_ino,
# wrapped_mode, package_root.
poc3_kwin_identity_pin_pair() {
  local exec_path="${1:-}" readlink_bin="${2:-}" stat_bin="${3:-}" sha_bin="${4:-}"
  [[ -n "$exec_path" && -n "$readlink_bin" && -n "$stat_bin" && -n "$sha_bin" ]] || return 1
  [[ "$exec_path" != *' (deleted)'* ]] || return 1
  poc3_kwin_identity_safe_abs "$exec_path" || return 1
  local launcher_base="${exec_path##*/}"
  [[ "$launcher_base" == "kwin_wayland_wrapper" ]] || return 1
  [[ "$exec_path" == */bin/kwin_wayland_wrapper ]] || return 1
  local pkg_root="${exec_path%/bin/kwin_wayland_wrapper}"
  [[ -n "$pkg_root" && "$pkg_root" != "$exec_path" ]] || return 1
  poc3_kwin_identity_safe_abs "$pkg_root" || return 1
  if [[ "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE:-0}" == 1 ]]; then
    :
  else
    [[ "$exec_path" =~ ^/nix/store/[a-z0-9]{32}-[A-Za-z0-9._-]+/bin/kwin_wayland_wrapper$ ]] || return 1
    local _lrest="${exec_path#/nix/store/}"
    local _lhash="${_lrest%%-*}"
    [[ "$_lhash" =~ ^[a-z0-9]{32}$ ]] || return 1
    [[ "$pkg_root" =~ ^/nix/store/[a-z0-9]{32}-[A-Za-z0-9._-]+$ ]] || return 1
    local _r rest2
    _r="${pkg_root#/nix/store/}"
    rest2="${_r%%-*}"
    [[ "$rest2" =~ ^[a-z0-9]{32}$ ]] || return 1
  fi
  local launcher_canon=""
  launcher_canon="$("$readlink_bin" -f -- "$exec_path" 2>/dev/null)" || return 1
  [[ "$launcher_canon" == "$exec_path" ]] || return 1
  poc3_kwin_identity_safe_abs "$launcher_canon" || return 1
  [[ -f "$launcher_canon" && ! -L "$launcher_canon" && -x "$launcher_canon" && ! -d "$launcher_canon" ]] || return 1
  local wrapped_path="$pkg_root/bin/.kwin_wayland_wrapper-wrapped"
  [[ "$wrapped_path" == "$pkg_root/bin/.kwin_wayland_wrapper-wrapped" ]] || return 1
  local wrapped_base="${wrapped_path##*/}"
  [[ "$wrapped_base" == ".kwin_wayland_wrapper-wrapped" ]] || return 1
  poc3_kwin_identity_safe_abs "$wrapped_path" || return 1
  [[ "$wrapped_path" != *' (deleted)'* ]] || return 1
  if [[ "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONSTORE:-0}" == 1 ]]; then
    [[ "$wrapped_path" == */bin/.kwin_wayland_wrapper-wrapped ]] || return 1
  else
    [[ "$wrapped_path" =~ ^/nix/store/[a-z0-9]{32}-[A-Za-z0-9._-]+/bin/\.kwin_wayland_wrapper-wrapped$ ]] || return 1
  fi
  local wrapped_root="${wrapped_path%/bin/.kwin_wayland_wrapper-wrapped}"
  [[ "$wrapped_root" == "$pkg_root" ]] || return 1
  local wrapped_canon=""
  wrapped_canon="$("$readlink_bin" -f -- "$wrapped_path" 2>/dev/null)" || return 1
  [[ "$wrapped_canon" == "$wrapped_path" ]] || return 1
  poc3_kwin_identity_safe_abs "$wrapped_canon" || return 1
  [[ -f "$wrapped_canon" && ! -L "$wrapped_canon" && -x "$wrapped_canon" && ! -d "$wrapped_canon" ]] || return 1
  local l_dev="" l_ino="" l_line="" l_sha="" w_dev="" w_ino="" w_line="" w_sha=""
  local l_mode="" l_ftype="" w_mode="" w_ftype=""
  local l_dev2="" l_ino2="" l_mode2="" l_ftype2="" l_line2="" l_sha2=""
  local w_dev2="" w_ino2="" w_mode2="" w_ftype2="" w_line2="" w_sha2=""
  l_dev="$("$stat_bin" -c '%d' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_ino="$("$stat_bin" -c '%i' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_mode="$("$stat_bin" -c '%a' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_ftype="$("$stat_bin" -c '%F' -- "$launcher_canon" 2>/dev/null)" || return 1
  [[ "$l_dev" =~ ^[0-9]+$ && "$l_ino" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$l_ftype" == regular* ]] || return 1
  poc3_kwin_identity_mode_ok "$l_mode" || return 1
  l_line="$("$sha_bin" -- "$launcher_canon" 2>/dev/null)" || return 1
  l_sha="${l_line%% *}"
  [[ "$l_sha" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
  l_dev2="$("$stat_bin" -c '%d' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_ino2="$("$stat_bin" -c '%i' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_mode2="$("$stat_bin" -c '%a' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_ftype2="$("$stat_bin" -c '%F' -- "$launcher_canon" 2>/dev/null)" || return 1
  l_line2="$("$sha_bin" -- "$launcher_canon" 2>/dev/null)" || return 1
  l_sha2="${l_line2%% *}"
  [[ "$l_dev2" == "$l_dev" && "$l_ino2" == "$l_ino" && "$l_mode2" == "$l_mode" ]] || return 1
  [[ "$l_ftype2" == "$l_ftype" && "$l_sha2" == "$l_sha" ]] || return 1
  w_dev="$("$stat_bin" -c '%d' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_ino="$("$stat_bin" -c '%i' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_mode="$("$stat_bin" -c '%a' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_ftype="$("$stat_bin" -c '%F' -- "$wrapped_canon" 2>/dev/null)" || return 1
  [[ "$w_dev" =~ ^[0-9]+$ && "$w_ino" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$w_ftype" == regular* ]] || return 1
  poc3_kwin_identity_mode_ok "$w_mode" || return 1
  w_line="$("$sha_bin" -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_sha="${w_line%% *}"
  [[ "$w_sha" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
  w_dev2="$("$stat_bin" -c '%d' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_ino2="$("$stat_bin" -c '%i' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_mode2="$("$stat_bin" -c '%a' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_ftype2="$("$stat_bin" -c '%F' -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_line2="$("$sha_bin" -- "$wrapped_canon" 2>/dev/null)" || return 1
  w_sha2="${w_line2%% *}"
  [[ "$w_dev2" == "$w_dev" && "$w_ino2" == "$w_ino" && "$w_mode2" == "$w_mode" ]] || return 1
  [[ "$w_ftype2" == "$w_ftype" && "$w_sha2" == "$w_sha" ]] || return 1
  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    "$launcher_canon" "$l_sha" "$l_dev" "$l_ino" "$l_mode" "$wrapped_canon" "$w_sha" "$w_dev" "$w_ino" "$w_mode" "$pkg_root"
}

# Safe ExecStart value parser. Takes the raw value after "ExecStart=" from
# `systemctl show` machine-readable output. Prints the single path= target.
# Rejects injection, ambiguity, multiple commands, malformed/escaped array
# values, and mutable or non-store execution paths (store shape checked by
# the caller via poc3_kwin_identity_store_ok, but absolute safety enforced
# here as well).
poc3_kwin_identity_parse_execstart() {
  local raw="$1" path=""
  [[ -n "$raw" ]] || return 1
  [[ "$raw" != *$'\n'* && "$raw" != *$'\r'* ]] || return 1
  case "$raw" in
    *\\*|*\"*|*\'*|*\`*|*\$*) return 1 ;;
  esac
  case "$raw" in
    *\&*|*\|*|*\<*|*\>*) return 1 ;;
  esac
  local open_count close_count s n
  open_count=0
  s="$raw"
  while [[ "$s" == *"{"* ]]; do
    open_count=$((open_count + 1))
    s="${s#*\{}"
  done
  close_count=0
  s="$raw"
  while [[ "$s" == *"}"* ]]; do
    close_count=$((close_count + 1))
    s="${s#*\}}"
  done
  [[ "$open_count" -eq 1 && "$close_count" -eq 1 ]] || return 1
  [[ "$raw" == "{ "* && "$raw" == *" }" ]] || return 1
  s="$raw"
  n=0
  while [[ "$s" == *"path="* ]]; do
    n=$((n + 1))
    s="${s#*path=}"
  done
  [[ "$n" -eq 1 ]] || return 1
  if [[ "$raw" =~ \{[[:space:]]+path=([^[:space:]\;]+)[[:space:]]*\; ]]; then
    path="${BASH_REMATCH[1]}"
  else
    return 1
  fi
  [[ -n "$path" ]] || return 1
  poc3_kwin_identity_safe_abs "$path" || return 1
  printf '%s' "$path"
}

# Resolve a tool to an absolute executable without using its result as KWin
# executable authority. Bare names resolve via command -v; absolute paths
# must be safe and executable.
poc3_kwin_identity_tool() {
  local configured="$1"
  local bin="$configured"
  [[ -n "$bin" ]] || return 1
  if [[ "$bin" != */* ]]; then
    bin="$(command -v -- "$bin" 2>/dev/null)" || return 1
  fi
  poc3_kwin_identity_safe_abs "$bin" || return 1
  [[ -x "$bin" && ! -d "$bin" ]] || return 1
  printf '%s' "$bin"
}

# Authorized fallback: poc3_kwin_systemd_fallback <owner> <pid> <tick>.
# Caller must pass the D-Bus-pinned org.kde.KWin unique owner, PID, and
# /proc start tick. Verifies tick/boot/unit/MainPID/wrapper-pair identity and
# /proc/exe agreement when readable (readable MainPID exe must match only the
# wrapped pin in canonical path, device/inode, hash, and stat mode, then the
# pair is revalidated once more). Prints 21 lines on success.
# MainPID-mismatch contract: when the unit MainPID is validly parsed and
# differs from the owner PID, prints the mismatch to stderr and returns
# 42 only for that exact case; malformed
# MainPID and every other failure return 1.
poc3_kwin_systemd_fallback() {
  local owner="${1:-}" pid="${2:-}" tick="${3:-}"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || { echo "error: KWin owner is not a unique name" >&2; return 1; }
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || { echo "error: KWin PID is malformed" >&2; return 1; }
  [[ "$tick" =~ ^[1-9][0-9]*$ ]] || { echo "error: KWin start tick is malformed" >&2; return 1; }
  local proc_root="${PROC_ROOT:-/proc}"
  if [[ "$proc_root" != /proc ]]; then
    [[ "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC:-0}" == 1 ]] || { echo "error: PROC_ROOT must be /proc in production" >&2; return 1; }
    poc3_kwin_identity_safe_abs "$proc_root" || { echo "error: PROC_ROOT is unsafe" >&2; return 1; }
  fi
  local systemctl_bin stat_bin readlink_bin sha_bin
  systemctl_bin="$(poc3_kwin_identity_tool "${SYSTEMCTL_BIN:-systemctl}")" || { echo "error: systemctl tool is unavailable" >&2; return 1; }
  stat_bin="$(poc3_kwin_identity_tool "${STAT_BIN:-stat}")" || { echo "error: stat tool is unavailable" >&2; return 1; }
  readlink_bin="$(poc3_kwin_identity_tool "${READLINK_BIN:-readlink}")" || { echo "error: readlink tool is unavailable" >&2; return 1; }
  sha_bin="$(poc3_kwin_identity_tool "${SHA256SUM_BIN:-sha256sum}")" || { echo "error: sha256sum tool is unavailable" >&2; return 1; }
  local live_tick
  live_tick="$(poc3_kwin_identity_proc_tick "$pid")" || { echo "error: KWin PID $pid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  [[ "$live_tick" == "$tick" ]] || { echo "error: KWin start-tick mismatch (PID reuse suspected)" >&2; return 1; }
  local boot
  boot="$(poc3_kwin_identity_boot_id)" || { echo "error: boot ID is unreadable or malformed" >&2; return 1; }
  local show_out
  show_out="$("$systemctl_bin" --user --no-pager show plasma-kwin_wayland.service --property=Id,ActiveState,SubState,MainPID,Type,BusName,ExecStart,FragmentPath,SourcePath 2>/dev/null)" || { echo "error: systemctl show failed for plasma-kwin_wayland.service" >&2; return 1; }
  [[ -n "$show_out" && "$show_out" != *$'\r'* ]] || { echo "error: systemctl show reply is empty or malformed" >&2; return 1; }
  local unit="" active="" sub="" mainpid="" utype="" busname="" exec_raw="" fragment="" source="" seen=""
  local line name value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" && "$line" == *"="* ]] || { echo "error: systemctl show line is malformed" >&2; return 1; }
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$value" != *$'\n'* ]] || { echo "error: systemctl show value is malformed" >&2; return 1; }
    case "$name" in
      Id|ActiveState|SubState|MainPID|Type|BusName|ExecStart|FragmentPath|SourcePath) ;;
      *) { echo "error: unexpected systemctl property: $name" >&2; return 1; } ;;
    esac
    case "$seen" in *"|$name|"*) { echo "error: duplicate systemctl property: $name" >&2; return 1; } ;; esac
    seen="${seen}|${name}|"
    case "$name" in
      Id) unit="$value" ;;
      ActiveState) active="$value" ;;
      SubState) sub="$value" ;;
      MainPID) mainpid="$value" ;;
      Type) utype="$value" ;;
      BusName) busname="$value" ;;
      ExecStart) exec_raw="$value" ;;
      FragmentPath) fragment="$value" ;;
      SourcePath) source="$value" ;;
    esac
  done <<<"$show_out"
  [[ -n "$unit" && -n "$active" && -n "$sub" && -n "$mainpid" && -n "$utype" && -n "$busname" && -n "$exec_raw" && -n "$fragment" ]] || { echo "error: systemctl show reply is missing required unit identity" >&2; return 1; }
  case "$seen" in *"|SourcePath|"*) ;; *) { echo "error: systemctl show reply is missing SourcePath" >&2; return 1; } ;; esac
  [[ "$unit" == "plasma-kwin_wayland.service" ]] || { echo "error: unit Id mismatch: $unit" >&2; return 1; }
  [[ "$active" == "active" ]] || { echo "error: unit is not active: $active" >&2; return 1; }
  [[ "$sub" == "running" ]] || { echo "error: unit is not running: $sub" >&2; return 1; }
  if ! [[ "$mainpid" =~ ^[1-9][0-9]*$ ]]; then
    echo "error: unit MainPID $mainpid is not an exact process identity" >&2
    return 1
  fi
  if [[ "$mainpid" != "$pid" ]]; then
    echo "error: unit MainPID $mainpid does not match KWin PID $pid" >&2
    return 42
  fi
  [[ "$utype" == "dbus" ]] || { echo "error: unit Type is not dbus: $utype" >&2; return 1; }
  [[ "$busname" == "org.kde.KWinWrapper" ]] || { echo "error: unit BusName mismatch: $busname" >&2; return 1; }
  poc3_kwin_identity_safe_abs "$fragment" || { echo "error: unit FragmentPath is unsafe" >&2; return 1; }
  if [[ -n "$source" ]]; then
    poc3_kwin_identity_safe_abs "$source" || { echo "error: unit SourcePath is unsafe" >&2; return 1; }
  fi
  local exec_path
  exec_path="$(poc3_kwin_identity_parse_execstart "$exec_raw")" || { echo "error: unit ExecStart is ambiguous, malformed, or not an exact executable identity" >&2; return 1; }
  local _pair_out=""
  if ! _pair_out="$(poc3_kwin_identity_pin_pair "$exec_path" "$readlink_bin" "$stat_bin" "$sha_bin")"; then
    echo "error: unit ExecStart is not an exact wrapper-pair executable identity" >&2
    return 1
  fi
  local -a _pair=()
  mapfile -t _pair <<<"$_pair_out" || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  [[ "${#_pair[@]}" -eq 11 ]] || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  local launcher_canon="${_pair[0]}" launcher_sha="${_pair[1]}" launcher_dev="${_pair[2]}" launcher_ino="${_pair[3]}" launcher_mode="${_pair[4]}"
  local canon="${_pair[5]}" sha="${_pair[6]}" dev="${_pair[7]}" ino="${_pair[8]}" wmode="${_pair[9]}" pkg_root="${_pair[10]}"
  [[ -n "$launcher_canon" && -n "$canon" && -n "$pkg_root" ]] || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  [[ -n "$launcher_mode" && -n "$wmode" ]] || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  local proc_target proc_canon
  if proc_target="$("$readlink_bin" -- "$proc_root/$pid/exe" 2>/dev/null)"; then
    [[ -n "$proc_target" && "$proc_target" == /* ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$proc_target" != *' (deleted)'* ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    proc_canon="$("$readlink_bin" -f -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$proc_canon" == "$canon" ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    local _p_dev _p_ino _p_mode _p_ftype _p_line _p_sha
    _p_dev="$("$stat_bin" -L -c '%d' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _p_ino="$("$stat_bin" -L -c '%i' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _p_mode="$("$stat_bin" -L -c '%a' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _p_ftype="$("$stat_bin" -L -c '%F' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$_p_ftype" == regular* ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$_p_dev" == "$dev" && "$_p_ino" == "$ino" && "$_p_mode" == "$wmode" ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _p_line="$("$sha_bin" -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _p_sha="${_p_line%% *}"
    [[ "$_p_sha" == "$sha" ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    local _re_out=""
    if ! _re_out="$(poc3_kwin_identity_pin_pair "$exec_path" "$readlink_bin" "$stat_bin" "$sha_bin")"; then
      echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2
      return 1
    fi
    local -a _re=()
    mapfile -t _re <<<"$_re_out" || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
    [[ "${#_re[@]}" -eq 11 ]] || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
    [[ "${_re[0]}" == "$launcher_canon" && "${_re[1]}" == "$launcher_sha" && "${_re[2]}" == "$launcher_dev" && "${_re[3]}" == "$launcher_ino" && "${_re[4]}" == "$launcher_mode" ]] || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
    [[ "${_re[5]}" == "$canon" && "${_re[6]}" == "$sha" && "${_re[7]}" == "$dev" && "${_re[8]}" == "$ino" && "${_re[9]}" == "$wmode" && "${_re[10]}" == "$pkg_root" ]] || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
  fi
  local live_tick_end
  live_tick_end="$(poc3_kwin_identity_proc_tick "$pid")" || { echo "error: KWin PID $pid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  [[ "$live_tick_end" == "$tick" ]] || { echo "error: KWin start-tick mismatch (PID reuse suspected)" >&2; return 1; }
  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    "$canon" "$boot" "$sha" "$dev" "$ino" "$wmode" "$launcher_canon" "$launcher_sha" "$launcher_dev" "$launcher_ino" "$launcher_mode" "$pkg_root" "$unit" "$active" "$sub" "$mainpid" "$utype" "$busname" "$exec_path" "$fragment" "$source"
}

# Authorized direct-parent fallback:
#   poc3_kwin_direct_parent_fallback <owner> <pid> <tick>.
# Caller must pass the D-Bus-pinned org.kde.KWin unique owner, PID, and
# /proc start tick. Accepts the owner PID only when its direct PPid exactly
# equals the plasma-kwin_wayland.service MainPID (one level; deeper
# descendants refused, no process-table scans, no same-name or command-line
# trust). Pins the MainPID start tick, the active/running unit identity,
# the immutable wrapper-pair executable identity (launcher and wrapped
# canonical path hash/device/inode/mode plus package root), the boot ID, and the
# owner cgroup root "0::/" before and after; any
# owner/PID/PPid/tick/unit/MainPID/ExecStart/boot/cgroup drift fails closed
# with no partial identity. A readable MainPID /proc exe must match only the
# wrapped pin in canonical path, device/inode, hash, and mode; a readable
# owner /proc exe must match the same wrapped pin too (owner disagreement
# fails closed). After any readable proc agreement the pair is revalidated
# once more.
# The "0::/" cgroup is recorded as a platform fact only; same-unit cgroup
# containment is never claimed. Prints 25 lines on success.
poc3_kwin_direct_parent_fallback() {
  local owner="${1:-}" pid="${2:-}" tick="${3:-}"
  [[ "$owner" =~ ^:[0-9]+\.[0-9]+$ ]] || { echo "error: KWin owner is not a unique name" >&2; return 1; }
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || { echo "error: KWin PID is malformed" >&2; return 1; }
  [[ "$tick" =~ ^[1-9][0-9]*$ ]] || { echo "error: KWin start tick is malformed" >&2; return 1; }
  local proc_root="${PROC_ROOT:-/proc}"
  if [[ "$proc_root" != /proc ]]; then
    [[ "${POC3_KWIN_IDENTITY_TEST_ALLOW_NONPROC:-0}" == 1 ]] || { echo "error: PROC_ROOT must be /proc in production" >&2; return 1; }
    poc3_kwin_identity_safe_abs "$proc_root" || { echo "error: PROC_ROOT is unsafe" >&2; return 1; }
  fi
  local systemctl_bin stat_bin readlink_bin sha_bin
  systemctl_bin="$(poc3_kwin_identity_tool "${SYSTEMCTL_BIN:-systemctl}")" || { echo "error: systemctl tool is unavailable" >&2; return 1; }
  stat_bin="$(poc3_kwin_identity_tool "${STAT_BIN:-stat}")" || { echo "error: stat tool is unavailable" >&2; return 1; }
  readlink_bin="$(poc3_kwin_identity_tool "${READLINK_BIN:-readlink}")" || { echo "error: readlink tool is unavailable" >&2; return 1; }
  sha_bin="$(poc3_kwin_identity_tool "${SHA256SUM_BIN:-sha256sum}")" || { echo "error: sha256sum tool is unavailable" >&2; return 1; }
  local live_tick ppid
  live_tick="$(poc3_kwin_identity_proc_tick "$pid")" || { echo "error: KWin PID $pid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  [[ "$live_tick" == "$tick" ]] || { echo "error: KWin start-tick mismatch (PID reuse suspected)" >&2; return 1; }
  ppid="$(poc3_kwin_identity_proc_ppid "$pid")" || { echo "error: KWin PID $pid parent identity is unreadable" >&2; return 1; }
  local boot
  boot="$(poc3_kwin_identity_boot_id)" || { echo "error: boot ID is unreadable or malformed" >&2; return 1; }
  local cgroup
  cgroup="$(poc3_kwin_identity_owner_cgroup "$pid")" || { echo "error: KWin owner cgroup is not the accepted host-pilot root" >&2; return 1; }
  local show_out
  show_out="$("$systemctl_bin" --user --no-pager show plasma-kwin_wayland.service --property=Id,ActiveState,SubState,MainPID,Type,BusName,ExecStart,FragmentPath,SourcePath 2>/dev/null)" || { echo "error: systemctl show failed for plasma-kwin_wayland.service" >&2; return 1; }
  [[ -n "$show_out" && "$show_out" != *$'\r'* ]] || { echo "error: systemctl show reply is empty or malformed" >&2; return 1; }
  local unit="" active="" sub="" mainpid="" utype="" busname="" exec_raw="" fragment="" source="" seen=""
  local line name value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" && "$line" == *"="* ]] || { echo "error: systemctl show line is malformed" >&2; return 1; }
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$value" != *$'\n'* ]] || { echo "error: systemctl show value is malformed" >&2; return 1; }
    case "$name" in
      Id|ActiveState|SubState|MainPID|Type|BusName|ExecStart|FragmentPath|SourcePath) ;;
      *) { echo "error: unexpected systemctl property: $name" >&2; return 1; } ;;
    esac
    case "$seen" in *"|$name|"*) { echo "error: duplicate systemctl property: $name" >&2; return 1; } ;; esac
    seen="${seen}|${name}|"
    case "$name" in
      Id) unit="$value" ;;
      ActiveState) active="$value" ;;
      SubState) sub="$value" ;;
      MainPID) mainpid="$value" ;;
      Type) utype="$value" ;;
      BusName) busname="$value" ;;
      ExecStart) exec_raw="$value" ;;
      FragmentPath) fragment="$value" ;;
      SourcePath) source="$value" ;;
    esac
  done <<<"$show_out"
  [[ -n "$unit" && -n "$active" && -n "$sub" && -n "$mainpid" && -n "$utype" && -n "$busname" && -n "$exec_raw" && -n "$fragment" ]] || { echo "error: systemctl show reply is missing required unit identity" >&2; return 1; }
  case "$seen" in *"|SourcePath|"*) ;; *) { echo "error: systemctl show reply is missing SourcePath" >&2; return 1; } ;; esac
  [[ "$unit" == "plasma-kwin_wayland.service" ]] || { echo "error: unit Id mismatch: $unit" >&2; return 1; }
  [[ "$active" == "active" ]] || { echo "error: unit is not active: $active" >&2; return 1; }
  [[ "$sub" == "running" ]] || { echo "error: unit is not running: $sub" >&2; return 1; }
  [[ "$mainpid" =~ ^[1-9][0-9]*$ ]] || { echo "error: unit MainPID $mainpid is not an exact process identity" >&2; return 1; }
  [[ "$pid" != "$mainpid" ]] || { echo "error: direct-parent mode requires the owner PID below the unit MainPID" >&2; return 1; }
  [[ "$ppid" == "$mainpid" ]] || { echo "error: KWin owner PPid $ppid is not the direct unit MainPID $mainpid" >&2; return 1; }
  [[ "$utype" == "dbus" ]] || { echo "error: unit Type is not dbus: $utype" >&2; return 1; }
  [[ "$busname" == "org.kde.KWinWrapper" ]] || { echo "error: unit BusName mismatch: $busname" >&2; return 1; }
  poc3_kwin_identity_safe_abs "$fragment" || { echo "error: unit FragmentPath is unsafe" >&2; return 1; }
  if [[ -n "$source" ]]; then
    poc3_kwin_identity_safe_abs "$source" || { echo "error: unit SourcePath is unsafe" >&2; return 1; }
  fi
  local exec_path
  exec_path="$(poc3_kwin_identity_parse_execstart "$exec_raw")" || { echo "error: unit ExecStart is ambiguous, malformed, or not an exact executable identity" >&2; return 1; }
  local _pair_out=""
  if ! _pair_out="$(poc3_kwin_identity_pin_pair "$exec_path" "$readlink_bin" "$stat_bin" "$sha_bin")"; then
    echo "error: unit ExecStart is not an exact wrapper-pair executable identity" >&2
    return 1
  fi
  local -a _pair=()
  mapfile -t _pair <<<"$_pair_out" || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  [[ "${#_pair[@]}" -eq 11 ]] || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  local launcher_canon="${_pair[0]}" launcher_sha="${_pair[1]}" launcher_dev="${_pair[2]}" launcher_ino="${_pair[3]}" launcher_mode="${_pair[4]}"
  local canon="${_pair[5]}" sha="${_pair[6]}" dev="${_pair[7]}" ino="${_pair[8]}" wmode="${_pair[9]}" pkg_root="${_pair[10]}"
  [[ -n "$launcher_canon" && -n "$canon" && -n "$pkg_root" ]] || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  [[ -n "$launcher_mode" && -n "$wmode" ]] || { echo "error: wrapper-pair identity capture is ambiguous" >&2; return 1; }
  local main_tick
  main_tick="$(poc3_kwin_identity_proc_tick "$mainpid")" || { echo "error: unit MainPID $mainpid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  local owner_target owner_canon main_target main_canon
  local _proc_checked=0
  if owner_target="$("$readlink_bin" -- "$proc_root/$pid/exe" 2>/dev/null)"; then
    [[ -n "$owner_target" && "$owner_target" == /* ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$owner_target" != *' (deleted)'* ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    owner_canon="$("$readlink_bin" -f -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$owner_canon" == "$canon" ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    local _o_dev _o_ino _o_mode _o_ftype _o_line _o_sha
    _o_dev="$("$stat_bin" -L -c '%d' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _o_ino="$("$stat_bin" -L -c '%i' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _o_mode="$("$stat_bin" -L -c '%a' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _o_ftype="$("$stat_bin" -L -c '%F' -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$_o_ftype" == regular* ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$_o_dev" == "$dev" && "$_o_ino" == "$ino" && "$_o_mode" == "$wmode" ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _o_line="$("$sha_bin" -- "$proc_root/$pid/exe" 2>/dev/null)" || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _o_sha="${_o_line%% *}"
    [[ "$_o_sha" == "$sha" ]] || { echo "error: live executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _proc_checked=1
  fi
  if main_target="$("$readlink_bin" -- "$proc_root/$mainpid/exe" 2>/dev/null)"; then
    [[ -n "$main_target" && "$main_target" == /* ]] || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$main_target" != *' (deleted)'* ]] || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    main_canon="$("$readlink_bin" -f -- "$proc_root/$mainpid/exe" 2>/dev/null)" || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$main_canon" == "$canon" ]] || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    local _m_dev _m_ino _m_mode _m_ftype _m_line _m_sha
    _m_dev="$("$stat_bin" -L -c '%d' -- "$proc_root/$mainpid/exe" 2>/dev/null)" || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _m_ino="$("$stat_bin" -L -c '%i' -- "$proc_root/$mainpid/exe" 2>/dev/null)" || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _m_mode="$("$stat_bin" -L -c '%a' -- "$proc_root/$mainpid/exe" 2>/dev/null)" || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _m_ftype="$("$stat_bin" -L -c '%F' -- "$proc_root/$mainpid/exe" 2>/dev/null)" || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$_m_ftype" == regular* ]] || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    [[ "$_m_dev" == "$dev" && "$_m_ino" == "$ino" && "$_m_mode" == "$wmode" ]] || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _m_line="$("$sha_bin" -- "$proc_root/$mainpid/exe" 2>/dev/null)" || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _m_sha="${_m_line%% *}"
    [[ "$_m_sha" == "$sha" ]] || { echo "error: unit MainPID executable identity disagrees with the canonical wrapped identity" >&2; return 1; }
    _proc_checked=1
  fi
  if [[ "$_proc_checked" == 1 ]]; then
    local _re_out=""
    if ! _re_out="$(poc3_kwin_identity_pin_pair "$exec_path" "$readlink_bin" "$stat_bin" "$sha_bin")"; then
      echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2
      return 1
    fi
    local -a _re=()
    mapfile -t _re <<<"$_re_out" || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
    [[ "${#_re[@]}" -eq 11 ]] || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
    [[ "${_re[0]}" == "$launcher_canon" && "${_re[1]}" == "$launcher_sha" && "${_re[2]}" == "$launcher_dev" && "${_re[3]}" == "$launcher_ino" && "${_re[4]}" == "$launcher_mode" ]] || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
    [[ "${_re[5]}" == "$canon" && "${_re[6]}" == "$sha" && "${_re[7]}" == "$dev" && "${_re[8]}" == "$ino" && "${_re[9]}" == "$wmode" && "${_re[10]}" == "$pkg_root" ]] || { echo "error: wrapper-pair revalidation drift detected; refusing ambiguous identity" >&2; return 1; }
  fi
  local live_tick_end ppid_end main_tick_end cgroup_end boot_end
  live_tick_end="$(poc3_kwin_identity_proc_tick "$pid")" || { echo "error: KWin PID $pid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  [[ "$live_tick_end" == "$tick" ]] || { echo "error: KWin start-tick mismatch (PID reuse suspected)" >&2; return 1; }
  ppid_end="$(poc3_kwin_identity_proc_ppid "$pid")" || { echo "error: KWin PID $pid parent identity is unreadable" >&2; return 1; }
  [[ "$ppid_end" == "$ppid" ]] || { echo "error: KWin owner parent drift detected (PPid reuse suspected)" >&2; return 1; }
  main_tick_end="$(poc3_kwin_identity_proc_tick "$mainpid")" || { echo "error: unit MainPID $mainpid is stale or unreadable (PID reuse suspected)" >&2; return 1; }
  [[ "$main_tick_end" == "$main_tick" ]] || { echo "error: unit MainPID start-tick mismatch (PID reuse suspected)" >&2; return 1; }
  cgroup_end="$(poc3_kwin_identity_owner_cgroup "$pid")" || { echo "error: KWin owner cgroup drift detected" >&2; return 1; }
  [[ "$cgroup_end" == "$cgroup" ]] || { echo "error: KWin owner cgroup drift detected" >&2; return 1; }
  boot_end="$(poc3_kwin_identity_boot_id)" || { echo "error: boot ID is unreadable or malformed" >&2; return 1; }
  [[ "$boot_end" == "$boot" ]] || { echo "error: boot ID drift detected" >&2; return 1; }
  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    "$canon" "$boot" "$sha" "$dev" "$ino" "$wmode" "$launcher_canon" "$launcher_sha" "$launcher_dev" "$launcher_ino" "$launcher_mode" "$pkg_root" "$unit" "$active" "$sub" "$mainpid" "$main_tick" "$ppid" "$cgroup" "$utype" "$busname" "$exec_path" "$fragment" "$source" "direct-parent"
}
