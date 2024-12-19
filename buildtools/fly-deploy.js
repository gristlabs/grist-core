const util = require('util');
const childProcess = require('child_process');
const fs = require('fs/promises');

const exec = util.promisify(childProcess.exec);

const org = "grist-labs";
const expirationSec = 30 * 24 * 60 * 60;  // 30 days

const getAppName = () => "grist-" + getBranchName().toLowerCase().replace(/[\W|_]+/g, '-');
const getVolumeName = () => ("gv_" + getBranchName().toLowerCase().replace(/\W+/g, '_')).substring(0, 30);

const getBranchName = () => {
  if (!process.env.BRANCH_NAME) { console.log('Usage: Need BRANCH_NAME env var'); process.exit(1); }
  return process.env.BRANCH_NAME;
};

async function main() {
  switch (process.argv[2]) {
    case "deploy": {
      const name = getAppName();
      const volName = getVolumeName();
      if (!await appExists(name)) {
        await appCreate(name);
        await volCreate(name, volName);
      } else {
        // Check if volume exists, and create it if not. This is needed because there was an API
        // change in flyctl (mandatory -y flag) and some apps were created without a volume.
        if (!(await volList(name)).length) {
          await volCreate(name, volName);
        }
      }
      await prepConfig(name, volName);
      await appDeploy(name);
      break;
    }
    case "destroy": {
      const name = getAppName();
      if (await appExists(name)) {
        await appDestroy(name);
      }
      break;
    }
    case "clean": {
      const staleApps = await findStaleApps();
      for (const appName of staleApps) {
        await appDestroy(appName);
      }
      break;
    }
    default: {
      console.log(`Usage:
  deploy:   create (if needed) and deploy fly app grist-{BRANCH_NAME}.
  destroy:  destroy fly app grist-{BRANCH_NAME}
  clean:    destroy all grist-* fly apps whose time has come
            (according to FLY_DEPLOY_EXPIRATION env var set at deploy time)

  DRYRUN=1 in environment will show what would be done
`);
      process.exit(1);
    }
  }
}

function getDockerTag(name) {
  return `registry.fly.io/${name}:latest`;
}

const appExists = (name) => runFetch(`flyctl status -a ${name}`).then(() => true).catch(() => false);
// We do not deploy at the create stage, since the Docker image isn't ready yet.
// Assigning --image prevents flyctl from making inferences based on the codebase and provisioning unnecessary postgres/redis instances.
const appCreate = (name) => runAction(`flyctl launch --no-deploy --auto-confirm --image ${getDockerTag(name)} --name ${name} -r ewr -o ${org}`);
const volCreate = (name, vol) => runAction(`flyctl volumes create ${vol} -s 1 -r ewr -y -a ${name}`);
const volList = (name) => runFetch(`flyctl volumes list -a ${name} -j`).then(({stdout}) => JSON.parse(stdout));
const appDeploy = async (name) => {
  try {
    await runAction("flyctl auth docker")
    await runAction(`docker image tag grist-core:preview ${getDockerTag(name)}`);
    await runAction(`docker push ${getDockerTag(name)}`);
    await runAction(`flyctl deploy --app ${name} --image ${getDockerTag(name)}`);
  } catch (e) {
    console.log(`Error occurred when deploying: ${e}`);
    process.exit(1);
  }
};

async function appDestroy(name) {
  await runAction(`flyctl apps destroy ${name} -y`);
}

async function prepConfig(name, volName) {
  const configPath = "./fly.toml";
  const configTemplatePath = "./buildtools/fly-template.toml";
  const envVarsPath = "./buildtools/fly-template.env";
  const template = await fs.readFile(configTemplatePath, {encoding: 'utf8'});

  // Parse envVarsPath manually to avoid the need to install npm modules. It supports comments,
  // strips whitespace, and splits on "=". (If not for comments, we could've used json.)
  // The reason it's separate is to allow it to come from untrusted branches.
  const envVars = [];
  const envVarsContent = await fs.readFile(envVarsPath, {encoding: 'utf8'});
  for (const line of envVarsContent.split(/\n/)) {
    const match = /^(?:\s*([^#=]+?)\s*=\s*([^#]*?))?\s*(?:#.*)?$/.exec(line);
    if (!match) {
      throw new Error(`Invalid syntax in ${envVarsPath}, in ${line}`);
    }
    // The regexp also matches empty lines, but if match[1] is present, then we have key=value.
    if (match[1]) {
      envVars.push(`  ${stringifyTomlString(match[1])} = ${stringifyTomlString(match[2])}`);
    }
  }

  // Calculate the time when we can destroy the app, used by findStaleApps.
  const expiration = new Date(Date.now() + expirationSec * 1000).toISOString();
  const config = template
    .replace(/{APP_NAME}/g, name)
    .replace(/{VOLUME_NAME}/g, volName)
    .replace(/{FLY_DEPLOY_EXPIRATION}/g, expiration)
    // If there are any env vars, append them after line with <fly-template.env> tag.
    .replace(/<fly-template.env>.*/, `$&\n${envVars.join("\n")}`);

  await fs.writeFile(configPath, config);
}

// Stringify a string for safe inclusion into toml. (We are careful not to allow it to escape
// being a string.)
function stringifyTomlString(str) {
  // JSON.stringify() is sufficient to produce a safe TOML string.
  return JSON.stringify(String(str));
}

function runFetch(cmd) {
  console.log(`Running: ${cmd}`);
  return exec(cmd);
}

async function runAction(cmd) {
  if (process.env.DRYRUN) {
    console.log(`Would run: ${cmd}`);
    return;
  }
  console.log(`Running: ${cmd}`);
  const cp = childProcess.spawn(cmd, {shell: true, stdio: 'inherit'});
  return new Promise((resolve, reject) => {
    cp.on('error', reject);
    cp.on('exit', function (code) {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`exited with code ${code}`));
      }
    });
  });
}

async function findStaleApps() {
  const {stdout} = await runFetch(`flyctl apps list -j`);
  const list = JSON.parse(stdout);
  const appNames = [];
  for (const app of list) {
    if (app.Organization?.Slug !== org) {
      continue;
    }
    const {stdout} = await runFetch(`flyctl config display -a ${app.Name}`);
    const expiration = JSON.parse(stdout).env?.FLY_DEPLOY_EXPIRATION;
    if (!expiration) {
      continue;
    }
    const expired = (Date.now() > Number(new Date(expiration)));
    if (isNaN(expired)) {
      console.warn(`Skipping ${app.Name} with invalid expiration ${expiration}`);
    } else if (!expired) {
      console.log(`Skipping ${app.Name}; not reached expiration of ${expiration}`);
    } else {
      console.log(`Will clean ${app.Name}; expired at ${expiration}`);
      appNames.push(app.Name);
    }
  }
  return appNames;
}

main().catch(err => { console.warn("ERROR", err); process.exit(1); });
