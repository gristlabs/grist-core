#!/usr/bin/env bash

set -e

# Use a built-in standalone version of Python if available in a directory
# called python. This is used for Electron packaging. The standalone Python
# will have extra packages installed, and then be moved to a standard location
# (sandbox_venv3).
for possible_path in python/bin/python python/bin/python3 \
                     python/Scripts/python.exe python/python.exe; do
  if [[ -e $possible_path ]]; then
    echo "found $possible_path"
    buildtools/prepare_python3.sh $possible_path python
    # Make sure Python2 sandbox is not around.
    rm -rf venv
    exit 0
  fi
done

echo "Use Python3 if available and recent enough, otherwise Python2"
if python3 -c 'import sys; assert sys.version_info >= (3,9)' 2> /dev/null; then
  # Default to python3 if recent enough.
  buildtools/prepare_python3.sh python3
  # Make sure python2 isn't around.
  rm -rf venv
else
  buildtools/prepare_python2.sh
  # Make sure python3 isn't around.
  rm -rf sandbox_venv3
fi
