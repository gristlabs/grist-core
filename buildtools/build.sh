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

# Records the build's version, channel, and git commit in app/common/version.ts, overriding the
# stub in stubs/. channel is "release" only for a clean checkout of a release tag (or when
# GRIST_BUILD_CHANNEL is set, e.g. in Docker, where no .git is present). This is currently used
# to gate the "Switch to full edition" button on release builds of Grist.
build_version_file() {
  local out=app/common/version.ts
  local tmp="${out}.tmp"
  local version commit channel
  version=$(node -p "require('./package.json').version")
  commit="${GRIST_BUILD_COMMIT:-}"
  channel="${GRIST_BUILD_CHANNEL:-}"
  if git rev-parse --git-dir >/dev/null 2>&1; then
    local dirty=""
    git diff --quiet HEAD 2>/dev/null || dirty="M"
    : "${commit:=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)${dirty}}"
    if [[ -z "$channel" ]]; then
      local tag
      tag=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
      if [[ -z "$dirty" && "$tag" == "v$version" ]]; then channel="release"; else channel="core"; fi
    fi
  fi
  : "${commit:=unknown}"
  : "${channel:=core}"
  mkdir -p app/common
  cat > "$tmp" <<EOF
export const version = "$version";
export const channel = "$channel";
export const gitcommit = "$commit";
EOF
  if cmp --silent "$tmp" "$out" 2>/dev/null; then rm "$tmp"; else mv "$tmp" "$out"; fi
}

build_version_file
set -x
node buildtools/sanitize_translations.js
tsc --build $PROJECT
buildtools/update_type_info.sh app
webpack --config $WEBPACK_CONFIG $WEBPACK_MODE
webpack --config buildtools/webpack.check.js $WEBPACK_MODE
webpack --config buildtools/webpack.api.config.js $WEBPACK_MODE
cat app/client/*.css app/client/*/*.css > static/bundle.css
