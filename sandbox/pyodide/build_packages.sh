#!/bin/bash

set -e

echo ""
echo "###############################################################"
echo "## Get pyodide repository, for transpiling python packages"

if [[ ! -e _build/pyodide ]]; then
  cd _build
  git clone https://github.com/pyodide/pyodide
  cd ..
fi

echo ""
echo "###############################################################"
echo "## Prepare python packages"

cd _build/pyodide
./run_docker make
cp ../../../requirements3.txt .
./run_docker pyodide build -r requirements3.txt --output-lockfile result.txt
cat result.txt
cd ../..

echo ""
echo "###############################################################"
echo "## Copy out python packages"

node ./packages.js _build/pyodide/dist/ _build/packages/
