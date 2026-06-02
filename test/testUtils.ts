import { parseUrlId } from "app/common/gristUrls";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { StorageCoordinator } from "app/server/lib/GristServer";

export async function getDatabase(typeormDb?: string): Promise<HomeDBManager> {
  const origTypeormDB = process.env.TYPEORM_DATABASE;
  if (typeormDb) {
    process.env.TYPEORM_DATABASE = typeormDb;
  }

  // Used when a document is deleted, HomeDBManager tries to delete forks from S3 and filesystem.
  // We mock that here and just delete from home DB.
  const storageCoordinator: StorageCoordinator = {
    async hardDeleteDoc(docId: string) {
      const parts = parseUrlId(docId);
      await db.connection.query("delete from docs where id = $1", [parts.forkId || parts.trunkId]);
    },
  };
  const db = new HomeDBManager(storageCoordinator);
  await db.connect();
  await db.initializeSpecialIds();
  if (origTypeormDB) {
    process.env.TYPEORM_DATABASE = origTypeormDB;
  }
  return db;
}
