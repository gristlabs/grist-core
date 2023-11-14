import {FlexServer} from 'app/server/lib/FlexServer';
import {GristServer} from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import {PluginManager} from 'app/server/lib/PluginManager';
import * as express from 'express';
import * as mimeTypes from 'mime-types';
import * as path from 'path';

// Get the host serving plugin material
export function getUntrustedContentHost(origin: string|undefined): string|undefined {
  if (!origin) { return; }
  return new URL(origin).host;
}

// Add plugin endpoints to be served on untrusted host
export function addPluginEndpoints(server: FlexServer, pluginManager: PluginManager) {
  if (server.servesPlugins()) {
    server.app.get(/^\/plugins\/(installed|builtIn)\/([^/]+)\/(.+)/, (req, res) =>
                   servePluginContent(req, res, pluginManager, server));
  }
}

// Serve content for plugins with various checks that it is being accessed as we expect.
function servePluginContent(req: express.Request, res: express.Response,
                            pluginManager: PluginManager,
                            gristServer: GristServer) {
  const pluginUrl = gristServer.getPluginUrl();
  const untrustedContentHost = getUntrustedContentHost(pluginUrl);
  if (!untrustedContentHost) {
    // not expected
    throw new Error('plugin host unexpectedly not set');
  }

  const pluginKind = req.params[0];
  const pluginId = req.params[1];
  const pluginPath = req.params[2];

  // We should not serve untrusted content (as from plugins) from the same domain as the main app
  // (at least not html pages), as it's an open door to XSS attacks.
  // - For hosted version, we serve it from a separate domain name.
  // - For electron version, we give access to protected <webview> content based on a special header.
  // - We also allow "application/javascript" content from the main domain for serving the
  //   WebWorker main script, since that's hard to distinguish in electron case, and should not
  //   enable XSS.
  if (matchHost(req.get('host'), untrustedContentHost) ||
      req.get('X-From-Plugin-WebView') === "true" ||
      mimeTypes.lookup(path.extname(pluginPath)) === "application/javascript") {
    const dirs = pluginManager.dirs();
    const contentRoot = pluginKind === "installed" ? dirs.installed :
        (pluginKind === "builtIn" ? dirs.builtIn : dirs.bundled);
    // Note that pluginPath may not be safe, but `sendFile` with the "root" option restricts
    // relative paths to be within the root folder (see the 3rd party library unit-test:
    // https://github.com/pillarjs/send/blob/3daa901cf731b86187e4449fa2c52f971e0b3dbc/test/send.js#L1363)
    return res.sendFile(`${pluginId}/${pluginPath}`, {root: contentRoot});
  }

  log.warn(`Refusing to serve untrusted plugin content on ${req.get('host')}`);
  res.status(403).end('Plugin content is not accessible to this request');
}

// Middleware to restrict some assets to untrusted host.
export function limitToPlugins(gristServer: GristServer,
                               handler: express.RequestHandler) {
  return function(req: express.Request, resp: express.Response, next: express.NextFunction) {
    const pluginUrl = gristServer.getPluginUrl();
    const host = getUntrustedContentHost(pluginUrl);
    if (!host) { return next(); }
    if (matchHost(req.get('host'), host) || req.get('X-From-Plugin-WebView') === "true") {
      return handler(req, resp, next);
    }
    return next();
  };
}

// Compare hosts, bearing in mind that if they happen to be on port 443 the
// port number may or may not be included.  This assumes we are serving over https.
function matchHost(host1: string|undefined, host2: string) {
  if (!host1) { return false; }
  if (host1 === host2) { return true; }
  if (host1.indexOf(':') === -1) { host1 += ":443"; }
  if (host2.indexOf(':') === -1) { host2 += ":443"; }
  return host1 === host2;
}
