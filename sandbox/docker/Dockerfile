FROM python:3.11

COPY requirements.txt /tmp/requirements.txt

RUN \
  pip3 install -r /tmp/requirements.txt

RUN \
  apt-get update && \
  apt-get install -y faketime

RUN useradd --shell /bin/bash sandbox
USER sandbox
WORKDIR /
