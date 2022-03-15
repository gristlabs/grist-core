#!/usr/bin/env bash

set -e

echo "Making Python2 sandbox"
if [ ! -e venv ]; then
  virtualenv -ppython2.7 venv
fi

. venv/bin/activate

echo "Updating Python2 packages"
pip install --no-deps -r sandbox/requirements.txt
echo "Python2 packages ready in venv"
