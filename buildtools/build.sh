#!/usr/bin/env bash

set -e

PROJECT=""
export GRIST_EXT=stubs
if [[ -e ext/app ]]; then
  PROJECT="tsconfig-ext.json"
fi

set -x
tsc --build $PROJECT
webpack --config buildtools/webpack.config.js --mode production
webpack --config buildtools/webpack.check.js --mode production
cat app/client/*.css app/client/*/*.css > static/bundle.css
