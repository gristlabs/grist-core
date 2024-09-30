import { makeId } from 'app/server/lib/idUtils';
import log from 'app/server/lib/log';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

/**
 *
 * Support for queues.
 *
 * We use BullMQ for queuing, since it seems currently the best the
 * node ecosystem has to offer. BullMQ relies on Redis. Since queuing
 * is so handy, but we'd like most of Grist to be usable without Redis,
 * we make some effort to support queuing without BullMQ. This
 * may not be sustainable, we'll see.
 *
 * Important: if you put a job in a queue, it can outlast your process.
 * That has implications for testing and deployment, so be careful.
 *
 * Long running jobs may be a challenge. BullMQ cancelation
 * relies on non-open source features:
 *  https://docs.bullmq.io/bullmq-pro/observables/cancelation
 *
 */
export interface GristJobs {
  /**
   * All workers and jobs are scoped to individual named queues,
   * with the real interfaces operating at that level.
   */
  queue(queueName?: string): GristQueueScope;

  /**
   * Shut everything down that we're responsible for.
   * Set obliterate flag to destroy jobs even if they are
   * stored externally (useful for testing).
   */
  stop(options?: {
    obliterate?: boolean,
  }): Promise<void>;
}

/**
 * For a given queue, we can add jobs, or methods to process jobs,
 */
export interface GristQueueScope {
  /**
   * Add a job.
   */
  add(name: string, data: any, options?: JobAddOptions): Promise<void>;


  /**
   * Add a job handler for all jobs regardless of name.
   * Handlers given by handleName take priority, but no
   * job handling will happen until handleDefault has been
   * called.
   */
  handleDefault(defaultCallback: JobHandler): void;

  /**
   * Add a job handler for jobs with a specific name.
   * Handler will only be effective once handleAll is called
   * to specify what happens to jobs not matching expected
   * names.
   */
  handleName(name: string,
             callback: (job: GristJob) => Promise<any>): void;

  /**
   * Shut everything down that we're responsible for.
   * Set obliterate flag to destroy jobs even if they are
   * stored externally (useful for testing).
   */
  stop(options?: {
    obliterate?: boolean,
  }): Promise<void>;
}

/**
 * The type of a function for handling jobs on a queue.
 */
export type JobHandler = (job: GristJob) => Promise<any>;

/**
 * The name used for a queue if no specific name is given.
 */
export const DEFAULT_QUEUE_NAME = 'default';

/**
 * BullMQ jobs are a string name, and then a data object.
 */
interface GristJob {
  name: string;
  data: any;
}

/**
 * Options when adding a job. BullMQ has many more.
 */
interface JobAddOptions {
  delay?: number;
  jobId?: string;
  repeat?: {
    every: number;
  }
}

/**
 * Implementation for job functionality across the application.
 * Will use BullMQ, with an in-memory fallback if Redis is
 * unavailable.
 */
export class GristBullMQJobs implements GristJobs {
  private _connection?: IORedis;
  private _checkedForConnection: boolean = false;
  private _queues = new Map<string, GristQueueScope>();

  /**
   * Get BullMQ-compatible options for the queue.
   */
  public getQueueOptions() {
    // Following BullMQ, queue options contain the connection
    // to redis, if any.
    if (!this._checkedForConnection) {
      this._connect();
      this._checkedForConnection = true;
    }
    if (!this._connection) {
      return {};
    }
    return {
      connection: this._connection,
      maxRetriesPerRequest: null,
    };
  }

  /**
   * Get an interface scoped to a particular queue by name.
   */
  public queue(queueName: string = DEFAULT_QUEUE_NAME): GristQueueScope {
    if (!this._queues.get(queueName)) {
      this._queues.set(
        queueName,
        new GristBullMQQueueScope(queueName, this),
      );
    }
    return this._queues.get(queueName)!;
  }

  public async stop(options: {
    obliterate?: boolean,
  } = {}) {
    for (const q of this._queues.values()) {
      await q.stop(options);
    }
    this._queues.clear();
    this._connection?.disconnect();
  }

  /**
   * Connect to Redis if available.
   */
  private _connect() {
    // Connect to Redis for use with BullMQ, if REDIS_URL is set.
    const urlTxt = process.env.REDIS_URL || process.env.TEST_REDIS_URL;
    if (!urlTxt) {
      this._connection = undefined;
      log.warn('Using in-memory queues, Redis is unavailable');
      return;
    }
    const url = new URL(urlTxt);
    const conn = new IORedis({
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : undefined,
      db: (url.pathname.charAt(0) === '/') ?
          parseInt(url.pathname.substring(1), 10) : undefined,
      maxRetriesPerRequest: null,
    });
    this._connection = conn;
    log.info('Storing queues externally in Redis');
  }
}

/**
 * Work with a particular named queue.
 */
export class GristBullMQQueueScope implements GristQueueScope {
  private _queue: Queue|GristWorker|undefined;
  private _worker: Worker|GristWorker|undefined;
  private _namedProcessors: Record<string, JobHandler> = {};

  public constructor(public readonly queueName: string,
                     private _owner: GristBullMQJobs) {}

  public handleDefault(defaultCallback: JobHandler) {
    // The default callback passes any recognized named jobs to
    // processors added with handleName(), then, if there is no
    // specific processor, calls the defaultCallback.
    const callback = async (job: GristJob) => {
      const processor = this._namedProcessors[job.name] || defaultCallback;
      return processor(job);
    };
    const options = this._owner.getQueueOptions();
    if (!options.connection) {
      // If Redis isn't available, we go our own way, not
      // using BullMQ.
      const worker = new GristWorker(this.queueName, callback);
      this._worker = worker;
      return worker;
    }
    const worker = new Worker(this.queueName, callback, options);
    this._worker = worker;
    return worker;
  }

  public handleName(name: string,
                    callback: (job: GristJob) => Promise<any>) {
    this._namedProcessors[name] = callback;
  }

  public async stop(options: {
    obliterate?: boolean,
  } = {}) {
    await this._worker?.close();
    if (options.obliterate) {
      await this._queue?.obliterate({force: true});
    }
  }

  public async add(name: string, data: any, options?: JobAddOptions) {
    await this._getQueue().add(name, data, {
      ...options,
      // These settings are quite arbitrary, and should be
      // revised when it matters, or made controllable.
      removeOnComplete: {
        age: 3600, // keep up to 1 hour
        count: 1000, // keep up to 1000 jobs
      },
      removeOnFail: {
        age: 24 * 3600, // keep up to 24 hours
      },
    });
  }

  private _getQueue(): Queue|GristWorker {
    if (this._queue) { return this._queue; }
    const queue = this._pickQueueImplementation();
    this._queue = queue;
    return queue;
  }

  private _pickQueueImplementation() {
    const name = this.queueName;
    const queueOptions = this._owner.getQueueOptions();
    // If we have Redis, get a proper BullMQ interface.
    // Otherwise, make do.
    if (queueOptions.connection) {
      return new Queue(name, queueOptions);
    }
    // If in memory, we hand a job directly to the single worker for their
    // queue. This is very crude.
    const worker = this._worker;
    if (!worker) {
      throw new Error(`no handler yet for ${this.queueName}`);
    }
    // We only access workers directly when working in-memory, to
    // hand jobs directly to them.
    if (isBullMQWorker(worker)) {
      // Not expected! Somehow we have a BullMQ worker.
      throw new Error(`wrong kind of worker for ${this.queueName}`);
    }
    return worker;
  }
}

/**
 * If running in memory without Redis, all jobs need to be
 * created and served by the the same process. This class
 * pretends to be a BullMQ worker, but accepts jobs directly
 * without any intermediate queue. This could be elaborated
 * in future if needed.
 */
class GristWorker {
  private _jobs: Map<string, NodeJS.Timeout> = new Map();

  public constructor(public queueName: string,
                     private _callback: (job: GristJob) => Promise<void>) {
  }

  public async close() {
    for (const job of this._jobs.keys()) {
      // Key deletion is safe with the keys() iterator.
      this._clearJob(job);
    }
  }

  public async add(name: string, data: any, options?: JobAddOptions) {
    if (options?.delay) {
      if (options.repeat) {
        // Unexpected combination.
        throw new Error('cannot delay and repeat');
      }
      const jobId = options.jobId || makeId();
      this._clearJob(jobId);
      this._jobs.set(jobId, setTimeout(() => this._callback({name, data}),
                                       options.delay));
      return;
    }
    if (options?.repeat) {
      const jobId = options.jobId || makeId();
      this._clearJob(jobId);
      this._jobs.set(jobId, setInterval(() => this._callback({name, data}),
                                        options.repeat.every));
      return;
    }
    await this._callback({name, data});
  }

  public async obliterate() {
    await this.close();
  }

  private _clearJob(id: string) {
    const job = this._jobs.get(id);
    if (!job) { return; }
    // We don't know if the job is a once-off or repeating,
    // so we call both clearInterval and clearTimeout, which
    // apparently works.
    clearInterval(job);
    clearTimeout(job);
    this._jobs.delete(id);
  }
}

/**
 * Check if a worker is a real BullMQ worker, or just pretend.
 */
function isBullMQWorker(worker: Worker|GristWorker): worker is Worker {
  return 'isNextJob' in worker;
}
