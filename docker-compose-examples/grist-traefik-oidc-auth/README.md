This is an example of Grist with Authelia for OIDC authentication, and Traefik for HTTP encryption and routing.

OIDC enables authentication using many existing providers, including Google, Microsoft, Amazon and Okta.

This example uses Authelia, which is a locally hosted OIDC provider, so that it can work without further setup. 
However, Authelia could be easily replaced by one of the providers listed above, or other self-hosted alternatives,
such as Authentik or Dex.

This example could be hosted on a dedicated server, with the following changes:
- DNS setup
- HTTPS / Certificate setup (e.g Let's encrypt)

See https://support.getgrist.com/install/oidc for more information on using Grist with OIDC.

## How to run this example

To run this example, you'll first need to generate several secrets needed by Authelia.

This is automated for you in `generateSecureSecrets.sh`, which uses Authelia's docker image to populate the `./secrets` directory.

This example can then be run with `docker compose up`. This will make Grist available on `https://grist.localhost` with a self-signed certificate (by default), after all the services have started. Note: it may take up to a minute for all of the services to start correctly.

You can add or modify users in ./configs/authelia/user-database.yml. Additional instructions are provided in that file.

