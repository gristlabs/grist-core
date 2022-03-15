#!/usr/bin/env bash

set -e

echo "Making Python3 sandbox"
if [ ! -e sandbox_venv3 ]; then
  python3 -m venv sandbox_venv3
fi

echo "Updating Python3 packages"
sandbox_venv3/bin/pip install --no-deps -r sandbox/requirements3.txt
echo "Python3 packages ready in sandbox_venv3"
