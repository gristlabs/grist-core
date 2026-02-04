#!/usr/bin/env bash

set -e

CHROME_VERSION=144.0.7559.132-1

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

# Google's official repo no longer keeps old versions, using UChicago mirror instead.
# Original URL (may work again in future):
#   https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb
curl -sS -o /tmp/chrome.deb https://mirror.cs.uchicago.edu/google-chrome/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb \
  && sudo apt-get install --allow-downgrades -y /tmp/chrome.deb \
  && rm /tmp/chrome.deb \
  && sudo rm /usr/bin/chromedriver \
  && node_modules/selenium-webdriver/bin/linux/selenium-manager --driver chromedriver
