import {UserProfile} from 'app/common/LoginSessionAPI';

export interface ClientJsonMemoryLimits {
  totalSize?: number;
  jsonResponseReservation?: number;
  maxReservationSize?: number|null;
}

export interface ITestingHooks {
  getOwnPort(): Promise<number>;
  getPort(): Promise<number>;
  setLoginSessionProfile(gristSidCookie: string, profile: UserProfile|null, org?: string): Promise<void>;
  setServerVersion(version: string|null): Promise<void>;
  disconnectClients(): Promise<void>;
  commShutdown(): Promise<void>;
  commRestart(): Promise<void>;
  commSetClientPersistence(ttlMs: number): Promise<number>;
  commSetClientJsonMemoryLimits(limits: ClientJsonMemoryLimits): Promise<ClientJsonMemoryLimits>;
  closeDocs(): Promise<void>;
  setDocWorkerActivation(workerId: string, active: 'active'|'inactive'|'crash'): Promise<void>;
  flushAuthorizerCache(): Promise<void>;
  flushDocs(): Promise<void>;
  getDocClientCounts(): Promise<Array<[string, number]>>;
  setActiveDocTimeout(seconds: number): Promise<number>;
  setDiscourseConnectVar(varName: string, value: string|null): Promise<string|null>;
  setWidgetRepositoryUrl(url: string): Promise<void>;
  getMemoryUsage(): Promise<object>;  // actually NodeJS.MemoryUsage
  tickleUnhandledErrors(errType: string): Promise<void>;
}
