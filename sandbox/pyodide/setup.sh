#!/usr/bin/env bash

set -e

echo ""
echo "###############################################################"
echo "## Get pyodide node package"

if [[ ! -e _build/worker ]]; then
  mkdir -p _build/worker
  cd _build/worker
  yarn init --yes
  yarn add pyodide@0.23.4
  cd ../..
fi
