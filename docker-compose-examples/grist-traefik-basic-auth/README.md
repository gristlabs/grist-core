This is the simplest example of Grist with authentication and HTTPS encryption.

It uses Traefik as:
- A reverse proxy to manage certificates and provide HTTPS support
- A basic authentication provided using Traefik's Basic Auth middleware.

This setup, after configuring HTTPS certificates correctly, should be acceptable on the public internet.

However, it doesn't allow a user to sign-out due to the way browsers handle basic authentication.

You may want to try a more secure authentication setup such Authelia, Authentik or traefik-forward-auth.
The OIDC auth example demonstrates a setup using Authelia.

See https://support.getgrist.com/self-managed for more information.

## How to run this example

This example can be run with `docker compose up`.

The default login is:
- Username: `test@example.org`
- Password: `test`

This can be changed in `./configs/traefik-dynamic-config.yaml`. Instructions on how to do this are available in that file.
