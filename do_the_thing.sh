#!/bin/bash

set -e

echo "DO THE THING $1 [$TESTS] [$GREP_TESTS]"

echo "Clear test directory"
rm -rf $TESTDIR || echo ok
echo "Stop stray node"
killall -9 node || echo ok
echo "Stop stray chrome"
killall -9 chrome || echo ok
echo "Run tests"
MOCHA_WEBDRIVER_HEADLESS=1 yarn run test:nbrowser
