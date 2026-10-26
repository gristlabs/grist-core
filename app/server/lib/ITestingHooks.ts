import { UserProfile } from "app/common/LoginSessionAPI";

export interface ClientJsonMemoryLimits {
  totalSize?: number;
  jsonResponseReservation?: number;
  maxReservationSize?: number | null;
}

/**
 * One entry logged by the server, as captured by captureLog().
 */
export interface CapturedLogEntry {
  level: string;
  msg: string;
  // The log metadata, which for a telemetry event holds the event itself.
  meta: any;
}

export interface ITestingHooks {
  getPort(): Promise<number>;
  setLoginSessionProfile(gristSidCookie: string, profile: UserProfile | null, org?: string): Promise<void>;
  setServerVersion(version: string | null): Promise<void>;
  disconnectClients(): Promise<void>;
  commShutdown(): Promise<void>;
  commRestart(): Promise<void>;
  commSetClientPersistence(ttlMs: number): Promise<number>;
  commSetClientJsonMemoryLimits(limits: ClientJsonMemoryLimits): Promise<ClientJsonMemoryLimits>;
  closeDocs(): Promise<void>;
  setDocOpenPaused(paused: boolean): Promise<void>;
  getDocOpenCount(): Promise<number>;
  setDocWorkerActivation(workerId: string, active: "active" | "inactive" | "crash"): Promise<void>;
  flushAuthorizerCache(): Promise<void>;
  flushDocs(): Promise<void>;
  getDocClientCounts(): Promise<[string, number][]>;
  setActiveDocTimeout(seconds: number): Promise<number>;
  setDiscourseConnectVar(varName: string, value: string | null): Promise<string | null>;
  setWidgetRepositoryUrl(url: string): Promise<void>;
  getMemoryUsage(): Promise<object>;  // actually NodeJS.MemoryUsage
  tickleUnhandledErrors(errType: string): Promise<void>;
  addEnv(env: { [key: string]: string }): Promise<void>;
  resetEnv(): Promise<void>;
  captureLog(capture: boolean): Promise<CapturedLogEntry[]>;
}
