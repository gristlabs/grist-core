This is the simplest example that runs Grist, suitable for local testing.

It is STRONGLY RECOMMENDED not to use this container in a way that makes it accessible to the internet.
This setup lacks basic security or authentication.

Other examples demonstrate how to set up authentication and HTTPS.

See https://support.getgrist.com/self-managed for more information.

## How to run this example

Before running, create a directory where Grist will store its documents and settings:
```sh
mkdir ./persist
```

Then this example can be run with:
```sh
env PERSIST_DIR=./persist docker compose up
```
