import { ApiError } from "app/common/ApiError";
import { commonUrls, LatestVersionAvailable } from "app/common/gristUrls";
import { isAffirmative } from "app/common/gutil";
import { naturalCompare } from "app/common/SortFunc";
import { version as installedVersion } from "app/common/version";
import { GristServer } from "app/server/lib/GristServer";
import { LatestVersion } from "app/server/lib/UpdateManager";

export async function checkForUpdates(gristServer: GristServer): Promise<LatestVersion> {
  // Prepare data for the telemetry that endpoint might expect.
  const installationId = (await gristServer.getActivations().current()).id;
  const deploymentType = gristServer.getDeploymentType();
  const currentVersion = installedVersion;
  const response = await fetch(
    process.env.GRIST_TEST_VERSION_CHECK_URL || commonUrls.versionCheck,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId,
        deploymentType,
        currentVersion,
      }),
    },
  );

  if (!response.ok) {
    const errorData = response.headers.get("content-type")?.includes("application/json") ?
      await response.json() :
      await response.text();
    throw new ApiError("Version update checking failed", response.status, errorData);
  }

  return await response.json();
}

export async function updateGristServerLatestVersion(
  gristServer: GristServer,
  forceCheck = false,
): Promise<LatestVersionAvailable | null> {
  // We only automatically check for versions in certain situations,
  // such as for example, in Docker images that enable
  // `GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING`. If `doItAnyway` is
  // true, we check, as this means the user explicitly requested a
  // one-time version check.
  const activation = await gristServer.getActivations().current();
  const prefEnabled = activation.prefs?.checkForLatestVersion ?? true;
  const envvarEnabled = isAffirmative(process.env.GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING);
  const doIt = (envvarEnabled && prefEnabled) || forceCheck;
  if (!doIt) {
    return null;
  }

  const response = await checkForUpdates(gristServer);

  // naturalCompare correctly sorts version numbers.
  const versions = [installedVersion, response.latestVersion];
  versions.sort(naturalCompare);

  const latestVersionAvailable: LatestVersionAvailable = {
    version: response.latestVersion,
    isNewer: versions[1] !== installedVersion,
    isCritical: response.isCritical ?? false,
    dateChecked: Date.now(),
    releaseUrl: response.updateURL,
  };

  await gristServer.publishLatestVersionAvailable(latestVersionAvailable);
  return latestVersionAvailable;
}
