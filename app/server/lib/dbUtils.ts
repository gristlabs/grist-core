import {synchronizeProducts} from 'app/gen-server/entity/Product';
import {codeRoot} from 'app/server/lib/places';
import {Mutex} from 'async-mutex';
import {DataSource, DataSourceOptions} from 'typeorm';

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
    migrationsInDb = (await dataSource.query('select name from migrations')).map((rec: any) => rec.name);
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
export async function updateDb(dataSource?: DataSource): Promise<void> {
  if (!dataSource) {
    return await withTmpDataSource(updateDb);
  }
  await runMigrations(dataSource);
  await synchronizeProducts(dataSource, true);
}

function getDataSourceName() {
  return process.env.TYPEORM_NAME || 'default';
}

/**
 * Get a datasource for db if one exists, or create one. Serialized to
 * avoid duplication.
 */
const dataSourceMutex = new Mutex();

async function buildDataSource(overrideConf?: Partial<DataSourceOptions>) {
  const settings = getTypeORMSettings(overrideConf);
  const dataSource = new DataSource(settings);
  await dataSource.initialize();
  // When using Sqlite, set a busy timeout of 3s to tolerate a little
  // interference from datasources made by tests. Logging doesn't show
  // any particularly slow queries, but bad luck is possible.
  // This doesn't affect when Postgres is in use. It also doesn't have
  // any impact when there is a single datasource to the db, as is the
  // case when Grist is run as a single process.
  if (dataSource.driver.options.type === 'sqlite') {
    await dataSource.query('PRAGMA busy_timeout = 3000');
  }
  return dataSource;
}

export async function createNewDataSource(overrideConf?: Partial<DataSourceOptions>): Promise<DataSource> {
  return dataSourceMutex.runExclusive(async () => {
    return buildDataSource(overrideConf);
  });
}

export async function withTmpDataSource<T>(
  cb: (dataSource: DataSource) => Promise<T>,
  overrideConf?: Partial<DataSourceOptions>
): Promise<T> {
  let dataSource: DataSource|null = null;
  let res: T;
  try {
    dataSource = await createNewDataSource(overrideConf);
    res = await cb(dataSource);
  } finally {
    await dataSource?.destroy();
  }
  return res;
}

export async function runMigrations(datasource: DataSource) {
  // on SQLite, migrations fail if we don't temporarily disable foreign key
  // constraint checking.  This is because for sqlite typeorm copies each
  // table and rebuilds it from scratch for each schema change.
  // Also, we need to disable foreign key constraint checking outside of any
  // transaction, or it has no effect.
  const sqlite = datasource.driver.options.type === 'sqlite';
  if (sqlite) { await datasource.query("PRAGMA foreign_keys = OFF;"); }
  await datasource.transaction(async tr => {
    await tr.connection.runMigrations();
  });
  if (sqlite) { await datasource.query("PRAGMA foreign_keys = ON;"); }
}

export async function undoLastMigration(dataSource: DataSource) {
  const sqlite = dataSource.driver.options.type === 'sqlite';
  if (sqlite) { await dataSource.query("PRAGMA foreign_keys = OFF;"); }
  await dataSource.transaction(async tr => {
    await tr.connection.undoLastMigration();
  });
  if (sqlite) { await dataSource.query("PRAGMA foreign_keys = ON;"); }
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
        port: parseInt(redisUrl.port || "6379", 10)
      }
    } as const
  } : undefined;

  return {
    "name": getDataSourceName(),
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
    ...overrideConf,
  };
}
