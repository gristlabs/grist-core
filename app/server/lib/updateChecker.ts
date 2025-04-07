import {commonUrls} from "app/common/gristUrls";
import {isAffirmative} from "app/common/gutil";
import {version as installedVersion, LatestVersionAvailable} from "app/common/version";
import {naturalCompare} from 'app/common/SortFunc';
import {GristServer} from "app/server/lib/GristServer";
import {ApiError} from "app/common/ApiError";

export async function checkForUpdates(gristServer: GristServer) {
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
    }
  );

  if (!response.ok) {
    const errorData = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text();
    throw new ApiError ('Version update checking failed', response.status, errorData);
  }

  return await response.json();
}

export async function updateGristServerLatestVersion(gristServer: GristServer) {
  // We only automatically check for versions in certain situations,
  // such as for example, in Docker images that enable this envvar
  if (!isAffirmative(process.env.GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING)) {
    return;
  }
  const response = await checkForUpdates(gristServer);

  // naturalCompare correctly sorts version numbers.
  const versions = [installedVersion, response.latestVersion];
  versions.sort(naturalCompare);

  const latestVersionAvailable: LatestVersionAvailable = {
    version: response.latestVersion,
    isNewer: versions[1] !== installedVersion,
  };

  await gristServer.publishLatestVersionAvailable(latestVersionAvailable);
}
