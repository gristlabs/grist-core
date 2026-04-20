// Deprecated: Grist now starts under its own RestartShell by default
// on Linux (see app/server/lib/RestartShell.ts), which handles
// admin-triggered restarts without dropping the listening socket.
// The Dockerfile no longer invokes this script; it is kept for
// external builds that still point at it. New deployments should
// run Grist directly and rely on RestartShell.
import {spawn} from "child_process";

let grist;

function startGrist(newConfig={}) {
  // Printing the user helps with setting volume permissions if
  // using a container.
  const uid = process.getuid();
  const gid = process.getgid();
  console.log(`Running Grist as user ${uid} with primary group ${gid}`);

  // H/T https://stackoverflow.com/a/36995148/11352427
  grist = spawn("./sandbox/run.sh", {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: {...process.env, GRIST_RUNNING_UNDER_SUPERVISOR: true}
  });
  grist.on("message", function(data) {
    if (data.action === "restart") {
      console.log("Restarting Grist with new configuration");

      // Note that we only set this event handler here, after we have
      // a new environment to reload with. Small chance of a race here
      // in case something else sends a SIGINT before we do it
      // ourselves further below.
      grist.on("exit", () => {
        grist = startGrist(data.newConfig);
      });

      grist.kill("SIGINT");
    }
  });
  return grist;
}

startGrist();
