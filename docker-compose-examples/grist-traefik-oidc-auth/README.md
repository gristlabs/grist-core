This is an example of Grist with Authelia for OIDC authentication, and Traefik for HTTP encryption and routing.

OIDC enables authentication using many existing providers, including Google, Microsoft, Amazon and Okta.

This example uses Authelia, which is a locally hosted OIDC provider, so that it can work without further setup. 
However, Authelia could be easily replaced by one of the providers listed above, or other self-hosted alternatives,
such as Authentik or Dex.

This example could be hosted on a dedicated server, with the following changes:
- DNS setup
- HTTPS / Certificate setup (e.g Let's encrypt)

Users are defined in ./configs/authelia/user-database.yml

See https://support.getgrist.com/install/oidc for more information on using Grist with OIDC.
