import { getSetMapValue } from 'app/common/gutil';
import { makeId } from 'app/server/lib/idUtils';
import log from 'app/server/lib/log';
import { Job as BullMQJob, JobsOptions, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

// Name of the queue for doc-notification emails. Let's define queue names in this file, to ensure
// that different users of GristJobs don't accidentally use conflicting queue names.
export const docEmailsQueue = 'deq';

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
  stop(options?: StopOptions): Promise<void>;
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
  handleName(name: string, callback: JobHandler): void;

  /**
   * Shut everything down that we're responsible for.
   * Set obliterate flag to destroy jobs even if they are
   * stored externally (useful for testing).
   */
  stop(options?: StopOptions): Promise<void>;
}

/**
 * The type of a function for handling jobs on a queue.
 */
export type JobHandler<Job extends GristJob = GristJob> = (job: Job) => Promise<any>;

/**
 * The name used for a queue if no specific name is given.
 */
export const DEFAULT_QUEUE_NAME = 'default';

/**
 * BullMQ jobs are a string name, and then a data object.
 */
export interface GristJob {
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

interface StopOptions {
  obliterate?: boolean;
}

export function createGristJobs(): GristJobs {
  const connection = getRedisConnection();
  return connection ? new GristBullMQJobs(connection) : new GristInMemoryJobs();
}

abstract class GristJobsBase<QS extends GristQueueScope> {
  private _queues = new Map<string, QS>();
  public queue(queueName: string = DEFAULT_QUEUE_NAME): QS {
    return getSetMapValue(this._queues, queueName, () => this.createQueueScope(queueName));
  }
  public async stop(options: StopOptions = {}) {
    await Promise.all(Array.from(this._queues.values(), q => q.stop(options)));
    this._queues.clear();
  }
  protected abstract createQueueScope(queueName: string): QS;
}

class GristInMemoryJobs extends GristJobsBase<GristInMemoryQueueScope> implements GristJobs {
  protected createQueueScope(queueName: string) { return new GristInMemoryQueueScope(queueName); }
}

/**
 * Implementation for job functionality across the application.
 * Will use BullMQ, with an in-memory fallback if Redis is
 * unavailable.
 */
export class GristBullMQJobs extends GristJobsBase<GristBullMQQueueScope> implements GristJobs {
  constructor(private _connection: IORedis) {
    super();
  }

  /**
   * Get BullMQ-compatible options for the queue.
   */
  public getQueueOptions() {
    return {
      connection: this._connection,
      maxRetriesPerRequest: null,
    };
  }

  public async stop(options: { obliterate?: boolean, } = {}) {
    await super.stop();
    this._connection.disconnect();
  }

  protected createQueueScope(queueName: string) { return new GristBullMQQueueScope(queueName, this); }
}

/**
 * Connect to Redis if available.
 */
function getRedisConnection(): IORedis|undefined {
  // Connect to Redis for use with BullMQ, if REDIS_URL is set.
  const urlTxt = process.env.REDIS_URL || process.env.TEST_REDIS_URL;
  if (!urlTxt) {
    log.warn('Using in-memory queues, Redis is unavailable');
    return;
  }
  const conn = new IORedis(urlTxt, {
    maxRetriesPerRequest: null,
    // Back off faster and retry more slowly than the default, to avoid filling up logs needlessly.
    retryStrategy: (times) => Math.min((times ** 2) * 50, 10000),
  });
  conn.on('error', (err) => log.error('GristJobs: Redis connection error:', String(err)));
  log.info('Storing queues externally in Redis');
  return conn;
}

interface IWorker {
  close(): Promise<void>;
}

abstract class GristQueueScopeBase<Worker extends IWorker, Job extends GristJob = GristJob> {
  protected _worker: Worker|undefined;
  private _namedProcessors: Record<string, JobHandler<Job>> = {};

  public constructor(public readonly queueName: string) {}

  public getWorker(): Worker|undefined { return this._worker; }

  public handleDefault(defaultCallback: JobHandler<Job>): void {
    // The default callback passes any recognized named jobs to
    // processors added with handleName(), then, if there is no
    // specific processor, calls the defaultCallback.
    const callback = async (job: Job) => {
      const processor = this._namedProcessors[job.name] || defaultCallback;
      return processor(job);
    };
    this._worker = this.createWorker(this.queueName, callback);
  }

  public handleName(name: string, callback: (data: Job) => Promise<any>) {
    this._namedProcessors[name] = callback;
  }

  public async stop(options: StopOptions = {}) {
    await this._worker?.close();
    if (options.obliterate) {
      await this.obliterate();
    }
  }

  protected abstract obliterate(): Promise<void>;
  protected abstract createWorker(queueName: string, callback: JobHandler<Job>): Worker;
}

class GristInMemoryQueueScope extends GristQueueScopeBase<GristWorker> implements GristQueueScope {
  public async add(name: string, data: any, options?: JobAddOptions) {
    // If in memory, we hand a job directly to the single worker for their
    // queue. This is very crude.
    if (!this._worker) {
      throw new Error(`no handler yet for ${this.queueName}`);
    }
    await this._worker.add(name, data, options);
  }
  protected override async obliterate(): Promise<void> {
    await this._worker?.obliterate();
  }
  protected override createWorker(queueName: string, callback: JobHandler): GristWorker {
    return new GristWorker(this.queueName, callback);
  }
}

/**
 * Work with a particular named queue.
 */
export class GristBullMQQueueScope extends GristQueueScopeBase<Worker, BullMQJob> implements GristQueueScope {
  private _queue: Queue|undefined;

  public constructor(queueName: string, private _owner: GristBullMQJobs) { super(queueName); }

  public getQueue(): Queue|undefined { return this._queue; }

  public async add(name: string, data: any, options?: JobsOptions) {
    await this._getQueue().add(name, data, {
      // These settings are quite arbitrary, and should be
      // revised when it matters, or made controllable.
      removeOnComplete: {
        age: 3600, // keep up to 1 hour
        count: 1000, // keep up to 1000 jobs
      },
      removeOnFail: {
        age: 24 * 3600, // keep up to 24 hours
      },
      ...options,
    });
  }

  public getJobRedisKey(jobId: string): string {
    // This isn't a well-documented method, so this was confirmed empirically.
    return this._getQueue().toKey(jobId);
  }

  protected override async obliterate() {
    await this._getQueue().obliterate({force: true});
  }

  protected createWorker(queueName: string, callback: JobHandler<BullMQJob>): Worker {
    const options = this._owner.getQueueOptions();
    return new Worker(this.queueName, callback, options);
  }

  private _getQueue(): Queue {
    return this._queue || (this._queue = new Queue(this.queueName, this._owner.getQueueOptions()));
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
