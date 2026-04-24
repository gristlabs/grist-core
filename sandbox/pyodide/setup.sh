#!/usr/bin/env bash

set -eu

echo ""
echo "###############################################################"
echo "## Get pyodide node package"

source env.sh

# make sure we have the right version of pyodide
CUR_PYODIDE_VERSION=`node -p 'require("./worker/package.json").dependencies.pyodide'`
if [[ "${CUR_PYODIDE_VERSION}" != "${PYODIDE_VERSION}" ]]; then
  echo "## Updating pyodide to ${PYODIDE_VERSION}"
  yarn add "pyodide@${PYODIDE_VERSION}" --cwd worker
fi

# make sure pyodide is installed
if [[ ! -d worker/node_modules/pyodide ]]; then
  yarn install --cwd worker
fi

# Need an area for pyodide package cache.
mkdir -p _build/cache
