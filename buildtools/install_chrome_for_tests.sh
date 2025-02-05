#!/usr/bin/env bash

set -e

CHROME_VERSION="132.0.6834.110-1"

if [[ "$1" != "-y" ]]; then
  echo "Usage: $0 -y"
  echo "Installs Google Chrome and chromedriver for running end-to-end Selenium tests in GitHub."
  exit 1
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Error: This script can only be run on Linux."
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Error: This script can only be run on amd64 architecture."
  exit 1
fi

curl -sS -o /tmp/chrome.deb https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb \
  && sudo apt-get install --allow-downgrades -y /tmp/chrome.deb \
  && rm /tmp/chrome.deb \
  && node_modules/selenium-webdriver/bin/linux/selenium-manager --driver chromedriver
