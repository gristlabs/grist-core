#!/usr/bin/env bash

set -eu

echo ""
echo "###############################################################"
echo "## Get pyodide node package"

source env.sh

# make sure we have the right version of pyodide defined
CUR_PYODIDE_VERSION=`node -p 'JSON.parse(require("fs").readFileSync("./worker/package.json")).dependencies.pyodide'`
if [[ "${CUR_PYODIDE_VERSION}" != "${PYODIDE_VERSION}" ]]; then
  echo "Please ensure the versions of Pyodide in package.json (${CUR_PYODIDE_VERSION}) and env.sh (${PYODIDE_VERSION}) match."
  exit 1
fi

# if pyodide not present, install dependencies
if [[ ! -d ./worker/node_modules/pyodide ]]; then
  yarn install --frozen-lockfile --cwd worker
fi

# make sure we have the right version of pyodide + packages installed (in case package.json was updated after install)
INST_PYODIDE_VERSION=`node -p 'JSON.parse(require("fs").readFileSync("./worker/node_modules/pyodide/package.json")).version' 2>/dev/null || true`
if [[ "${INST_PYODIDE_VERSION}" != "${PYODIDE_VERSION}" ]]; then
  echo "Pyodide is already present at version ${INST_PYODIDE_VERSION} (configured version ${PYODIDE_VERSION})."
  echo "Run make clean and try again."
  exit 1
fi

# Need an area for pyodide package cache.
mkdir -p _build/cache
