This example runs Grist behind [Authelia](https://www.authelia.com/), a
self-hosted authentication service, connected to Grist through
[forwarded headers](https://support.getgrist.com/install/forwarded-headers/):
Traefik checks each sign-in with Authelia and passes the signed-in user's
email to Grist in a header. This method works with all editions of Grist,
and the same wiring applies to other services that can act as a Traefik
authentication middleware, such as Authentik or traefik-forward-auth.

It uses Traefik as a reverse proxy to manage certificates, provide HTTPS
support, and guard Grist's sign-in path with Authelia.

See https://support.getgrist.com/self-managed for more information.

## How to run this example

1. In the directory containing this example, generate the secrets Authelia
   needs (written to `./secrets`):
   ```sh
   ./generateSecureSecrets.sh
   ```
2. Run:
   ```sh
   docker compose up
   ```
3. Visit <https://grist.localhost>. Chrome and Firefox resolve `*.localhost`
   addresses to your own machine automatically.
4. Your browser will warn about self-signed certificates if using the
   default `grist.localhost` domain — both for it and for
   `auth.grist.localhost`, where Authelia's sign-in page lives. Proceed past
   the warnings. When deployed on a real domain, Traefik gets proper
   certificates from Let's Encrypt automatically.
5. On the first visit, Grist takes you through its
   [setup](https://support.getgrist.com/install/first-run-setup/): sign in
   with the boot key — printed in a very visible box in the terminal, or run
   `docker compose logs grist | grep "BOOT KEY"` — then follow the Quick
   setup steps and finish with "Apply & go live".
6. Click "Sign in". At Authelia's sign-in page, enter:
   - Username: `test`
   - Password: `test`

   This signs you in as `test@example.org`, which is also the administrator
   account for this installation.

Users and passwords are defined in `./configs/authelia/users_database.yml`.
Instructions on how to change them are available in that file. Note that a
user's email doubles as their Grist account: the administrator is whoever
signs in with the email in `GRIST_ADMIN_EMAIL`. To change the administrator,
change both together.

Running `docker compose up` with defaults is equivalent to:
```sh
GRIST_IMAGE=gristlabs/grist:latest \
GRIST_DOMAIN=grist.localhost \
GRIST_ADMIN_EMAIL=test@example.org \
ACME_EMAIL=my_email@example.com \
PERSIST_DIR=./persist \
docker compose up
```
Run with different values in the environment (or in a `.env` file), such as
a locally built image or your real domain.

## Deploying on a real domain

Set `GRIST_DOMAIN` to your domain and `ACME_EMAIL` to your email (Let's
Encrypt uses it for expiry notices, and refuses to issue certificates for
the placeholder email). Traefik then obtains certificates automatically —
both for your domain and for its `auth.` subdomain, which must also point
at your server.
