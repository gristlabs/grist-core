import {server} from 'test/nbrowser/testServer';
import {createTmpDir} from 'test/server/docTools';
import {mkdtemp} from 'fs-extra';
import path from 'path';
import * as process from 'node:process';

/**
 * Adds a before() hook that sets the environment variables for external attachments, then restarts
 * the Grist server. Preserves existing values of those environment variables, and restores them in
 * the after() hook.
 * @param {string} transferDelay - Extra time to add to attachment transfers
 * @returns {{envVars: Record<string, string>, getAttachmentsDir(): string}}
 */
export function enableExternalAttachmentsForTestSuite(options: {
  thresholdMb?: number,
  transferDelay?: number,
}):
  { envVars: Record<string, string>; getAttachmentsDir(): string; }
{
  const {thresholdMb, transferDelay} = options;
  const envVars: Record<string, string> = {
    GRIST_EXTERNAL_ATTACHMENTS_MODE: 'test',
    GRIST_TEST_ATTACHMENTS_DIR: "",
  };

  if (transferDelay) {
    envVars.GRIST_TEST_TRANSFER_DELAY = String(transferDelay);
  }
  if (thresholdMb) {
    envVars.GRIST_ATTACHMENTS_THRESHOLD_MB = String(thresholdMb);
  }

  let originalEnv: Record<string, string | undefined> = {};

  before(async () => {
    const tempFolder = await createTmpDir();
    envVars.GRIST_TEST_ATTACHMENTS_DIR = await mkdtemp(path.join(tempFolder, 'attachments'));

    originalEnv = saveEnvVars(Object.keys(envVars));
    setEnvVars(envVars);

    await server.restart();
  });

  after(async () => {
    setEnvVars(originalEnv);

    await server.restart();
  });

  return {
    envVars,
    getAttachmentsDir() {
      return envVars.GRIST_TEST_ATTACHMENTS_DIR;
    }
  };
}

function saveEnvVars(varNames: string[]) {
  const originalEnvVars: Record<string, string | undefined> = {};
  for (const envVar of varNames) {
    originalEnvVars[envVar] = process.env[envVar];
  }

  return originalEnvVars;
}

function setEnvVars(vars: Record<string, string | undefined>) {
  for (const [varName, varValue] of Object.entries(vars)) {
    if (varValue === undefined) {
      delete process.env[varName];
    } else {
      process.env[varName] = varValue;
    }
  }
}
