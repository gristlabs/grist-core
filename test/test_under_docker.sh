#!/usr/bin/env bash

# This runs browser tests with the server started using docker, to
# catch any configuration problems.
# Run with MOCHA_WEBDRIVER_HEADLESS=1 for headless operation.
# Run with DEBUG=1 for server logs.

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
  return_value=$?
  docker rm -f $DOCKER_CONTAINER
  if [ -n "$DOCKER_PID" ]; then
    wait $DOCKER_PID || echo "docker container gone"
  fi
  echo "Cleaned up docker container, bye."
  exit $return_value
}

GRIST_LOG_LEVEL="error"
if [[ "${DEBUG:-}" == 1 ]]; then
  GRIST_LOG_LEVEL=""
fi

docker run --name $DOCKER_CONTAINER --rm \
  --env VERBOSE=${DEBUG:-} \
  -p $PORT:$PORT --env PORT=$PORT \
  --env GRIST_SESSION_COOKIE=grist_test_cookie \
  --env GRIST_TEST_LOGIN=1 \
  --env GRIST_LOG_LEVEL=$GRIST_LOG_LEVEL \
  --env GRIST_LOG_SKIP_HTTP=${DEBUG:-false} \
  --env TEST_SUPPORT_API_KEY=api_key_for_support \
  --env GRIST_TEMPLATE_ORG=templates \
  ${TEST_IMAGE:-gristlabs/grist} &

DOCKER_PID="$!"

echo "[waiting for server]"
while true; do
  curl -s http://localhost:$PORT/status && break
  sleep 1
done
echo ""
echo "[server found]"
MOCHA=mocha
# Test if we have mocha available as a command
if ! type $MOCHA > /dev/null 2>&1; then
  echo "Mocha not found, using from ./node_modules/.bin/mocha"
  MOCHA=./node_modules/.bin/mocha
fi

TEST_ADD_SAMPLES=1 TEST_ACCOUNT_PASSWORD=not-needed \
  HOME_URL=http://localhost:8585 \
  GRIST_SESSION_COOKIE=grist_test_cookie \
  GRIST_TEST_LOGIN=1 \
  NODE_PATH=_build:_build/stubs \
  LANGUAGE=en_US \
  $MOCHA _build/test/deployment/*.js --slow 6000 -g "${GREP_TESTS:-}" "$@"
