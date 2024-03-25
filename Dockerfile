################################################################################
## The Grist source can be extended. This is a stub that can be overridden
## from command line, as:
##   docker buildx build -t ... --build-context=ext=<path> .
## The code in <path> will then be built along with the rest of Grist.
################################################################################
FROM scratch as ext

################################################################################
## Javascript build stage
################################################################################

FROM node:18-buster as builder

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
RUN yarn run build:prod

################################################################################
## Python collection stage
################################################################################

# Fetch python3.11 and python2.7
FROM python:3.11-slim-buster as collector

# Install all python dependencies.
ADD sandbox/requirements.txt requirements.txt
ADD sandbox/requirements3.txt requirements3.txt
RUN \
  apt update && \
  apt install -y --no-install-recommends python2 python-pip python-setuptools \
  build-essential libxml2-dev libxslt-dev python-dev zlib1g-dev && \
  pip2 install wheel && \
  pip2 install -r requirements.txt && \
  pip3 install -r requirements3.txt

################################################################################
## Sandbox collection stage
################################################################################

# Fetch gvisor-based sandbox. Note, to enable it to run within default
# unprivileged docker, layers of protection that require privilege have
# been stripped away, see https://github.com/google/gvisor/issues/4371
FROM docker.io/gristlabs/gvisor-unprivileged:buster as sandbox

################################################################################
## Run-time stage
################################################################################

# Now, start preparing final image.
FROM node:18-buster-slim

# Install libexpat1, libsqlite3-0 for python3 library binary dependencies.
# Install pgrep for managing gvisor processes.
RUN \
  apt-get update && \
  apt-get install -y --no-install-recommends libexpat1 libsqlite3-0 procps && \
  rm -rf /var/lib/apt/lists/*

# Keep all storage user may want to persist in a distinct directory
RUN mkdir -p /persist/docs

# Copy node files.
COPY --from=builder /node_modules /node_modules
COPY --from=builder /grist/node_modules /grist/node_modules
COPY --from=builder /grist/_build /grist/_build
COPY --from=builder /grist/static /grist/static-built

# Copy python files.
COPY --from=collector /usr/bin/python2.7 /usr/bin/python2.7
COPY --from=collector /usr/lib/python2.7 /usr/lib/python2.7
COPY --from=collector /usr/local/lib/python2.7 /usr/local/lib/python2.7
COPY --from=collector /usr/local/bin/python3.11 /usr/bin/python3.11
COPY --from=collector /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=collector /usr/local/lib/libpython3.11.* /usr/local/lib/
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

# Finalize static directory
RUN \
  mv /grist/static-built/* /grist/static && \
  rmdir /grist/static-built

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
  TYPEORM_DATABASE=/persist/home.sqlite3

EXPOSE 8484

CMD ["./sandbox/run.sh"]
