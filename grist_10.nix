# SPDX-FileCopyrightText: 2025 Maurice Debray <maurice.debray@dgnum.eu>
# SPDX-FileCopyrightText: 2026 Ryan Lahfa <ryan@lahfa.xyz>
#
# SPDX-License-Identifier: MIT

let
  defaultPythonFun =
    ps: with ps; [
      astroid
      asttokens
      chardet
      et-xmlfile
      executing
      friendly-traceback
      iso8601
      lazy-object-proxy
      openpyxl
      phonenumbers
      pure-eval
      python-dateutil
      roman
      six
      sortedcontainers
      stack-data
      typing-extensions
      unittest-xml-reporting
      wrapt
    ];
in
{
  lib,
  stdenv,
  fetchFromGitHub,
  fetchYarnDeps,
  python3,
  yarn,
  nodejs,
  prefetch-yarn-deps,
  fixup-yarn-lock,
  node-gyp-build,
  node-gyp,
  node-pre-gyp,
  sandboxEnv ? [ ],
  pythonFun ? defaultPythonFun,
  pythonEnv ? python3.withPackages pythonFun,
  gitUpdater,
  enterpriseEdition ? false,
}:
let
  # We put them here to be sure not to fetch them in the free version
  enterpriseSrc = fetchFromGitHub {
    owner = "gristlabs";
    repo = "grist-ee";
    rev = "0b2157f0861a540b8dffa0c3f5d0d7f86c7ab365";
    hash = "sha256-co9/bWmsa4UYoxx3nUyic0+j7zo/wXtM3AAe99f3yXs=";
  };

  enterpriseOfflineCache = fetchYarnDeps {
    yarnLock = "${enterpriseSrc}/ext/yarn.lock";
    hash = "sha256-uKn9ocEhEfjahlyWoB6rPYBQVA+ALjIWuMzfav6GHpw=";
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "grist-core";
  version = "1.7.10";

  src = fetchFromGitHub {
    owner = "gristlabs";
    repo = "grist-core";
    tag = "v${finalAttrs.version}";
    hash = "sha256-0hecO/+w/ellB0ClsD+LTXOcyW6MeyxcjE1Z+herOtw=";
  };

  offlineCache = fetchYarnDeps {
    yarnLock = "${finalAttrs.src}/yarn.lock";
    hash = "sha256-+pxRVc0BTLC2KGIR7vLhv+mNS+JPXCucXxHtyxU3VuE=";
  };

  patches = [
    ./patches/0001-nixos.patch
  ];

  prePatch = lib.optionalString enterpriseEdition ''
    echo "Copying ext"
    cp -r --preserve=timestamps --reflink=auto -- "${enterpriseSrc}/ext" ./ext
    chmod -R u+w -- "./ext"
  '';

  nativeBuildInputs = [
    yarn
    nodejs
    prefetch-yarn-deps
    fixup-yarn-lock
    node-gyp-build
    node-gyp
    node-pre-gyp
  ];

  buildInputs = [ pythonEnv ];

  sandboxPath = lib.makeSearchPath "bin" ([ pythonEnv ] ++ sandboxEnv);
  sandboxLibPath = lib.makeLibraryPath ([ pythonEnv ] ++ sandboxEnv);

  configurePhase = ''
    runHook preConfigure

    rm .yarnrc

    export HOME=$(mktemp -d)
    export npm_config_nodedir=${nodejs}

    ${lib.optionalString enterpriseEdition ''
      pushd ext

      yarn config --offline set yarn-offline-mirror ${enterpriseOfflineCache}
      fixup-yarn-lock yarn.lock

      yarn install \
        --modules-folder ../../node_modules/ \
        --frozen-lockfile \
        --force \
        --production=false \
        --ignore-engines \
        --ignore-platform \
        --no-progress \
        --non-interactive \
        --offline

      patchShebangs ../../node_modules

      popd
    ''}

    yarn config --offline set yarn-offline-mirror ${finalAttrs.offlineCache}
    fixup-yarn-lock yarn.lock

    yarn install \
      --frozen-lockfile \
      --force \
      --production=false \
      --ignore-engines \
      --ignore-platform \
      --no-progress \
      --non-interactive \
      --offline || true

    patchShebangs node_modules
    patchShebangs buildtools

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    ${lib.optionalString enterpriseEdition ''export WEBPACK_EXTRA_MODULE_PATHS="$PWD/../node_modules"''}
    yarn --offline run build:prod

    runHook postBuild
  '';

  postBuild = ''
    yarn install \
      --frozen-lockfile \
      --force \
      --production=true \
      --ignore-engines \
      --ignore-platform \
      --no-progress \
      --non-interactive \
      --offline
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/grist-core"

    cp -r {_build,node_modules,plugins,sandbox,static,bower_components} "$out/grist-core"
    ${lib.optionalString enterpriseEdition ''
      cp -r ext/assets "$out/grist-core"
      cp -r ../node_modules $out
    ''}

    runHook postInstall
  '';

  postInstall = ''
    # FIXME Mocha and sinon might only be needed for testing? Not sure if they should be here at all?
    unlink $out/grist-core/static/mocha.js
    unlink $out/grist-core/static/sinon.js
    unlink $out/grist-core/static/mocha.css

    # FIXME
    unlink $out/grist-core/node_modules/msgpackr/node_modules/.bin/download-msgpackr-prebuilds
    unlink $out/grist-core/node_modules/.bin/download-msgpackr-prebuilds

    unlink $out/grist-core/bower_components/bootstrap

    substituteAllInPlace $out/grist-core/sandbox/gvisor/run.py
  '';

  passthru = {
    inherit pythonEnv;
    updateScript = gitUpdater { rev-prefix = "v"; };
  };

  meta = {
    description = "Grist is the evolution of spreadsheets";
    homepage = "https://github.com/gristlabs/grist-core";
    license = if enterpriseEdition then lib.licenses.unfree else lib.licenses.asl20;
    platforms = lib.platforms.all;
  };
})
