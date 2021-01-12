/**
 * An exceptional grant of rights on a resource, for when work needs to be
 * initiated by Grist systems rather than a user.  Cases where this may happen:
 *
 *   - Deletion of documents and workspaces in the trash
 *
 * Permits are stored in redis (or, in a single-process dev environment, in memory)
 * as json, in keys that expire within minutes.  The keys should be effectively
 * unguessable.
 *
 * To use a permit:
 *
 *   - Prepare a Permit object that includes the id of the document or
 *     workspace to be operated on.
 *
 *   - It the operation you care about involves the database, check
 *     that "allowSpecialPermit" is enabled for it in HomeDBManager
 *     (currently only deletion of docs/workspaces has this enabled).
 *
 *   - Save the permit in the permit store, with setPermit, noting its
 *     generated key.
 *
 *   - Call the API with a "Permit: <permit-key>" header.
 *
 *   - Optionally, remove the permit with removePermit().
 */
export interface Permit {
  docId?: string;
  workspaceId?: number;
  org?: string|number;
  otherDocId?: string;  // For operations involving two documents.
}

/* A store of permits */
export interface IPermitStore {

  // Store a permit, and return the key it is stored in.
  // Permits are transient, and will expire.
  setPermit(permit: Permit): Promise<string>;

  // Get any permit associated with the given key, or null if none.
  getPermit(permitKey: string): Promise<Permit|null>;

  // Remove any permit associated with the given key.
  removePermit(permitKey: string): Promise<void>;

  // Close down the permit store.
  close(): Promise<void>;
}

// Create a well formatted permit key from a seed string.
export function formatPermitKey(seed: string) {
  return `permit-${seed}`;
}

// Check that permit key is well formatted.
export function checkPermitKey(key: string): boolean {
  return key.startsWith('permit-');
}
