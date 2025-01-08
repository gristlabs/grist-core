
FROM node:22-bookworm
RUN apt-get update && apt-get install -y python3.11 python3-pip pipx gdb
COPY sandbox/requirements3.txt package.json yarn.lock /grist/
RUN pip3 install --break-system-packages -r /grist/requirements3.txt
RUN yarn install --frozen-lockfile --verbose --network-timeout 600000

# absolutely bad idea normally, but I could not get python to attach to a running process otherwise
# it always failed with "ptrace: Operation not permitted."
RUN chmod u+s /usr/bin/gdb

ENV GRIST_HOST="0.0.0.0"
