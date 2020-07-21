import { ILoginSession } from 'app/server/lib/ILoginSession';

export interface IInstanceManager {
  getLoginSession(instanceId: string): ILoginSession;
}
