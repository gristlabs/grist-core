#!/usr/bin/env bash

set -eEu -o pipefail

PROJECT=""
WEBPACK_MODE="--mode production"
MODE="${1:-}"
if [[ -e ext/app ]]; then
  PROJECT="tsconfig-ext.json"
  echo "Using extra app directory"
elif [[ "${MODE}" == "prod" ]]; then
  PROJECT="tsconfig-prod.json"
  echo "Building for production"
else
  WEBPACK_MODE="--mode development"
  echo "No extra app directory found"
fi

WEBPACK_CONFIG=buildtools/webpack.config.js
if [[ -e ext/buildtools/webpack.config.js ]]; then
  # Allow webpack config file to be replaced (useful
  # for grist-static)
  WEBPACK_CONFIG=ext/buildtools/webpack.config.js
fi

set -x
node buildtools/sanitize_translations.js
tsc --build $PROJECT
buildtools/update_type_info.sh app
webpack --config $WEBPACK_CONFIG $WEBPACK_MODE
webpack --config buildtools/webpack.check.js $WEBPACK_MODE
webpack --config buildtools/webpack.api.config.js $WEBPACK_MODE
cat app/client/*.css app/client/*/*.css > static/bundle.css
