################################################################################
## Javascript build stage
################################################################################

FROM node:14-buster as builder

# Install all node dependencies.
ADD package.json package.json
ADD yarn.lock yarn.lock
RUN yarn install --frozen-lockfile

# Build node code.
ADD tsconfig.json tsconfig.json
ADD app app
ADD stubs stubs
ADD buildtools buildtools
ADD static static
ADD test/tsconfig.json test/tsconfig.json
RUN yarn run build:prod

################################################################################
## Python collection stage
################################################################################

# Fetch python3.9 and python2.7
FROM python:3.9-slim-buster as collector

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
FROM gristlabs/gvisor-unprivileged:buster as sandbox

################################################################################
## Run-time stage
################################################################################

# Now, start preparing final image.
FROM node:14-buster-slim

# Install libexpat1, libsqlite3-0 for python3 library binary dependencies.
# Install pgrep for managing gvisor processes.
RUN \
  apt-get update && \
  apt-get install -y --no-install-recommends libexpat1 libsqlite3-0 procps && \
  rm -rf /var/lib/apt/lists/*

# Keep all storage user may want to persist in a distinct directory
RUN mkdir -p /persist/docs

# Copy node files.
COPY --from=builder /node_modules node_modules
COPY --from=builder /_build _build
COPY --from=builder /static static

# Copy python files.
COPY --from=collector /usr/bin/python2.7 /usr/bin/python2.7
COPY --from=collector /usr/lib/python2.7 /usr/lib/python2.7
COPY --from=collector /usr/local/lib/python2.7 /usr/local/lib/python2.7
COPY --from=collector /usr/local/bin/python3.9 /usr/bin/python3.9
COPY --from=collector /usr/local/lib/python3.9 /usr/local/lib/python3.9
COPY --from=collector /usr/local/lib/libpython3.9.* /usr/local/lib/
# Set default to python3
RUN \
  ln -s /usr/bin/python3.9 /usr/bin/python && \
  ln -s /usr/bin/python3.9 /usr/bin/python3 && \
  ldconfig

# Copy runsc.
COPY --from=sandbox /runsc /usr/bin/runsc

# Add files needed for running server.
ADD package.json package.json
ADD ormconfig.js ormconfig.js
ADD bower_components bower_components
ADD sandbox sandbox
ADD plugins plugins

# Set some default environment variables to give a setup that works out of the box when
# started as:
#   docker run -p 8484:8484 -it <image>
# Variables will need to be overridden for other setups.
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
  GRIST_SANDBOX_FLAVOR=gvisor \
  TYPEORM_DATABASE=/persist/home.sqlite3

EXPOSE 8484

CMD ./sandbox/run.sh
