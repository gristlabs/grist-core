import { appSettings, ValueWithSource } from "app/server/lib/AppSettings";

export interface ServiceStatus {
  inService: ValueWithSource<boolean>;
}

/**
 * Returns if this Grist installation is in service.
 *
 * When out of service, functionality is limited to administrative operations like
 * modifying installation settings.
 *
 * Used by `FlexServer.addSetupGate` to limit access to fresh installations until an operator
 * with access to server logs provides a boot key.
 */
export function getServiceStatus(): ServiceStatus {
  const setting = appSettings.section("grist").flag("inService");
  const value = setting.requireBool({
    envVar: "GRIST_IN_SERVICE",
    defaultValue: true,
  });
  const { source } = setting.describe();
  return { inService: { value, source } };
}
