/**
 * The server's Comm object implements communication with the client.
 *
 * The server receives requests, to which it sends a response (or an error). The server can
 * also send asynchronous messages to the client. Available methods should be provided via
 * comm.registerMethods().
 *
 * To send async messages, you may call broadcastMessage() or sendDocMessage().
 *
 * In practice, requests which modify the document are done via UserActions.js, and result in an
 * asynchronous message updating the document (which is sent to all clients who have the document
 * open), and the response could return some useful value, but does not have to.
 *
 * See app/client/components/Comm.js for other details of the communication protocol.
 *
 *
 * Currently, this module also implements the concept of a "Client". A Client corresponds to a
 * browser window, and should persist across brief disconnects. A Client has a 'clientId'
 * property, which uniquely identifies a client within the currently running server. Method
 * registered with Comm always receive a Client object as the first argument.
 *
 * In the future, we may want to have a separate Client.js file with documentation of the various
 * properties that may be associated with a client.
 *
 * Note that users of this module should never use the websocket of a Client, since that's an
 * implementation detail of Comm.js.
 */

/**
 * Event for DocList changes.
 * @event docListAction Emitted when the document list changes in any way.
 * @property {Array[String]} [addDocs] Array of names of documents to add to the docList.
 * @property {Array[String]} [removeDocs] Array of names of documents that got removed.
 * @property {Array[String]} [renameDocs] Array of [oldName, newName] pairs for renamed docs.
 * @property {Array[String]} [addInvites] Array of document invite names to add.
 * @property {Array[String]} [removeInvites] Array of documents invite names to remove.
 */



var events = require('events');
var url = require('url');
var util = require('util');
var ws = require('ws');
var Promise = require('bluebird');

var log = require('./log');
var gutil = require('app/common/gutil');
const {parseFirstUrlPart} = require('app/common/gristUrls');
const version = require('app/common/version');
const {Client} = require('./Client');
const {localeFromRequest} = require('app/server/lib/ServerLocale');

// Bluebird promisification, to be able to use e.g. websocket.sendAsync method.
Promise.promisifyAll(ws.prototype);

/// How long the client state persists after a disconnect.
var clientRemovalTimeoutMsDefault = 300 * 1000;   // 300s = 5 minutes.
var clientRemovalTimeoutMs = clientRemovalTimeoutMsDefault;

/**
 * Constructs a Comm object.
 * @param {Object} server - The HTTP server.
 * @param {Object} options.sessions - A collection of sessions
 * @param {Object} options.settings - The config object containing instance settings
 *  including features.
 * @param {Object} options.instanceManager - Instance manager, giving access to InstanceStore
 *  and per-instance objects. If null, HubUserClient will not be created.
 * @param {Object} options.hosts - Hosts object from extractOrg.ts. if set, we use
 *  hosts.getOrgInfo(req) to extract an organization from a (possibly versioned) url.
 */
function Comm(server, options) {
  events.EventEmitter.call(this);
  this._server = server;
  this._httpsServer = options.httpsServer;
  this.wss = this._startServer();

  // Maps client IDs to websocket objects.
  this._clients = {};       // Maps clientIds to Client objects.
  this.clientList = [];     // List of all active Clients, ordered by clientId.

  // Maps sessionIds to ScopedSession objects.
  this.sessions = options.sessions;

  this._settings = options.settings;
  this._hosts = options.hosts;

  // This maps method names to their implementation.
  this.methods = {};

  // For testing, we need a way to override the server version reported.
  // For upgrading, we use this to set the server version for a defunct server
  // to "dead" so that a client will know that it needs to periodically recheck
  // for a valid server.
  this._serverVersion = null;
}
util.inherits(Comm, events.EventEmitter);


/**
 * Registers server methods.
 * @param {Object[String:Function]} Mapping of method name to their implementations. All methods
 *      receive the client as the first argument, and the arguments from the request.
 */
Comm.prototype.registerMethods = function(serverMethods) {
  // Wrap methods to translate return values and exceptions to promises.
  for (var methodName in serverMethods) {
    this.methods[methodName] = Promise.method(serverMethods[methodName]);
  }
};

/**
 * Returns the Client object associated with the given clientId, or throws an Error if not found.
 */
Comm.prototype.getClient = function(clientId) {
  const client = this._clients[clientId];
  if (!client) { throw new Error('Unrecognized clientId'); }
  return client;
};

/**
 * Returns a ScopedSession object with the given session id from the list of sessions,
 *  or adds a new one and returns that.
 */
Comm.prototype.getOrCreateSession = function(sid, req, userSelector) {
  // ScopedSessions are specific to a session id / org combination.
  const org = req.org || "";
  return this.sessions.getOrCreateSession(sid, org, userSelector);
};


/**
 * Returns the sessionId from the signed grist cookie.
 */
Comm.prototype.getSessionIdFromCookie = function(gristCookie) {
  return this.sessions.getSessionIdFromCookie(gristCookie);
};


/**
 * Broadcasts an app-level message to all clients.
 * @param {String} type - Type of message, e.g. 'docListAction'.
 * @param {Object} messageData - The data for this type of message.
 */
Comm.prototype.broadcastMessage = function(type, messageData) {
  return this._broadcastMessage(type, messageData, this.clientList);
};

Comm.prototype._broadcastMessage = function(type, data, clients) {
  clients.forEach(client => client.sendMessage({type, data}));
};

/**
 * Sends a per-doc message to the given client.
 * @param {Object} client - The client object, as passed to all per-doc methods.
 * @param {Number} docFD - The document's file descriptor in the given client.
 * @param {String} type - The type of the message, e.g. 'docUserAction'.
 * @param {Object} messageData - The data for this type of message.
 * @param {Boolean} fromSelf - Whether `client` is the originator of this message.
 */
Comm.sendDocMessage = function(client, docFD, type, data, fromSelf = undefined) {
  client.sendMessage({type, docFD, data, fromSelf});
};

/**
 * Processes a new websocket connection.
 * TODO: Currently it always creates a new client, but in the future the creation of a client
 * should possibly be delayed until some hello message, so that a previous client may reconnect
 * without losing state.
 */
Comm.prototype._onWebSocketConnection = async function(websocket, req) {
  log.info("Comm: Got WebSocket connection: %s", req.url);
  if (this._hosts) {
    // DocWorker ID (/dw/) and version tag (/v/) may be present in this request but are not
    // needed. addOrgInfo assumes req.url starts with /o/ if present.
    req.url = parseFirstUrlPart('dw', req.url).path;
    req.url = parseFirstUrlPart('v', req.url).path;
    await this._hosts.addOrgInfo(req);
  }

  websocket.on('error', this.onError.bind(this, websocket));
  websocket.on('close', this.onClose.bind(this, websocket));
  // message handler is added later, after we create a Client but before any async operations

  // Parse the cookie in the request to get the sessionId.
  var sessionId = this.sessions.getSessionIdFromRequest(req);
  var urlObj = url.parse(req.url, true);
  var existingClientId = urlObj.query.clientId;
  var browserSettings = urlObj.query.browserSettings ? JSON.parse(urlObj.query.browserSettings) : {};
  var newClient = (parseInt(urlObj.query.newClient, 10) === 1);
  const counter = urlObj.query.counter;
  const userSelector = urlObj.query.user || '';

  // Associate an ID with each websocket, reusing the supplied one if it's valid.
  var client;
  if (existingClientId && this._clients.hasOwnProperty(existingClientId) &&
      !this._clients[existingClientId]._websocket &&
      await this._clients[existingClientId].isAuthorized()) {
    client = this._clients[existingClientId];
    client.setCounter(counter);
    log.info("Comm %s: existing client reconnected (%d missed messages)", client,
             client._missedMessages.length);
    if (client._destroyTimer) {
      log.warn("Comm %s: clearing scheduled destruction", client);
      clearTimeout(client._destroyTimer);
      client._destroyTimer = null;
    }
    if (newClient) {
      // If this isn't a reconnect, then we assume that the browser client lost its state (e.g.
      // reloaded the page), so we treat it as a disconnect followed by a new connection to the
      // same state. At the moment, this only means that we close all docs.
      if (client._missedMessages.length) {
        log.warn("Comm %s: clearing missed messages for new client", client);
      }
      client._missedMessages.length = 0;
      client.closeAllDocs();
    }
    client.setConnection(websocket, req.headers.host, browserSettings);
  } else {
    client = new Client(this, this.methods, req.headers.host, localeFromRequest(req));
    client.setCounter(counter);
    client.setConnection(websocket, req.headers.host, browserSettings);
    this._clients[client.clientId] = client;
    this.clientList.push(client);
    log.info("Comm %s: new client", client);
  }

  websocket._commClient = client;
  websocket.clientId = client.clientId;

  // Add a Session object to the client.
  log.info(`Comm ${client}: using session ${sessionId}`);
  const scopedSession = this.getOrCreateSession(sessionId, req, userSelector);
  client.setSession(scopedSession);

  // Delegate message handling to the client
  websocket.on('message', client.onMessage.bind(client));

  scopedSession.getSessionProfile()
  .then((profile) => {
    log.debug(`Comm ${client}: sending clientConnect with ` +
      `${client._missedMessages.length} missed messages`);
    // Don't use sendMessage here, since we don't want to queue up this message on failure.
    client.setOrg(req.org || "");
    client.setProfile(profile);
    const clientConnectMsg = {
      type: 'clientConnect',
      clientId: client.clientId,
      serverVersion: this._serverVersion || version.gitcommit,
      missedMessages: client._missedMessages.slice(0),
      settings: this._settings,
      profile,
    };
    // If reconnecting a client with missed messages, clear them now.
    client._missedMessages.length = 0;
    return websocket.sendAsync(JSON.stringify(clientConnectMsg))
    // A heavy-handed fix to T396, since 'clientConnect' is sometimes not seen in the browser,
    // (seemingly when the 'message' event is triggered before 'open' on the native WebSocket.)
    // See also my report at https://stackoverflow.com/a/48411315/328565
    .delay(250).then(() => {
      if (client._destroyed) { return; }  // object is already closed - don't show messages
      if (websocket.readyState === websocket.OPEN) {
        return websocket.sendAsync(JSON.stringify(Object.assign(clientConnectMsg, {dup: true})));
      } else {
        log.debug(`Comm ${client}: websocket closed right after clientConnect`);
      }
    });
  })
  .then(() => {
    if (!client._destroyed) { log.debug(`Comm ${client}: clientConnect sent successfully`); }
  })
  .catch(err => {
    log.error(`Comm ${client}: failed to prepare or send clientConnect:`, err);
  });
};

/**
 * Processes an error on the websocket.
 */
Comm.prototype.onError = function(websocket, err) {
  log.warn("Comm cid %s: onError", websocket.clientId, err);
  // TODO Make sure that this is followed by onClose when the connection is lost.
};

/**
 * Processes the closing of a websocket.
 */
Comm.prototype.onClose = function(websocket) {
  log.info("Comm cid %s: onClose", websocket.clientId);
  websocket.removeAllListeners();

  var client = websocket._commClient;
  if (client) {
    // Remove all references to the websocket.
    client._websocket = null;

    // Schedule the client to be destroyed after a timeout. The timer gets cleared if the same
    // client reconnects in the interim.
    if (client._destroyTimer) {
      log.warn("Comm cid %s: clearing previously scheduled destruction", websocket.clientId);
      clearTimeout(client._destroyTimer);
    }
    log.warn("Comm cid %s: will discard client in %s sec",
      websocket.clientId, clientRemovalTimeoutMs / 1000);
    client._destroyTimer = setTimeout(this._destroyClient.bind(this, client),
                                      clientRemovalTimeoutMs);
  }
};

Comm.prototype._startServer = function() {
  const servers = [this._server];
  if (this._httpsServer) { servers.push(this._httpsServer); }
  const wss = [];
  for (const server of servers) {
    const wssi = new ws.Server({server});
    wssi.on('connection', async (websocket, req) => {
      try {
        await this._onWebSocketConnection(websocket, req);
      } catch (e) {
        log.error("Comm connection for %s threw exception: %s", req.url, e.message);
        websocket.removeAllListeners();
        websocket.terminate();  // close() is inadequate when ws routed via loadbalancer
      }
    });
    wss.push(wssi);
  }
  return wss;
};

Comm.prototype.testServerShutdown = async function() {
  if (this.wss) {
    for (const wssi of this.wss) {
      await Promise.fromCallback((cb) => wssi.close(cb));
    }
    this.wss = null;
  }
};

Comm.prototype.testServerRestart = async function() {
  await this.testServerShutdown();
  this.wss = this._startServer();
};

/**
 * Destroy all clients, forcing reconnections.
 */
Comm.prototype.destroyAllClients = function() {
  // Iterate over all clients.  Take a copy of the list of clients since it will be changing
  // during the loop as we remove them one by one.
  for (const client of this.clientList.slice()) {
    client.interruptConnection();
    this._destroyClient(client);
  }
};

/**
 * Destroys a client. If the same browser window reconnects later, it will get a new Client
 * object and clientId.
 */
Comm.prototype._destroyClient = function(client) {
  log.info("Comm %s: client gone", client);
  client.closeAllDocs();
  if (client._destroyTimer) {
    clearTimeout(client._destroyTimer);
  }
  delete this._clients[client.clientId];
  gutil.arrayRemove(this.clientList, client);
  client.destroy();
};

/**
 * Override the version string Comm will report to clients.
 * Call with null to reset the override.
 *
 */
Comm.prototype.setServerVersion = function (serverVersion) {
  this._serverVersion = serverVersion;
};

/**
 * Mark the server as active or inactive.  If inactive, any client that manages to
 * connect to it will read a server version of "dead".
 */
Comm.prototype.setServerActivation = function (active) {
  this._serverVersion = active ? null : 'dead';
};

/**
 * Set how long clients persist on the server after disconnection.  Call with
 * 0 to return to the default.
 */
Comm.prototype.testSetClientPersistence = function (ttlMs) {
  clientRemovalTimeoutMs = ttlMs || clientRemovalTimeoutMsDefault;
}

module.exports = Comm;
