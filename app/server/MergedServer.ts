/**
 *
 * A version of hosted grist that recombines a home server,
 * a doc worker, and a static server on a single port.
 *
 */

import {FlexServer, FlexServerOptions} from 'app/server/lib/FlexServer';
import log from 'app/server/lib/log';
import {getGlobalConfig} from "app/server/lib/globalConfig";

// Allowed server types. We'll start one or a combination based on the value of GRIST_SERVERS
// environment variable.
export type ServerType = "home" | "docs" | "static" | "app";
const allServerTypes: ServerType[] = ["home", "docs", "static", "app"];

// Parse a comma-separate list of server types into an array, with validation.
export function parseServerTypes(serverTypes: string|undefined): ServerType[] {
  // Split and filter out empty strings (including the one we get when splitting "").
  const types = (serverTypes || "").trim().split(',').filter(part => Boolean(part));

  // Check that parts is non-empty and only contains valid options.
  if (!types.length) {
    throw new Error(`No server types; should be a comma-separated list of ${allServerTypes.join(", ")}`);
  }
  for (const t of types) {
    if (!allServerTypes.includes(t as ServerType)) {
      throw new Error(`Invalid server type '${t}'; should be in ${allServerTypes.join(", ")}`);
    }
  }
  return types as ServerType[];
}

function checkUserContentPort(): number | null {
  // Check whether a port is explicitly set for user content.
  if (process.env.GRIST_UNTRUSTED_PORT) {
    return parseInt(process.env.GRIST_UNTRUSTED_PORT, 10);
  }
  // Checks whether to serve user content on same domain but on different port
  if (process.env.APP_UNTRUSTED_URL && process.env.APP_HOME_URL) {
    const homeUrl = new URL(process.env.APP_HOME_URL);
    const pluginUrl = new URL(process.env.APP_UNTRUSTED_URL);
    // If the hostname of both home and plugin url are the same,
    // but the ports are different
    if (homeUrl.hostname === pluginUrl.hostname &&
        homeUrl.port !== pluginUrl.port) {
      const port = parseInt(pluginUrl.port || '80', 10);
      return port;
    }
  }
  return null;
}

interface ServerOptions extends FlexServerOptions {
  // If set, messages logged to console (default: false)
  // (but if options are not given at all in call to main, logToConsole is set to true)
  logToConsole?: boolean;

  // If set, documents saved to external storage such as s3 (default is to check environment variables,
  // which get set in various ways in dev/test entry points)
  externalStorage?: boolean;

  // If set, add this many extra dedicated doc workers,
  // at ports above the main server.
  extraWorkers?: number;
}

export class MergedServer {

  public static async create(port: number, serverTypes: ServerType[], options: ServerOptions = {}) {
    options.settings ??= getGlobalConfig();
    const ms = new MergedServer(port, serverTypes, options);
    // We need to know early on whether we will be serving plugins or not.
    if (ms.hasComponent("home")) {
      const userPort = checkUserContentPort();
      ms.flexServer.setServesPlugins(userPort !== undefined);
    } else {
      ms.flexServer.setServesPlugins(false);
    }

    ms.flexServer.addCleanup();
    ms.flexServer.setDirectory();

    if (process.env.GRIST_TEST_ROUTER) {
      // Add a mock api for adding/removing doc workers from load balancer.
      ms.flexServer.testAddRouter();
    }

    if (ms._options.logToConsole !== false) { ms.flexServer.addLogging(); }
    if (ms._options.externalStorage === false) { ms.flexServer.disableExternalStorage(); }
    await ms.flexServer.initHomeDBManager();
    await ms.flexServer.addLoginMiddleware();

    if (ms.hasComponent("docs")) {
      // It is important that /dw and /v prefixes are accepted (if present) by health check
      // in ms case, since they are included in the url registered for the doc worker.
      ms.flexServer.stripDocWorkerIdPathPrefixIfPresent();
      ms.flexServer.addTagChecker();
    }

    ms.flexServer.addHealthCheck();
    if (ms.hasComponent("home") || ms.hasComponent("app")) {
      ms.flexServer.addBootPage();
    }
    ms.flexServer.denyRequestsIfNotReady();

    if (ms.hasComponent("home") || ms.hasComponent("static") || ms.hasComponent("app")) {
      ms.flexServer.setDirectory();
    }

    if (ms.hasComponent("home") || ms.hasComponent("static")) {
      ms.flexServer.addStaticAndBowerDirectories();
    }

    ms.flexServer.addHosts();

    ms.flexServer.addDocWorkerMap();

    if (ms.hasComponent("home") || ms.hasComponent("static")) {
      await ms.flexServer.addAssetsForPlugins();
    }

    if (ms.hasComponent("home")) {
      ms.flexServer.addEarlyWebhooks();
    }

    if (ms.hasComponent("home") || ms.hasComponent("docs") || ms.hasComponent("app")) {
      ms.flexServer.addSessions();
    }

    ms.flexServer.addAccessMiddleware();
    ms.flexServer.addApiMiddleware();
    ms.flexServer.addBillingMiddleware();

    return ms;
  }

  public readonly flexServer: FlexServer;
  private readonly _serverTypes: ServerType[];
  private readonly _options: ServerOptions;
  // It can be useful to start up a bunch of extra workers within
  // a single process mostly for testing purposes, but conceivably
  // for real too.
  private readonly _extraWorkers: MergedServer[] = [];

  private constructor(port: number, serverTypes: ServerType[], options: ServerOptions = {}) {
    this._serverTypes = serverTypes;
    this._options = options;
    this.flexServer = new FlexServer(port, `server(${serverTypes.join(",")})`, options);
  }

  public hasComponent(serverType: ServerType) {
    return this._serverTypes.includes(serverType);
  }


  public async run() {

    try {
      await this.flexServer.start();

      if (this.hasComponent("home")) {
        this.flexServer.addUsage();
        if (!this.hasComponent("docs")) {
          this.flexServer.addDocApiForwarder();
        }
        await this.flexServer.addLandingPages();
        // Early endpoints use their own json handlers, so they come before
        // `addJsonSupport`.
        this.flexServer.addEarlyApi();
        this.flexServer.addJsonSupport();
        this.flexServer.addUpdatesCheck();
        this.flexServer.addWidgetRepository();
        // todo: add support for home api to standalone app
        this.flexServer.addHomeApi();
        this.flexServer.addScimApi();
        this.flexServer.addBillingApi();
        this.flexServer.addNotifier();
        this.flexServer.addAuditLogger();
        await this.flexServer.addTelemetry();
        this.flexServer.addAssistant();
        await this.flexServer.addHousekeeper();
        await this.flexServer.addLoginRoutes();
        this.flexServer.addAccountPage();
        this.flexServer.addBillingPages();
        this.flexServer.addWelcomePaths();
        this.flexServer.addLogEndpoint();
        this.flexServer.addGoogleAuthEndpoint();
        this.flexServer.addConfigEndpoints();
      }

      if (this.hasComponent("docs")) {
        this.flexServer.addJsonSupport();
        this.flexServer.addWidgetRepository();
        this.flexServer.addAuditLogger();
        await this.flexServer.addTelemetry();
        this.flexServer.addAssistant();
        await this.flexServer.addDoc();
      }

      if (this.hasComponent("home")) {
        this.flexServer.addClientSecrets();
      }

      this.flexServer.finalizeEndpoints();
      await this.flexServer.finalizePlugins(this.hasComponent("home") ? checkUserContentPort() : null);
      this.flexServer.checkOptionCombinations();
      this.flexServer.summary();
      this.flexServer.setReady(true);

      if (this._options.extraWorkers) {
        if (!process.env.REDIS_URL) {
          throw new Error('Redis needed to support multiple workers');
        }
        for (let i = 1; i <= this._options.extraWorkers; i++) {
          const server = await MergedServer.create(0, ['docs'], {
            ...this._options,
            extraWorkers: undefined,
          });
          await server.run();
          this._extraWorkers.push(server);
        }
      }
    } catch(e) {
      await this.close();
      throw e;
    }
  }

  public async close() {
    for (const worker of this._extraWorkers) {
      await worker.flexServer.close();
    }
    await this.flexServer.close();
  }

  /**
   * Look up a worker from its id in Redis.
   */
  public testGetWorkerFromId(docWorkerId: string): MergedServer {
    if (this.flexServer.worker?.id === docWorkerId) {
      return this;
    }
    for (const worker of this._extraWorkers) {
      if (worker.flexServer.worker.id === docWorkerId) {
        return worker;
      }
    }
    throw new Error('Worker not found');
  }
}

export async function startMain() {
  try {

    const serverTypes = parseServerTypes(process.env.GRIST_SERVERS);

    // No defaults for a port, since this server can serve very different purposes.
    if (!process.env.GRIST_PORT) {
      throw new Error("GRIST_PORT must be specified");
    }

    const port = parseInt(process.env.GRIST_PORT, 10);

    let extraWorkers = 0;
    if (process.env.DOC_WORKER_COUNT) {
      extraWorkers = parseInt(process.env.DOC_WORKER_COUNT, 10);
      // If the main server functions also as a doc worker, then
      // we need one fewer extra servers.
      if (serverTypes.includes('docs')) { extraWorkers--; }
    }

    const server = await MergedServer.create(port, serverTypes, {
      extraWorkers
    });
    await server.run();

    const opt = process.argv[2];
    if (opt === '--testingHooks') {
      await server.flexServer.addTestingHooks();
    }

    return server.flexServer;
  } catch (e) {
    log.error('mergedServer failed to start', e);
    process.exit(1);
  }
}

if (require.main === module) {
  startMain().catch((e) => log.error('mergedServer failed to start', e));
}
