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
RUN yarn install --frozen-lockfile --verbose --network-timeout 600000

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
COPY test/tsconfig.json /grist/test/tsconfig.json
COPY test/chai-as-promised.js /grist/test/chai-as-promised.js
COPY app /grist/app
COPY stubs /grist/stubs
COPY buildtools /grist/buildtools
# Copy locales files early. During build process they are validated.
COPY static/locales /grist/static/locales
RUN yarn run build:prod
# We don't need them anymore, they will by copied to the final image.
RUN rm -rf /grist/static/locales


# Prepare material for optional pyodide sandbox
COPY sandbox/pyodide /grist/sandbox/pyodide
COPY sandbox/requirements3.txt /grist/sandbox/requirements3.txt
RUN \
  cd /grist/sandbox/pyodide && make setup

################################################################################
## Python collection stage
################################################################################

# Fetch python3.11
FROM python:3.11-slim-bookworm AS collector-py3
ADD sandbox/requirements3.txt requirements3.txt
RUN \
  pip3 install -r requirements3.txt

# Fetch <shame>python2.7</shame>
# This is to support users with old documents.
# If you have documents with python2.7 formulas, try switching
# to python3 in the document settings. It'll probably work fine!
# And we'll be forced to turn off python2 support eventually,
# the workarounds needed to keep it are getting silly.
# It doesn't exist in recent Debian, so we need to reach back
# to buster.
# Many Python2 imports require the ffi foreign-function interface
# library binary, of course present on modern debian but with
# a different ABI (currently version 8, versus version 6 for this
# version of Python2). We move it from an achitecture-specific location
# to a standard location so we can pick it up and copy it across later.
# This will no longer be necessary when support for Python2 is dropped.
# The Grist data engine code will not work without it.
FROM debian:buster-slim AS collector-py2
ADD sandbox/requirements.txt requirements.txt
RUN \
  apt update && \
  apt install -y --no-install-recommends python2 python-pip python-setuptools \
  build-essential libxml2-dev libxslt-dev python-dev zlib1g-dev && \
  pip2 install wheel && \
  pip2 install -r requirements.txt && \
  find /usr/lib -iname "libffi.so.6*" -exec cp {} /usr/local/lib \;

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
COPY --from=builder /grist/node_modules /grist/node_modules
COPY --from=builder /grist/_build /grist/_build
COPY --from=builder /grist/static /grist/static-built

# Copy python2 files.
COPY --from=collector-py2 /usr/bin/python2.7 /usr/bin/python2.7
COPY --from=collector-py2 /usr/lib/python2.7 /usr/lib/python2.7
COPY --from=collector-py2 /usr/local/lib/python2.7 /usr/local/lib/python2.7
# Copy across an older libffi library binary needed by python2.
# We moved it a bit sleazily to a predictable location to avoid awkward
# architecture-dependent logic.
COPY --from=collector-py2 /usr/local/lib/libffi.so.6* /usr/local/lib

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
ADD package.json /grist/package.json
ADD bower_components /grist/bower_components
ADD sandbox /grist/sandbox
ADD plugins /grist/plugins
ADD static /grist/static

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
  PYTHON_VERSION_ON_CREATION=3 \
  GRIST_ORG_IN_PATH=true \
  GRIST_HOST=0.0.0.0 \
  GRIST_SINGLE_PORT=true \
  GRIST_SERVE_SAME_ORIGIN=true \
  GRIST_DATA_DIR=/persist/docs \
  GRIST_INST_DIR=/persist \
  GRIST_SESSION_COOKIE=grist_core \
  GVISOR_FLAGS="-unprivileged -ignore-cgroups" \
  GRIST_SANDBOX_FLAVOR=unsandboxed \
  NODE_OPTIONS="--no-deprecation" \
  NODE_ENV=production \
  TYPEORM_DATABASE=/persist/home.sqlite3

EXPOSE 8484

ENTRYPOINT ["./sandbox/docker_entrypoint.sh"]
CMD ["node", "./sandbox/supervisor.mjs"]
