################################################################################
## Build stage
################################################################################

FROM node:14 as builder

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

# Install all python dependencies.
ADD sandbox/requirements.txt requirements.txt
RUN \
  apt update && \
  apt install -y python-pip && \
  pip install -r requirements.txt

################################################################################
## Run-time stage
################################################################################

# Now, start preparing final image.
FROM node:14-buster-slim

# Copy node files.
COPY --from=builder /node_modules node_modules
COPY --from=builder /_build _build
COPY --from=builder /static static

# Copy python files. TODO: package python3.9 also in grist-core.
COPY --from=builder /usr/bin/python2.7 /usr/bin/python2.7
COPY --from=builder /usr/lib/python2.7 /usr/lib/python2.7
COPY --from=builder /usr/local/lib/python2.7 /usr/local/lib/python2.7
RUN ln -s /usr/bin/python2.7 /usr/bin/python

# Add files needed for running server.
ADD package.json package.json
ADD ormconfig.js ormconfig.js
ADD bower_components bower_components
ADD sandbox sandbox
ADD plugins plugins

# Keep all storage user may want to persist in a distinct directory
RUN mkdir -p /persist/docs

# Set some default environment variables to give a setup that works out of the box when
# started as:
#   docker run -p 8484:8484 -it <image>
# Variables will need to be overridden for other setups.
ENV GRIST_ORG_IN_PATH=true
ENV GRIST_HOST=0.0.0.0
ENV GRIST_SINGLE_PORT=true
ENV GRIST_SERVE_SAME_ORIGIN=true
ENV GRIST_DATA_DIR=/persist/docs
ENV GRIST_SESSION_COOKIE=grist_core
ENV TYPEORM_DATABASE=/persist/home.sqlite3
EXPOSE 8484
CMD yarn run start:prod
