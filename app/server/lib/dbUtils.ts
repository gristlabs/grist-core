import { synchronizeProducts } from "app/gen-server/entity/Product";
import { codeRoot } from "app/server/lib/places";

import { Mutex } from "async-mutex";
import { DatabaseType, DataSource, DataSourceOptions } from "typeorm";

// Summary of migrations found in database and in code.
interface MigrationSummary {
  migrationsInDb: string[];
  migrationsInCode: string[];
  pendingMigrations: string[];
}

// Find the migrations in the database, the migrations in the codebase, and compare the two.
export async function getMigrations(dataSource: DataSource): Promise<MigrationSummary> {
  let migrationsInDb: string[];
  try {
    migrationsInDb = (await dataSource.query("select name from migrations")).map((rec: any) => rec.name);
  }
  catch (e) {
    // If no migrations have run, there'll be no migrations table - which is fine,
    // it just means 0 migrations run yet.  Sqlite+Postgres report this differently,
    // so any query error that mentions the name of our table is treated as ok.
    // Everything else is unexpected.
    if (!(e.name === "QueryFailedError" && e.message.includes("migrations"))) {
      throw e;
    }
    migrationsInDb = [];
  }
  // get the migration names in codebase.
  // They are a bit hidden, see typeorm/src/migration/MigrationExecutor::getMigrations
  const migrationsInCode: string[] = dataSource.migrations.map(m => (m.constructor as any).name);
  const pendingMigrations = migrationsInCode.filter(m => !migrationsInDb.includes(m));
  return {
    migrationsInDb,
    migrationsInCode,
    pendingMigrations,
  };
}

/**
 * Run any needed migrations, and make sure products are up to date.
 */
export async function updateDb(dataSource?: DataSource) {
  dataSource = dataSource || await getOrCreateConnection();
  await runMigrations(dataSource);
  await synchronizeProducts(dataSource, true);
}

export function getConnectionName() {
  return process.env.TYPEORM_NAME || "default";
}

/**
 * Get a connection to db if one exists, or create one. Serialized to
 * avoid duplication.
 */
let gristDataSource: DataSource | null = null;
const connectionMutex = new Mutex();
export async function getOrCreateConnection(): Promise<DataSource> {
  return connectionMutex.runExclusive(async () => {
    // If multiple servers are started within the same process, we
    // share the database connection.  This saves locking trouble
    // with Sqlite.
    if (!gristDataSource?.isInitialized) {
      let settings = getTypeORMSettings();
      if (settings.type === "postgres") {
        // We're having problems with the Postgres JIT compiler slowing
        // down a particular query, so we'll turn it off for this
        // session.
        //
        // If some day Postgres's JIT compiler gets smarter and has a
        // better cost function that knows it's a bad idea to compile
        // certain queries, we might then want to revisit this
        // workaround and remove it.
        //
        // General JIT documentation in Postgres, including other more
        // fine-tuned possible configuratin options to consider in the
        // future:
        //
        //   https://www.postgresql.org/docs/current/jit.html
        //
        // Note that this passes options valid for the duration of the
        // session (i.e. the connection) into libpq via PGOPTIONS:
        //
        //  https://www.postgresql.org/docs/current/config-setting.html#CONFIG-SETTING-SHELL
        settings = getTypeORMSettings({ extra: { options: "-c jit=off" } });
      }

      gristDataSource = new DataSource(settings);
      await gristDataSource.initialize();
      if (settings.type === "sqlite") {
        // When using Sqlite, set a busy timeout of 3s to tolerate a little
        // interference from connections made by tests. Logging doesn't show
        // any particularly slow queries, but bad luck is possible.
        // This doesn't affect when Postgres is in use. It also doesn't have
        // any impact when there is a single connection to the db, as is the
        // case when Grist is run as a single process.
        await gristDataSource.query("PRAGMA busy_timeout = 3000");
      }
    }
    return gristDataSource;
  });
}

export async function runMigrations(dataSource: DataSource) {
  return await withSqliteForeignKeyConstraintDisabled(dataSource, async () => {
    await dataSource.runMigrations({ transaction: "all" });
  });
}

export async function undoLastMigration(dataSource: DataSource) {
  return await withSqliteForeignKeyConstraintDisabled(dataSource, async () => {
    await dataSource.transaction(async (tr) => {
      await tr.connection.undoLastMigration();
    });
  });
}

// on SQLite, migrations fail if we don't temporarily disable foreign key
// constraint checking.  This is because for sqlite typeorm copies each
// table and rebuilds it from scratch for each schema change.
// Also, we need to disable foreign key constraint checking outside of any
// transaction, or it has no effect.
export async function withSqliteForeignKeyConstraintDisabled<T>(
  dataSource: DataSource, cb: () => Promise<T>,
): Promise<T> {
  const sqlite = getDatabaseType(dataSource) === "sqlite";
  if (sqlite) { await dataSource.query("PRAGMA foreign_keys = OFF;"); }
  try {
    return await cb();
  }
  finally {
    if (sqlite) { await dataSource.query("PRAGMA foreign_keys = ON;"); }
  }
}

export function getDatabaseType(dataSource: DataSource): DatabaseType {
  return dataSource.driver.options.type;
}

// Replace the old janky ormconfig.js file, which was always a source of
// pain to use since it wasn't properly integrated into the typescript
// project.
export function getTypeORMSettings(overrideConf?: Partial<DataSourceOptions>): DataSourceOptions {
  // If we have a redis server available, tell typeorm.  Then any queries built with
  // .cache() called on them will be cached via redis.
  // We use a separate environment variable for the moment so that we don't have to
  // enable this until we really need it.
  const redisUrl = process.env.TYPEORM_REDIS_URL ? new URL(process.env.TYPEORM_REDIS_URL) : undefined;
  const cache = redisUrl ? {
    cache: {
      type: "redis",
      options: {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || "6379", 10),
      },
    } as const,
  } : undefined;

  return {
    name: getConnectionName(),
    type: (process.env.TYPEORM_TYPE as any) || "sqlite",  // officially, TYPEORM_CONNECTION -
    // but if we use that, this file will never
    // be read, and we can't configure
    // caching otherwise.
    database: process.env.TYPEORM_DATABASE || "landing.db",
    username: process.env.TYPEORM_USERNAME || undefined,
    password: process.env.TYPEORM_PASSWORD || undefined,
    host: process.env.TYPEORM_HOST || undefined,
    port: process.env.TYPEORM_PORT ? parseInt(process.env.TYPEORM_PORT, 10) : undefined,
    synchronize: false,
    migrationsRun: false,
    logging: process.env.TYPEORM_LOGGING === "true",
    maxQueryExecutionTime: process.env.TYPEORM_LOG_SLOW_MS ? parseInt(process.env.TYPEORM_LOG_SLOW_MS) : undefined,
    entities: [
      `${codeRoot}/app/gen-server/entity/*.js`,
    ],
    migrations: [
      `${codeRoot}/app/gen-server/migration/*.js`,        // migration files don't actually get packaged.
    ],
    subscribers: [
      `${codeRoot}/app/gen-server/subscriber/*.js`,
    ],
    ...cache,
    ...overrideConf,
    ...JSON.parse(process.env.TYPEORM_EXTRA || "{}"),
  };
}
