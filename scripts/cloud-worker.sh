#!/bin/sh
set -eu
: "${DATA_DIR:?DATA_DIR is required}"
mkdir -p "$DATA_DIR"
# Kernel lock lives on the persistent volume. Never remove this file to force a restart.
exec flock -E 73 -n "$DATA_DIR/worker.lock" node dist/cloud-worker.cjs
