#!/bin/bash

set -e

if [ ! -e venv ]; then
  virtualenv -ppython2.7 venv
fi

. venv/bin/activate

pip install --no-deps -r sandbox/requirements.txt
