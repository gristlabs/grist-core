#!/usr/bin/env bash

set -e

PROJECT=""
export GRIST_EXT=stubs
if [[ -e ext/app ]]; then
  PROJECT="tsconfig-ext.json"
fi

set -x
tsc --build $PROJECT
buildtools/update_type_info.sh app
webpack --config buildtools/webpack.config.js --mode production
webpack --config buildtools/webpack.check.js --mode production
webpack --config buildtools/webpack.api.config.js --mode production
cat app/client/*.css app/client/*/*.css > static/bundle.css
