This is the simplest example that runs Grist, suitable for local testing.

It is STRONGLY RECOMMENDED not to use this container in a way that makes it accessible to the internet.
This setup lacks basic security or authentication.

Other examples demonstrate how to set up authentication and HTTPS.

See https://support.getgrist.com/self-managed for more information.

## How to run this example

To run this example, change to the directory containing this example, and run:
```sh
docker compose up
```
Then you should be able to visit your local Grist instance at <http://localhost:8484>.

On the first visit, Grist takes you through its
[setup](https://support.getgrist.com/install/first-run-setup/): sign in with
the boot key — printed in a very visible box in the terminal, or run
`docker compose logs grist | grep "BOOT KEY"` — and follow the Quick setup
steps. For local testing, it is fine to pick *No authentication* (the
bottom-most option) at the Authentication step.

This will start an instance that stores its documents and files in the `persist/` subdirectory.

Running `docker compose up` with defaults is equivalent to:
```sh
GRIST_IMAGE=gristlabs/grist:latest \
PERSIST_DIR=./persist \
docker compose up
```
Run with different values in the environment (or in a `.env` file), such as
a locally built image or another storage location.
