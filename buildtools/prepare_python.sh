#!/bin/bash

set -e

echo "Use Python3 if available and recent enough, otherwise Python2"
if python3 -c 'import sys; assert sys.version_info >= (3,9)' 2> /dev/null; then
  # Default to python3 if recent enough.
  buildtools/prepare_python3.sh
  # Make sure python2 isn't around.
  rm -rf venv
else
  buildtools/prepare_python2.sh
  # Make sure python3 isn't around.
  rm -rf sandbox_venv3
fi
