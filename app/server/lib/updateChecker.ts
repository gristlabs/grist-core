import {commonUrls} from "app/common/gristUrls";
import {version as installedVersion} from "app/common/version";
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
