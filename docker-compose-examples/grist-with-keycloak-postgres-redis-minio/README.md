This example shows how to start up Grist that:
- Uses Postgres as a home database,
- Redis as a state store.
- MinIO for snapshot storage
- and Keycloak for managing and authenticating users.

It is STRONGLY RECOMMENDED not to use this container in a way that makes it accessible to the internet.
This setup lacks basic security or authentication.

Other examples demonstrate how to set up authentication and HTTPS.

See https://support.getgrist.com/self-managed for more information.

This setup is based on one provided by vviers (https://github.com/vviers).

## How to run this example

- Start the services with `docker compose up`
- Go to `localhost:8080` and log in as an admin to keycloak with the username "admin" and password "admin"
- Follow these steps : https://www.keycloak.org/getting-started/getting-started-docker and https://support.getgrist.com/install/oidc/#example-keycloak

NB : Before running this example, it's very strongly recommended to update the `_PASSWORD` environment variables
in `.env` to be long, randomly generated passwords.