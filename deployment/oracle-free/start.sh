#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p "$HOME" "${DATA_DIR:-/data}"
# One service/probe owns the volume. Keep this kernel lock for the whole process tree.
exec 9>"${DATA_DIR:-/data}/worker.lock"
flock -E 73 -n 9
children=()
cleanup() {
 trap - EXIT TERM INT
 # Preserve session checkpoints before removing the browser display.
 if [ "${#children[@]}" -gt 0 ]; then
  service_pid="${children[-1]}"
  kill -TERM "$service_pid" 2>/dev/null || true
  for _ in {1..90}; do kill -0 "$service_pid" 2>/dev/null || break; sleep 1; done
  kill -KILL "$service_pid" 2>/dev/null || true
  wait "$service_pid" 2>/dev/null || true
 fi
 for pid in "${children[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
 for pid in "${children[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT TERM INT
Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp -ac & children+=("$!")
for _ in {1..50}; do [ -S /tmp/.X11-unix/X99 ] && break; sleep .1; done
[ -S /tmp/.X11-unix/X99 ] || exit 1
openbox --sm-disable >/tmp/openbox.log 2>&1 & children+=("$!")
if [ "${1:-}" = probe ]; then
 shift
 node tools/capacity-probe.mjs "$@" & children+=("$!")
 wait "${children[-1]}"
 exit "$?"
fi
# VNC and WebSocket ports are loopback-only INSIDE the container. The Node
# gateway authenticates both viewer HTTP and WebSocket upgrades server-side.
x11vnc -display "$DISPLAY" -localhost -listen 127.0.0.1 -no6 -rfbport 5900 -nopw -forever -shared -nosel -noclipboard -nosetclipboard -noxrecord >/tmp/vnc.log 2>&1 & children+=("$!")
websockify --heartbeat=20 127.0.0.1:6081 127.0.0.1:5900 >/tmp/websockify.log 2>&1 & children+=("$!")
node dist/oracle-server.cjs & children+=("$!")
# Any essential component exiting terminates the container; Docker applies bounded backoff.
set +e
wait -n "${children[@]}"
status=$?
set -e
[ "$status" -ne 0 ] || status=1
exit "$status"
