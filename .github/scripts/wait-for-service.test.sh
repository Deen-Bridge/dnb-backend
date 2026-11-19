#!/usr/bin/env bash
set -u
set +e
output=$(WAIT_ATTEMPTS=1 bash "$(dirname "$0")/wait-for-service.sh" unsupported 2>&1)
status=$?
set -e
test "$status" -eq 2
grep -q "Unknown service" <<< "$output"
echo "wait-for-service failure path passed"
