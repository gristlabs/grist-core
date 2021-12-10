#!/bin/bash

# This runs browser tests with the server started using docker, to
# catch any configuration problems.
# Run with MOCHA_WEBDRIVER_HEADLESS=1 for headless operation.
# Run with VERBOSE=1 for server logs.

# Settings for script robustness
set -o pipefail  # trace ERR through pipes
set -o nounset   # same as set -u : treat unset variables as an error
set -o errtrace  # same as set -E: inherit ERR trap in functions
set -o errexit   # same as set -e: exit on command failures
trap 'cleanup' EXIT
trap 'echo "Exiting on SIGINT"; exit 1' INT
trap 'echo "Exiting on SIGTERM"; exit 1' TERM

PORT=8585
DOCKER_CONTAINER=grist-core-test
DOCKER_PID=""

cleanup() {
  docker rm -f $DOCKER_CONTAINER
  if [ -n "$DOCKER_PID" ]; then
    wait $DOCKER_PID || echo "docker container gone"
  fi
  echo "Cleaned up docker container, bye."
  exit 0
}

docker run --name $DOCKER_CONTAINER --rm \
  --env VERBOSE=${VERBOSE:-} \
  -p $PORT:$PORT --env PORT=$PORT \
  --env GRIST_SESSION_COOKIE=grist_test_cookie \
  --env GRIST_TEST_LOGIN=1 \
  --env TEST_SUPPORT_API_KEY=api_key_for_support \
  gristlabs/grist &

DOCKER_PID="$!"

echo "[waiting for server]"
while true; do
  curl -s http://localhost:$PORT/status && break
  sleep 1
done
echo ""
echo "[server found]"

TEST_ADD_SAMPLES=1 TEST_ACCOUNT_PASSWORD=not-needed \
  HOME_URL=http://localhost:8585 \
  GRIST_SESSION_COOKIE=grist_test_cookie \
  GRIST_TEST_LOGIN=1 \
  NODE_PATH=_build:_build/stubs \
  mocha _build/test/nbrowser/*.js "$@"
