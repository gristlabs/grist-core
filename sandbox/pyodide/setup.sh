#!/usr/bin/env bash

set -eu

echo ""
echo "###############################################################"
echo "## Get pyodide node package"

source env.sh
if [[ ! -e _build/worker ]]; then
  mkdir -p _build/worker
  cd _build/worker
  yarn init --yes
  touch yarn.lock
  yarn add deno@2.6.3
  yarn add pyodide@$PYODIDE_VERSION
  cd ../..
fi

# Warn if install is old.
if [[ ! -e _build/worker/node_modules/deno ]]; then
  echo "Deno not present in worker packages."
  echo "Deno is now required."
  echo "please delete _build/worker and retry."
  exit 1
fi

# Need an area for pyodide package cache.
mkdir -p _build/cache
