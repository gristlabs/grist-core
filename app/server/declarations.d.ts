declare module "app/server/lib/ActionLog";
declare module "app/server/lib/sandboxUtil";
declare module "app/server/lib/User";

declare module "app/server/lib/shutdown" {
  export function addCleanupHandler<T>(context: T, method: (this: T) => void, timeout?: number, name?: string): void;
  export function removeCleanupHandlers<T>(context: T): void;
  export function cleanupOnSignals(...signalNames: string[]): void;
  export function exit(optExitCode?: number): Promise<void>;
}

// There is a @types/bluebird, but it's not great, and breaks for some of our usages.
declare module "bluebird";

// Redlock types refer to bluebird.Disposer.
declare module "bluebird" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class Disposer<T> {}
}

// Used in one place, and the typings are almost entirely unhelpful.
declare module "multiparty";

// Used in one place, for one call.
declare module "chokidar";

// Used in one place
declare module "mime-types";

// Used in one place
declare module "morgan";
declare module "cookie";
declare module "cookie-parser";
declare module "on-headers";
declare module "@gristlabs/express-session";

// Used for command line path tweaks.
declare module "app-module-path" {
  export function addPath(path: string): void;
}

// version of pidusage that has correct ctime on linux
declare module '@gristlabs/pidusage' {
  import pidusage from 'pidusage';
  export default pidusage;
}

declare module "csv";

declare module 'winston/lib/winston/common' {
  export function serialize(meta: any): string;
}
