import { commonUrls } from "app/common/gristUrls";
import { version as installedVersion } from "app/common/version";
import {naturalCompare} from 'app/common/SortFunc';
import { GristServer } from "app/server/lib/GristServer";

export async function checkForUpdates(gristServer: GristServer) {
  const installationId = (await gristServer.getActivations().current()).id;
  const deploymentType = gristServer.getDeploymentType();

  const response = await fetch(
    process.env.GRIST_TEST_VERSION_CHECK_URL || commonUrls.versionCheck,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId,
        deploymentType,
        installedVersion,
      }),
    }
  );

  if (!response.ok) {
    const errorData = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text();
    throw new Error(`Update check failed: ${response.status} - ${errorData}`);
  }

  return await response.json();
}
