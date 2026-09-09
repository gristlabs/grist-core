import { MultiServerDescription, MultiServerEntry } from "app/common/BootProbe";
import { isAffirmative } from "app/common/gutil";
import { GristServer } from "app/server/lib/GristServer";

/** The doc workers an installation runs, read from the worker map. */
export async function describeServers(server: GristServer): Promise<MultiServerDescription> {
  const docWorkerMap = server.getDocWorkerMap();
  const ownWorkerId = server.getWorkerId();

  // Without Redis there is nowhere for servers to find each other, so there is only ever this
  // one, whatever else is configured.
  if (!docWorkerMap?.getRedisClient()) {
    return { kind: "single-server", servers: [] };
  }

  const kind = isAffirmative(process.env.GRIST_FLEET) ? "fleet" : "worker-pool";

  const registrations = await docWorkerMap.getRegisteredWorkers();

  const servers: MultiServerEntry[] = registrations.map(reg => ({
    id: reg.info.id,
    internalUrl: reg.info.internalUrl,
    group: reg.info.group,
    available: reg.available,
    // Assignments is the worker map's word, matching the keys it reads. An administrator
    // reading this is looking at documents.
    documentCount: reg.assignmentCount,
    load: reg.load,
    self: reg.info.id === ownWorkerId,
    alive: reg.alive,
  }));

  return { kind, servers };
}
