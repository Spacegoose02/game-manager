#!/bin/sh
# Started as root (the default), make /data belong to PUID:PGID (Unraid's
# nobody:users, 99:100, unless set otherwise); the server then drops to that user
# (packages/server/src/privileges.ts). Started with --user, nothing to do.
set -e
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-99}"
  PGID="${PGID:-100}"
  mkdir -p "$GM_DATA_DIR"
  if [ "$(stat -c %u:%g "$GM_DATA_DIR")" != "$PUID:$PGID" ]; then
    echo "Setting owner of $GM_DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$GM_DATA_DIR"
  fi
fi
exec "$@"
