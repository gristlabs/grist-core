/**
 *
 * A version of hosted grist that recombines a home server,
 * a doc worker, and a static server on a single port.
 *
 */

import {FlexServer, FlexServerOptions} from 'app/server/lib/FlexServer';
import {GristLoginSystem} from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';

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
  logToConsole?: boolean;  // If set, messages logged to console (default: false)
                           //   (but if options are not given at all in call to main,
                           //    logToConsole is set to true)
  externalStorage?: boolean; // If set, documents saved to external storage such as s3 (default is to check environment
                           // variables, which get set in various ways in dev/test entry points)
  loginSystem?: () => Promise<GristLoginSystem>;
}

/**
 * Start a server on the given port, including the functionality specified in serverTypes.
 */
export async function main(port: number, serverTypes: ServerType[],
                           options: ServerOptions = {}) {
  const includeHome = serverTypes.includes("home");
  const includeDocs = serverTypes.includes("docs");
  const includeStatic = serverTypes.includes("static");
  const includeApp = serverTypes.includes("app");

  const server = new FlexServer(port, `server(${serverTypes.join(",")})`, options);

  // We need to know early on whether we will be serving plugins or not.
  if (includeHome) {
    const userPort = checkUserContentPort();
    server.setServesPlugins(userPort !== undefined);
  } else {
    server.setServesPlugins(false);
  }

  if (options.loginSystem) {
    server.setLoginSystem(options.loginSystem);
  }

  server.addCleanup();
  server.setDirectory();

  if (process.env.GRIST_TEST_ROUTER) {
    // Add a mock api for adding/removing doc workers from load balancer.
    server.testAddRouter();
  }

  if (options.logToConsole !== false) { server.addLogging(); }
  if (options.externalStorage === false) { server.disableExternalStorage(); }
  await server.loadConfig();

  if (includeDocs) {
    // It is important that /dw and /v prefixes are accepted (if present) by health check
    // in this case, since they are included in the url registered for the doc worker.
    server.stripDocWorkerIdPathPrefixIfPresent();
    server.addTagChecker();
  }

  server.addHealthCheck();
  if (includeHome || includeApp) {
    server.addBootPage();
  }
  server.denyRequestsIfNotReady();

  if (includeHome || includeStatic || includeApp) {
    server.setDirectory();
  }

  if (includeHome || includeStatic) {
    server.addStaticAndBowerDirectories();
  }

  await server.initHomeDBManager();
  server.addHosts();

  server.addDocWorkerMap();

  if (includeHome || includeStatic) {
    await server.addAssetsForPlugins();
  }

  if (includeHome) {
    server.addEarlyWebhooks();
  }

  if (includeHome || includeDocs || includeApp) {
    server.addSessions();
  }

  server.addAccessMiddleware();
  server.addApiMiddleware();
  await server.addBillingMiddleware();

  try {
    await server.start();

    if (includeHome) {
      server.addUsage();
      if (!includeDocs) {
        server.addDocApiForwarder();
      }
      server.addJsonSupport();
      await server.addLandingPages();
      // todo: add support for home api to standalone app
      server.addHomeApi();
      server.addBillingApi();
      server.addNotifier();
      await server.addTelemetry();
      await server.addHousekeeper();
      await server.addLoginRoutes();
      server.addAccountPage();
      server.addBillingPages();
      server.addWelcomePaths();
      server.addLogEndpoint();
      server.addGoogleAuthEndpoint();
      server.addInstallEndpoints();
    }

    if (includeDocs) {
      server.addJsonSupport();
      await server.addTelemetry();
      await server.addDoc();
    }

    if (includeHome) {
      server.addClientSecrets();
    }

    server.finalizeEndpoints();
    await server.finalizePlugins(includeHome ? checkUserContentPort() : null);
    server.checkOptionCombinations();
    server.summary();
    server.ready();
    return server;
  } catch(e) {
    await server.close();
    throw e;
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

    const server = await main(port, serverTypes);

    const opt = process.argv[2];
    if (opt === '--testingHooks') {
      await server.addTestingHooks();
    }

    return server;
  } catch (e) {
    log.error('mergedServer failed to start', e);
    process.exit(1);
  }
}

if (require.main === module) {
  startMain().catch((e) => log.error('mergedServer failed to start', e));
}
