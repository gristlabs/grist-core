#!/usr/bin/env bash

set -eEu -o pipefail

# Use a built-in standalone version of Python if available in a directory
# called python. This is used for Electron packaging. The standalone Python
# will have extra packages installed, and then be moved to a standard location
# (sandbox_venv3).
for possible_path in python/bin/python python/bin/python3 \
                     python/Scripts/python.exe python/python.exe; do
  if [[ -e $possible_path ]]; then
    echo "found $possible_path"
    if [[ -e sandbox_venv3 ]]; then
     echo "Have Python3 sandbox"
      exit 0
    fi
    echo "Updating Python3 packages"
    $possible_path -m pip install --no-deps -r sandbox/requirements.txt
    echo "Moving ./python to sandbox_venv3"
    mv ./python sandbox_venv3
    echo "Python3 packages ready in sandbox_venv3"
    exit 0
  fi
done

echo "Use Python3 if available and recent enough"
! [ -x "$(command -v python3)" ] && echo "Error: python3 must be installed" && exit 1
! python3 -c 'import sys; assert sys.version_info >= (3,9)' 2> /dev/null && echo "Error: python must be >= 3.9" && exit 1

# Default to python3 if recent enough.
echo "Making Python3 sandbox"
python3 -m venv sandbox_venv3
echo "Updating Python3 packages"
sandbox_venv3/bin/pip install --no-deps -r sandbox/requirements.txt
echo "Python3 packages ready in sandbox_venv3"
exit 0
