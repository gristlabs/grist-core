import {synchronizeProducts} from 'app/gen-server/entity/Product';
import {codeRoot} from 'app/server/lib/places';
import {Mutex} from 'async-mutex';
import {Connection, createConnection, DataSourceOptions, getConnection} from 'typeorm';

// Summary of migrations found in database and in code.
interface MigrationSummary {
  migrationsInDb: string[];
  migrationsInCode: string[];
  pendingMigrations: string[];
}

// Find the migrations in the database, the migrations in the codebase, and compare the two.
export async function getMigrations(connection: Connection): Promise<MigrationSummary> {
  let migrationsInDb: string[];
  try {
    migrationsInDb = (await connection.query('select name from migrations')).map((rec: any) => rec.name);
  } catch (e) {
    // If no migrations have run, there'll be no migrations table - which is fine,
    // it just means 0 migrations run yet.  Sqlite+Postgres report this differently,
    // so any query error that mentions the name of our table is treated as ok.
    // Everything else is unexpected.
    if (!(e.name === 'QueryFailedError' && e.message.includes('migrations'))) {
      throw e;
    }
    migrationsInDb = [];
  }
  // get the migration names in codebase.
  // They are a bit hidden, see typeorm/src/migration/MigrationExecutor::getMigrations
  const migrationsInCode: string[] = connection.migrations.map(m => (m.constructor as any).name);
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
export async function updateDb(connection?: Connection) {
  connection = connection || await getOrCreateConnection();
  await runMigrations(connection);
  await synchronizeProducts(connection, true);
}

/**
 * Get a connection to db if one exists, or create one. Serialized to
 * avoid duplication.
 */
const connectionMutex = new Mutex();
export async function getOrCreateConnection(): Promise<Connection> {
  return connectionMutex.runExclusive(async() => {
    try {
      // If multiple servers are started within the same process, we
      // share the database connection.  This saves locking trouble
      // with Sqlite.
      const connection = getConnection();
      return connection;
    } catch (e) {
      if (!String(e).match(/ConnectionNotFoundError/)) {
        throw e;
      }
      const connection = await createConnection(getTypeORMSettings());
      // When using Sqlite, set a busy timeout of 3s to tolerate a little
      // interference from connections made by tests. Logging doesn't show
      // any particularly slow queries, but bad luck is possible.
      // This doesn't affect when Postgres is in use. It also doesn't have
      // any impact when there is a single connection to the db, as is the
      // case when Grist is run as a single process.
      if (connection.driver.options.type === 'sqlite') {
        await connection.query('PRAGMA busy_timeout = 3000');
      }
      return connection;
    }
  });
}

export async function runMigrations(connection: Connection) {
  // on SQLite, migrations fail if we don't temporarily disable foreign key
  // constraint checking.  This is because for sqlite typeorm copies each
  // table and rebuilds it from scratch for each schema change.
  // Also, we need to disable foreign key constraint checking outside of any
  // transaction, or it has no effect.
  const sqlite = connection.driver.options.type === 'sqlite';
  if (sqlite) { await connection.query("PRAGMA foreign_keys = OFF;"); }
  await connection.transaction(async tr => {
    await tr.connection.runMigrations();
  });
  if (sqlite) { await connection.query("PRAGMA foreign_keys = ON;"); }
}

export async function undoLastMigration(connection: Connection) {
  const sqlite = connection.driver.options.type === 'sqlite';
  if (sqlite) { await connection.query("PRAGMA foreign_keys = OFF;"); }
  await connection.transaction(async tr => {
    await tr.connection.undoLastMigration();
  });
  if (sqlite) { await connection.query("PRAGMA foreign_keys = ON;"); }
}

// Replace the old janky ormconfig.js file, which was always a source of
// pain to use since it wasn't properly integrated into the typescript
// project.
export function getTypeORMSettings(): DataSourceOptions {
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
        port: parseInt(redisUrl.port || "6379", 10)
      }
    } as const
  } : undefined;

  return {
    "name": process.env.TYPEORM_NAME || "default",
    "type": (process.env.TYPEORM_TYPE as any) || "sqlite",  // officially, TYPEORM_CONNECTION -
                                                   // but if we use that, this file will never
                                                   // be read, and we can't configure
                                                   // caching otherwise.
    "database": process.env.TYPEORM_DATABASE || "landing.db",
    "username": process.env.TYPEORM_USERNAME || undefined,
    "password": process.env.TYPEORM_PASSWORD || undefined,
    "host": process.env.TYPEORM_HOST || undefined,
    "port": process.env.TYPEORM_PORT ? parseInt(process.env.TYPEORM_PORT, 10) : undefined,
    "synchronize": false,
    "migrationsRun": false,
    "logging": process.env.TYPEORM_LOGGING === "true",
    "entities": [
      `${codeRoot}/app/gen-server/entity/*.js`
    ],
    "migrations": [
      `${codeRoot}/app/gen-server/migration/*.js`        // migration files don't actually get packaged.
    ],
    "subscribers": [
      `${codeRoot}/app/gen-server/subscriber/*.js`
    ],
    ...JSON.parse(process.env.TYPEORM_EXTRA || "{}"),
    ...cache,
  };
}
