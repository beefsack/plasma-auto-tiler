#!/usr/bin/env bash
# Safe route-diag log aggregation: snapshot/follow over the current boot only.
#
# Reads the full current-user current-boot journal via `journalctl --user -b`
# and then fixed-string filters on the shared anchor, so KWin, Planner, and
# tray autostart records appear together. The tray autostart entry has no
# committed systemd unit, so a `-u` restriction would silently exclude it;
# visible output stays exclusively anchored project records via `grep -F`.
# KWin/Planner unit names below are retained as documented source metadata.
# Never invokes D-Bus, systemctl, busctl, qdbus, or gdbus, and never
# activates anything.
#
# Usage:
#   route-diag-follow.sh [--follow] [--corr <token>] [--gen <token>] [--no-pointer]
#
# Build identity (stale-build check): one bridge startup line
# (`...:lifecycle:comp=bridge:event=started:gen=<id>:version=0.1.0:result=ok`)
# and one planner line (`...:comp=planner:event=started:gen=<id>:version=0.1.0:result=ok`),
# where <id> is self.rev or local-dev. Compare with --gen <id>; mismatch means
# mixed builds. Installed build-id files (KWin contents, tray
# share/plasma-auto-tiler) carry package=/version=/source= lines; source=
# equals the gen= token that build emits.
#
# Options:
#   --follow       stream new lines (journalctl -f); default prints a snapshot
#   --corr TOKEN   keep only lines containing the validated correlation token
#   --gen TOKEN    keep only lines containing the validated generation token
#   --no-pointer   suppress KWin pointer coalescing summary lines (:ptr:)
#
# Environment overrides (hermetic shell tests):
#   JOURNALCTL_BIN, GREP_BIN
set -euo pipefail

ANCHOR="plasma-auto-tiler:route-diag"
KWIN_UNIT="plasma-kwin_wayland.service"
PLANNER_UNIT="plasma-auto-tiler-planner.service"

: "${JOURNALCTL_BIN:=journalctl}"
: "${GREP_BIN:=grep}"

FOLLOW=0
CORR=""
GEN=""
NO_POINTER=0

usage() {
  printf 'usage: %s [--follow] [--corr <token>] [--gen <token>] [--no-pointer]\n' "${0##*/}" >&2
}

# Closed token alphabets mirror the route-diag validators: corr tokens are
# bounded opaque ids, gen tokens are lowercase/digit/dash. Anything else is
# rejected without invoking any command.
valid_corr() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9._-]{1,128}$ ]]
}

valid_gen() {
  local value="$1"
  [[ "$value" =~ ^[a-z0-9-]{1,64}$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --follow)
      FOLLOW=1
      shift
      ;;
    --no-pointer)
      NO_POINTER=1
      shift
      ;;
    --corr)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      valid_corr "$2" || { printf 'error: invalid --corr token\n' >&2; exit 2; }
      CORR="$2"
      shift 2
      ;;
    --gen)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      valid_gen "$2" || { printf 'error: invalid --gen token\n' >&2; exit 2; }
      GEN="$2"
      shift 2
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

# Documented source units (source specificity only; the journal invocation
# below intentionally carries no `-u` restriction so the unit-less tray
# autostart stderr is included; anchor filtering keeps visible output exact).
# Exactly one journal source: current boot, current user, full journal.
# No `-u` restriction (tray autostart has no committed unit), no other
# flags, no activation verbs.
journal_args=(--user -b)
if [[ "$FOLLOW" == 1 ]]; then
  journal_args+=(-f)
fi

# Fixed-string filtering only: anchor first, then optional validated tokens.
# Quoted arrays throughout; never eval, never a shell expansion of tokens.
# Explicit branches so an empty filter passes lines through instead of
# consuming stdin silently.
filter_anchor() {
  "$GREP_BIN" -F -- "$ANCHOR"
}

filter_corr() {
  if [[ -n "$CORR" ]]; then
    "$GREP_BIN" -F -- "$CORR"
  else
    cat
  fi
}

filter_gen() {
  if [[ -n "$GEN" ]]; then
    "$GREP_BIN" -F -- "$GEN"
  else
    cat
  fi
}

filter_pointer() {
  if [[ "$NO_POINTER" == 1 ]]; then
    "$GREP_BIN" -F -v -- ":ptr:"
  else
    cat
  fi
}

"$JOURNALCTL_BIN" "${journal_args[@]}" | filter_anchor | filter_corr | filter_gen | filter_pointer
