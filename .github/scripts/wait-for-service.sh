#!/usr/bin/env bash
set -u

service="${1:-}"
attempts="${WAIT_ATTEMPTS:-30}"

check_service() {
  case "$service" in
    mongodb)
      command -v mongosh >/dev/null 2>&1 && mongosh --quiet --host 127.0.0.1:27017 --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -qx '1'
      ;;
    redis)
      command -v redis-cli >/dev/null 2>&1 && test "$(redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null)" = PONG
      ;;
    *)
      echo "Unknown service: ${service:-<missing>}" >&2
      return 2
      ;;
  esac
}

for attempt in $(seq 1 "$attempts"); do
  if check_service; then
    echo "$service is reachable and answered its protocol health check"
    exit 0
  fi
  echo "Waiting for $service readiness ($attempt/$attempts)..."
  sleep 1
done

echo "$service did not become ready after $attempts attempts" >&2
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '\n### Dependency readiness failure\n- `%s` did not answer its protocol health check after %s attempts.\n' "$service" "$attempts" >> "$GITHUB_STEP_SUMMARY"
fi
exit 1
