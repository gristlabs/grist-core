import { AdminPageConfig } from "app/common/gristUrls";
import { isAffirmative } from "app/common/gutil";
import { GristServer } from "app/server/lib/GristServer";
import { getInService } from "app/server/lib/gristSettings";

export function canRestart() {
  return isAffirmative(process.env.GRIST_RUNNING_UNDER_SUPERVISOR) ||
    isAffirmative(process.env.GRIST_UNDER_RESTART_SHELL);
}

/**
 * Per-request config sent by admin-group endpoints (e.g. /admin, /boot).
 * `runningUnderSupervisor` doubles as the discriminator used by
 * `getAdminConfig()` on the client.
 */
export function makeAdminPageConfig(gristServer: GristServer): Partial<AdminPageConfig> {
  return {
    runningUnderSupervisor: canRestart(),
    adminControls: gristServer.create.areAdminControlsAvailable(),
    inService: getInService().value,
  };
}
