#!/bin/bash

set -e

if [ ! -e sandbox_venv3 ]; then
  virtualenv -ppython3 sandbox_venv3
fi

. sandbox_venv3/bin/activate

pip install --no-deps -r sandbox/requirements3.txt
