#!/usr/bin/env bash
# Wait for a CI service container (mongodb / redis) to answer a protocol-level
# health check.
#
# The previous version shelled out to `mongosh` and `redis-cli`. Neither is
# installed on GitHub-hosted runners, so `command -v` always failed, the check
# could never succeed, and every job died with "did not become ready" no matter
# how healthy the service container was.
#
# This version uses what the repository already installs: Node with the MongoDB
# driver bundled inside mongoose, and the `redis` client. If node_modules is not
# there yet (the script is called before `npm ci` in some jobs), it falls back to
# a TCP connect, which at least proves the container is listening.
set -u

service="${1:-}"
attempts="${WAIT_ATTEMPTS:-30}"

MONGO_HOST="${MONGO_HOST:-127.0.0.1}"
MONGO_PORT="${MONGO_PORT:-27017}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

tcp_open() {
  (exec 3<>"/dev/tcp/$1/$2") >/dev/null 2>&1
}

# Every attempt is hard-bounded: a container that accepts a TCP connection but
# never answers the protocol must not stall the whole job.
ATTEMPT_TIMEOUT_SECONDS="${ATTEMPT_TIMEOUT_SECONDS:-5}"

mongo_ping() {
  CHECK_URI="$1" timeout "$ATTEMPT_TIMEOUT_SECONDS" node --input-type=module -e '
    const mongoose = (await import("mongoose")).default;
    const client = new mongoose.mongo.MongoClient(process.env.CHECK_URI, {
      serverSelectionTimeoutMS: 2000,
    });
    let ok = false;
    try {
      await client.connect();
      const result = await client.db("admin").command({ ping: 1 });
      ok = result.ok === 1;
    } catch {
      ok = false;
    }
    await client.close().catch(() => {});
    process.exit(ok ? 0 : 1);
  '
}

redis_ping() {
  CHECK_URI="$1" timeout "$ATTEMPT_TIMEOUT_SECONDS" node --input-type=module -e '
    const { createClient } = await import("redis");
    const client = createClient({
      url: process.env.CHECK_URI,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    client.on("error", () => {});
    let ok = false;
    try {
      await client.connect();
      ok = (await client.ping()) === "PONG";
    } catch {
      ok = false;
    }
    await client.disconnect().catch(() => {});
    process.exit(ok ? 0 : 1);
  '
}

module_available() {
  node -e "import('$1').then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1
}

check_service() {
  case "$service" in
    mongodb)
      if module_available mongoose; then
        mongo_ping "mongodb://${MONGO_HOST}:${MONGO_PORT}/admin"
      else
        tcp_open "$MONGO_HOST" "$MONGO_PORT"
      fi
      ;;
    redis)
      if module_available redis; then
        redis_ping "redis://${REDIS_HOST}:${REDIS_PORT}"
      else
        tcp_open "$REDIS_HOST" "$REDIS_PORT"
      fi
      ;;
    *)
      echo "Unknown service: ${service:-<missing>}" >&2
      return 2
      ;;
  esac
}

# Fail fast on a typo instead of sleeping through every attempt.
case "$service" in
  mongodb|redis) ;;
  *)
    echo "Unknown service: ${service:-<missing>} (expected mongodb or redis)" >&2
    exit 2
    ;;
esac

for attempt in $(seq 1 "$attempts"); do
  if check_service; then
    echo "$service is reachable and answered its protocol health check"
    exit 0
  fi
  echo "Waiting for $service readiness ($attempt/$attempts)..."
  sleep 1
done

echo "$service did not become ready after $attempts attempts" >&2
if command -v docker >/dev/null 2>&1; then
  echo "Containers on this runner:" >&2
  docker ps --format '  {{.Names}} {{.Image}} {{.Status}}' >&2 2>/dev/null || true
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '\n### Dependency readiness failure\n- `%s` did not answer its protocol health check after %s attempts.\n' "$service" "$attempts" >> "$GITHUB_STEP_SUMMARY"
fi
exit 1
