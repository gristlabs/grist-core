import {
  commonUrls,
  Features,
  getContactSupportUrl,
  getFreeCoachingCallUrl,
  getHelpCenterUrl,
  getPageTitleSuffix,
  getTermsOfServiceUrl,
  GristLoadConfig,
  IFeature
} from 'app/common/gristUrls';
import {isAffirmative} from 'app/common/gutil';
import {getTagManagerSnippet} from 'app/common/tagManager';
import {Document} from 'app/common/UserAPI';
import {AttachedCustomWidgets, IAttachedCustomWidget} from "app/common/widgetTypes";
import {SUPPORT_EMAIL} from 'app/gen-server/lib/homedb/HomeDBManager';
import {isAnonymousUser, isSingleUserMode, RequestWithLogin} from 'app/server/lib/Authorizer';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {GristServer} from 'app/server/lib/GristServer';
import {getOnboardingTutorialDocId, getTemplateOrg} from 'app/server/lib/gristSettings';
import {getSupportedEngineChoices} from 'app/server/lib/serverUtils';
import {readLoadedLngs, readLoadedNamespaces} from 'app/server/localization';
import * as express from 'express';
import * as fse from 'fs-extra';
import * as handlebars from 'handlebars';
import jsesc from 'jsesc';
import * as path from 'path';
import difference from 'lodash/difference';

const { escapeExpression } = handlebars.Utils;

/**
 * Return the translation given the key.
 *
 * @param req
 * @param key The key of the translation (which will be prefixed by `sendAppPage`)
 * @param args The args to pass to the translation string (optional)
 */
const translate = (req: express.Request, key: string, args?: any) =>  req.t(`sendAppPage.${key}`, args)?.toString();


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

export interface MakeGristConfigOptions {
  homeUrl: string|null;
  extra: Partial<GristLoadConfig>;
  baseDomain?: string;
  req?: express.Request;
  server?: GristServer|null;
}

export function makeGristConfig(options: MakeGristConfigOptions): GristLoadConfig {
  const {homeUrl, extra, baseDomain, req, server} = options;
  // .invalid is a TLD the IETF promises will never exist.
  const pluginUrl = process.env.APP_UNTRUSTED_URL || 'http://plugins.invalid';
  const pathOnly = (process.env.GRIST_ORG_IN_PATH === "true") ||
    (homeUrl && new URL(homeUrl).hostname === 'localhost') || false;
  const mreq = req as RequestWithOrg|undefined;
  return {
    homeUrl,
    org: process.env.GRIST_SINGLE_ORG || (mreq && mreq.org),
    baseDomain,
   // True if no subdomains or separate servers are defined for the home servers or doc workers.
    serveSameOrigin: !baseDomain && pathOnly,
    singleOrg: process.env.GRIST_SINGLE_ORG,
    helpCenterUrl: getHelpCenterUrl(),
    termsOfServiceUrl: getTermsOfServiceUrl(),
    freeCoachingCallUrl: getFreeCoachingCallUrl(),
    contactSupportUrl: getContactSupportUrl(),
    pathOnly,
    supportAnon: shouldSupportAnon(),
    enableAnonPlayground: isAffirmative(process.env.GRIST_ANON_PLAYGROUND ?? true),
    supportEngines: getSupportedEngineChoices(),
    features: getFeatures(),
    pageTitleSuffix: configuredPageTitleSuffix(),
    pluginUrl,
    stripeAPIKey: process.env.STRIPE_PUBLIC_API_KEY,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleDriveScope: process.env.GOOGLE_DRIVE_SCOPE,
    helpScoutBeaconId: process.env.HELP_SCOUT_BEACON_ID_V2,
    maxUploadSizeImport: (Number(process.env.GRIST_MAX_UPLOAD_IMPORT_MB) * 1024 * 1024) || undefined,
    maxUploadSizeAttachment: (Number(process.env.GRIST_MAX_UPLOAD_ATTACHMENT_MB) * 1024 * 1024) || undefined,
    timestampMs: Date.now(),
    enableWidgetRepository: Boolean(process.env.GRIST_WIDGET_LIST_URL) ||
        ((server?.getBundledWidgets().length || 0) > 0),
    survey: Boolean(process.env.DOC_ID_NEW_USER_INFO),
    tagManagerId: process.env.GOOGLE_TAG_MANAGER_ID,
    activation: (req as RequestWithLogin|undefined)?.activation,
    enableCustomCss: isAffirmative(process.env.APP_STATIC_INCLUDE_CUSTOM_CSS),
    supportedLngs: readLoadedLngs(req?.i18n),
    namespaces: readLoadedNamespaces(req?.i18n),
    featureComments: isAffirmative(process.env.COMMENTS),
    featureFormulaAssistant: Boolean(process.env.OPENAI_API_KEY ||
      process.env.ASSISTANT_API_KEY  ||
      process.env.ASSISTANT_CHAT_COMPLETION_ENDPOINT),
    assistantService: process.env.OPENAI_API_KEY ? 'OpenAI' : undefined,
    permittedCustomWidgets: getPermittedCustomWidgets(server),
    supportEmail: SUPPORT_EMAIL,
    userLocale: (req as RequestWithLogin | undefined)?.user?.options?.locale,
    telemetry: server?.getTelemetry().getTelemetryConfig(req as RequestWithLogin | undefined),
    deploymentType: server?.getDeploymentType(),
    forceEnableEnterprise: isAffirmative(process.env.GRIST_FORCE_ENABLE_ENTERPRISE),
    templateOrg: getTemplateOrg(),
    onboardingTutorialDocId: getOnboardingTutorialDocId(),
    canCloseAccount: isAffirmative(process.env.GRIST_ACCOUNT_CLOSE),
    experimentalPlugins: isAffirmative(process.env.GRIST_EXPERIMENTAL_PLUGINS),
    notifierEnabled: server?.hasNotifier(),
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
    const content = fileContent.replace(
      "<!-- INSERT MESSAGE -->",
      `<script>window.message = ${jsesc(message, {isScriptContext: true, json: true})};</script>`
    );
    resp.status(200).type('html').send(content);
  };
}

export type SendAppPageFunction =
  (req: express.Request, resp: express.Response, options: ISendAppPageOptions) => Promise<void>;

/**
 * Send a simple template page, read from file at pagePath (relative to static/), with certain
 * placeholders replaced.
 */
export function makeSendAppPage({ server, staticDir, tag, testLogin, baseDomain }: {
  server: GristServer, staticDir: string, tag: string, testLogin?: boolean, baseDomain?: string
}): SendAppPageFunction {

  // If env var GRIST_INCLUDE_CUSTOM_SCRIPT_URL is set, load it in a <script> tag on all app pages.
  const customScriptUrl = process.env.GRIST_INCLUDE_CUSTOM_SCRIPT_URL;
  const insertCustomScript: string = customScriptUrl ?
    `<script src="${customScriptUrl}" crossorigin="anonymous"></script>` : '';

  return async (req: express.Request, resp: express.Response, options: ISendAppPageOptions) => {
    const config = makeGristConfig({
      homeUrl: !isSingleUserMode() ? server.getHomeUrl(req) : null,
      extra: options.config,
      baseDomain,
      req,
      server,
    });

    // We could cache file contents in memory, but the filesystem does caching too, and compared
    // to that, the performance gain is unlikely to be meaningful. So keep it simple here.
    const fileContent = options.content || await fse.readFile(path.join(staticDir, options.path), 'utf8');

    const needTagManager = (options.googleTagManager === 'anon' && isAnonymousUser(req)) ||
      options.googleTagManager === true;
    const tagManagerSnippet = needTagManager ? getTagManagerSnippet(process.env.GOOGLE_TAG_MANAGER_ID) : '';
    const staticTag = options.tag || tag;
    // If boot tag is used, serve assets locally, otherwise respect
    // APP_STATIC_URL.
    const staticOrigin = staticTag === 'boot' ? '' : (process.env.APP_STATIC_URL || '');
    const staticBaseUrl = `${staticOrigin}/v/${staticTag}/`;
    const customHeadHtmlSnippet = server.create.getExtraHeadHtml?.() ?? "";
    const warning = testLogin ? "<div class=\"dev_warning\">Authentication is not enforced</div>" : "";
    // Preload all languages that will be used or are requested by client.
    const preloads = req.languages
      .filter(lng => (readLoadedLngs(req.i18n)).includes(lng))
      .map(lng => lng.replace('-', '_'))
      .map((lng) =>
        readLoadedNamespaces(req.i18n).map((ns) =>
       `<link rel="preload" href="locales/${lng}.${ns}.json" as="fetch" type="application/json" crossorigin>`
      ).join("\n")
    ).join('\n');
    const content = fileContent
      .replace("<!-- INSERT WARNING -->", warning)
      .replace("<!-- INSERT TITLE -->", getDocName(config) ?? escapeExpression(translate(req, 'Loading...')))
      .replace("<!-- INSERT META -->", getPageMetadataHtmlSnippet(req, config))
      .replace("<!-- INSERT TITLE SUFFIX -->", getPageTitleSuffix(server.getGristConfig()))
      .replace("<!-- INSERT BASE -->", `<base href="${staticBaseUrl}">` + tagManagerSnippet)
      .replace("<!-- INSERT LOCALE -->", preloads)
      .replace("<!-- INSERT CUSTOM -->", customHeadHtmlSnippet)
      .replace("<!-- INSERT CUSTOM SCRIPT -->", insertCustomScript)
      .replace(
        "<!-- INSERT CONFIG -->",
        `<script>window.gristConfig = ${jsesc(config, {isScriptContext: true, json: true})};</script>`
      );
    logVisitedPageTelemetryEvent(req as RequestWithLogin, {
      server,
      pagePath: options.path,
      docId: config.assignmentId,
    });
    resp.status(options.status).type('html').send(content);
  };
}

interface LogVisitedPageEventOptions {
  server: GristServer;
  pagePath: string;
  docId?: string;
}

function logVisitedPageTelemetryEvent(req: RequestWithLogin, options: LogVisitedPageEventOptions) {
  const {server, pagePath, docId} = options;

  // Construct a fake URL and append the utm_* parameters from the original URL.
  // We avoid using the original URL here because it may contain sensitive identifiers,
  // such as link key parameters and site/doc ids.
  const url = new URL('fake', server.getMergedOrgUrl(req));
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith('utm_')) {
      url.searchParams.set(key, String(value));
    }
  }

  server.getTelemetry().logEvent(req, 'visitedPage', {
    full: {
      docIdDigest: docId,
      url: url.toString(),
      path: pagePath,
      userAgent: req.headers['user-agent'],
      userId: req.userId,
      altSessionId: req.altSessionId,
    },
  });
}

function shouldSupportAnon() {
  // Enable UI for anonymous access if a flag is explicitly set in the environment
  return process.env.GRIST_SUPPORT_ANON === "true";
}

function getFeatures(): IFeature[] {
  const disabledFeatures = process.env.GRIST_HIDE_UI_ELEMENTS?.split(',') ?? [];
  const enabledFeatures = process.env.GRIST_UI_FEATURES?.split(',') ?? Features.values;
  return Features.checkAll(difference(enabledFeatures, disabledFeatures));
}

function getPermittedCustomWidgets(gristServer?: GristServer|null): IAttachedCustomWidget[] {
  if (!process.env.PERMITTED_CUSTOM_WIDGETS && gristServer) {
    // The PERMITTED_CUSTOM_WIDGETS environment variable is a bit of
    // a drag. If there are bundled widgets that overlap with widgets
    // described in the codebase, let's just assume they are permitted.
    const widgets = gristServer.getBundledWidgets();
    const names = new Set(AttachedCustomWidgets.values as string[]);
    const namesFound: IAttachedCustomWidget[] = [];
    for (const widget of widgets) {
      // Permitted custom widgets are identified so many ways across the
      // code! Why? TODO: cut down on identifiers.
      const name = widget.widgetId.replace('@gristlabs/widget-', 'custom.');
      if (names.has(name)) {
        namesFound.push(name as IAttachedCustomWidget);
      }
    }
    return AttachedCustomWidgets.checkAll(namesFound);
  }
  const widgetsList = process.env.PERMITTED_CUSTOM_WIDGETS?.split(',').map(widgetName=>`custom.${widgetName}`) ?? [];
  return AttachedCustomWidgets.checkAll(widgetsList);
}

function configuredPageTitleSuffix() {
  const result = process.env.GRIST_PAGE_TITLE_SUFFIX;
  return result === "_blank" ? "" : result;
}

/**
 * Returns the doc name.
 *
 * Note: The string returned is escaped and safe to insert into HTML.
 *
 */
function getDocName(config: GristLoadConfig): string|null {
  const maybeDoc = getDocFromConfig(config);

  return maybeDoc && escapeExpression(maybeDoc.name);
}

/**
 * Returns a string representation of 0 or more HTML metadata elements.
 *
 * Currently includes the document description and thumbnail if the requested page is
 * for a document and the document has one set.
 *
 * Note: The string returned is escaped and safe to insert into HTML.
 */
function getPageMetadataHtmlSnippet(req: express.Request, config: GristLoadConfig): string {
  const metadataElements: string[] = [];
  const maybeDoc = getDocFromConfig(config);

  metadataElements.push('<meta property="og:type" content="website">');
  metadataElements.push('<meta name="twitter:card" content="summary_large_image">');

  const description = maybeDoc?.options?.description ?
    escapeExpression(maybeDoc.options.description) :
    translate(req, 'og-description');
  metadataElements.push(`<meta name="description" content="${description}">`);
  metadataElements.push(`<meta property="og:description" content="${description}">`);
  metadataElements.push(`<meta name="twitter:description" content="${description}">`);

  const openGraphPreviewImage = process.env.GRIST_OPEN_GRAPH_PREVIEW_IMAGE || commonUrls.openGraphPreviewImage;
  const image = escapeExpression(maybeDoc?.options?.icon ?? openGraphPreviewImage);
  metadataElements.push(`<meta name="thumbnail" content="${image}">`);
  metadataElements.push(`<meta property="og:image" content="${image}">`);
  metadataElements.push(`<meta name="twitter:image" content="${image}">`);

  const maybeDocTitle = getDocName(config);
  const title = maybeDocTitle ? maybeDocTitle + getPageTitleSuffix(config) : translate(req, 'og-title');
  // NB: We don't generate the content of the <title> tag here.
  metadataElements.push(`<meta property="og:title" content="${title}">`);
  metadataElements.push(`<meta name="twitter:title" content="${title}">`);

  return metadataElements.join('\n');
}

function getDocFromConfig(config: GristLoadConfig): Document | null {
  if (!config.getDoc || !config.assignmentId) { return null; }

  return config.getDoc[config.assignmentId] ?? null;
}
