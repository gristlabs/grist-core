import {Response as ExpressRequest} from 'express';
import {commonUrls} from "app/common/gristUrls";
import {version as installedVersion, LatestVersionAvailable} from "app/common/version";
import {naturalCompare} from 'app/common/SortFunc';
import {GristServer} from "app/server/lib/GristServer";

export async function checkForUpdates(gristServer: GristServer, res: ExpressRequest|null) {
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
  if (res) {
    if (!response.ok) {
      res.status(response.status);
      if (
        response.headers.get("content-type")?.includes("application/json")
      ) {
        const data = await response.json();
        res.json(data);
      } else {
        res.send(await response.text());
      }
    } else {
      res.json(await response.json());
    }
  }
  return await response.json();
}

export async function updateGristServerLatestVersion(gristServer: GristServer) {
  const response = await checkForUpdates(gristServer, null);

  // naturalCompare correctly sorts version numbers.
  const versions = [installedVersion, response.latestVersion];
  versions.sort(naturalCompare);

  const latestVersionAvailable: LatestVersionAvailable = {
    version: response.latestVersion,
    isNewer: versions[1] !== installedVersion,
  };

  gristServer.setLatestVersionAvailable(latestVersionAvailable);
}
