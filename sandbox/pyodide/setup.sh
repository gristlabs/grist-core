#!/usr/bin/env bash

set -e

echo ""
echo "###############################################################"
echo "## Get pyodide node package"

if [[ ! -e _build/worker ]]; then
  mkdir -p _build/worker
  cd _build/worker
  yarn init --yes
  touch yarn.lock
  yarn add pyodide@0.23.4
  yarn add deno@2.6.3
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
