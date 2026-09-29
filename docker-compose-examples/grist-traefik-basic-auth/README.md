This is the simplest example of Grist with authentication and HTTPS encryption.
It works with all editions of Grist.

It uses Traefik as:
- A reverse proxy to manage certificates and provide HTTPS support
- A basic authentication provided using Traefik's Basic Auth middleware.

This setup, after configuring HTTPS certificates correctly, should be acceptable on the public internet.

However, it doesn't allow a user to sign-out due to the way browsers handle basic authentication.

You may want to try a more secure authentication setup, such as Authelia or Authentik.
The `grist-with-authelia-forwarded-headers` example demonstrates a setup using Authelia.

See https://support.getgrist.com/self-managed for more information.

## How to run this example

1. In the directory containing this example, run:
   ```sh
   docker compose up
   ```
2. Visit <https://grist.localhost>. Chrome and Firefox resolve `*.localhost`
   addresses to your own machine automatically.
3. Your browser will warn about the site's self-signed certificate if using
   the default `grist.localhost` domain. Proceed past the warning. When
   deployed on a real domain, Traefik gets a proper certificate from Let's
   Encrypt automatically.
4. On the first visit, Grist takes you through its
   [setup](https://support.getgrist.com/install/first-run-setup/): sign in
   with the boot key — printed in a very visible box in the terminal, or run
   `docker compose logs grist | grep "BOOT KEY"` — then follow the Quick
   setup steps and finish with "Apply & go live".
5. Click "Sign in". At the browser's login prompt, enter:
   - Username: `test@example.com`
   - Password: `test`

   This signs you in as `test@example.com`, which is also the administrator
   account for this installation.

Users and passwords are defined in `./configs/traefik-dynamic-config.yml`.
Instructions on how to change them are available in that file. Note that the
username doubles as the Grist account email: the administrator is whoever
signs in with the email in `GRIST_ADMIN_EMAIL`. To change the administrator,
change both together.

Running `docker compose up` with defaults is equivalent to:
```sh
GRIST_IMAGE=gristlabs/grist:latest \
GRIST_DOMAIN=grist.localhost \
GRIST_ADMIN_EMAIL=test@example.com \
PERSIST_DIR=./persist \
docker compose up
```
Run with different values in the environment (or in a `.env` file), such as
a locally built image or your real domain.

## Deploying on a real domain

Set `GRIST_DOMAIN` to your domain, and put your email in the `letsencrypt`
section of `./configs/traefik-config.yml` (Let's Encrypt uses it for expiry
notices, and refuses to issue certificates for the placeholder email).
Traefik then obtains a certificate automatically.
