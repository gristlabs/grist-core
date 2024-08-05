This examples shows how to start up Grist that:
- Uses Postgres as a home database,
- Redis as a state store.
- MinIO for snapshot storage

It is STRONGLY RECOMMENDED not to use this container in a way that makes it accessible to the internet.
This setup lacks basic security or authentication.

Other examples demonstrate how to set up authentication and HTTPS.

See https://support.getgrist.com/self-managed for more information.

This setup is based on one provided by Akito (https://github.com/theAkito).

## How to run this example

Before running this example, it's very strongly recommended to update the `_PASSWORD` environment variables
in `.env` to be long, randomly generated passwords.

This example can be run with `docker compose up`.
