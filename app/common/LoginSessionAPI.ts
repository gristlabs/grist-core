import {normalizeEmail} from 'app/common/emails';
import {UserPrefs} from 'app/common/Prefs';

// User profile info for the user. When using Cognito, it is fetched during login.
export interface UserProfile {
  email: string;          // TODO: Used inconsistently: as lowercase login email or display email.
  name: string;
  disabledAt?: Date|null;
  loginEmail?: string;    // When set, this is consistently normalized (lowercase) login email.
  picture?: string|null; // when present, a url to a public image of unspecified dimensions.
  anonymous?: boolean;   // when present, asserts whether user is anonymous (not authorized).
  connectId?: string|null, // used by GristConnect to identify user in external provider.
  loginMethod?: 'Google'|'Email + Password'|'External';
  locale?: string|null;
  type?: string; // user type, e.g. 'login' or 'service'
  extra?: Record<string, any>; // extra fields from the user profile, e.g. from OIDC.
}

// For describing install admin users and why they are install admins
export interface InstallAdminInfo {
  user: UserProfile|null;
  reason: string
}

/**
 * Tries to compare two user profiles to see if they represent the same user.
 * Note: if you have access to FullUser objects, comparing ids is more reliable.
 */
export function sameUser(a: UserProfile|FullUser, b: UserProfile|FullUser): boolean {
  if ('id' in a && 'id' in b) {
    return a.id === b.id;
  }
  if (a.loginEmail && b.loginEmail) {
    return a.loginEmail === b.loginEmail;
  } else {
    return normalizeEmail(a.email) === normalizeEmail(b.email);
  }
}

// User profile including user id and user ref.  All information in it should
// have been validated against database.
export interface FullUser extends UserProfile {
  id: number;
  ref?: string|null; // Not filled for anonymous users.
  allowGoogleLogin?: boolean; // when present, specifies whether logging in via Google is possible.
  isSupport?: boolean; // set if user is a special support user.
  firstLoginAt?: Date | null;
  prefs?: UserPrefs;
  createdAt?: Date; // Not filled for anonymous users.
}

export interface LoginSessionAPI {
  /**
   * Logs out by clearing all data in the session store besides the session cookie itself.
   * Broadcasts the logged out state to all clients.
   */
  logout(): Promise<void>;

  /**
   * Replaces the user profile object in the session and broadcasts the new profile to all clients.
   */
  updateProfile(profile: UserProfile): Promise<void>;
}
