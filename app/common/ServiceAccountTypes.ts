/**
 * Base interface for ServiceAccounts whose all attributes are optional.
 * A Service Account is non-login user managed by a login user.
 * Their purpose is be able to interact with via api on the small chosen scope
 * given to the service account.
 */
interface ServiceAccountAllOptional {
  label: string|undefined;
  description: string|undefined;
  expiresAt: string|undefined; // ISO date string
}

export interface ServiceAccountApiResponse {
  id: number;
  login: string;
  label: string;
  description: string;
  expiresAt: string;
  hasValidKey: boolean;
}

export interface ServiceAccountCreationResponse extends ServiceAccountApiResponse {
  id: number;
  key: string;
  login: string;
}

export type PatchServiceAccount = ServiceAccountAllOptional;

export interface PostServiceAccount extends ServiceAccountAllOptional {
  // expiresAt required for creation
  expiresAt: string;
}
