#!/usr/bin/env bash

set -e

PROJECT=""
if [[ -e ext/app ]]; then
  PROJECT="tsconfig-ext.json"
fi
WEBPACK_CONFIG=buildtools/webpack.config.js
if [[ -e ext/buildtools/webpack.config.js ]]; then
  # Allow webpack config file to be replaced (useful
  # for grist-static)
  WEBPACK_CONFIG=ext/buildtools/webpack.config.js
fi

set -x
tsc --build $PROJECT
buildtools/update_type_info.sh app
webpack --config $WEBPACK_CONFIG --mode production
webpack --config buildtools/webpack.check.js --mode production
webpack --config buildtools/webpack.api.config.js --mode production
cat app/client/*.css app/client/*/*.css > static/bundle.css
