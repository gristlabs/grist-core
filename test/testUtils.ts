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
  // If this is Sqlite, we are making a separate connection to the database,
  // so could get busy errors. We bump up our timeout. The rest of Grist could
  // get busy errors if we do slow writes though.
  const connection = db.connection;
  const sqlite = connection.driver.options.type === 'sqlite';
  if (sqlite) {
    await db.connection.query('PRAGMA busy_timeout = 3000');
  }
  return db;
}
