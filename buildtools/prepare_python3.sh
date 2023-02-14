#!/usr/bin/env bash

# Prepare a Python3 sandbox in the sandbox_venv3 directory.
# Optionally, can be called with the command to use for Python,
# and the directory of a standalone version of Python to incorporate.

set -e

if [[ -e sandbox_venv3 ]]; then
  echo "Have Python3 sandbox"
  exit 0
fi

python="$1"
python_dir="$2"
if [[ "$python_dir" = "" ]]; then
  python=python3
  pip=sandbox_venv3/bin/pip
  echo "Making Python3 sandbox"
  $python -m venv sandbox_venv3
else
  pip="$python -m pip"
fi

echo "Updating Python3 packages"
$pip install --no-deps -r sandbox/requirements3.txt

if [[ ! -e sandbox_venv3 ]]; then
  echo "Moving $python_dir to sandbox_venv3"
  mv $python_dir sandbox_venv3
fi
echo "Python3 packages ready in sandbox_venv3"
