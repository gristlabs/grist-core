import {GristLoadConfig} from 'app/common/gristUrls';
import {isAnonymousUser} from 'app/server/lib/Authorizer';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {GristServer} from 'app/server/lib/GristServer';
import {getSupportedEngineChoices} from 'app/server/lib/serverUtils';
import * as express from 'express';
import * as fse from 'fs-extra';
import * as path from 'path';

export interface ISendAppPageOptions {
  path: string;        // Ignored if .content is present (set to "" for clarity).
  content?: string;
  status: number;
  config: Partial<GristLoadConfig>;
  tag?: string;        // If present, override version tag.

  // If present, enable Google Tag Manager on this page (if GOOGLE_TAG_MANAGER_ID env var is set).
  // Used on the welcome page to track sign-ups. We don't intend to use it for in-app analytics.
  // Set to true to insert tracker unconditionally; false to omit it; "anon" to insert
  // it only when the user is not logged in.
  googleTagManager?: true | false | 'anon';
}

export function makeGristConfig(homeUrl: string|null, extra: Partial<GristLoadConfig>,
                                baseDomain?: string, req?: express.Request
): GristLoadConfig {
  // .invalid is a TLD the IETF promises will never exist.
  const pluginUrl = process.env.APP_UNTRUSTED_URL || 'http://plugins.invalid';
  const pathOnly = (process.env.GRIST_ORG_IN_PATH === "true") ||
    (homeUrl && new URL(homeUrl).hostname === 'localhost') || false;
  const mreq = req as RequestWithOrg|undefined;
  return {
    homeUrl,
    org: process.env.GRIST_SINGLE_ORG || (mreq && mreq.org),
    baseDomain,
    singleOrg: process.env.GRIST_SINGLE_ORG,
    pathOnly,
    supportAnon: shouldSupportAnon(),
    supportEngines: getSupportedEngineChoices(),
    pluginUrl,
    stripeAPIKey: process.env.STRIPE_PUBLIC_API_KEY,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleDriveScope: process.env.GOOGLE_DRIVE_SCOPE,
    helpScoutBeaconId: process.env.HELP_SCOUT_BEACON_ID_V2,
    maxUploadSizeImport: (Number(process.env.GRIST_MAX_UPLOAD_IMPORT_MB) * 1024 * 1024) || undefined,
    maxUploadSizeAttachment: (Number(process.env.GRIST_MAX_UPLOAD_ATTACHMENT_MB) * 1024 * 1024) || undefined,
    timestampMs: Date.now(),
    enableWidgetRepository: Boolean(process.env.GRIST_WIDGET_LIST_URL),
    survey: Boolean(process.env.DOC_ID_NEW_USER_INFO),
    ...extra,
  };
}

/**
 * Creates a method that will send html page that will immediately post a message to a parent window.
 * Primary used for Google Auth Grist's endpoint, but can be used in future in any other server side
 * authentication flow.
 */
export function makeMessagePage(staticDir: string) {
  return async (req: express.Request, resp: express.Response, message: any) => {
    const fileContent = await fse.readFile(path.join(staticDir, "message.html"), 'utf8');
    const content = fileContent
      .replace("<!-- INSERT MESSAGE -->", `<script>window.message = ${JSON.stringify(message)};</script>`);
    resp.status(200).type('html').send(content);
  };
}

/**
 * Send a simple template page, read from file at pagePath (relative to static/), with certain
 * placeholders replaced.
 */
export function makeSendAppPage(opts: {
  server: GristServer|null, staticDir: string, tag: string, testLogin?: boolean,
  baseDomain?: string
}) {
  const {server, staticDir, tag, testLogin} = opts;
  return async (req: express.Request, resp: express.Response, options: ISendAppPageOptions) => {
    // .invalid is a TLD the IETF promises will never exist.
    const config = makeGristConfig(server ? server.getHomeUrl(req) : null, options.config,
      opts.baseDomain, req);

    // We could cache file contents in memory, but the filesystem does caching too, and compared
    // to that, the performance gain is unlikely to be meaningful. So keep it simple here.
    const fileContent = options.content || await fse.readFile(path.join(staticDir, options.path), 'utf8');

    const needTagManager = (options.googleTagManager === 'anon' && isAnonymousUser(req)) ||
      options.googleTagManager === true;
    const tagManagerSnippet = needTagManager ? getTagManagerSnippet() : '';
    const staticOrigin = process.env.APP_STATIC_URL || "";
    const staticBaseUrl = `${staticOrigin}/v/${options.tag || tag}/`;
    const warning = testLogin ? "<div class=\"dev_warning\">Authentication is not enforced</div>" : "";
    const content = fileContent
      .replace("<!-- INSERT WARNING -->", warning)
      .replace("<!-- INSERT BASE -->", `<base href="${staticBaseUrl}">` + tagManagerSnippet)
      .replace("<!-- INSERT CONFIG -->", `<script>window.gristConfig = ${JSON.stringify(config)};</script>`);
    resp.status(options.status).type('html').send(content);
  };
}

function shouldSupportAnon() {
  // Enable UI for anonymous access if a flag is explicitly set in the environment
  return process.env.GRIST_SUPPORT_ANON === "true";
}

/**
 * Returns the Google Tag Manager snippet to insert into <head> of the page, if
 * GOOGLE_TAG_MANAGER_ID env var is set to a non-empty value. Otherwise returns the empty string.
 */
function getTagManagerSnippet() {
  // Note also that we only insert the snippet for the <head>. The second recommended part (for
  // <body>) is for <noscript> scenario, which doesn't apply to the Grist app (such visits, if
  // any, wouldn't work and shouldn't be counted for any metrics we care about).
  const tagId = process.env.GOOGLE_TAG_MANAGER_ID;
  if (!tagId) { return ""; }

  return `
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${tagId}');</script>
<!-- End Google Tag Manager -->
`;
}
