import { Features } from "app/common/Features";
import * as gu from "test/nbrowser/gristUtils";
import { server } from "test/nbrowser/testUtils";

// Turns on `importFromGrist` on the session's site. Answers a function that undoes it.
export async function enableTableSyncFeature(session: gu.Session): Promise<() => Promise<void>> {
  const db = await server.getDatabase();
  const userId = await session.getUserId();
  const org = await db.getOrg({ userId }, session.orgDomain ?? null);
  const orgId = org.data!.id;
  let previous: Features | null = null;
  await db.updateBillingAccount(db.getPreviewerUserId(), orgId, (account) => {
    previous = account.features;
    account.features = { ...account.features, importFromGrist: true };
  });
  return async () => {
    // The suite's own `after` may have closed the database by now, so open it again.
    const restoreDb = await server.getDatabase();
    try {
      await restoreDb.updateBillingAccount(restoreDb.getPreviewerUserId(), orgId, (account) => {
        account.features = previous;
      });
    } finally {
      await server.closeDatabase();
    }
  };
}
