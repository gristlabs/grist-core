// User profile info for the user. When using Cognito, it is fetched during login.
export interface UserProfile {
  email: string;
  name: string;
  picture?: string|null; // when present, a url to a public image of unspecified dimensions.
  anonymous?: boolean;   // when present, asserts whether user is anonymous (not authorized).
  loginMethod?: 'Google'|'Email + Password';
}

// User profile including user id.  All information in it should
// have been validated against database.
export interface FullUser extends UserProfile {
  id: number;
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
