#!/usr/bin/env bash

set -e

echo ""
echo "###############################################################"
echo "## Get pyodide node package"

source env.sh
if [[ ! -e _build/worker ]]; then
  mkdir -p _build/worker
  cd _build/worker
  yarn init --yes
  yarn add pyodide@$PYODIDE_VERSION
  cd ../..
fi
