#!/usr/bin/env bash

export GRIST_IN_SERVICE="true"
export GRIST_SESSION_COOKIE="grist_test_cookie"
export LANGUAGE="en_US"
export TEST_CLEAN_DATABASE="true"
export TEST_SUPPORT_API_KEY="api_key_for_support"

exec "$@"
