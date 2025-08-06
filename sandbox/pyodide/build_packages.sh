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

source env.sh
cd _build/pyodide
git checkout $PYODIDE_VERSION || (git fetch && git checkout $PYODIDE_VERSION)
git submodule update --init
./run_docker make
cp ../../../requirements.txt .
./run_docker "source pyodide_env.sh && pyodide build -r requirements.txt --outdir grist-packages"
./run_docker pyodide py-compile grist-packages
cd ../..

echo ""
echo "###############################################################"
echo "## Copy out python packages"

rm -rf _build/packages/
node ./preparePackages.js _build/pyodide/grist-packages/ _build/packages/
