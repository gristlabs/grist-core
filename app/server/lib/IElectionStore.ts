/**
 * Get a revokable named exclusive lock with a TTL.  This is convenient for housekeeping
 * tasks, which can be done by any server, but should preferably be only done by one
 * at a time.
 */
export interface IElectionStore {
  /**
   * Try to get a lock called <name> for a specified duration.  If the named lock
   * has already been taken, null is returned, otherwise a secret is returned.
   * The secret can be used to remove the lock before the duration has expired.
   */
  getElection(name: string, durationInMs: number): Promise<string|null>;

  /**
   * Remove a named lock, presenting the secret returned by getElection() as
   * a cross-check.
   */
  removeElection(name: string, electionKey: string): Promise<void>;

  /**
   * Close down access to the store.
   */
  close(): Promise<void>;
}
