import { parseUrlId } from "app/common/gristUrls";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { createConnection, getOrCreateConnection, getTypeORMSettings } from "app/server/lib/dbUtils";
import { StorageCoordinator } from "app/server/lib/GristServer";

import { DataSource } from "typeorm";

export async function getDatabase(typeormDb?: string): Promise<HomeDBManager> {
  const database = typeormDb || process.env.TYPEORM_DATABASE;
  const connection = await getConnectionFor(database);

  // Used when a document is deleted, HomeDBManager tries to delete forks from S3 and filesystem.
  // We mock that here and just delete from home DB.
  const storageCoordinator: StorageCoordinator = {
    async hardDeleteDoc(docId: string) {
      const parts = parseUrlId(docId);
      await db.connection.query("delete from docs where id = $1", [parts.forkId || parts.trunkId]);
    },
  };
  const db = new HomeDBManager(storageCoordinator);
  db.connectTo(connection);
  await db.initializeSpecialIds();
  return db;
}

// Dedicated connections for callers whose database isn't the shared one,
// keyed by database so we open each only once.
const extraConnections = new Map<string, DataSource>();

async function getConnectionFor(database: string | undefined): Promise<DataSource> {
  const shared = await getSharedConnection(database);
  if (!database || shared.options.database === database) {
    return shared;
  }
  // The shared connection is bound to a different database (an earlier suite
  // connected first), so open a dedicated one for the caller's database.
  let connection = extraConnections.get(database);
  if (!connection?.isInitialized) {
    connection = await createConnection(getTypeORMSettings({ name: `test-${database}`, database }));
    extraConnections.set(database, connection);
  }
  return connection;
}

// getOrCreateConnection() caches one process-global connection (shared with any
// in-process server), binding it to TYPEORM_DATABASE the first time it connects.
// Make sure it sees `database` for that initial bind, so we don't accidentally
// point the shared connection at the wrong database.
async function getSharedConnection(database: string | undefined): Promise<DataSource> {
  if (!database) { return getOrCreateConnection(); }
  const orig = process.env.TYPEORM_DATABASE;
  process.env.TYPEORM_DATABASE = database;
  try {
    return await getOrCreateConnection();
  } finally {
    if (orig === undefined) {
      delete process.env.TYPEORM_DATABASE;
    } else {
      process.env.TYPEORM_DATABASE = orig;
    }
  }
}
