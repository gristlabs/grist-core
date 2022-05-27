import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';

export async function getDatabase(typeormDb?: string): Promise<HomeDBManager> {
  const origTypeormDB = process.env.TYPEORM_DATABASE;
  if (typeormDb) {
    process.env.TYPEORM_DATABASE = typeormDb;
  }
  const db = new HomeDBManager();
  await db.connect();
  await db.initializeSpecialIds();
  if (origTypeormDB) {
    process.env.TYPEORM_DATABASE = origTypeormDB;
  }
  return db;
}
