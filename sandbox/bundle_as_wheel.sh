#!/usr/bin/env bash

# Package up Grist code as a stand-alone wheel.
# This is useful for grist-static.
# It is the reason why MANIFEST.in and setup.py are present.

set -e

# Clean up any previous packaging.
rm -rf dist foo.egg-info grist.egg-info build

# Go ahead and run packaging again.
python setup.py bdist_wheel

echo ""
echo "Result is in the dist directory:"
ls dist
