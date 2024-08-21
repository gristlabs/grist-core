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

This will start an instance that stores its documents and files in the `persist/` subdirectory.
You can change this location using the `PERSIST_DIR` environment variable.
