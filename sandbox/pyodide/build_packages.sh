#!/usr/bin/env bash

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
git checkout 0.23.4 || (git fetch && git checkout 0.23.4)
./run_docker make
cp ../../../requirements3.txt .
./run_docker "source emsdk/emsdk/emsdk_env.sh && pyodide build -r requirements3.txt --outdir grist-packages"
./run_docker pyodide py-compile grist-packages
cd ../..

echo ""
echo "###############################################################"
echo "## Copy out python packages"

rm -rf _build/packages/
node ./packages.js _build/pyodide/grist-packages/ _build/packages/
