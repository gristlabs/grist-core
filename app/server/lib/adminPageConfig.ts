import { AdminPageConfig } from "app/common/gristUrls";
import { isAffirmative } from "app/common/gutil";
import { isExtFullEditionSupported } from "app/server/lib/bootstrapFullEdition";
import { GristServer } from "app/server/lib/GristServer";
import { getInService } from "app/server/lib/gristSettings";
import { isUnderRestartShell } from "app/server/lib/RestartShellWorker";

import * as express from "express";

export function canRestart() {
  return isAffirmative(process.env.GRIST_RUNNING_UNDER_SUPERVISOR) ||
    isAffirmative(process.env.GRIST_UNDER_RESTART_SHELL);
}

/**
 * Whether the request comes from an install admin, for deciding what a response may contain.
 * Answers false rather than throwing: the enterprise implementation reads org membership from
 * the home DB (see InstallAdminUsingOrg), so a DB hiccup would otherwise fail every page this
 * guards, including /admin and /boot, which exist to report such problems. An undecidable case
 * withholds admin-only data instead.
 */
export async function isInstallAdminReq(req: express.Request, gristServer: GristServer): Promise<boolean> {
  try {
    return await gristServer.getInstallAdmin().isAdminReq(req);
  } catch (e) {
    return false;
  }
}

/**
 * Per-request config sent by admin-group endpoints (e.g. /admin, /boot).
 * `runningUnderSupervisor` doubles as the discriminator used by
 * `getAdminConfig()` on the client.
 */
export async function makeAdminPageConfig(
  req: express.Request, gristServer: GristServer,
): Promise<Partial<AdminPageConfig>> {
  return {
    runningUnderSupervisor: canRestart(),
    adminControls: gristServer.create.areAdminControlsAvailable(),
    inService: getInService().value,
    supportsExtFullEdition: isExtFullEditionSupported() && isUnderRestartShell(),
    // The installation ID identifies this install to Grist Labs, so keep it off pages
    // served to non-admins.
    installationId: await isInstallAdminReq(req, gristServer) ?
      gristServer.getInstallationId() : undefined,
  };
}
