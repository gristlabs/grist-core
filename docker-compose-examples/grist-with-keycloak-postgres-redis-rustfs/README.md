This is the most complete example in this suite. It runs Grist with the
external services used by larger or more demanding deployments:

- Postgres as a home database,
- Redis as a state store,
- [RustFS](https://rustfs.com/) for snapshot and attachment storage (any
  S3-compatible store with bucket versioning will do),
- and [Keycloak](https://www.keycloak.org/) for managing and authenticating
  users, connected to Grist with
  [OpenID Connect](https://support.getgrist.com/install/oidc/).

It uses Traefik as a reverse proxy to manage certificates and provide HTTPS
support. Keycloak's realm and Grist's client registration are imported
automatically at first startup, so the example works out of the box.

This example runs the [full edition of
Grist](https://support.getgrist.com/self-managed/#how-do-i-enable-the-full-edition-of-grist),
which includes OpenID Connect single sign-on, Admin Controls, automations,
an MCP server with OAuth apps for connecting AI clients (enabled here),
audit logging (streamed to destinations you configure in the Admin Panel),
and — each needing an external account, see `docker-compose.yml` — an AI
Assistant and email notifications.

It starts as a 30-day free trial. To continue past the trial, get an
[activation key](https://www.getgrist.com/request-activation-key) — free
for individuals and small orgs — and paste it in the Admin Panel's Edition
section. When an unactivated trial ends, the server
switches to read-only mode until a key is entered; documents remain intact.
For single sign-on available in all editions, see the
`grist-with-authelia-forwarded-headers` example.

See https://support.getgrist.com/self-managed for more information.

This setup is based on ones provided by Akito (https://github.com/theAkito)
and vviers (https://github.com/vviers).

## How to run this example

1. In the directory containing this example, generate random passwords for
   the services (written to `.env`):
   ```sh
   ./generateSecureSecrets.sh
   ```
   If you skip this step, the default passwords listed below apply.
2. Run:
   ```sh
   docker compose up
   ```
   Starting all the services can take up to a minute.
3. Visit <https://grist.localhost>. Chrome and Firefox resolve `*.localhost`
   addresses to your own machine automatically.
4. Your browser will warn about self-signed certificates if using the
   default `grist.localhost` domain — both for it and for
   `auth.grist.localhost`, where Keycloak's sign-in page lives. Proceed past
   the warnings. When deployed on a real domain, Traefik gets proper
   certificates from Let's Encrypt automatically.
5. On the first visit, Grist takes you through its
   [setup](https://support.getgrist.com/install/first-run-setup/): sign in
   with the boot key — printed in a very visible box in the terminal, or run
   `docker compose logs grist | grep "BOOT KEY"` — then follow the Quick
   setup steps and finish with "Apply & go live".
6. Click "Sign in". At Keycloak's sign-in page, enter:
   - Username: `test`
   - Password: `test`

   This signs you in as `test@example.org`, which is also the administrator
   account for this installation.

Users are managed in Keycloak's admin console at
<https://auth.grist.localhost> (username `admin`, with the
`KEYCLOAK_ADMIN_PASSWORD` from your `.env` — or `admin` by default), in the
`grist` realm — pick it in the console's realm selector. A user's email in
Keycloak doubles as their Grist account: the administrator is whoever signs
in with the email in `GRIST_ADMIN_EMAIL`. The realm is imported from
`./configs/keycloak/grist-realm.json` at first startup only; after that,
users and settings live in Keycloak's database.

Running `docker compose up` with defaults is equivalent to:
```sh
GRIST_IMAGE=gristlabs/grist:latest \
GRIST_DOMAIN=grist.localhost \
GRIST_ADMIN_EMAIL=test@example.org \
ACME_EMAIL=my_email@example.com \
PERSIST_DIR=./persist \
DATABASE_PASSWORD=grist-db-password \
RUSTFS_PASSWORD=grist-rustfs-password \
OIDC_CLIENT_SECRET=gristclientsecret \
KEYCLOAK_DATABASE_PASSWORD=keycloak-db-password \
KEYCLOAK_ADMIN_PASSWORD=admin \
docker compose up
```
Run with different values in the environment (or in a `.env` file), such as
a locally built image or your real domain.

## Deploying on a real domain

- Set `GRIST_DOMAIN` to your domain and `ACME_EMAIL` to your email (Let's
  Encrypt uses it for expiry notices, and refuses to issue certificates for
  the placeholder email). Traefik then obtains certificates automatically —
  both for your domain and for its `auth.` subdomain, which must also point
  at your server.
- Remove `NODE_TLS_REJECT_UNAUTHORIZED` from `docker-compose.yml`. It is
  only needed to let Grist talk to Keycloak through the self-signed
  certificate used for local testing.
- If you skipped the `./generateSecureSecrets.sh` step and started with the
  default passwords, they are baked into the databases under `persist/`;
  the simplest reset is to remove `persist/` and start fresh.
- The `gristclient` client's redirect URIs follow `GRIST_DOMAIN` when the
  realm is first imported. On an installation that has already started,
  update them (including the post-logout one) in Keycloak's admin console.
