import {UserProfile} from 'app/common/LoginSessionAPI';

export interface ITestingHooks {
  getOwnPort(): number;
  getPort(): number;
  updateAuthToken(instId: string, authToken: string): Promise<void>;
  getAuthToken(instId: string): Promise<string|null>;
  useTestToken(instId: string, token: string): Promise<void>;
  setLoginSessionProfile(gristSidCookie: string, profile: UserProfile|null, org?: string): Promise<void>;
  setServerVersion(version: string|null): Promise<void>;
  disconnectClients(): Promise<void>;
  commShutdown(): Promise<void>;
  commRestart(): Promise<void>;
  commSetClientPersistence(ttlMs: number): Promise<void>;
  closeDocs(): Promise<void>;
  setDocWorkerActivation(workerId: string, active: 'active'|'inactive'|'crash'): Promise<void>;
  flushAuthorizerCache(): Promise<void>;
  getDocClientCounts(): Promise<Array<[string, number]>>;
  setActiveDocTimeout(seconds: number): Promise<number>;
}
