This example runs Grist with HTTPS encryption, with authentication set up
through Grist's own Quick setup. The method recommended there, "Sign in with
getgrist.com", needs no authentication service of your own — only a
[getgrist.com](https://getgrist.com) account, whose email you will use during
setup below. It works with all editions of Grist.

It uses Traefik as a reverse proxy to manage certificates and provide HTTPS
support.

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
   `docker compose logs grist | grep "BOOT KEY"` — entering the email of
   your getgrist.com account as the administrator email. Then follow the
   Quick setup steps: at the Authentication step, choose
   ["Sign in with getgrist.com"](https://support.getgrist.com/install/sign-in-with-grist/)
   and follow its registration instructions, and finish with
   "Apply & go live".
5. Click "Sign in" and sign in with your getgrist.com account.

Running `docker compose up` with defaults is equivalent to:
```sh
GRIST_IMAGE=gristlabs/grist:latest \
GRIST_DOMAIN=grist.localhost \
ACME_EMAIL=my_email@example.com \
PERSIST_DIR=./persist \
docker compose up
```
Run with different values in the environment (or in a `.env` file), such as
a locally built image or your real domain.

## Deploying on a real domain

Set `GRIST_DOMAIN` to your domain and `ACME_EMAIL` to your email (Let's
Encrypt uses it for expiry notices, and refuses to issue certificates for
the placeholder email). Traefik then obtains a certificate automatically.
