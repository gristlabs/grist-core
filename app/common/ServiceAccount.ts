/**
 * Base interface for ServiceAccounts whose all attributes are optional.
 * A Service Account is non-login user managed by a login user.
 * Their purpose is be able to interact with via api on the small choosen scope
 * given to the service account.
 */
interface ServiceAccountAllOptional {
  label: string|undefined;
  description: string|undefined;
  expiresAt: string|undefined; // ISO date string
}

export type PatchServiceAccount = ServiceAccountAllOptional;

export interface PostServiceAccount extends ServiceAccountAllOptional {
  // expiresAt required for creation
  expiresAt: string;
}
