const _ = require('underscore');
const metricConfig = require('./metricConfig');
const metricTools = require('./metricTools');
const gutil = require('app/common/gutil');

/**
 * Base class for metrics collection used by both the server metrics collector, ServerMetrics.js,
 *  and the client metrics collector, ClientMetrics.js. Should not be instantiated.
 * Establishes interval attempts to push metrics to the server on creation.
 */
function MetricsCollector() {
  this.startTime = metricTools.getBucketStartTime(Date.now());
  this.readyToExport = [];
  // used (as a protected member) by the derived ServerMetrics class.
  this._collect = setTimeout(() => this.scheduleBucketPreparation(), metricTools.getDeltaMs(Date.now()));
}

// Should return a map from metric names (as entered in metricConfig.js) to their metricTools.
MetricsCollector.prototype.getMetrics = function() {
  throw new Error("Not implemented");
};

// Should return a promise that is resolved when the metrics have been pushed.
MetricsCollector.prototype.pushMetrics = function() {
  throw new Error("Not implemented");
};

// Should return a bucket of metric data, formatted for either the client or server.
MetricsCollector.prototype.createBucket = function(bucketStart) {
  throw new Error("Not implemented");
};

// Takes a list of metrics specifications and creates an object mapping metric names to
//  a new instance of the metric gathering tool matching that metric's type.
MetricsCollector.prototype.initMetricTools = function(metricsList) {
  var metrics = {};
  metricsList.forEach(metricInfo => {
    metrics[metricInfo.name] = new metricTools[metricInfo.type](metricInfo.name);
  });
  return metrics;
};

// Called each push interval.
MetricsCollector.prototype.attemptPush = function() {
  this.pushMetrics(this.readyToExport);
  this.readyToExport = [];
};

// Pushes bucket to the end of the readyToExport queue. Should be called sequentially, since it
//  handles deletion of buckets older than the export memory limit.
MetricsCollector.prototype.queueBucket = function(bucket) {
  // If readyToExport is at maximum length, delete the oldest element
  this.readyToExport.push(bucket);
  var length = this.readyToExport.length;
  if (length > metricConfig.MAX_PENDING_BUCKETS) {
    this.readyToExport.splice(0, length - metricConfig.MAX_PENDING_BUCKETS);
  }
};

MetricsCollector.prototype.scheduleBucketPreparation = function() {
  this.prepareCompletedBuckets(Date.now());
  this._collect = setTimeout(() => this.scheduleBucketPreparation(), metricTools.getDeltaMs(Date.now()));
};

/**
 * Checks if each bucket since the last update is completed and for each one adds all data and
 *  pushes it to the export ready array.
 */
MetricsCollector.prototype.prepareCompletedBuckets = function(now) {
  var bucketStart = metricTools.getBucketStartTime(now);
  while (bucketStart > this.startTime) {
    this.queueBucket(this.createBucket(this.startTime));
    this.startTime += metricConfig.BUCKET_SIZE;
  }
};

/**
 * Collects primitive metrics tools into a list.
 */
MetricsCollector.prototype.collectPrimitiveMetrics = function() {
  var metricTools = [];
  _.forEach(this.getMetrics(), metricTool => {
    gutil.arrayExtend(metricTools, metricTool.getPrimitiveMetrics());
  });
  return metricTools;
};

/**
 * Loops through metric tools for a chosen bucket and performs the provided callback on each.
 * Resets each tool after the callback is performed.
 * @param {Number} bucketStart - The desired bucket's start time in milliseconds
 * @param {Function} callback - The callback to perform on each metric tool.
 */
MetricsCollector.prototype.forEachBucketMetric = function(bucketEnd, callback) {
  this.collectPrimitiveMetrics().forEach(tool => {
    callback(tool);
    tool.reset(bucketEnd);
  });
};

module.exports = MetricsCollector;
