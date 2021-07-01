import {UserProfile} from 'app/common/LoginSessionAPI';
import {Client} from 'app/server/lib/Client';
import {ILoginSession} from 'app/server/lib/ILoginSession';

export class LoginSession implements ILoginSession {
  public clients: Set<Client> = new Set();
  public async getEmail() {
    return process.env.GRIST_DEFAULT_EMAIL || 'anon@getgrist.com';
  }
  public async getSessionProfile() {
    return {
      name: await this.getEmail(),
      email: await this.getEmail(),
    };
  }
  public async clearSession(): Promise<void> {
    // do nothing
  }
  public async testSetProfile(profile: UserProfile|null): Promise<void> {
    // do nothing
  }
}
