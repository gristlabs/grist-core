import {UserProfile} from 'app/common/LoginSessionAPI';
import {Client} from 'app/server/lib/Client';
import {ILoginSession} from 'app/server/lib/ILoginSession';

export class LoginSession implements ILoginSession {
  public clients: Set<Client> = new Set();
  public async getEmail() {
    return 'anon@getgrist.com';
  }
  public async clearSession(): Promise<void> {
    // do nothing
  }
  public async testSetProfile(profile: UserProfile|null): Promise<void> {
    // do nothing
  }
  public async updateTokenForTesting(idToken: string): Promise<void> {
    // do nothing
  }
  public async getCurrentTokenForTesting(): Promise<string|null> {
    return null;
  }
  public async useTestToken(idToken: string): Promise<void> {
    // do nothing
  }
}
