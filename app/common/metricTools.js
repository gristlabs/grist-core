const _ = require('underscore');
const gutil = require('./gutil');
const metricConfig = require('./metricConfig');

// TODO: Create a metric test class and write tests for each metric tool.

/**
 * Base class for tools to gather metrics. Should not be instantiated.
 */
function MetricTool(name) {
  this.name = name;
}

// Should be implemented by extending classes
MetricTool.prototype._getSuffix = function() {
  throw new Error("Not implemented");
};

// Should be overridden by extending classes depending on desired reset behavior
MetricTool.prototype.reset = _.noop;

// Returns the name of the metric with its suffix appended to the end.
// NOTE: Should return names in the same order as getValues.
MetricTool.prototype.getName = function() {
  return this.name + '.' + this._getSuffix();
};

// Should be implemented by extending classes. Returns the value of the tool for a bucket.
// @param {Number} bucketEndTime - The desired bucket's end time in milliseconds
MetricTool.prototype.getValue = function(bucketEndTime) {
  throw new Error("Not implemented");
};

// Returns a list of all primitive metrics this tool is made up of.
// Only requires overridding by non-primitive metrics.
MetricTool.prototype.getPrimitiveMetrics = function() {
  return [this];
};

/**
 * Counts the number of times an event has occurred in the current bucket.
 */
function Counter(name) {
  MetricTool.call(this, name);
  this.val = 0;
}
_.extend(Counter.prototype, MetricTool.prototype);

Counter.prototype.inc = function() {
  this.val += 1;
};

Counter.prototype._getSuffix = function() {
  return 'count';
};

Counter.prototype.getValue = function(bucketEndTime) {
  // If the bucket is more recent than the last one where counting occurred, return 0
  return this.val;
};

Counter.prototype.reset = function(bucketEndTime) {
  this.val = 0;
};
exports.Counter = Counter;


/**
 * Keeps track of a count that persists across buckets.
 */
function Gauge(name) {
  MetricTool.call(this, name);
  this.val = null;
}
_.extend(Gauge.prototype, MetricTool.prototype);

Gauge.prototype.set = function(num) {
  this.val = num;
};

Gauge.prototype.inc = function() {
  this.val = (this.val ? this.val + 1 : 1);
};

Gauge.prototype.dec = function() {
  this.val -= 1;
};

Gauge.prototype._getSuffix = function() {
  return 'total';
};

Gauge.prototype.getValue = function(bucketEndTime) {
  return this.val;
};
exports.Gauge = Gauge;


/**
 * A gauge that pulls samples using a callback function
 */
function SamplingGauge(name) {
  MetricTool.call(this, name);
  this.callback = _.constant(null);
}
_.extend(SamplingGauge.prototype, MetricTool.prototype);

SamplingGauge.prototype.assignCallback = function(callback) {
  this.callback = callback;
};

SamplingGauge.prototype._getSuffix = function() {
  return 'total';
};

SamplingGauge.prototype.getValue = function(bucketEndTime) {
  return this.callback();
};
exports.SamplingGauge = SamplingGauge;


/**
 * Keeps track of whether or not a certain condition is met. Useful for statistics
 * which measure the number of users who meet a certain criteria. Persists across buckets.
 */
function Switch(name) {
  MetricTool.call(this, name);
  this.val = null;
}
_.extend(Switch.prototype, Gauge.prototype);

Switch.prototype.set = function(bool) {
  this.val = bool ? 1 : 0;
};

Switch.prototype._getSuffix = function() {
  return 'instances';
};

Switch.prototype.getValue = function(bucketEndTime) {
  return this.val;
};
exports.Switch = Switch;


/**
 * Keeps track of the amount of time in each bucket that an event is occurring (ms).
 */
function Timer(name) {
  MetricTool.call(this, name);
  this.val = 0;               // The sum of all runtimes in the last updated bucket
  this.startTime = 0;         // The time (in ms since the bucket started) when the timer was started
  this.running = false;
}
_.extend(Timer.prototype, MetricTool.prototype);

Timer.prototype.setRunning = function(bool) {
  return bool ? this.start() : this.stop();
};

Timer.prototype.start = function() {
  if (this.running) {
    return;
  }
  // Record start time and set to running
  this.startTime = Date.now();
  this.running = true;
};

Timer.prototype.stop = function() {
  if (!this.running) {
    return;
  }
  // Add time since start to value and set running to false
  var stopTime = Date.now();
  this.val += stopTime - this.startTime;
  this.running = false;
};

Timer.prototype._getSuffix = function() {
  return 'time';
};

Timer.prototype.getValue = function(bucketEndTime) {
  // Add the value and the time to the end of the bucket if the timer is running
  return this.val + (this.running ? Math.max(0, bucketEndTime - this.startTime) : 0);
};

Timer.prototype.reset = function(bucketEndTime) {
  this.val = 0;
  this.startTime = Math.max(bucketEndTime, this.startTime);
};
exports.Timer = Timer;


/**
 * Keeps track of the amount of time in an event takes, and the number of times that event occurs (ms).
 */
function ExecutionTimer(name) {
  MetricTool.call(this, name);
  this.startTime = 0;         // The last time (in ms) the timer was started
  this.val = 0;
  this.running = false;
  // Counter keeps track of the total number of executions in the current bucket.
  // An execution is in a bucket if it ended in that bucket.
  this.counter = new Counter(name);
}
_.extend(ExecutionTimer.prototype, MetricTool.prototype);

ExecutionTimer.prototype.setRunning = function(bool) {
  return bool ? this.start() : this.stop();
};

ExecutionTimer.prototype.start = function() {
  if (this.running) {
    return;
  }
  this.startTime = Date.now();
  this.running = true;
};

ExecutionTimer.prototype.stop = function() {
  if (!this.running) {
    return;
  }
  var stopTime = Date.now();
  this.val += stopTime - this.startTime;
  this.counter.inc();
  this.running = false;
};

ExecutionTimer.prototype._getSuffix = function() {
  return 'execution_time';
};

ExecutionTimer.prototype.getValue = function(bucketEndTime) {
  return this.val;
};

ExecutionTimer.prototype.reset = function(bucketEndTime) {
  this.val = 0;
  this.counter.reset();
};

ExecutionTimer.prototype.getPrimitiveMetrics = function() {
  return [this, this.counter];
};
exports.ExecutionTimer = ExecutionTimer;


// Returns the time rounded down to the start of the current bucket's time window (in ms).
function getBucketStartTime(now) {
  return gutil.roundDownToMultiple(now, metricConfig.BUCKET_SIZE);
}
exports.getBucketStartTime = getBucketStartTime;

// Returns the time until the start of the next bucket (in ms).
function getDeltaMs(now) {
  return getBucketStartTime(now) + metricConfig.BUCKET_SIZE - now;
}
exports.getDeltaMs = getDeltaMs;
