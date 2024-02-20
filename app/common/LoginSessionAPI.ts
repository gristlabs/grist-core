import {UserPrefs} from 'app/common/Prefs';

// User profile info for the user. When using Cognito, it is fetched during login.
export interface UserProfile {
  email: string;          // TODO: Used inconsistently: as lowercase login email or display email.
  loginEmail?: string;    // When set, this is consistently normalized (lowercase) login email.
  name: string;
  picture?: string|null; // when present, a url to a public image of unspecified dimensions.
  anonymous?: boolean;   // when present, asserts whether user is anonymous (not authorized).
  connectId?: string|null, // used by GristConnect to identify user in external provider.
  loginMethod?: 'Google'|'Email + Password'|'External';
  locale?: string|null;
}

// User profile including user id and user ref.  All information in it should
// have been validated against database.
export interface FullUser extends UserProfile {
  id: number;
  ref?: string|null; // Not filled for anonymous users.
  allowGoogleLogin?: boolean; // when present, specifies whether logging in via Google is possible.
  isSupport?: boolean; // set if user is a special support user.
  prefs?: UserPrefs;
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
