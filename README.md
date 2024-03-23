# Grist

Grist is a modern relational spreadsheet. It combines the flexibility of a spreadsheet with the robustness of a database.

* `grist-core` (this repo) has what you need to run a powerful spreadsheet hosting server.
* [`grist-electron`](https://github.com/gristlabs/grist-electron) is a Linux/macOS/Windows desktop app for viewing and editing spreadsheets stored locally.
* [`grist-static`](https://github.com/gristlabs/grist-static) is a fully in-browser build of Grist for displaying spreadsheets on a website without back-end support.

The `grist-core` repo is the heart of Grist, including the hosted services offered by [Grist Labs](https://getgrist.com), an NYC-based company 🇺🇸 and Grist's main developer. The French government agency [ANCT Données et Territoires](https://donnees.incubateur.anct.gouv.fr/toolbox/grist) 🇫🇷 has also made significant contributions to the codebase.

The `grist-core`, `grist-electron`, and `grist-static` repositories are all open source (Apache License, Version 2.0).

> Questions? Feedback? Want to share what you're building with Grist? Join our [official Discord server](https://discord.gg/MYKpYQ3fbP) or visit our [Community forum](https://community.getgrist.com/).

https://user-images.githubusercontent.com/118367/151245587-892e50a6-41f5-4b74-9786-fe3566f6b1fb.mp4

## 2024 - We're hiring a Systems Engineer!

We are looking for a friendly, capable engineer to join our small
team. You will have broad responsibility for the ease of installation
and maintenance of Grist as an application and service, by our
clients, by self-hosters, and by ourselves.
Read the [full job posting](https://www.getgrist.com/job-systems-engineer/)
or jump into the puzzle that comes with it by just running this:

```
docker run -it gristlabs/grist-twist
```

## Features

Grist is a hybrid database/spreadsheet, meaning that:

  - Columns work like they do in databases: they are named, and they hold one kind of data.
  - Columns can be filled by formula, spreadsheet-style, with automatic updates when referenced cells change.

This difference can confuse people coming directly from Excel or Google Sheets. Give it a chance! There's also a [Grist for Spreadsheet Users](https://www.getgrist.com/blog/grist-for-spreadsheet-users/) article to help get you oriented. If you're coming from Airtable, you'll find the model familiar (and there's also our [Grist vs Airtable](https://www.getgrist.com/blog/grist-v-airtable/) article for a direct comparison).

Here are some specific feature highlights of Grist:

  * Python formulas.
    - Full [Python syntax is supported](https://support.getgrist.com/formulas/#python), including the standard library.
    - Many [Excel functions](https://support.getgrist.com/functions/) also available.
    - An [AI Assistant](https://www.getgrist.com/ai-formula-assistant/) specifically tuned for formula generation (using OpenAI gpt-3.5-turbo or [Llama](https://ai.meta.com/llama/) via <a href="https://github.com/abetlen/llama-cpp-python">llama-cpp-python</a>).
  * A portable, self-contained format.
    - Based on SQLite, the most widely deployed database engine.
    - Any tool that can read SQLite can read numeric and text data from a Grist file.
    - Enables [backups](https://support.getgrist.com/exports/#backing-up-an-entire-document) that you can confidently restore in full.
    - Great for moving between different hosts.
  * Can be displayed on a static website with [`grist-static`](https://github.com/gristlabs/grist-static) – no special server needed.
  * A self-contained desktop app for viewing and editing locally: [`grist-electron`](https://github.com/gristlabs/grist-electron).
  * Convenient editing and formatting features.
    - Choices and [choice lists](https://support.getgrist.com/col-types/#choice-list-columns), for adding colorful tags to records.
    - [References](https://support.getgrist.com/col-refs/#creating-a-new-reference-list-column) and reference lists, for cross-referencing records in other tables.
    - [Attachments](https://support.getgrist.com/col-types/#attachment-columns), to include media or document files in records.
    - Dates and times, toggles, and special numerics such as currency all have specialized editors and formatting options.
    - [Conditional Formatting](https://support.getgrist.com/conditional-formatting/), letting you control the style of cells with formulas to draw attention to important information.
  * Drag-and-drop dashboards.
    - [Charts](https://support.getgrist.com/widget-chart/), [card views](https://support.getgrist.com/widget-card/) and a [calendar widget](https://support.getgrist.com/widget-calendar/) for visualization.
    - [Summary tables](https://support.getgrist.com/summary-tables/) for summing and counting across groups.
    - [Widget linking](https://support.getgrist.com/linking-widgets/) streamlines filtering and editing data.
    Grist has a unique approach to visualization, where you can lay out and link distinct widgets to show together,
    without cramming mixed material into a table.
    - [Filter bar](https://support.getgrist.com/search-sort-filter/#filter-buttons) for quick slicing and dicing.
  * [Incremental imports](https://support.getgrist.com/imports/#updating-existing-records).
    - Import a CSV of the last three months activity from your bank...
    - ...and import new activity a month later without fuss or duplication.
  * Integrations.
    - A [REST API](https://support.getgrist.com/api/), [Zapier actions/triggers](https://support.getgrist.com/integrators/#integrations-via-zapier), and support from similar [integrators](https://support.getgrist.com/integrators/).
    - Import/export to Google drive, Excel format, CSV.
    - Link data with [custom widgets](https://support.getgrist.com/widget-custom/#_top), hosted externally.
    - Configurable outgoing webhooks.
  * [Many templates](https://templates.getgrist.com/) to get you started, from investment research to organizing treasure hunts.
  * Access control options.
    - (You'll need SSO logins set up to make use of these options; [`grist-omnibus`](https://github.com/gristlabs/grist-omnibus) has a prepackaged solution if configuring this feels daunting)
    - Share [individual documents](https://support.getgrist.com/sharing/), workspaces, or [team sites](https://support.getgrist.com/team-sharing/).
    - Control access to [individual rows, columns, and tables](https://support.getgrist.com/access-rules/).
    - Control access based on cell values and user attributes.
  * Self-maintainable.
    - Useful for intranet operation and specific compliance requirements.
  * Sandboxing options for untrusted documents.
    - On Linux or with Docker, you can enable [gVisor](https://github.com/google/gvisor) sandboxing at the individual document level.
    - On macOS, you can use native sandboxing.
    - On any OS, including Windows, you can use a wasm-based sandbox.
  * Translated to many languages.
  * `F1` key brings up some quick help. This used to go without saying, but in general Grist has good keyboard support.
  * We post progress on [𝕏 or Twitter or whatever](https://twitter.com/getgrist) and publish [monthly newsletters](https://support.getgrist.com/newsletters/).

If you are curious about where Grist is heading, see [our roadmap](https://github.com/gristlabs/grist-core/projects/1), drop a question in [our forum](https://community.getgrist.com), or browse [our extensive documentation](https://support.getgrist.com).

## Using Grist

If you just want a quick demo of Grist:

  * You can try Grist out at the hosted service run by Grist Labs at [docs.getgrist.com](https://docs.getgrist.com) (no registration needed).
  * Or you can see a fully in-browser build of Grist at [gristlabs.github.io/grist-static](https://gristlabs.github.io/grist-static/).
  * Or you can download Grist as a desktop app from [github.com/gristlabs/grist-electron](https://github.com/gristlabs/grist-electron).

To get `grist-core` running on your computer with [Docker](https://www.docker.com/get-started), do:

```sh
docker pull gristlabs/grist
docker run -p 8484:8484 -it gristlabs/grist
```

Then visit `http://localhost:8484` in your browser. You'll be able to create, edit, import,
and export documents. To preserve your work across docker runs, share a directory as `/persist`:

```sh
docker run -p 8484:8484 -v $PWD/persist:/persist -it gristlabs/grist
```

Get templates at [templates.getgrist.com](https://templates.getgrist.com) for payroll,
inventory management, invoicing, D&D encounter tracking, and a lot
more, or use any document you've created on
[docs.getgrist.com](https://docs.getgrist.com).

If you need to change the port Grist runs on, set a `PORT` variable, don't just change the
port mapping:

```
docker run --env PORT=9999 -p 9999:9999 -v $PWD/persist:/persist -it gristlabs/grist
```

To enable gVisor sandboxing, set `--env GRIST_SANDBOX_FLAVOR=gvisor`.
This should work with default docker settings, but may not work in all
environments.

You can find a lot more about configuring Grist, setting up authentication,
and running it on a public server in our
[Self-Managed Grist](https://support.getgrist.com/self-managed/) handbook.

## Activating the boot page for diagnosing problems

You can turn on a special "boot page" to inspect the status of your
installation. Just visit `/boot` on your Grist server for instructions.
Since it is useful for the boot page to be available even when authentication
isn't set up, you can give it a special access key by setting `GRIST_BOOT_KEY`.

```
docker run -p 8484:8484 -e GRIST_BOOT_KEY=secret -it gristlabs/grist
```

The boot page should then be available at `/boot/<GRIST_BOOT_KEY>`. We are
starting to collect probes for common problems there. If you hit a problem that
isn't covered, it would be great if you could add a probe for it in
[BootProbes](https://github.com/gristlabs/grist-core/blob/main/app/server/lib/BootProbes.ts).
Or file an issue so someone else can add it, we're just getting start with this.

## Building from source

To build Grist from source, follow these steps:

    yarn install
    yarn run build:prod
    yarn run install:python
    yarn start
    # Grist will be available at http://localhost:8484/

Grist formulas in documents will be run using Python executed directly on your
machine. You can configure sandboxing using a `GRIST_SANDBOX_FLAVOR`
environment variable.

 * On macOS, `export GRIST_SANDBOX_FLAVOR=macSandboxExec`
   uses the native `sandbox-exec` command for sandboxing.
 * On Linux with [gVisor's runsc](https://github.com/google/gvisor)
   installed, `export GRIST_SANDBOX_FLAVOR=gvisor` is an option.
 * On any OS including Windows, `export GRIST_SANDBOX_FLAVOR=pyodide` is available.

These sandboxing methods have been written for our own use at Grist Labs and
may need tweaking to work in your own environment - pull requests
very welcome here!

## Logins

Like git, Grist has features to track document revision history. So for full operation,
Grist expects to know who the user modifying a document is. Until it does, it operates
in a limited anonymous mode. To get you going, the docker image is configured so that
when you click on the "sign in" button Grist will attribute your work to `you@example.com`.
Change this by setting `GRIST_DEFAULT_EMAIL`:

```
docker run --env GRIST_DEFAULT_EMAIL=my@email -p 8484:8484 -v $PWD/persist:/persist -it gristlabs/grist
```

You can change your name in `Profile Settings` in
the [User Menu](https://support.getgrist.com/glossary/#user-menu).

For multi-user operation, or if you wish to access Grist across the
public internet, you'll want to connect it to your own Single Sign-On service.
There are a lot of ways to do this, including [SAML and forward authentication](https://support.getgrist.com/self-managed/#how-do-i-set-up-authentication).
Grist has been tested with [Authentik](https://goauthentik.io/), [Auth0](https://auth0.com/),
and Google/Microsoft sign-ins via [Dex](https://dexidp.io/).

## Translations

We use [Weblate](https://hosted.weblate.org/engage/grist/) to manage translations.
Thanks to everyone who is pitching in. Thanks especially to the ANCT developers who
did the hard work of making a good chunk of the application localizable. Merci bien!

<a href="https://hosted.weblate.org/engage/grist/">
<img src="https://hosted.weblate.org/widgets/grist/-/open-graph.png" alt="Translation status" width=480 />
</a>

## Why free and open source software

This repository, `grist-core`, is maintained by Grist Labs. Our flagship product available at [getgrist.com](https://www.getgrist.com) is built from the code you see here, combined with business-specific software designed to scale to many users, handle billing, etc.

Grist Labs is an open-core company. We offer Grist hosting as a service, with free and paid plans. We also develop and sell features related to Grist using a proprietary license, targeted at the needs of enterprises with large self-managed installations.

We see data portability and autonomy as a key value, and `grist-core` is an essential part of that. We are committed to maintaining and improving the `grist-core` codebase, and to be thoughtful about how proprietary offerings impact data portability and autonomy.

By opening its source code and offering an [OSI](https://opensource.org/)-approved free license, Grist benefits its users:

- **Developer community.** The freedom to examine source code, make bug fixes, and develop
  new features is a big deal for a general-purpose spreadsheet-like product, where there is a
  very long tail of features vital to someone somewhere.
- **Increased trust.** Because anyone can examine the source code, &ldquo;security by obscurity&rdquo; is not
  an option. Vulnerabilities in the code can be found by others and reported before they cause
  damage.
- **Independence.** Grist is available to you regardless of the fortunes of the Grist Labs business,
  since it is open source and can be self-hosted. Using our hosted solution is convenient, but you
  are not locked in.
- **Price flexibility.** If you are low on funds but have time to invest, self-hosting is a great
  option to have. And DIY users may have the technical savvy and motivation to delve in and make improvements,
  which can benefit all users of Grist.
- **Extensibility.** For developers, having the source open makes it easier to build extensions (such as [Custom Widgets](https://support.getgrist.com/widget-custom/)). You can more easily include Grist in your pipeline. And if a feature is missing, you can just take the source code and build on top of it.

For more on Grist Labs' history and principles, see our [About Us](https://www.getgrist.com/about/) page.

## Sponsors

<p align="center">
  <a href="https://www.dotphoton.com/">
    <img width="11%" src="https://user-images.githubusercontent.com/11277225/228914729-ae581352-b37a-4ca8-b220-b1463dd1ade0.png" />
  </a>
</p>

## Reviews

 * [Grist on ProductHunt](https://www.producthunt.com/posts/grist-2)
 * [Grist on AppSumo](https://appsumo.com/products/grist/) (life-time deal is sold out)
 * [Capterra](https://www.capterra.com/p/232821/Grist/#reviews), [G2](https://www.g2.com/products/grist/reviews), [TrustRadius](https://www.trustradius.com/products/grist/reviews)

## Environment variables

Grist can be configured in many ways. Here are the main environment variables it is sensitive to:

Variable | Purpose
-------- | -------
ALLOWED_WEBHOOK_DOMAINS | comma-separated list of permitted domains to use in webhooks (e.g. webhook.site,zapier.com). You can set this to `*` to allow all domains, but if doing so, we recommend using a carefully locked-down proxy (see `GRIST_HTTPS_PROXY`) if you do not entirely trust users. Otherwise services on your internal network may become vulnerable to manipulation.
APP_DOC_URL | doc worker url, set when starting an individual doc worker (other servers will find doc worker urls via redis)
APP_DOC_INTERNAL_URL | like `APP_DOC_URL` but used by the home server to reach the server using an internal domain name resolution (like in a docker environment). Defaults to `APP_DOC_URL`
APP_HOME_URL | url prefix for home api (home and doc servers need this)
APP_STATIC_URL | url prefix for static resources
APP_STATIC_INCLUDE_CUSTOM_CSS | set to "true" to include custom.css (from APP_STATIC_URL) in static pages
APP_UNTRUSTED_URL   | URL at which to serve/expect plugin content.
GRIST_ADAPT_DOMAIN  | set to "true" to support multiple base domains (careful, host header should be trustworthy)
GRIST_APP_ROOT      | directory containing Grist sandbox and assets (specifically the sandbox and static subdirectories).
GRIST_BACKUP_DELAY_SECS | wait this long after a doc change before making a backup
GRIST_BOOT_KEY | if set, offer diagnostics at /boot/GRIST_BOOT_KEY
GRIST_DATA_DIR      | directory in which to store document caches.
GRIST_DEFAULT_EMAIL | if set, login as this user if no other credentials presented
GRIST_DEFAULT_PRODUCT  | if set, this controls enabled features and limits of new sites. See names of PRODUCTS in Product.ts.
GRIST_DEFAULT_LOCALE  | Locale to use as fallback when Grist cannot honour the browser locale.
GRIST_DOMAIN        | in hosted Grist, Grist is served from subdomains of this domain.  Defaults to "getgrist.com".
GRIST_EXPERIMENTAL_PLUGINS | enables experimental plugins
GRIST_ENABLE_REQUEST_FUNCTION | enables the REQUEST function. This function performs HTTP requests in a similar way to `requests.request`. This function presents a significant security risk, since it can let users call internal endpoints when Grist is available publicly. This function can also cause performance issues. Unset by default.
GRIST_HIDE_UI_ELEMENTS | comma-separated list of UI features to disable. Allowed names of parts: `helpCenter,billing,templates,createSite,multiSite,multiAccounts,sendToDrive,tutorials,supportGrist`. If a part also exists in GRIST_UI_FEATURES, it will still be disabled.
GRIST_HOST          | hostname to use when listening on a port.
GRIST_HTTPS_PROXY   | if set, use this proxy for webhook payload delivery.
GRIST_ID_PREFIX | for subdomains of form o-*, expect or produce o-${GRIST_ID_PREFIX}*.
GRIST_IGNORE_SESSION | if set, Grist will not use a session for authentication.
GRIST_INCLUDE_CUSTOM_SCRIPT_URL | if set, will load the referenced URL in a `<script>` tag on all app pages.
GRIST_INST_DIR      | path to Grist instance configuration files, for Grist server.
GRIST_LIST_PUBLIC_SITES | if set to true, sites shared with the public will be listed for anonymous users. Defaults to false.
GRIST_MANAGED_WORKERS | if set, Grist can assume that if a url targeted at a doc worker returns a 404, that worker is gone
GRIST_MAX_UPLOAD_ATTACHMENT_MB | max allowed size for attachments (0 or empty for unlimited).
GRIST_MAX_UPLOAD_IMPORT_MB | max allowed size for imports (except .grist files) (0 or empty for unlimited).
GRIST_OFFER_ALL_LANGUAGES | if set, all translated langauages are offered to the user (by default, only languages with a special 'good enough' key set are offered to user).
GRIST_ORG_IN_PATH | if true, encode org in path rather than domain
GRIST_PAGE_TITLE_SUFFIX | a string to append to the end of the `<title>` in HTML documents. Defaults to `" - Grist"`. Set to `_blank` for no suffix at all.
~GRIST_PROXY_AUTH_HEADER~ | Deprecated, and interpreted as a synonym for GRIST_FORWARD_AUTH_HEADER.
GRIST_ROUTER_URL | optional url for an api that allows servers to be (un)registered with a load balancer
GRIST_SERVE_SAME_ORIGIN | set to "true" to access home server and doc workers on the same protocol-host-port as the top-level page, same as for custom domains (careful, host header should be trustworthy)
GRIST_SERVERS | the types of server to setup. Comma separated values which may contain "home", "docs", static" and/or "app". Defaults to "home,docs,static".
GRIST_SESSION_COOKIE | if set, overrides the name of Grist's cookie
GRIST_SESSION_DOMAIN | if set, associates the cookie with the given domain - otherwise defaults to GRIST_DOMAIN
GRIST_SESSION_SECRET | a key used to encode sessions
GRIST_SKIP_BUNDLED_WIDGETS | if set, Grist will ignore any bundled widgets included via NPM packages.
GRIST_ANON_PLAYGROUND    | When set to 'false' deny anonymous users access to the home page
GRIST_FORCE_LOGIN    | Much like GRIST_ANON_PLAYGROUND but don't support anonymous access at all (features like sharing docs publicly requires authentication)
GRIST_SINGLE_ORG | set to an org "domain" to pin client to that org
GRIST_TEMPLATE_ORG | set to an org "domain" to show public docs from that org
GRIST_HELP_CENTER | set the help center link ref
FREE_COACHING_CALL_URL | set the link to the human help (example: email adress or meeting scheduling tool)
GRIST_CONTACT_SUPPORT_URL | set the link to contact support on error pages (example: email adress or online form)
GRIST_SUPPORT_ANON | if set to 'true', show UI for anonymous access (not shown by default)
GRIST_SUPPORT_EMAIL | if set, give a user with the specified email support powers. The main extra power is the ability to share sites, workspaces, and docs with all users in a listed way.
GRIST_TELEMETRY_LEVEL | the telemetry level. Can be set to: `off` (default), `limited`, or `full`.
GRIST_THROTTLE_CPU | if set, CPU throttling is enabled
GRIST_TRUST_PLUGINS | if set, plugins are expect to be served from the same host as the rest of the Grist app, rather than from a distinct host. Ordinarily, plugins are served from a distinct host so that the cookies used by the Grist app are not automatically available to them. Enable this only if you understand the security implications.
GRIST_USER_ROOT     | an extra path to look for plugins in - Grist will scan for plugins in `$GRIST_USER_ROOT/plugins`.
GRIST_UI_FEATURES | comma-separated list of UI features to enable. Allowed names of parts: `helpCenter,billing,templates,createSite,multiSite,multiAccounts,sendToDrive,tutorials,supportGrist`. If a part also exists in GRIST_HIDE_UI_ELEMENTS, it won't be enabled.
GRIST_UNTRUSTED_PORT | if set, plugins will be served from the given port. This is an alternative to setting APP_UNTRUSTED_URL.
GRIST_WIDGET_LIST_URL | a url pointing to a widget manifest, by default `https://github.com/gristlabs/grist-widget/releases/download/latest/manifest.json` is used
COOKIE_MAX_AGE      | session cookie max age, defaults to 90 days; can be set to "none" to make it a session cookie
HOME_PORT           | port number to listen on for REST API server; if set to "share", add API endpoints to regular grist port.
PORT                | port number to listen on for Grist server
REDIS_URL           | optional redis server for browser sessions and db query caching
GRIST_SKIP_REDIS_CHECKSUM_MISMATCH | Experimental. If set, only warn if the checksum in Redis differs with the one in your S3 backend storage. You may turn it on if your backend storage implements the [read-after-write consistency](https://aws.amazon.com/fr/blogs/aws/amazon-s3-update-strong-read-after-write-consistency/). Defaults to false.
GRIST_SNAPSHOT_TIME_CAP       | optional. Define the caps for tracking buckets. Usage: {"hour": 25, "day": 32, "isoWeek": 12, "month": 96, "year": 1000}
GRIST_SNAPSHOT_KEEP           | optional. Number of recent snapshots to retain unconditionally for a document, regardless of when they were made
GRIST_PROMCLIENT_PORT         | optional. If set, serve the Prometheus metrics on the specified port number. ⚠️ Be sure to use a port which is not publicly exposed ⚠️.

#### AI Formula Assistant related variables (all optional):

Variable | Purpose
-------- | -------
ASSISTANT_API_KEY   | optional. An API key to pass when making requests to an external AI conversational endpoint.
ASSISTANT_CHAT_COMPLETION_ENDPOINT  | optional. A chat-completion style endpoint to call. Not needed if OpenAI is being used.
ASSISTANT_MODEL     | optional. If set, this string is passed along in calls to the AI conversational endpoint.
ASSISTANT_LONGER_CONTEXT_MODEL     | optional. If set, requests that fail because of a context length limitation will be retried with this model set.
OPENAI_API_KEY      | optional. Synonym for ASSISTANT_API_KEY that assumes an OpenAI endpoint is being used. Sign up for an account on OpenAI and then generate a secret key [here](https://platform.openai.com/account/api-keys).

At the time of writing, the AI Assistant is known to function against OpenAI chat completion endpoints for gpt-3.5-turbo and gpt-4.
It can also function against the chat completion endpoint provided by <a href="https://github.com/abetlen/llama-cpp-python">llama-cpp-python</a>.

#### Sandbox related variables:

Variable | Purpose
-------- | -------
GRIST_SANDBOX_FLAVOR | can be gvisor, pynbox, unsandboxed, docker, or macSandboxExec. If set, forces Grist to use the specified kind of sandbox.
GRIST_SANDBOX | a program or image name to run as the sandbox. See NSandbox.ts for nerdy details.
PYTHON_VERSION | can be 2 or 3. If set, documents without an engine setting are assumed to use the specified version of python. Not all sandboxes support all versions.
PYTHON_VERSION_ON_CREATION | can be 2 or 3. If set, newly created documents have an engine setting set to python2 or python3. Not all sandboxes support all versions.

#### Forward authentication variables:

Variable | Purpose
-------- | -------
GRIST_FORWARD_AUTH_HEADER | if set, trust the specified header (e.g. "x-forwarded-user") to contain authorized user emails, and enable "forward auth" logins.
GRIST_FORWARD_AUTH_LOGIN_PATH | if GRIST_FORWARD_AUTH_HEADER is set, Grist will listen at this path for logins. Defaults to `/auth/login`.
GRIST_FORWARD_AUTH_LOGOUT_PATH | if GRIST_FORWARD_AUTH_HEADER is set, Grist will forward to this path when user logs out.

Forward authentication supports two modes, distinguished by `GRIST_IGNORE_SESSION`:

1. With sessions, and forward-auth on login endpoints.

   For example, using traefik reverse proxy with
   [traefik-forward-auth](https://github.com/thomseddon/traefik-forward-auth) middleware:

   - `GRIST_IGNORE_SESSION`: do NOT set, or set to a falsy value.
   - Make sure your reverse proxy applies the forward auth middleware to
     `GRIST_FORWARD_AUTH_LOGIN_PATH` and `GRIST_FORWARD_AUTH_LOGOUT_PATH`.
   - If you want to allow anonymous access in some cases, make sure all other paths are free of
     the forward auth middleware. Grist will trigger it as needed by redirecting to
     `GRIST_FORWARD_AUTH_LOGIN_PATH`. Once the user is logged in, Grist will use sessions to
     identify the user until logout.

2. With no sessions, and forward-auth on all endpoints.

   For example, using HTTP Basic Auth and server configuration that sets the header (specified in
   `GRIST_FORWARD_AUTH_HEADER`) to the logged-in user.

  - `GRIST_IGNORE_SESSION`: set to `true`. Grist sessions will not be used.
  - Make sure your reverse proxy sets the header you specified for all requests that may need
    login information. It is imperative that this header cannot be spoofed by the user, since
    Grist will trust whatever is in it.

When using forward authentication, you may wish to also set the following variables:

  * `GRIST_FORCE_LOGIN=true` to disable anonymous access.

#### Plugins:

Grist has a plugin system, used internally. One useful thing you can
do with it is include custom widgets in a build of Grist. Custom widgets
are usually made available just by setting `GRIST_WIDGET_LIST_URL`,
but that has the downside of being an external dependency, which can
be awkward for offline use or for archiving. Plugins offer an alternative.

To "bundle" custom widgets as a plugin:

 * Add a subdirectory of `plugins`, e.g. `plugins/my-widgets`.
   Alternatively, you can set the `GRIST_USER_ROOT` environment
   variable to any path you want, and then create `plugins/my-widgets`
   within that.
 * Add a `manifest.yml` file in that subdirectory that looks like
   this:

```
name: My Widgets
components:
  widgets: widgets.json
```

 * The `widgets.json` file should be in the format produced by
   the [grist-widget](https://github.com/gristlabs/grist-widget)
   repository, and should be placed in the same directory as
   `manifest.yml`. Any material in `plugins/my-widgets`
   will be served by Grist, and relative URLs can be used in
   `widgets.json`.
 * Once all files are in place, restart Grist. Your widgets should
   now be available in the custom widgets dropdown, along with
   any others from `GRIST_WIDGET_LIST_URL`.
 * If you like, you can add multiple plugin subdirectories, with
   multiple sets of widgets, and they'll all be made available.

#### Google Drive integrations:

Variable | Purpose
-------- | -------
GOOGLE_CLIENT_ID    | set to the Google Client Id to be used with Google API client
GOOGLE_CLIENT_SECRET| set to the Google Client Secret to be used with Google API client
GOOGLE_API_KEY      | set to the Google API Key to be used with Google API client (accessing public files)
GOOGLE_DRIVE_SCOPE  | set to the scope requested for Google Drive integration (defaults to drive.file)

#### Database variables:

Variable | Purpose
-------- | -------
TYPEORM_DATABASE | database filename for sqlite or database name for other db types
TYPEORM_HOST     | host for db
TYPEORM_LOGGING  | set to 'true' to see all sql queries
TYPEORM_PASSWORD | password to use
TYPEORM_PORT     | port number for db if not the default for that db type
TYPEORM_TYPE     | set to 'sqlite' or 'postgres'
TYPEORM_USERNAME | username to connect as
TYPEORM_EXTRA    | any other properties to pass to TypeORM in JSON format

#### Testing:

Variable | Purpose
-------- | -------
GRIST_TESTING_SOCKET    | a socket used for out-of-channel communication during tests only.
GRIST_TEST_HTTPS_OFFSET | if set, adds https ports at the specified offset.  This is useful in testing.
GRIST_TEST_SSL_CERT     | if set, contains filename of SSL certificate.
GRIST_TEST_SSL_KEY      | if set, contains filename of SSL private key.
GRIST_TEST_LOGIN        | allow fake unauthenticated test logins (suitable for dev environment only).
GRIST_TEST_ROUTER       | if set, then the home server will serve a mock version of router api at /test/router
GREP_TESTS              | pattern for selecting specific tests to run (e.g. `env GREP_TESTS=ActionLog yarn test`).

## Tests

Tests are run automatically as part of CI when a PR is opened. However, it can be helpful to run tests locally
before pushing your changes to GitHub. First, you'll want to make sure you've installed all dependencies:

```
yarn install
yarn install:python
```

Then, you can run the main test suite like so:

```
yarn test
```

Python tests may also be run locally. (Note: currently requires Python 3.9 - 3.11.)

```
yarn test:python
```

For running specific tests, you can specify a pattern with the `GREP_TESTS` variable:

```
env GREP_TESTS=ChoiceList yarn test
env GREP_TESTS=summary yarn test:python
```

## License

This repository, `grist-core`, is released under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0), which is an [OSI](https://opensource.org/)-approved free software license. See LICENSE.txt and NOTICE.txt for more information.
