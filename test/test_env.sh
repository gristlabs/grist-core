#!/usr/bin/env bash

export GRIST_SESSION_COOKIE="grist_test_cookie"
export LANGUAGE="en_US"
export SE_BROWSER="chrome"
export SE_BROWSER_VERSION="130"
export SE_DRIVER="chrome-driver"
export SE_DRIVER_VERSION="130.0.6723.91"
export TEST_CLEAN_DATABASE="true"
export TEST_SUPPORT_API_KEY="api_key_for_support"

exec "$@"
