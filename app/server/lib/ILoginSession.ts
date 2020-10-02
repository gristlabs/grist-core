import {UserProfile} from 'app/common/LoginSessionAPI';
import {Client} from 'app/server/lib/Client';

export interface ILoginSession {
  clients: Set<Client>;
  getEmail(): Promise<string>;
  getSessionProfile(): Promise<UserProfile|null>;
  // Log out
  clearSession(): Promise<void>;

  // For testing only.  If no email address, profile is wiped, otherwise it is set.
  testSetProfile(profile: UserProfile|null): Promise<void>;
  updateTokenForTesting(idToken: string): Promise<void>;
  getCurrentTokenForTesting(): Promise<string|null>;
  useTestToken(idToken: string): Promise<void>;
}
