#!/bin/sh
# Launch one isolated nested kwin_wayland compositor for live validation.
#
# The nested compositor runs under its own dbus-run-session with private
# XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, XDG_STATE_HOME,
# XDG_RUNTIME_DIR and KDEHOME, all pointing into the per-run WORKDIR, so it
# can never read or write the user's KDE configuration. The runtime directory
# is owned by the calling user with mode 0700 to avoid crash or refusal from
# unsafe runtime-dir ownership/mode. Never uses --windowed.
#
# A private XDG_RUNTIME_DIR breaks the nested kwin's Wayland-backend
# connection to the host compositor, because a relative display name resolves
# under XDG_RUNTIME_DIR. The parent display is therefore exported and passed
# as the absolute path /run/user/<uid>/wayland-0 via --wayland-display.
# VALIDATED at unit-02/attempt-02 (/tmp/opencode/pat-u19-a03/u27a02); the
# pre-correction recipe failed at unit-02/attempt-01 (/tmp/opencode/pat-u19-a03/u27a01).
#
# Usage: nested-kwin-spike.sh WORKDIR
#   WORKDIR  per-run directory that owns all nested state; created fresh.
# Prints "READY launcher=<pid> nested=<pid> bus=<address>" on success.
set -u
WORKDIR="${1:?usage: nested-kwin-spike.sh WORKDIR}"
KWIN="${KWIN_BIN:-/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/bin/kwin_wayland}"
BUS="$WORKDIR/bus.txt"
LOG="$WORKDIR/nested.log"
mkdir "$WORKDIR" 2>/dev/null || { echo "error: WORKDIR must be fresh and not exist: $WORKDIR" >&2; exit 1; }
rm -f "$BUS" "$LOG"
mkdir -p "$WORKDIR/config" "$WORKDIR/cache" "$WORKDIR/data" "$WORKDIR/state" "$WORKDIR/runtime"
chmod 700 "$WORKDIR/runtime"
dbus-run-session -- /bin/sh -c 'echo "$DBUS_SESSION_BUS_ADDRESS" > "$1"; export XDG_CONFIG_HOME="$2/config"; export XDG_CACHE_HOME="$2/cache"; export XDG_DATA_HOME="$2/data"; export XDG_STATE_HOME="$2/state"; export XDG_RUNTIME_DIR="$2/runtime"; export KDEHOME="$2"; export WAYLAND_DISPLAY="/run/user/$4/wayland-0"; exec "$3" --wayland-display "$WAYLAND_DISPLAY" --socket nested-kwin-spike --width 640 --height 480 --no-global-shortcuts --no-kactivities --no-lockscreen' /bin/sh "$BUS" "$WORKDIR" "$KWIN" "$(id -u)" >"$LOG" 2>&1 &
LP=$!
echo "$LP" > "$WORKDIR/launcher.pid"
i=0
while [ $i -lt 300 ]; do
  if [ -s "$BUS" ] && busctl --address="$(cat "$BUS")" introspect org.kde.KWin /KWin org.kde.KWin >/dev/null 2>&1; then
    NP=$(ps --ppid "$LP" -o pid=,comm= 2>/dev/null | awk '$2 ~ /kwin_wayland/ {print $1}' | head -1)
    if [ -n "$NP" ]; then
      echo "$NP" > "$WORKDIR/nested.pid"
      echo "READY launcher=$LP nested=$NP bus=$(cat "$BUS")"
      exit 0
    fi
  fi
  i=$((i+1))
  sleep 0.1
done
echo "NOT-READY" >&2
exit 1
