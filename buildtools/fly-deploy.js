const util = require('util');
const childProcess = require('child_process');
const fs = require('fs/promises');
const {existsSync} = require('fs');

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
  if (process.argv[2] === 'deploy') {
    const appRoot = process.argv[3] || ".";
    if (!existsSync(`${appRoot}/Dockerfile`)) {
      console.log(`Dockerfile not found in appRoot of ${appRoot}`);
      process.exit(1);
    }

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
    await prepConfig(name, appRoot, volName);
    await appDeploy(name, appRoot);
  } else if (process.argv[2] === 'destroy') {
    const name = getAppName();
    if (await appExists(name)) {
      await appDestroy(name);
    }
  } else if (process.argv[2] === 'clean') {
    const staleApps = await findStaleApps();
    for (const appName of staleApps) {
      await appDestroy(appName);
    }
  } else {
    console.log(`Usage:
  deploy [appRoot]:
            create (if needed) and deploy fly app grist-{BRANCH_NAME}.
            appRoot may specify the working directory that contains the Dockerfile to build.
  destroy:  destroy fly app grist-{BRANCH_NAME}
  clean:    destroy all grist-* fly apps whose time has come
            (according to FLY_DEPLOY_EXPIRATION env var set at deploy time)

  DRYRUN=1 in environment will show what would be done
`);
    process.exit(1);
  }
}

const appExists = (name) => runFetch(`flyctl status -a ${name}`).then(() => true).catch(() => false);
const appCreate = (name) => runAction(`flyctl launch --auto-confirm --name ${name} -r ewr -o ${org} --vm-memory 1024`);
const volCreate = (name, vol) => runAction(`flyctl volumes create ${vol} -s 1 -r ewr -y -a ${name}`);
const volList = (name) => runFetch(`flyctl volumes list -a ${name} -j`).then(({stdout}) => JSON.parse(stdout));
const appDeploy = (name, appRoot) => runAction(`flyctl deploy ${appRoot} --remote-only --region=ewr --vm-memory 1024`,
  {shell: true, stdio: 'inherit'});

async function appDestroy(name) {
  await runAction(`flyctl apps destroy ${name} -y`);
}

async function prepConfig(name, appRoot, volName) {
  const configPath = `${appRoot}/fly.toml`;
  const configTemplatePath = `${appRoot}/buildtools/fly-template.toml`;
  const template = await fs.readFile(configTemplatePath, {encoding: 'utf8'});

  // Calculate the time when we can destroy the app, used by findStaleApps.
  const expiration = new Date(Date.now() + expirationSec * 1000).toISOString();
  const config = template
    .replace(/{APP_NAME}/g, name)
    .replace(/{VOLUME_NAME}/g, volName)
    .replace(/{FLY_DEPLOY_EXPIRATION}/g, expiration);
  await fs.writeFile(configPath, config);
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
