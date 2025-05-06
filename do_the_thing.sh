#!/bin/bash

set -e

rm -rf $TESTDIR || echo ok
killall -9 node || echo ok
killall -9 chrome || echo ok
MOCHA_WEBDRIVER_HEADLESS=1 yarn run test:nbrowser
