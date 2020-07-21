const _ = require('underscore');
const net = require('net');
const Promise = require('bluebird');
const log = require('./log');
const MetricCollector = require('app/common/MetricCollector');
const metricConfig = require('app/common/metricConfig');
const shutdown = require('./shutdown');
const version = require('app/common/version');
const crypto = require('crypto');

// Grist Metrics EC2 instance host and port
const host = 'metrics.getgrist.com';
const port = '2023'; // Plain-text port of carbon-aggregator

// Global reference to an instance of this class established in the constuctor.
var globalServerMetrics = null;

/**
 * Server-facing class for initializing server metrics collection.
 * Establishes interval attempts to push measured server metrics to the prometheus PushGateway
 *  on creation.
 * @param {Object} user - Instance of User.js server class, which contains config settings.
 */
function ServerMetrics() {
  MetricCollector.call(this);
  this.socket = null;
  // Randomly generated id to differentiate between metrics from this server and others.
  this.serverId = crypto.randomBytes(8).toString('hex');
  this.serverMetrics = this.initMetricTools(metricConfig.serverMetrics);
  this.clientNames = null;
  this.enabled = false;
  // Produce the prefix string for all metrics.
  // NOTE: If grist-rt is used instead of grist-raw for some metrics, this must be changed.
  let versionStr = version.version.replace(/\W/g, '-');
  let channelStr = version.channel.replace(/\W/g, '-');
  this._prefix = `grist-raw.instance.${channelStr}.${versionStr}`;

  globalServerMetrics = this;

  // This will not send metrics when they are disabled since there is a check in pushMetrics.
  shutdown.addCleanupHandler(null, () => this.attemptPush());
}
_.extend(ServerMetrics.prototype, MetricCollector.prototype);

/**
 * Checks the given preferences object from the user configuration and starts pushing metrics
 *  to carbon if metrics are enabled. Otherwise, ends the socket connection if there is one.
 */
ServerMetrics.prototype.handlePreferences = function(config) {
  config = config || {};
  this.enabled = config.enableMetrics;
  Promise.resolve(this.enabled && this._connectSocket())
  .then(() => {
    if (this.enabled) {
      this._push = setTimeout(() => this.attemptPush(), metricConfig.SERVER_PUSH_INTERVAL);
    } else if (this.socket) {
      this.socket.end();
    }
  });
};

ServerMetrics.prototype.disable = function() {
  this.enabled = false;
  if (this._push) {
    clearTimeout(this._push);
    this._push = null;
  }
  if (this._collect) {
    clearTimeout(this._collect);
    this._collect = null;
  }
}


/**
 * Returns a promise for a socket connection to the Carbon metrics collection server.
 * The promise will not fail because of connection errors, rather it will be continuously
 *  re-evaluated until it connects. The retry rate is specified in metricConfig.js
 */
ServerMetrics.prototype._connectSocket = function() {
  if (!this.enabled) { return Promise.resolve(); }
  var socket = null;
  log.info('Attempting connection to Carbon metrics server');
  return new Promise((resolve, reject) => {
    socket = net.connect({host: host, port: port}, () => {
      log.info('Connected to Carbon metrics server');
      this.socket = socket;
      resolve();
    });
    socket.setEncoding('utf8');
    socket.on('error', err => {
      log.warn('Carbon metrics connection error: %s', err);
      if (this.socket) {
        this.socket.end();
        this.socket = null;
      }
      reject(err);
    });
  })
  .catch(() => {
    return Promise.delay(metricConfig.CONN_RETRY)
      .then(() => this._connectSocket());
  });
};

// Returns a map from metric names (as entered in metricConfig.js) to their metricTools.
ServerMetrics.prototype.getMetrics = function() {
  return this.serverMetrics;
};

// Pushes ready server and client metrics to the aggregator
ServerMetrics.prototype.pushMetrics = function(metrics) {
  if (this.enabled) {
    return this._request(metrics.join(""))
      .finally(() => {
        this._push = setTimeout(() => this.attemptPush(), metricConfig.SERVER_PUSH_INTERVAL);
      });
  }
};

ServerMetrics.prototype._request = function(text) {
  return new Promise(resolve => {
    if (!this.enabled) {
      resolve();
      return;
    }
    this.socket.write(text, 'utf8', () => {
      log.info('Pushed metrics to Carbon');
      resolve();
    });
  })
  .catch(() => {
    return this._connectSocket()
      .then(() => this._request(text));
  });
};

/**
 * Function exposed to comm interface to provide server with client list of metrics.
 * Used so that ServerMetrics can associate indices to client metric names.
 * @param {Array} metricNames - A list of client metric names in the order in which values will be sent.
 */
ServerMetrics.prototype.registerClientMetrics = function(client, metricNames) {
  this.clientNames = metricNames;
};

/**
 * Function exposed to comm interface to allow client metrics to be pushed to this file,
 * so that they may in turn be pushed to Carbon with the server metrics.
 * @param {Array} data - A list of client buckets as defined in ClientMetrics.js's createBucket
 */
ServerMetrics.prototype.pushClientMetrics = function(client, data) {
  // Merge ready client bucket metrics into ready server buckets.
  if (!this.clientNames) {
    throw new Error("Client metrics must be registered");
  }
  data.forEach(clientBucket => {
    // Label the bucket with the client id so that clients' metrics do not replace one another
    let clientData = clientBucket.values.map((val, i) => {
      return this._stringifyMetric(this.clientNames[i], client.clientId, val, clientBucket.startTime);
    }).join("");
    this.queueBucket(clientData);
  });
};

ServerMetrics.prototype.get = function(name) {
  this.prepareCompletedBuckets(Date.now());
  return this.serverMetrics[name];
};

/**
 * Creates string bucket with metrics in carbon's text format.
 * For details, see phriction documentation: https://phab.getgrist.com/w/metrics/
 */
ServerMetrics.prototype.createBucket = function(bucketStart) {
  var data = [];
  var bucketEnd = bucketStart + metricConfig.BUCKET_SIZE;
  this.forEachBucketMetric(bucketEnd, tool => {
    if (tool.getValue(bucketEnd) !== null) {
      data.push(this._stringifyMetric(tool.getName(), this.serverId, tool.getValue(bucketEnd), bucketStart));
    }
  });
  return data.join("");
};

// Helper to stringify individual metrics for carbon's text format.
ServerMetrics.prototype._stringifyMetric = function(name, id, val, startTime) {
  // Server/client id is added to name for differentiating inputs to aggregator
  return `${this._prefix}.${name}.${id} ${val} ${startTime/1000}\n`;
};

/**
 * Static get method to retreive server metric recording tools.
 * IMPORTANT: Usage involves the side effect of updating completed buckets and
 *  adding them to a ready object. get() results should not be assigned to variables and
 *  reused, rather get() should be called each time a metric is needed.
 */
ServerMetrics.get = function(name) {
  if (!globalServerMetrics) {
    throw new Error('Must create ServerMetrics instance to access server metrics.');
  }
  return globalServerMetrics.get(name);
};

module.exports = ServerMetrics;
