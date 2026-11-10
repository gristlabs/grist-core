import { Mutex } from "async-mutex";
import { DataSource, EntityManager } from "typeorm";

const mutexes = new WeakMap<DataSource, Mutex>();

/**
 * Orders admission, authorization changes and final mirror writes across workers.
 * The mutex also prevents nested/concurrent transactions on SQLite's shared connection.
 * Fetching snapshots and running Python must happen before entering this short critical section.
 */
export function withReferenceRegistry<T>(db: DataSource, callback: (manager: EntityManager) => Promise<T>): Promise<T> {
  let mutex = mutexes.get(db);
  if (!mutex) { mutex = new Mutex(); mutexes.set(db, mutex); }
  return mutex.runExclusive(() => db.transaction(async (manager) => {
    await manager.query("UPDATE reference_registry_lock SET id = id WHERE id = 1");
    return callback(manager);
  }));
}
