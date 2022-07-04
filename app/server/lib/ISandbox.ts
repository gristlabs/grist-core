import log from 'app/server/lib/log';
import {ISandboxOptions} from 'app/server/lib/NSandbox';

/**
 * Starting to whittle down the options used when creating a sandbox, to leave more
 * freedom in how the sandbox works.
 */
export interface ISandboxCreationOptions {
  comment?: string;      // an argument to add in command line when possible, so it shows in `ps`

  logCalls?: boolean;
  logMeta?: log.ILogMeta;
  logTimes?: boolean;

  // This batch of options is used by SafePythonComponent, so are important for importers.
  entryPoint?: string;   // main script to call - leave undefined for default
  sandboxMount?: string; // if defined, make this path available read-only as "/sandbox"
  importMount?: string;  // if defined, make this path available read-only as "/importdir"

  preferredPythonVersion?: '2' | '3';

  sandboxOptions?: Partial<ISandboxOptions>;
}

export interface ISandbox {
  shutdown(): Promise<unknown>;  // TODO: tighten up this type.
  pyCall(funcName: string, ...varArgs: unknown[]): Promise<any>;
  reportMemoryUsage(): Promise<void>;
}

export interface ISandboxCreator {
  create(options: ISandboxCreationOptions): ISandbox;
}
