import { Mutex, MutexInterface } from 'async-mutex';

/**
 * A per-key mutex.  It has the same interface as Mutex, but with an extra key supplied.
 * Maintains an independent mutex for each key on need.
 */
export class KeyedMutex {
  private _mutexes = new Map<string, Mutex>();

  public async acquire(key: string): Promise<MutexInterface.Releaser> {
    // Create a new mutex if we need one.
    if (!this._mutexes.has(key)) {
      this._mutexes.set(key, new Mutex());
    }
    const mutex = this._mutexes.get(key)!;
    const unlock = await mutex.acquire();
    return () => {
      unlock();
      // After unlocking, clean-up the mutex if it is no longer needed.
      // unlock() leaves the mutex locked if anyone has been waiting for it.
      if (!mutex.isLocked()) {
        this._mutexes.delete(key);
      }
    };
  }

  public async runExclusive<T>(key: string, callback: MutexInterface.Worker<T>): Promise<T> {
    const unlock = await this.acquire(key);
    try {
      return await callback();
    } finally {
      unlock();
    }
  }

  public isLocked(key: string): boolean {
    const mutex = this._mutexes.get(key);
    if (!mutex) { return false; }
    return mutex.isLocked();
  }

  // Check how many mutexes are in use.
  public get size(): number {
    return this._mutexes.size;
  }
}
