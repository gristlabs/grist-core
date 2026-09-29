/**
 * Describes the servers in an installation, for the `multi-server` boot probe and the admin api.
 */

import {
  BootProbeResult,
  diagnoseMultiServer,
  judgeSituation,
  MultiServerDescription,
  MultiServerEntry,
} from "app/common/BootProbe";
import { isAffirmative } from "app/common/gutil";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { findSharedAddresses } from "app/server/lib/DocWorkerIdentity";
import { GristServer } from "app/server/lib/GristServer";

import * as express from "express";

interface ReportOptions {
  // Whether the activation key includes Grist Fleet. Individual servers are listed only if so.
  fleetIncluded: boolean;
}

/**
 * Whether the activation key includes Grist Fleet, whether or not GRIST_FLEET turns it on.
 */
export function isFleetIncluded(req: express.Request): boolean {
  return Boolean((req as RequestWithLogin).activation?.features?.installationFleet);
}

/**
 * Describes the multi-server topology, and the servers registered in Redis to hold documents,
 * including their status, load, and ids.
 *
 * Without `fleetIncluded`, only the topology and the number of servers are reported, since
 * listing servers is a Grist Fleet feature. The number is reported either way, because settings
 * are held per server and an admin changing one should know there are others.
 */
export async function describeServers(
  server: GristServer, options: ReportOptions,
): Promise<MultiServerDescription> {
  const docWorkerMap = server.getDocWorkerMap();
  const ownWorkerId = server.getWorkerId();
  const fleet = {
    included: options.fleetIncluded,
    active: Boolean(server.getSocketProxy()?.isActive()),
  };

  // Without Redis there is nowhere for servers to find each other, so there is only ever this
  // one, whatever else is configured.
  if (!docWorkerMap?.getRedisClient()) {
    return { kind: "single-server", registeredServerCount: 1, selfRegistered: true, fleet };
  }

  const kind = isAffirmative(process.env.GRIST_FLEET) ? "fleet" : "worker-pool";
  // A server has a worker id only if it registered as a doc worker.
  const selfRegistered = Boolean(ownWorkerId);

  if (!options.fleetIncluded) {
    return {
      kind,
      registeredServerCount: await docWorkerMap.getRegisteredWorkerCount(),
      selfRegistered,
      fleet,
    };
  }

  const registrations = await docWorkerMap.getRegisteredWorkers();

  const sharing = new Map<string, string[]>();
  for (const group of findSharedAddresses(registrations.map(reg => reg.info))) {
    for (const worker of group) {
      sharing.set(worker.id, group.filter(other => other.id !== worker.id).map(other => other.id));
    }
  }

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
    workerIdsSharingAddress: sharing.get(reg.info.id),
  }));

  return { kind, registeredServerCount: servers.length, selfRegistered, servers, fleet };
}

/**
 * The servers in this installation, with a verdict on their health.
 */
export async function reportServers(
  server: GristServer, options: ReportOptions,
): Promise<BootProbeResult> {
  const described = await describeServers(server, options);
  const situation = diagnoseMultiServer(described);
  return { ...judgeSituation(situation, described), details: { ...described, situation } };
}
