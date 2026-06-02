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

declare module "csv";

declare module "winston/lib/winston/common" {
  export function serialize(meta: any): string;
}

declare module "file-type" {
  export * from "file-type/source/index";
}

/**
 * Type definitions for Grist environment variables.
 *
 * This extends NodeJS.ProcessEnv to provide type safety and autocompletion
 * for environment variables used throughout the Grist codebase.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    // Database
    TYPEORM_TYPE?: string;
    TYPEORM_LOGGING?: "true" | "false";
    TYPEORM_DATABASE?: string;
    TYPEORM_HOST?: string;
    TYPEORM_PORT?: string;
    TYPEORM_USERNAME?: string;
    TYPEORM_PASSWORD?: string;
    TYPEORM_EXTRA?: string;
    TYPEORM_EXTRA_DRAFT?: string;
    REDIS_URL?: string;
    TEST_REDIS_URL?: string;

    // Notifications
    GRIST_NOTIFIER?: "sendgrid" | "smtp" | "test";
    SENDGRID_API_KEY?: string;
    GRIST_NODEMAILER_SENDER?: string;
    GRIST_NODEMAILER_CONFIG?: string;
    GRIST_SMTP_TEMPLATES_DIR?: string;

    // Testing and development
    GRIST_TEST_SERVER_DEPLOYMENT_TYPE?: "core" | "enterprise" | "saas" | "static" | "electron";

    // When set, run as a restart shell that holds the listening
    // socket and spawns a child Grist server, enabling restart
    // without dropping /status.
    GRIST_RESTART_SHELL?: string;
  }
}
