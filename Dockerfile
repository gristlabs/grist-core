################################################################################
## The Grist source can be extended. This is a stub that can be overridden
## from command line, as:
##   docker buildx build -t ... --build-context=ext=<path> .
## The code in <path> will then be built along with the rest of Grist.
################################################################################
FROM scratch AS ext

################################################################################
## Javascript build stage
################################################################################

FROM node:22-bookworm AS builder

# Install all node dependencies.
WORKDIR /grist
COPY package.json yarn.lock /grist/
# Create node_modules with devDependencies to be able to build the app
# Add at global level gyp deps to build sqlite3 for prod
# then create node_modules_prod that will be the node_modules of final image
RUN \
  yarn install --frozen-lockfile --verbose --network-timeout 600000 && \
  yarn global add --verbose --network-timeout 600000 node-gyp node-pre-gyp node-gyp-build node-gyp-build-optional-packages && \
  yarn install --prod --frozen-lockfile --modules-folder=node_modules_prod --verbose --network-timeout 600000

# Install any extra node dependencies (at root level, to avoid having to wrestle
# with merging them).
COPY --from=ext / /grist/ext
RUN \
 mkdir /node_modules && \
 cd /grist/ext && \
 { if [ -e package.json ] ; then yarn install --frozen-lockfile --modules-folder=/node_modules --verbose --network-timeout 600000 ; fi }

# Build node code.
COPY tsconfig.json /grist
COPY tsconfig-ext.json /grist
COPY tsconfig-prod.json /grist
COPY test/tsconfig.json /grist/test/tsconfig.json
COPY test/chai-as-promised.js /grist/test/chai-as-promised.js
COPY app /grist/app
COPY stubs /grist/stubs
COPY buildtools /grist/buildtools
# Copy locales files early. During build process they are validated.
COPY static/locales /grist/static/locales
RUN WEBPACK_EXTRA_MODULE_PATHS=/node_modules yarn run build:prod
# We don't need them anymore, they will by copied to the final image.
RUN rm -rf /grist/static/locales


# Prepare material for optional pyodide sandbox
COPY sandbox/pyodide /grist/sandbox/pyodide
COPY sandbox/requirements.txt /grist/sandbox/requirements.txt
RUN \
  cd /grist/sandbox/pyodide && make setup

################################################################################
## Python collection stage
################################################################################

# Fetch python3.11
FROM python:3.11-slim-bookworm AS collector-py3
COPY sandbox/requirements.txt requirements.txt
# setuptools is installed explicitly to 75.8.1 to avoid vunerable 65.5.1
# version installed by default. 75.8.1 is the up to date version compatible with
# python >= 3.9
RUN \
  pip3 install setuptools==75.8.1 && \
  pip3 install -r requirements.txt

################################################################################
## Sandbox collection stage
################################################################################

# Fetch gvisor-based sandbox. Note, to enable it to run within default
# unprivileged docker, layers of protection that require privilege have
# been stripped away, see https://github.com/google/gvisor/issues/4371
# The standalone sandbox binary is built on buster, but remains compatible
# with recent Debian.
# If you'd like to use unmodified gvisor, you should be able to just drop
# in the standard runsc binary and run the container with any extra permissions
# it needs.
FROM docker.io/gristlabs/gvisor-unprivileged:buster AS sandbox

################################################################################
## Run-time stage
################################################################################

# Now, start preparing final image.
FROM node:22-bookworm-slim

ARG GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING=false

# Install curl for docker healthchecks, libexpat1 and libsqlite3-0 for python3
# library binary dependencies, and procps for managing gvisor processes.
RUN \
  apt-get update && \
  apt-get install -y --no-install-recommends curl libexpat1 libsqlite3-0 procps tini && \
  rm -rf /var/lib/apt/lists/*

# Keep all storage user may want to persist in a distinct directory
RUN mkdir -p /persist/docs

# Copy node files.
COPY --from=builder /node_modules /node_modules
COPY --from=builder /grist/node_modules_prod /grist/node_modules
COPY --from=builder /grist/_build /grist/_build
COPY --from=builder /grist/static /grist/static-built
COPY --from=builder /grist/app/cli.sh /grist/cli
# Patterm match here is to copy assets only if it exists in the
# builder stage, otherwise matches nothing.
# https://stackoverflow.com/a/70096420/11352427
COPY --from=builder /grist/ext/asset[s] /grist/ext/assets

# Copy python3 files.
COPY --from=collector-py3 /usr/local/bin/python3.11 /usr/bin/python3.11
COPY --from=collector-py3 /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=collector-py3 /usr/local/lib/libpython3.11.* /usr/local/lib/
# Set default to python3
RUN \
  ln -s /usr/bin/python3.11 /usr/bin/python && \
  ln -s /usr/bin/python3.11 /usr/bin/python3 && \
  ldconfig

# Copy runsc.
COPY --from=sandbox /runsc /usr/bin/runsc

# Add files needed for running server.
COPY package.json /grist/package.json
COPY bower_components /grist/bower_components
COPY sandbox /grist/sandbox
COPY plugins /grist/plugins
COPY static /grist/static

# Make optional pyodide sandbox available
COPY --from=builder /grist/sandbox/pyodide /grist/sandbox/pyodide

# Finalize static directory
RUN \
  mv /grist/static-built/* /grist/static && \
  rmdir /grist/static-built

# To ensure non-root users can run grist, 'other' users need read access (and execute on directories)
# This should be the case by default when copying files in.
# Only uncomment this if running into permissions issues, as it takes a long time to execute on some systems.
# RUN chmod -R o+rX /grist

# Add a user to allow de-escalating from root on startup
RUN useradd -ms /bin/bash grist
ENV GRIST_DOCKER_USER=grist \
    GRIST_DOCKER_GROUP=grist
WORKDIR /grist

# Set some default environment variables to give a setup that works out of the box when
# started as:
#   docker run -p 8484:8484 -it <image>
# Variables will need to be overridden for other setups.
#
# GRIST_SANDBOX_FLAVOR is set to unsandboxed by default, because it
# appears that the services people use to run docker containers have
# a wide variety of security settings and the functionality needed for
# sandboxing may not be possible in every case. For default docker
# settings, you can get sandboxing as follows:
#   docker run --env GRIST_SANDBOX_FLAVOR=gvisor -p 8484:8484 -it <image>
#
# "NODE_OPTIONS=--no-deprecation" is set because there is a punycode
# deprecation nag that is relevant to developers but not to users.
# TODO: upgrade package.json to avoid using all package versions
# using the punycode functionality that may be removed in future
# versions of node.
#
# "NODE_ENV=production" gives ActiveDoc operations more time to
# complete, and the express webserver also does some streamlining
# with this setting. If you don't want these, set NODE_ENV to
# development.
#
ENV \
  GRIST_ORG_IN_PATH=true \
  GRIST_HOST=0.0.0.0 \
  GRIST_SINGLE_PORT=true \
  GRIST_SERVE_SAME_ORIGIN=true \
  GRIST_DATA_DIR=/persist/docs \
  GRIST_INST_DIR=/persist \
  GRIST_SESSION_COOKIE=grist_core \
  GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING=${GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING} \
  GVISOR_FLAGS="-unprivileged -ignore-cgroups" \
  GRIST_SANDBOX_FLAVOR=unsandboxed \
  NODE_OPTIONS="--no-deprecation" \
  NODE_ENV=production \
  TYPEORM_DATABASE=/persist/home.sqlite3

EXPOSE 8484

# When run without any arguments, we run the Grist server within
# a simple supervisor.
# When arguments are supplied they are treated as a command to run,
# as is default for docker. We arrange to have a "cli" command that
# is the same as "yarn cli" run from the source code repo.
# So you can do things like:
# docker run --rm -v $PWD:$PWD -it gristlabs/grist \
#   cli sqlite query $PWD/docs/4gtUhAEGbGAdsGNc52k4H6.grist \
#  --json "select * from _gristsys_ActionHistory"

ENTRYPOINT ["./sandbox/docker_entrypoint.sh"]
CMD ["node", "./sandbox/supervisor.mjs"]
